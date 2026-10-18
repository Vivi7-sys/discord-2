use crate::{
    backend::Backend,
    config::Config,
    model::{phase, Shared},
    native::{self, Flags},
};
use livekit::{
    options::{TrackPublishOptions, VideoCodec, VideoEncoderBackend, VideoEncoding},
    prelude::*,
    webrtc::{
        audio_frame::AudioFrame,
        audio_source::{native::NativeAudioSource, AudioSourceOptions, RtcAudioSource},
        stats::RtcStats,
        video_source::{native::NativeVideoSource, RtcVideoSource, VideoResolution},
    },
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, watch};

// Dropping a JoinHandle detaches it; explicitly abort diagnostics on every exit.
struct DiagnosticsTask(tokio::task::JoinHandle<()>);
impl Drop for DiagnosticsTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub async fn run(config: Config, state: Shared, mut cancel: watch::Receiver<bool>) {
    let result = run_inner(config, state.clone(), &mut cancel).await;
    match result {
        Ok(()) => phase(&state, "idle", "Parado"),
        Err(message) if *cancel.borrow() && message == "Operação cancelada." => {
            phase(&state, "idle", "Parado")
        }
        Err(message) => phase(&state, "error", &message),
    }
}
async fn step<T>(
    future: impl std::future::Future<Output = Result<T, String>>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<T, String> {
    if *cancel.borrow() {
        return Err("Operação cancelada.".into());
    }
    tokio::select! {_ = cancel.changed()=>Err("Operação cancelada.".into()),result=tokio::time::timeout(Duration::from_secs(25),future)=>result.map_err(|_|"Tempo de conexão excedido.".to_string())?}
}
async fn run_inner(
    config: Config,
    state: Shared,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let (_, _, profile) = config.validate()?;
    let mut backend = Backend::new(&config)?;
    let (url, token) = step(backend.login(&config.name), cancel).await?;
    let (room, mut events) = step(
        async {
            let mut options = RoomOptions::default();
            options.auto_subscribe = false;
            options.dynacast = false;
            Room::connect(&url, &token, options)
                .await
                .map_err(|_| "Não foi possível conectar ao LiveKit.".into())
        },
        cancel,
    )
    .await?;
    let mut reserved = false;
    let mut video_control = None;
    let mut audio_thread = None;
    let stop = Arc::new(AtomicBool::new(false));
    let result: Result<(), String> = async {
        // Release even when the acquire reply is lost after the server grants it.
        reserved = true;
        step(async { backend.share("acquire").await.map(|_| ()) }, cancel).await?;
        let source = NativeVideoSource::new(
            VideoResolution { width: profile.width, height: profile.height }, true,
        );
        let track = LocalVideoTrack::create_video_track("screen", RtcVideoSource::Native(source.clone()));
        let video_options = TrackPublishOptions {
            source: TrackSource::Screenshare,
            video_codec: VideoCodec::H264,
            simulcast: false,
            video_encoding: Some(VideoEncoding {
                max_bitrate: profile.bitrate,
                max_framerate: profile.fps as f64,
            }),
            video_encoder: VideoEncoderBackend::Hardware,
            ..Default::default()
        };
        step(async {
            room.local_participant().publish_track(LocalTrack::Video(track.clone()), video_options)
                .await.map_err(|_| "Falha ao publicar vídeo na sala.".into())
        }, cancel).await?;

        let (vtx, mut vrx) = mpsc::channel(1);
        let (atx, mut arx) = mpsc::channel(5);
        let epoch = Instant::now();
        let flags = Flags { tx: vtx, state: state.clone(), stop: stop.clone(), profile, epoch };
        // Initialize video first. Otherwise audio fills its 50 ms queue while WGC starts.
        let c = config.clone();
        video_control = Some(tokio::task::spawn_blocking(move || native::video(&c, flags))
            .await.map_err(|_| "Falha ao iniciar captura.")??);

        let audio_source = if config.audio != "none" {
            let source = NativeAudioSource::new(AudioSourceOptions::default(), 48000, 2, 100);
            let track = LocalAudioTrack::create_audio_track("screen-audio", RtcAudioSource::Native(source.clone()));
            let options = TrackPublishOptions {
                source: TrackSource::ScreenshareAudio,
                dtx: false,
                ..Default::default()
            };
            step(async {
                room.local_participant().publish_track(LocalTrack::Audio(track), options)
                    .await.map_err(|_| "Falha ao publicar áudio na sala.".into())
            }, cancel).await?;
            let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
            audio_thread = Some(native::audio(config.clone(), stop.clone(), atx, ready_tx));
            let readiness = tokio::task::spawn_blocking(move || ready_rx.recv_timeout(Duration::from_secs(10)));
            step(async {
                readiness.await.map_err(|_| "Falha ao iniciar áudio.".to_string())?
                    .map_err(|_| "A captura de áudio não respondeu.".to_string())?
            }, cancel).await?;
            Some(source)
        } else { None };

        phase(&state, "streaming", "Transmitindo · captura nativa Windows");
        // Query SDK stats independently. A slow stats callback must not stop
        // audio/video ingestion or fill the bounded WASAPI queue.
        let (stats_tx, mut stats_rx) = mpsc::channel(1);
        let stats_track = track.clone();
        let _diagnostics = DiagnosticsTask(tokio::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_secs(2));
            loop {
                timer.tick().await;
                let stats = tokio::time::timeout(Duration::from_secs(1), stats_track.get_stats()).await;
                let stats = stats.ok().and_then(Result::ok);
                if stats_tx.send((Instant::now(), stats)).await.is_err() { break; }
            }
        }));
        let mut previous = (Instant::now(), 0u64, 0u32, 0u32, Instant::now());
        loop {
            if *cancel.borrow() { break; }
            if stop.load(Ordering::Acquire) || video_control.as_ref().is_some_and(|c| c.is_finished()) {
                return Err("A fonte de captura foi fechada ou interrompida.".into());
            }
            if audio_thread.as_ref().is_some_and(|t| t.is_finished()) {
                return Err("A captura de áudio foi interrompida; nenhum áudio alternativo foi ativado.".into());
            }
            tokio::select! {
                _ = cancel.changed() => break,
                event = events.recv() => {
                    if matches!(event, Some(RoomEvent::Disconnected { .. }) | None) {
                        return Err("Conexão perdida. Captura encerrada.".into());
                    }
                },
                packet = vrx.recv() => {
                    let packet = packet.ok_or("A captura de vídeo foi encerrada.")?;
                    if packet.at.elapsed() > Duration::from_millis(150) {
                        state.lock().unwrap_or_else(|p| p.into_inner()).dropped += 1;
                    } else {
                        let source = source.clone();
                        tokio::task::spawn_blocking(move || source.capture_frame(&native::rtc_frame(packet)))
                            .await.map_err(|_| "Falha na entrega de vídeo ao SDK.")?;
                        state.lock().unwrap_or_else(|p| p.into_inner()).submitted += 1;
                    }
                },
                samples = arx.recv(), if audio_source.is_some() => {
                    let samples = samples.ok_or("A captura de áudio foi encerrada.")?;
                    let frame = AudioFrame { data: samples.into(), sample_rate: 48000, num_channels: 2, samples_per_channel: 480 };
                    tokio::time::timeout(Duration::from_millis(250), audio_source.as_ref().unwrap().capture_frame(&frame))
                        .await.map_err(|_| "Atraso na publicação de áudio.")?
                        .map_err(|_| "Falha na publicação de áudio.")?;
                },
                sample = stats_rx.recv() => {
                    let (now, stats) = sample.ok_or("O serviço de diagnósticos foi interrompido.")?;
                    let seconds = now.duration_since(previous.0).as_secs_f64().max(0.001);
                    let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
                    if s.captured == 0 && epoch.elapsed() > Duration::from_secs(10) {
                        return Err("Windows.Graphics.Capture não entregou frames. Selecione outra fonte.".into());
                    }
                    s.captured_fps = s.captured.saturating_sub(previous.1) as f64 / seconds;
                    s.encoded_fps = None;
                    s.published_fps = None;
                    if let Some(stats) = stats {
                        // One primary video stream (simulcast is off); do not let
                        // an RTX-only entry replace video counters with zeros.
                        let primary=stats.into_iter().filter_map(|stat|match stat {
                            RtcStats::OutboundRtp(out) if out.stream.kind=="video" => Some(out.outbound),
                            _ => None,
                        }).max_by_key(|out|out.frames_encoded);
                        if let Some(out)=primary {
                            let stats_seconds=now.duration_since(previous.4).as_secs_f64().max(0.001);
                            s.encoded_fps=Some(out.frames_encoded.saturating_sub(previous.2) as f64/stats_seconds);
                            s.published_fps=Some(out.frames_sent.saturating_sub(previous.3) as f64/stats_seconds);
                            if !out.encoder_implementation.is_empty(){s.encoder=Some(out.encoder_implementation);}
                            previous.2=out.frames_encoded;
                            previous.3=out.frames_sent;
                            previous.4=now;
                        }
                    }
                    previous.0 = now;
                    previous.1 = s.captured;
                },
            }
        }
        Ok(())
    }.await;
    phase(&state, "stopping", "Encerrando captura e liberando a sala…");
    stop.store(true, Ordering::Release);
    let mut cleanup_error = None;
    if let Some(control) = video_control {
        if !matches!(
            tokio::task::spawn_blocking(move || control.stop()).await,
            Ok(Ok(()))
        ) {
            state.lock().unwrap_or_else(|p| p.into_inner()).restart_safe = false;
            cleanup_error = Some(
                "Falha ao encerrar a captura. Feche o aplicativo antes de reiniciar.".to_string(),
            );
        }
    }
    if let Some(thread) = audio_thread {
        if !matches!(
            tokio::task::spawn_blocking(move || thread.join()).await,
            Ok(Ok(Ok(())))
        ) && result.is_ok()
        {
            cleanup_error = Some("A captura de áudio terminou com erro.".into());
        }
    }
    if reserved {
        let released = backend.release().await;
        state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .release_confirmed = Some(released);
        if !released {
            cleanup_error=Some("Liberação da sala não confirmada. O servidor verificará a desconexão na próxima tentativa.".into());
        }
    }
    let _ = tokio::time::timeout(Duration::from_secs(6), room.close()).await;
    if let Some(error) = cleanup_error {
        Err(error)
    } else {
        result
    }
}
