//! Linux capture only: portal-authorized PipeWire video and verified output-monitor audio.
use crate::{
    config::{Config, Profile},
    model::Shared,
};
use ashpd::desktop::{
    screencast::{CursorMode, Screencast, SourceType},
    PersistMode, Session,
};
use futures_util::StreamExt;
use gst::prelude::*;
use gstreamer as gst;
use gstreamer_video::VideoFrameExt;
use livekit::webrtc::video_frame::{I420Buffer, VideoFrame, VideoRotation};
use serde::Serialize;
use serde_json::Value;
use std::{
    os::fd::{AsRawFd, OwnedFd},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, watch};

#[derive(Serialize)]
pub struct Target {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub pid: Option<u32>,
}
pub fn targets() -> Result<Vec<Target>, String> {
    // Wayland never enumerates other clients' windows; the compositor owns the picker.
    Ok(vec![
        Target {
            id: "portal:monitor".into(),
            label: "Escolher monitor no portal do sistema…".into(),
            kind: "monitor".into(),
            pid: None,
        },
        Target {
            id: "portal:window".into(),
            label: "Escolher janela no portal do sistema…".into(),
            kind: "window".into(),
            pid: None,
        },
    ])
}
pub fn validate(config: &Config) -> Result<(), String> {
    if !["none", "system"].contains(&config.audio.as_str()) {
        return Err("Isolamento por aplicativo e exclusão do Discord indisponíveis no Linux. Escolha áudio do sistema ou sem áudio.".into());
    }
    if !["portal:monitor", "portal:window"].contains(&config.target.as_str()) {
        return Err("Selecione monitor ou janela pelo portal Linux.".into());
    }
    Ok(())
}
pub struct VideoPacket {
    pub buffer: I420Buffer,
    pub timestamp_us: i64,
    pub at: Instant,
}
pub struct Flags {
    pub tx: mpsc::Sender<VideoPacket>,
    pub state: Shared,
    pub stop: Arc<AtomicBool>,
    pub profile: Profile,
    pub epoch: Instant,
}
struct PortalSession(Option<Session<'static, Screencast<'static>>>);
impl Drop for PortalSession {
    fn drop(&mut self) {
        if let Some(session) = self.0.take() {
            // Also runs when the user cancels during the portal's source dialog.
            tokio::spawn(async move {
                let _ = session.close().await;
            });
        }
    }
}
pub struct VideoControl {
    pipeline: gst::Pipeline,
    worker: Option<thread::JoinHandle<Result<(), String>>>,
    portal: PortalSession,
    _remote: OwnedFd,
    watcher: tokio::task::JoinHandle<()>,
    stop: Arc<AtomicBool>,
}
impl VideoControl {
    pub fn is_finished(&self) -> bool {
        self.worker.as_ref().is_none_or(|w| w.is_finished())
    }
    pub async fn stop(mut self) -> Result<(), String> {
        self.stop.store(true, Ordering::Release);
        let pipeline = self.pipeline.clone();
        tokio::task::spawn_blocking(move || pipeline.set_state(gst::State::Null))
            .await
            .map_err(|_| "Falha ao encerrar PipeWire.")?
            .map_err(|_| "Falha ao encerrar PipeWire.")?;
        self.watcher.abort();
        if let Some(session) = self.portal.0.take() {
            tokio::time::timeout(Duration::from_secs(5), session.close())
                .await
                .map_err(|_| "O portal não confirmou encerramento.")?
                .map_err(|_| "Falha ao fechar a sessão do portal.")?;
        }
        if let Some(worker) = self.worker.take() {
            let _capture_result = tokio::task::spawn_blocking(move || worker.join())
                .await
                .map_err(|_| "Falha ao encerrar captura.")?
                .map_err(|_| "Falha na captura.")?;
        }
        Ok(())
    }
}
impl Drop for VideoControl {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = self.pipeline.set_state(gst::State::Null);
        self.watcher.abort();
    }
}
fn initialize() -> Result<(), String> {
    gst::init().map_err(|_| "GStreamer indisponível.".into())
}
fn pipeline(description: &str) -> Result<(gst::Pipeline, gstreamer_app::AppSink), String> {
    let pipeline = gst::parse::launch(description)
        .map_err(|e| format!("Falha no pipeline de captura: {e}"))?
        .downcast::<gst::Pipeline>()
        .map_err(|_| "Pipeline inválido.")?;
    let sink = pipeline
        .by_name("frames")
        .ok_or("Appsink ausente.")?
        .downcast::<gstreamer_app::AppSink>()
        .map_err(|_| "Appsink inválido.")?;
    Ok((pipeline, sink))
}
fn bus_error(pipeline: &gst::Pipeline) -> Result<(), String> {
    if let Some(message) = pipeline
        .bus()
        .and_then(|b| b.pop_filtered(&[gst::MessageType::Error, gst::MessageType::Eos]))
    {
        return Err(match message.view() {
            gst::MessageView::Error(e) => format!("A captura foi interrompida: {}", e.error()),
            _ => "A fonte de captura foi encerrada.".into(),
        });
    }
    Ok(())
}
pub async fn video(
    config: &Config,
    flags: Flags,
    cancel: &mut watch::Receiver<bool>,
) -> Result<VideoControl, String> {
    validate(config)?;
    initialize()?;
    if *cancel.borrow() {
        return Err("Operação cancelada.".into());
    }
    let proxy = tokio::time::timeout(Duration::from_secs(5), Screencast::new())
        .await
        .map_err(|_| "Portal ScreenCast não respondeu.")?
        .map_err(|_| "Portal ScreenCast indisponível.")?;
    let session = tokio::time::timeout(Duration::from_secs(5), proxy.create_session())
        .await
        .map_err(|_| "O portal não criou uma sessão a tempo.")?
        .map_err(|_| "Falha ao criar sessão do portal.")?;
    let mut portal = PortalSession(Some(session));
    let session = portal.0.as_ref().unwrap();
    let result = {
        let operation = async {
            let kind = if config.target == "portal:window" {
                SourceType::Window
            } else {
                SourceType::Monitor
            };
            proxy
                .select_sources(
                    session,
                    CursorMode::Embedded,
                    kind.into(),
                    false,
                    None,
                    PersistMode::DoNot,
                )
                .await
                .map_err(|_| "Não foi possível selecionar o tipo de captura.")?
                .response()
                .map_err(|_| "Seleção recusada pelo portal.")?;
            let response = proxy
                .start(session, None)
                .await
                .map_err(|_| "Seleção cancelada ou recusada pelo portal.")?
                .response()
                .map_err(|_| "Captura cancelada ou recusada.")?;
            if response.streams().len() != 1 {
                return Err("O portal deve autorizar exatamente uma fonte.".to_string());
            }
            let node = response.streams()[0].pipe_wire_node_id();
            let remote = proxy
                .open_pipe_wire_remote(session)
                .await
                .map_err(|_| "Falha ao abrir PipeWire autorizado.")?;
            let p = flags.profile;
            let (pipeline, sink) = pipeline(&format!("pipewiresrc fd={} path={} do-timestamp=true ! video/x-raw,pixel-aspect-ratio=1/1 ! queue max-size-buffers=1 leaky=downstream ! videorate drop-only=true ! video/x-raw,framerate={}/1 ! videoconvert ! videoscale add-borders=true ! video/x-raw,format=I420,width={},height={},pixel-aspect-ratio=1/1 ! appsink name=frames sync=false max-buffers=1 drop=true enable-last-sample=false", remote.as_raw_fd(), node, p.fps, p.width, p.height))?;
            Ok((pipeline, sink, remote))
        };
        if *cancel.borrow() {
            Err("Operação cancelada.".into())
        } else {
            tokio::select! {
                _ = cancel.changed() => Err("Operação cancelada.".into()),
                result = tokio::time::timeout(Duration::from_secs(120), operation) => result.unwrap_or_else(|_| Err("Tempo de seleção do portal excedido.".into())),
            }
        }
    };
    let (pipeline, sink, remote) = match result {
        Ok(v) => v,
        Err(error) => {
            if let Some(session) = portal.0.take() {
                if !matches!(
                    tokio::time::timeout(Duration::from_secs(5), session.close()).await,
                    Ok(Ok(()))
                ) {
                    flags
                        .state
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .restart_safe = false;
                    return Err("O portal não confirmou encerramento. Feche o aplicativo antes de reiniciar.".into());
                }
            }
            return Err(error);
        }
    };
    let mut closed = portal
        .0
        .as_ref()
        .unwrap()
        .receive_closed()
        .await
        .map_err(|_| "Falha ao observar o portal.")?;
    if pipeline.set_state(gst::State::Playing).is_err() {
        let _ = pipeline.set_state(gst::State::Null);
        return Err("Não foi possível iniciar PipeWire.".into());
    }
    let stop = flags.stop.clone();
    let watcher = tokio::spawn(async move {
        let _ = closed.next().await;
        stop.store(true, Ordering::Release);
    });
    let stop = flags.stop.clone();
    let capture_pipeline = pipeline.clone();
    let worker = thread::spawn(move || video_worker(capture_pipeline, sink, flags));
    Ok(VideoControl {
        pipeline,
        worker: Some(worker),
        portal,
        _remote: remote,
        watcher,
        stop,
    })
}
fn video_worker(
    pipeline: gst::Pipeline,
    sink: gstreamer_app::AppSink,
    flags: Flags,
) -> Result<(), String> {
    let mut next_frame = Instant::now();
    let interval = Duration::from_secs_f64(1.0 / flags.profile.fps as f64);
    while !flags.stop.load(Ordering::Acquire) {
        bus_error(&pipeline)?;
        let Some(sample) = sink.try_pull_sample(gst::ClockTime::from_mseconds(100)) else {
            continue;
        };
        let at = Instant::now();
        flags
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .captured += 1;
        if at + Duration::from_millis(1) < next_frame {
            continue;
        }
        next_frame += interval;
        if next_frame < at {
            next_frame = at + interval;
        }
        let Ok(permit) = flags.tx.try_reserve() else {
            flags
                .state
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .dropped += 1;
            continue;
        };
        let info = gstreamer_video::VideoInfo::from_caps(
            sample.caps().ok_or("Formato de vídeo ausente.")?,
        )
        .map_err(|_| "Formato de vídeo inválido.")?;
        let frame = gstreamer_video::VideoFrameRef::from_buffer_ref_readable(
            sample.buffer().ok_or("Frame vazio.")?,
            &info,
        )
        .map_err(|_| "Falha ao ler frame PipeWire.")?;
        let mut buffer = I420Buffer::new(info.width(), info.height());
        let (sy, su, sv) = buffer.strides();
        let (y, u, v) = buffer.data_mut();
        for (plane, output, stride, width, height) in [
            (
                0,
                y,
                sy as usize,
                info.width() as usize,
                info.height() as usize,
            ),
            (
                1,
                u,
                su as usize,
                info.width() as usize / 2,
                info.height() as usize / 2,
            ),
            (
                2,
                v,
                sv as usize,
                info.width() as usize / 2,
                info.height() as usize / 2,
            ),
        ] {
            let input = frame
                .plane_data(plane)
                .map_err(|_| "Plano I420 inválido.")?;
            let input_stride = frame.plane_stride()[plane as usize] as usize;
            for row in 0..height {
                output[row * stride..row * stride + width]
                    .copy_from_slice(&input[row * input_stride..row * input_stride + width]);
            }
        }
        flags
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .processing_ms = at.elapsed().as_secs_f64() * 1000.;
        permit.send(VideoPacket {
            buffer,
            timestamp_us: flags.epoch.elapsed().as_micros() as i64,
            at,
        });
    }
    Ok(())
}
pub fn rtc_frame(packet: VideoPacket) -> VideoFrame<I420Buffer> {
    let mut frame = VideoFrame::new(VideoRotation::VideoRotation0, packet.buffer);
    frame.timestamp_us = packet.timestamp_us;
    frame
}
fn pactl(args: &[&str]) -> Result<String, String> {
    let output = Command::new("pactl")
        .env("LC_ALL", "C.UTF-8")
        .args(args)
        .output()
        .map_err(|_| "pactl indisponível.")?;
    if !output.status.success() {
        return Err("Não foi possível consultar o monitor de saída PipeWire/PulseAudio.".into());
    }
    String::from_utf8(output.stdout).map_err(|_| "Resposta de áudio inválida.".into())
}
fn reference_matches(value: &Value, name: &str, index: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|v| v == name || index.as_u64().is_some_and(|i| v == i.to_string()))
        || (value.is_number() && value == index)
}
pub fn output_monitor(sources: &Value, sinks: &Value, default: &str) -> Result<String, String> {
    let sink = sinks
        .as_array()
        .and_then(|s| s.iter().find(|s| s["name"] == default))
        .ok_or("Saída padrão indisponível.")?;
    let source = sources
        .as_array()
        .and_then(|ss| {
            ss.iter().find(|s| {
                let Some(name) = s["name"].as_str() else {
                    return false;
                };
                // Confirm both directions against real sink/source records. Never trust '.monitor'.
                reference_matches(&sink["monitor_source"], name, &s["index"])
                    && reference_matches(
                        s.get("monitor_of_sink").unwrap_or(&s["monitor_source"]),
                        default,
                        &sink["index"],
                    )
            })
        })
        .ok_or("Monitor da saída não confirmado; nenhum microfone será utilizado.")?;
    Ok(source["name"].as_str().unwrap().into())
}
fn system_monitor() -> Result<String, String> {
    let sources: Value = serde_json::from_str(&pactl(&["-f", "json", "list", "sources"])?)
        .map_err(|_| "Fontes de áudio inválidas.")?;
    let sinks: Value = serde_json::from_str(&pactl(&["-f", "json", "list", "sinks"])?)
        .map_err(|_| "Saídas de áudio inválidas.")?;
    output_monitor(&sources, &sinks, pactl(&["get-default-sink"])?.trim())
}
pub fn audio(
    config: Config,
    stop: Arc<AtomicBool>,
    tx: mpsc::Sender<Vec<i16>>,
    ready: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> thread::JoinHandle<Result<(), String>> {
    thread::spawn(move || {
        let setup = (|| {
            validate(&config)?;
            initialize()?;
            let monitor = system_monitor()?;
            let (pipeline, sink) = pipeline("pulsesrc name=output do-timestamp=true ! audioconvert ! audioresample ! audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! appsink name=frames sync=false max-buffers=5 drop=true enable-last-sample=false")?;
            let source = pipeline.by_name("output").unwrap();
            source.set_property("device", &monitor);
            let policy = gst::Structure::builder("props")
                .field("node.dont-fallback", true)
                .field("node.dont-reconnect", true)
                .build();
            source.set_property("stream-properties", &policy);
            pipeline
                .set_state(gst::State::Playing)
                .map_err(|_| "Não foi possível iniciar o monitor de áudio.")?;
            Ok::<_, String>((pipeline, sink, source, monitor))
        })();
        let (pipeline, sink, source, monitor) = match setup {
            Ok(v) => v,
            Err(e) => {
                let _ = ready.send(Err(e.clone()));
                return Err(e);
            }
        };
        // Require actual monitor samples before declaring audio ready.
        let mut ready = Some(ready);
        let result: Result<(), String> = (|| {
            let mut pending = Vec::with_capacity(1920);
            let deadline = Instant::now() + Duration::from_secs(8);
            let mut last_sample = Instant::now();
            while !stop.load(Ordering::Acquire) {
                bus_error(&pipeline)?;
                let Some(sample) = sink.try_pull_sample(gst::ClockTime::from_mseconds(100)) else {
                    if ready.is_some() && Instant::now() > deadline
                        || last_sample.elapsed() > Duration::from_secs(5)
                    {
                        return Err("O monitor de áudio não entregou amostras.".into());
                    }
                    continue;
                };
                last_sample = Instant::now();
                if source
                    .property::<Option<String>>("current-device")
                    .as_deref()
                    != Some(monitor.as_str())
                {
                    return Err(
                        "A fonte de áudio mudou; captura encerrada para impedir uso do microfone."
                            .into(),
                    );
                }
                let data = sample
                    .buffer()
                    .ok_or("Áudio vazio.")?
                    .map_readable()
                    .map_err(|_| "Falha ao ler áudio.")?;
                pending.extend(
                    data.as_slice()
                        .chunks_exact(2)
                        .map(|b| i16::from_le_bytes([b[0], b[1]])),
                );
                if let Some(ready) = ready.take() {
                    let _ = ready.send(Ok(()));
                }
                while pending.len() >= 960 {
                    let samples = pending.drain(..960).collect();
                    match tx.try_send(samples) {
                        Ok(()) | Err(mpsc::error::TrySendError::Full(_)) => {}
                        Err(_) => return Ok(()),
                    }
                }
            }
            Ok(())
        })();
        if let (Some(ready), Err(error)) = (ready, &result) {
            let _ = ready.send(Err(error.clone()));
        }
        let _ = pipeline.set_state(gst::State::Null);
        result
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn unavailable_isolation_is_rejected_by_the_backend() {
        let mut config = Config {
            invite: String::new(),
            name: String::new(),
            profile: "1080p60".into(),
            target: "portal:monitor".into(),
            audio: "exclude".into(),
            audio_pid: Some(100),
        };
        assert!(validate(&config).is_err());
        config.audio = "application".into();
        assert!(validate(&config).is_err());
        config.audio = "system".into();
        assert!(validate(&config).is_ok());
        config.target = "monitor:123".into();
        assert!(validate(&config).is_err());
    }
    #[test]
    fn monitor_is_confirmed_in_both_directions() {
        let sinks = json!([{"name":"speakers", "index":4,"monitor_source":8}]);
        let sources = json!([{"name":"mic","index":7,"monitor_of_sink":4294967295u32}, {"name":"actual-output","index":8,"monitor_of_sink":4}]);
        assert_eq!(
            output_monitor(&sources, &sinks, "speakers").unwrap(),
            "actual-output"
        );
        assert_eq!(
            output_monitor(
                &json!([{"name":"actual-output","index":8,"monitor_source":"speakers"}]),
                &json!([{"name":"speakers","index":4,"monitor_source":"actual-output"}]),
                "speakers"
            )
            .unwrap(),
            "actual-output"
        );
        assert!(output_monitor(
            &json!([{"name":"fake.monitor","index":8,"monitor_of_sink":4294967295u32}]),
            &sinks,
            "speakers"
        )
        .is_err());
        assert!(output_monitor(&sources, &sinks, "missing").is_err());
    }
}

/// Read-only diagnostics used by the packaged executable's --check command.
pub async fn preflight() -> serde_json::Value {
    let initialized = initialize().is_ok();
    let plugins: serde_json::Map<String, Value> = [
        "pipewiresrc",
        "pulsesrc",
        "videoconvert",
        "videoscale",
        "videorate",
        "appsink",
        "audioconvert",
        "audioresample",
    ]
    .into_iter()
    .map(|name| {
        (
            name.into(),
            Value::Bool(initialized && gst::ElementFactory::find(name).is_some()),
        )
    })
    .collect();
    let portal = match tokio::time::timeout(Duration::from_secs(5), async {
        Screencast::new().await?.available_source_types().await
    })
    .await
    {
        Ok(Ok(types)) => {
            serde_json::json!({"monitor":types.contains(SourceType::Monitor), "window":types.contains(SourceType::Window)})
        }
        _ => Value::Null,
    };
    let monitor = system_monitor();
    let ready = plugins.values().all(|v| v == &Value::Bool(true)) && !portal.is_null();
    serde_json::json!({"ready":ready, "platform":"linux", "capture":"XDG Desktop Portal / PipeWire", "plugins":plugins, "portal":portal, "systemAudioMonitor":monitor.as_ref().ok(), "systemAudioError":monitor.err(), "microphone":false, "discordExclusionAvailable":false})
}

#[cfg(test)]
mod pipeline_tests {
    use super::*;
    use crate::model::Snapshot;
    use livekit::webrtc::video_frame::VideoBuffer;
    use std::sync::Mutex;
    #[test]
    fn gstreamer_i420_conversion_and_bounded_stop() {
        initialize().unwrap();
        let (pipeline, sink) = pipeline("videotestsrc is-live=true pattern=red ! video/x-raw,format=I420,width=1280,height=720,framerate=30/1 ! appsink name=frames sync=false max-buffers=1 drop=true").unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, mut rx) = mpsc::channel(1);
        let flags = Flags {
            tx,
            stop: stop.clone(),
            state: Arc::new(Mutex::new(Snapshot::default())),
            profile: Profile {
                width: 1280,
                height: 720,
                fps: 30,
                bitrate: 3_000_000,
            },
            epoch: Instant::now(),
        };
        pipeline.set_state(gst::State::Playing).unwrap();
        let p = pipeline.clone();
        let worker = thread::spawn(move || video_worker(p, sink, flags));
        let deadline = Instant::now() + Duration::from_secs(10);
        let packet = loop {
            if let Ok(packet) = rx.try_recv() {
                break packet;
            }
            assert!(Instant::now() < deadline, "No synthetic pipeline frame");
            thread::sleep(Duration::from_millis(10));
        };
        stop.store(true, Ordering::Release);
        pipeline.set_state(gst::State::Null).unwrap();
        worker.join().unwrap().unwrap();
        assert_eq!((packet.buffer.width(), packet.buffer.height()), (1280, 720));
        let (y, u, v) = packet.buffer.data();
        assert!((75..=85).contains(&y[0]));
        assert!((85..=95).contains(&u[0]));
        assert!((235..=245).contains(&v[0]));
    }
}
