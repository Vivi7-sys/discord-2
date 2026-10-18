use serde::Serialize;
use std::sync::{Arc, Mutex};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub phase: String,
    pub message: String,
    pub captured: u64,
    pub submitted: u64,
    pub dropped: u64,
    pub captured_fps: f64,
    pub encoded_fps: Option<f64>,
    pub published_fps: Option<f64>,
    pub processing_ms: f64,
    pub restart_safe: bool,
    pub encoder: Option<String>,
    pub release_confirmed: Option<bool>,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            message: "Pronto para conectar".into(),
            captured: 0,
            submitted: 0,
            dropped: 0,
            captured_fps: 0.,
            encoded_fps: None,
            published_fps: None,
            processing_ms: 0.,
            restart_safe: true,
            encoder: None,
            release_confirmed: None,
        }
    }
}
pub type Shared = Arc<Mutex<Snapshot>>;
pub fn phase(state: &Shared, phase: &str, message: &str) {
    let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
    s.phase = phase.into();
    s.message = message.into();
}
