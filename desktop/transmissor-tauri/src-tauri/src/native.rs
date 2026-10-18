use crate::{
    config::{Config, Profile},
    model::Shared,
};
use livekit::webrtc::{
    native::yuv_helper,
    video_frame::{I420Buffer, VideoFrame, VideoRotation},
};
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
use windows_capture::{
    capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl},
    monitor::Monitor,
    settings::*,
    window::Window,
};
pub type NativeError = Box<dyn std::error::Error + Send + Sync>;
#[derive(Serialize)]
pub struct Target {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub pid: Option<u32>,
}
pub fn targets() -> Result<Vec<Target>, String> {
    let mut list = Vec::new();
    for m in Monitor::enumerate().map_err(|_| "Não foi possível listar os monitores.")? {
        list.push(Target {
            id: format!("monitor:{}", m.as_raw_hmonitor() as usize),
            label: m.name().unwrap_or_else(|_| "Monitor".into()),
            kind: "monitor".into(),
            pid: None,
        });
    }
    for w in Window::enumerate().map_err(|_| "Não foi possível listar as janelas.")? {
        if let Ok(title) = w.title() {
            if !title.is_empty() {
                list.push(Target {
                    id: format!("window:{}", w.as_raw_hwnd() as usize),
                    label: title,
                    kind: "window".into(),
                    pid: w.process_id().ok(),
                });
            }
        }
    }
    Ok(list)
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
pub struct Capture {
    flags: Flags,
    next_frame: Instant,
}
impl GraphicsCaptureApiHandler for Capture {
    type Flags = Flags;
    type Error = NativeError;
    fn new(ctx: Context<Flags>) -> Result<Self, NativeError> {
        Ok(Self {
            flags: ctx.flags,
            next_frame: Instant::now(),
        })
    }
    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        control: InternalCaptureControl,
    ) -> Result<(), NativeError> {
        if self.flags.stop.load(Ordering::Acquire) {
            control.stop();
            return Ok(());
        }
        let at = Instant::now();
        {
            let mut s = self.flags.state.lock().unwrap_or_else(|p| p.into_inner());
            s.captured += 1;
        }
        let interval = Duration::from_secs_f64(1. / self.flags.profile.fps as f64);
        // Keep a running deadline: comparing against the last arrival halves FPS
        // when WGC delivers just before the nominal 16.67/33.33 ms boundary.
        if at + Duration::from_millis(1) < self.next_frame {
            self.flags
                .state
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .dropped += 1;
            return Ok(());
        }
        self.next_frame += interval;
        if self.next_frame < at {
            self.next_frame = at + interval;
        }
        // Reserve BEFORE GPU readback/conversion. At most one pending frame.
        let permit = match self.flags.tx.try_reserve() {
            Ok(p) => p,
            Err(_) => {
                self.flags
                    .state
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .dropped += 1;
                return Ok(());
            }
        };
        let width = frame.width() / 2 * 2;
        let height = frame.height() / 2 * 2;
        if width == 0 || height == 0 {
            self.flags
                .state
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .dropped += 1;
            return Ok(());
        }
        let mut buffer = I420Buffer::new(width, height);
        let (sy, su, sv) = buffer.strides();
        let (y, u, v) = buffer.data_mut();
        let mut pixels = frame.buffer()?;
        let pitch = pixels.row_pitch();
        // WGC BGRA bytes correspond to libyuv ARGB on little-endian Windows.
        yuv_helper::argb_to_i420(
            pixels.as_raw_buffer(),
            pitch,
            y,
            sy,
            u,
            su,
            v,
            sv,
            width as i32,
            height as i32,
        );
        let p = self.flags.profile;
        // Preserve aspect ratio; never stretch an application window.
        let ratio = (p.width as f64 / width as f64)
            .min(p.height as f64 / height as f64)
            .min(1.);
        let out_w = ((width as f64 * ratio) as u32 / 2 * 2).max(2);
        let out_h = ((height as f64 * ratio) as u32 / 2 * 2).max(2);
        if out_w != width || out_h != height {
            buffer = buffer.scale(out_w as i32, out_h as i32);
        }
        self.flags
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .processing_ms = at.elapsed().as_secs_f64() * 1000.;
        permit.send(VideoPacket {
            buffer,
            timestamp_us: at.duration_since(self.flags.epoch).as_micros() as i64,
            at,
        });
        Ok(())
    }
    fn on_closed(&mut self) -> Result<(), NativeError> {
        self.flags.stop.store(true, Ordering::Release);
        Ok(())
    }
}
pub type VideoControl = CaptureControl<Capture, NativeError>;
pub fn video(config: &Config, flags: Flags) -> Result<VideoControl, String> {
    let fps = flags.profile.fps;
    let minimum_interval =
        if GraphicsCaptureApi::is_minimum_update_interval_supported().unwrap_or(false) {
            MinimumUpdateIntervalSettings::Custom(Duration::from_secs_f64(1. / fps as f64))
        } else {
            MinimumUpdateIntervalSettings::Default
        };
    macro_rules! start_item {
        ($item:expr) => {
            Capture::start_free_threaded(Settings::new(
                $item,
                CursorCaptureSettings::Default,
                DrawBorderSettings::Default,
                SecondaryWindowSettings::Default,
                minimum_interval,
                DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                flags,
            ))
            .map_err(|_| "Não foi possível iniciar Windows.Graphics.Capture.".to_string())
        };
    }
    if config.target.starts_with("monitor:") {
        let m = Monitor::enumerate()
            .map_err(|_| "Monitor indisponível.")?
            .into_iter()
            .find(|m| format!("monitor:{}", m.as_raw_hmonitor() as usize) == config.target)
            .ok_or("Monitor removido. Atualize as fontes.")?;
        start_item!(m)
    } else {
        let w = Window::enumerate()
            .map_err(|_| "Janela indisponível.")?
            .into_iter()
            .find(|w| format!("window:{}", w.as_raw_hwnd() as usize) == config.target)
            .ok_or("Janela fechada. Atualize as fontes.")?;
        start_item!(w)
    }
}
pub fn rtc_frame(packet: VideoPacket) -> VideoFrame<I420Buffer> {
    let mut f = VideoFrame::new(VideoRotation::VideoRotation0, packet.buffer);
    f.timestamp_us = packet.timestamp_us;
    f
}

