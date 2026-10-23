#![cfg(target_os = "linux")]
// Compile the exact callback helper shipped by the vendored SDK, so the normal
// application cargo test run covers FFI reply completion and malformed reports.
pub use livekit::webrtc::{stats, RtcError, RtcErrorType};
#[path = "../vendor/libwebrtc-0.3.42/src/stats_callback.rs"]
mod stats_callback;
