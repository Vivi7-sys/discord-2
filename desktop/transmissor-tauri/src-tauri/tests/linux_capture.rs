#![cfg(target_os = "linux")]
#[path = "support/linux_audio.rs"]
mod linux_audio;
use d2_transmitter::{config::Config, model::Snapshot, native};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
fn config(audio: &str) -> Config {
    Config {
        invite: format!("https://fixture.invalid/sala/{}", "a".repeat(64)),
        name: "Linux probe".into(),
        profile: "720p30".into(),
        target: "portal:monitor".into(),
        audio: audio.into(),
        audio_pid: None,
    }
}
fn report(name: &str, value: serde_json::Value) {
    std::fs::create_dir_all("../evidence").unwrap();
    std::fs::write(
        format!("../evidence/{name}.json"),
        serde_json::to_vec_pretty(&value).unwrap(),
    )
    .unwrap();
}
#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires interactive COSMIC/Wayland portal approval; never substitutes synthetic video"]
async fn real_portal_frame_and_stop() {
    let config = config("none");
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    let state = Arc::new(Mutex::new(Snapshot::default()));
    let (cancel, mut cancelled) = tokio::sync::watch::channel(false);
    let timer = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(40)).await;
        let _ = cancel.send(true);
    });
    let control = native::video(
        &config,
        native::Flags {
            tx,
            state: state.clone(),
            stop: Arc::new(AtomicBool::new(false)),
            profile: config.validate().unwrap().2,
            epoch: Instant::now(),
        },
        &mut cancelled,
    )
    .await;
    timer.abort();
    let control = match control {
        Ok(v) => v,
        Err(e) => {
            report(
                "linux-real-capture",
                serde_json::json!({"synthetic":false,"validated":false,"error":e}),
            );
            panic!("Real portal capture unavailable: {e}");
        }
    };
    let packet = tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .ok()
        .flatten();
    let stop = Instant::now();
    let stopped = control.stop().await;
    report(
        "linux-real-capture",
        serde_json::json!({"synthetic":false,"validated":packet.is_some() && stopped.is_ok(),"framesObserved":state.lock().unwrap().captured,"stopMs":stop.elapsed().as_secs_f64()*1000.,"stopped":stopped.is_ok(),"livekitTested":false}),
    );
    stopped.unwrap();
    assert!(packet.is_some(), "PipeWire delivered no real frame");
}
#[test]
#[ignore = "captures real system output monitor (no microphone); requires PipeWire/PulseAudio session"]
fn real_output_monitor_samples() {
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, mut rx) = tokio::sync::mpsc::channel(5);
    let (ready, readiness) = std::sync::mpsc::sync_channel(1);
    let worker = native::audio(config("system"), stop.clone(), tx, ready);
    let initialized = readiness.recv_timeout(Duration::from_secs(10));
    let tone = if initialized.as_ref().is_ok_and(|r| r.is_ok()) {
        linux_audio::Tone::play().ok()
    } else {
        None
    };
    let mut blocks = 0;
    let mut peak = 0i32;
    let started = Instant::now();
    while initialized.as_ref().is_ok_and(|r| r.is_ok())
        && started.elapsed() < Duration::from_secs(3)
    {
        if let Ok(samples) = rx.try_recv() {
            assert_eq!(samples.len(), 960);
            blocks += 1;
            peak = peak.max(
                samples
                    .into_iter()
                    .map(|v| (v as i32).abs())
                    .max()
                    .unwrap_or(0),
            );
        } else {
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    stop.store(true, Ordering::Release);
    let stopped = worker.join().unwrap();
    report(
        "linux-real-audio",
        serde_json::json!({"synthetic":false,"monitorSamplesReceived":blocks>0,"blocks":blocks,"peak":peak,"microphoneCaptured":false,"audibleSignalValidated":peak>0,"testSignal":"quiet-tone-through-real-system-output","testSignalStarted":tone.is_some(),"stopped":stopped.is_ok(),"livekitTested":false}),
    );
    initialized.unwrap().unwrap();
    stopped.unwrap();
    assert!(blocks > 0, "No real output-monitor samples");
    assert!(
        tone.is_some() && peak > 0,
        "Real playback signal was not captured"
    );
}
