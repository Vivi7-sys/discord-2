#![cfg(windows)]
// CPU conversion only: no WGC, encoder, network, or WebView is measured here.
use livekit::webrtc::{native::yuv_helper, video_frame::I420Buffer};
use std::time::Instant;
#[test]
fn synthetic_bgra_conversion_profiles() {
    let mut reports = Vec::new();
    for (name, width, height, fps) in [
        ("720p30", 1280, 720, 30),
        ("1080p30", 1920, 1080, 30),
        ("1080p60", 1920, 1080, 60),
    ] {
        // BGRA test pattern: solid red. Padding is deliberately included.
        let pitch = width * 4 + 64;
        let mut bgra = vec![0; pitch as usize * height as usize];
        for row in bgra.chunks_exact_mut(pitch as usize) {
            for pixel in row[..width as usize * 4].as_chunks_mut::<4>().0.iter_mut() {
                pixel.copy_from_slice(&[0, 0, 255, 255]);
            }
        }
        let mut output = I420Buffer::new(width, height);
        let (sy, su, sv) = output.strides();
        let mut times = Vec::new();
        for _ in 0..128 {
            let (y, u, v) = output.data_mut();
            let start = Instant::now();
            yuv_helper::argb_to_i420(
                &bgra,
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
            times.push(start.elapsed().as_secs_f64() * 1000.);
        }
        let (y, u, v) = output.data();
        assert!((75..=90).contains(&y[0]));
        assert!(u[0] < 110);
        assert!(v[0] > 220, "Red and blue must not be swapped");
        times.sort_by(f64::total_cmp);
        let mean = times.iter().sum::<f64>() / times.len() as f64;
        reports.push(serde_json::json!({"profile":name,"requestedFps":fps,"frames":128,"p50Ms":times[64],"p95Ms":times[121],"meanMs":mean,"conversionThroughputFps":1000./mean}));
    }
    let report = serde_json::json!({"synthetic":true,"pipeline":"CPU BGRA (padded rows) -> libyuv SIMD -> I420","realCapture":false,"encoded":false,"published":false,"results":reports});
    std::fs::create_dir_all("../evidence").unwrap();
    std::fs::write(
        "../evidence/windows-synthetic-conversion.json",
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
}
