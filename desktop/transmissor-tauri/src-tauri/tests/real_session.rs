#![cfg(windows)]
// Requires a dedicated test room and an independent subscribed receiver.
// The test never uses the production site unless explicitly configured by its owner.
use d2_transmitter::{config::Config, model::Snapshot, native, session};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires D2_TEST_INVITE for a dedicated test environment and an active receiver"]
async fn real_connection_capture_and_rtp_publication() {
    let invite = std::env::var("D2_TEST_INVITE").expect("Dedicated test invitation required");
    let target = native::targets()
        .unwrap()
        .into_iter()
        .find(|t| t.kind == "monitor")
        .expect("Interactive desktop required");
    let config = Config {
        invite,
        name: "Rust integration".into(),
        target: target.id,
        profile: "720p30".into(),
        audio: "none".into(),
        audio_pid: None,
    };
    let state = Arc::new(Mutex::new(Snapshot::default()));
    let (cancel, rx) = tokio::sync::watch::channel(false);
    let task = tokio::spawn(session::run(config, state.clone(), rx));
    let mut live = false;
    for _ in 0..45 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let snapshot = state.lock().unwrap().clone();
        if snapshot.phase == "error" {
            break;
        }
        if snapshot.captured > 0
            && snapshot.submitted > 0
            && snapshot.published_fps.is_some_and(|v| v > 0.)
        {
            live = true;
            break;
        }
    }
    let _ = cancel.send(true);
    tokio::time::timeout(Duration::from_secs(30), task)
        .await
        .expect("Stop timeout")
        .unwrap();
    let snapshot = state.lock().unwrap().clone();
    let report = serde_json::json!({"synthetic":false,"capture":"Windows.Graphics.Capture","audioMode":"none","rtpObserved":live,"receiverDecodeVerified":false,"snapshot":snapshot});
    std::fs::create_dir_all("../evidence").unwrap();
    std::fs::write(
        "../evidence/windows-real-session.json",
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    assert!(
        live,
        "No real captured/submitted/RTP frames; installer gate must remain closed"
    );
    assert_eq!(snapshot.release_confirmed, Some(true));
    assert_eq!(snapshot.phase, "idle");
}
