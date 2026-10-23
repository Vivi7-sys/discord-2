#![cfg(target_os = "linux")]
//! Requires an owner-provided dedicated room. Both receiver decoders consume real media.
#[path = "support/linux_audio.rs"]
mod linux_audio;
use d2_transmitter::{backend::Backend, config::Config, model::Snapshot, session};
use futures_util::StreamExt;
use livekit::{
    prelude::*,
    webrtc::{audio_stream::native::NativeAudioStream, video_stream::native::NativeVideoStream},
};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires D2_TEST_INVITE and interactive portal approval; connects an independent real receiver"]
async fn real_connection_capture_audio_decode_and_release() {
    let config = Config {
        invite: std::env::var("D2_TEST_INVITE").expect("Dedicated test invitation required"),
        name: "Rust Linux sender".into(),
        target: "portal:monitor".into(),
        profile: std::env::var("D2_TEST_PROFILE").unwrap_or_else(|_| "720p30".into()),
        audio: "system".into(),
        audio_pid: None,
    };
    let mut viewer = Backend::new(&config).unwrap();
    let (url, token) = viewer.login("Rust Linux receiver").await.unwrap();
    let (receiver, mut events) = Room::connect(&url, &token, RoomOptions::default())
        .await
        .unwrap();
    let decoded_video = Arc::new(AtomicU64::new(0));
    let decoded_audio = Arc::new(AtomicU64::new(0));
    let peak_audio = Arc::new(AtomicU64::new(0));
    let video_count = decoded_video.clone();
    let audio_count = decoded_audio.clone();
    let peak_count = peak_audio.clone();
    let receive_task = tokio::spawn(async move {
        let mut decoders = tokio::task::JoinSet::new();
        while let Some(event) = events.recv().await {
            if let RoomEvent::TrackSubscribed { track, .. } = event {
                match track {
                    RemoteTrack::Video(track) => {
                        let count = video_count.clone();
                        decoders.spawn(async move {
                            let mut stream = NativeVideoStream::new(track.rtc_track());
                            while stream.next().await.is_some() {
                                count.fetch_add(1, Ordering::Relaxed);
                            }
                        });
                    }
                    RemoteTrack::Audio(track) => {
                        let count = audio_count.clone();
                        let peak = peak_count.clone();
                        decoders.spawn(async move {
                            let mut stream = NativeAudioStream::new(track.rtc_track(), 48000, 2);
                            while let Some(frame) = stream.next().await {
                                count.fetch_add(1, Ordering::Relaxed);
                                peak.fetch_max(
                                    frame
                                        .data
                                        .iter()
                                        .map(|v| (*v as i32).unsigned_abs() as u64)
                                        .max()
                                        .unwrap_or(0),
                                    Ordering::Relaxed,
                                );
                            }
                        });
                    }
                }
            }
        }
    });
    let state = Arc::new(Mutex::new(Snapshot::default()));
    let (cancel, rx) = tokio::sync::watch::channel(false);
    let task = tokio::spawn(session::run(config.clone(), state.clone(), rx));
    let mut live = false;
    let mut tone = None;
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let snapshot = state.lock().unwrap().clone();
        if snapshot.phase == "streaming" && tone.is_none() {
            tone = linux_audio::Tone::play().ok();
        }
        if snapshot.phase == "error" {
            break;
        }
        if snapshot.submitted > 0
            && snapshot.published_fps.is_some_and(|v| v > 0.)
            && decoded_video.load(Ordering::Relaxed) > 5
            && decoded_audio.load(Ordering::Relaxed) > 5
            && peak_audio.load(Ordering::Relaxed) > 0
        {
            live = true;
            break;
        }
    }
    // Verify the server refuses a second publisher while real tracks are active.
    let mut contender = Backend::new(&config).unwrap();
    let conflict = if live {
        let (contender_url, contender_token) = contender.login("Rust conflict peer").await.unwrap();
        let (room, _events) =
            Room::connect(&contender_url, &contender_token, RoomOptions::default())
                .await
                .unwrap();
        let result = contender.share("acquire").await;
        let conflict = result.as_ref().is_err_and(|e| e.contains("Outra pessoa"));
        if result.is_ok() {
            let _ = contender.release().await;
        }
        let _ = room.close().await;
        conflict
    } else {
        false
    };
    let _ = cancel.send(true);
    tokio::time::timeout(Duration::from_secs(30), task)
        .await
        .expect("Stop timeout")
        .unwrap();
    let _ = receiver.close().await;
    receive_task.abort();
    let snapshot = state.lock().unwrap().clone();
    let report = serde_json::json!({"synthetic":false,"capture":"XDG Desktop Portal / PipeWire","profile":config.profile,"audioMode":"system","microphoneCaptured":false,"rtpObserved":live,"receiverDecodedVideoFrames":decoded_video.load(Ordering::Relaxed),"receiverDecodedAudioFrames":decoded_audio.load(Ordering::Relaxed),"receiverAudioPeak":peak_audio.load(Ordering::Relaxed),"testSignal":"quiet-tone-through-real-system-output","exclusivityVerified":conflict,"snapshot":snapshot});
    std::fs::create_dir_all("../evidence").unwrap();
    std::fs::write(
        "../evidence/linux-real-session.json",
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    assert!(live, "Real screen/audio decoding remains unvalidated");
    assert!(conflict, "Publisher exclusivity not confirmed");
    assert_eq!(snapshot.release_confirmed, Some(true));
    assert_eq!(snapshot.phase, "idle");
    assert!(snapshot.restart_safe);
}
