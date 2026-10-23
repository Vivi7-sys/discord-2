//! A quiet test signal played through the real system output, never injected into RTC.
use std::{
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};
pub struct Tone {
    child: Child,
    path: PathBuf,
}
impl Tone {
    pub fn play() -> std::io::Result<Self> {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("d2-linux-tone-{}-{nonce}.pcm", std::process::id()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        for n in 0..96000 {
            let envelope = ((n as f64 / 480.).min(1.)).min(((96000 - n) as f64 / 480.).min(1.));
            let sample = ((n as f64 * 440. * std::f64::consts::TAU / 48000.).sin()
                * 8192.
                * envelope) as i16;
            file.write_all(&sample.to_le_bytes())?;
            file.write_all(&sample.to_le_bytes())?;
        }
        drop(file);
        let result = Command::new("paplay")
            .args([
                "--raw",
                "--rate=48000",
                "--channels=2",
                "--format=s16le",
                "--volume=8192",
            ])
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        match result {
            Ok(child) => Ok(Self { child, path }),
            Err(error) => {
                let _ = std::fs::remove_file(path);
                Err(error)
            }
        }
    }
}
impl Drop for Tone {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        let _ = std::fs::remove_file(&self.path);
    }
}
