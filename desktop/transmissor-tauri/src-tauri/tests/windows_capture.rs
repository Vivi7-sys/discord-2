#![cfg(windows)]
// Real WGC probe: never substitute synthetic pixels when no desktop is available.
use d2_transmitter::{config::Config, model::Snapshot, native};
use std::{
    sync::{atomic::AtomicBool, Arc, Mutex},
    time::{Duration, Instant},
};

#[test]
#[ignore = "requires an interactive Windows desktop; no microphone or audio capture"]
fn real_wgc_frame_and_stop_on_static_desktop() {
    let target = native::targets()
        .unwrap()
        .into_iter()
        .find(|t| t.kind == "monitor")
        .expect("No real monitor available");
    let config = Config {
        invite: format!("https://fixture.invalid/sala/{}", "a".repeat(64)),
        name: "WGC probe".into(),
        target: target.id,
        profile: "720p30".into(),
        audio: "none".into(),
        audio_pid: None,
    };
    let profile = config.validate().unwrap().2;
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    let state = Arc::new(Mutex::new(Snapshot::default()));
    let control = native::video(
        &config,
        native::Flags {
            tx,
            state: state.clone(),
            stop: Arc::new(AtomicBool::new(false)),
            profile,
            epoch: Instant::now(),
        },
    )
    .expect("WGC failed; do not claim desktop capture support on this runner");
    let started = Instant::now();
    let mut packet = None;
    while started.elapsed() < Duration::from_secs(10) {
        if let Ok(frame) = rx.try_recv() {
            packet = Some(frame);
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let stop = Instant::now();
    control.stop().expect("WGC stop failed");
    assert!(
        stop.elapsed() < Duration::from_secs(3),
        "Stop must wake the message loop on a static desktop"
    );
    let packet = packet.expect("No real WGC frame was captured");
    let frame = native::rtc_frame(packet);
    use livekit::webrtc::video_frame::VideoBuffer;
    assert!(frame.buffer.width() > 0);
    assert!(frame.buffer.width() <= 1280);
    assert!(frame.buffer.height() <= 720);
    let report = serde_json::json!({"synthetic":false,"platform":"windows","capture":"Windows.Graphics.Capture","framesObserved":state.lock().unwrap().captured,"width":frame.buffer.width(),"height":frame.buffer.height(),"stopMs":stop.elapsed().as_secs_f64()*1000.,"rtcPublicationTested":false,"audioTested":false});
    std::fs::create_dir_all("../evidence").unwrap();
    std::fs::write(
        "../evidence/windows-real-wgc.json",
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
}