fn process_snapshot() -> sysinfo::System {
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    system
}

// Dedicated COM thread, render loopback only. Never activate a recording endpoint.
pub fn audio(
    config: Config,
    stop: Arc<AtomicBool>,
    tx: mpsc::Sender<Vec<i16>>,
    ready: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> std::thread::JoinHandle<Result<(), String>> {
    std::thread::spawn(move || {
        let result = audio_loop(config, stop, tx, &ready);
        if result.is_err() {
            let _ = ready.try_send(Err(
                "Falha na captura WASAPI; nenhum áudio alternativo foi selecionado.".into(),
            ));
        }
        result
    })
}
fn audio_loop(
    config: Config,
    stop: Arc<AtomicBool>,
    tx: mpsc::Sender<Vec<i16>>,
    ready: &std::sync::mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    use wasapi::*;
    let err = |_| "Não foi possível ativar a captura de áudio solicitada.".to_string();
    initialize_mta()
        .ok()
        .map_err(|_| "Falha ao inicializar COM de áudio.")?;
    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            wasapi::deinitialize();
        }
    }
    let _com = ComGuard;
    let mut excluded_pid = None;
    let mut included_process = None;
    let mut client = match config.audio.as_str() {
        "system" => {
            let enumerator = DeviceEnumerator::new().map_err(err)?;
            let device = enumerator
                .get_default_device(&Direction::Render)
                .map_err(err)?;
            device.get_iaudioclient().map_err(err)?
        }
        "application" => {
            let pid = config.audio_pid.ok_or("Processo não selecionado.")?;
            let system = process_snapshot();
            let process = system
                .process(sysinfo::Pid::from_u32(pid))
                .ok_or("Aplicativo fechado. Atualize a seleção de áudio.")?;
            included_process = Some((pid, process.start_time()));
            AudioClient::new_application_loopback_client(pid, true).map_err(err)?
        }
        "exclude" => {
            let system = process_snapshot();
            let mut roots = system
                .processes()
                .iter()
                .filter(|(_, p)| {
                    p.name()
                        .to_string_lossy()
                        .eq_ignore_ascii_case("discord.exe")
                })
                .filter(|(_, p)| {
                    p.parent().is_none_or(|parent| {
                        system.process(parent).is_none_or(|p| {
                            !p.name()
                                .to_string_lossy()
                                .eq_ignore_ascii_case("discord.exe")
                        })
                    })
                })
                .map(|(pid, _)| pid.as_u32());
            let pid = roots
                .next()
                .ok_or("Discord não encontrado. A exclusão de áudio não pode ser garantida.")?;
            if roots.next().is_some() {
                return Err(
                    "Há múltiplos processos raiz do Discord. Exclusão segura indisponível.".into(),
                );
            }
            excluded_pid = Some(pid);
            AudioClient::new_application_loopback_client(pid, false).map_err(err)?
        }
        _ => return Err("Modo de áudio não capturável.".into()),
    };
    let format = WaveFormat::new(16, 16, &SampleType::Int, 48000, 2, None);
    client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: 200_000,
            },
        )
        .map_err(err)?;
    let event = client.set_get_eventhandle().map_err(err)?;
    let capture = client.get_audiocaptureclient().map_err(err)?;
    client.start_stream().map_err(err)?;
    let _ = ready.send(Ok(()));
    let result = (|| {
        let mut bytes = VecDeque::with_capacity(19200);
        let mut process_check = Instant::now() - Duration::from_secs(2);
        while !stop.load(Ordering::Acquire) {
            if process_check.elapsed() > Duration::from_secs(1) {
                if let Some((pid, start_time)) = included_process {
                    let system = process_snapshot();
                    if system
                        .process(sysinfo::Pid::from_u32(pid))
                        .is_none_or(|p| p.start_time() != start_time)
                    {
                        return Err("O aplicativo de áudio foi fechado ou reiniciado. Selecione-o novamente.".into());
                    }
                }

                if let Some(pid) = excluded_pid {
                    let system = process_snapshot();
                    let roots: Vec<_> = system
                        .processes()
                        .iter()
                        .filter(|(_, p)| {
                            p.name()
                                .to_string_lossy()
                                .eq_ignore_ascii_case("discord.exe")
                        })
                        .filter(|(_, p)| {
                            p.parent().is_none_or(|parent| {
                                system.process(parent).is_none_or(|p| {
                                    !p.name()
                                        .to_string_lossy()
                                        .eq_ignore_ascii_case("discord.exe")
                                })
                            })
                        })
                        .map(|(pid, _)| pid.as_u32())
                        .collect();
                    if roots != vec![pid] {
                        return Err("Discord foi fechado ou reiniciado. Reconfigure a exclusão antes de transmitir.".into());
                    }
                }
                process_check = Instant::now();
            }
            while capture.get_next_packet_size().map_err(err)?.unwrap_or(0) > 0 {
                capture.read_from_device_to_deque(&mut bytes).map_err(err)?;
                if bytes.len() > 19200 {
                    return Err("Fila de áudio excedeu 100 ms. Reinicie a transmissão.".into());
                }
            }
            while bytes.len() >= 1920 {
                let chunk: Vec<u8> = bytes.drain(..1920).collect();
                let samples = chunk
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .copied()
                    .map(i16::from_le_bytes)
                    .collect();
                tx.try_send(samples)
                    .map_err(|_| "Publicação de áudio atrasou. Captura interrompida.")?;
            }
            let _ = event.wait_for_event(20);
        }
        Ok(())
    })();
    let _ = client.stop_stream();
    result
}
