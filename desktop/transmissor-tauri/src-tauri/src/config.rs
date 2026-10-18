use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub invite: String,
    pub name: String,
    pub profile: String,
    pub target: String,
    pub audio: String,
    pub audio_pid: Option<u32>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Profile {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u64,
}
impl Config {
    pub fn validate(&self) -> Result<(Url, String, Profile), String> {
        let invalid = || "Cole um convite HTTPS válido /sala/… do Discord 2.".to_string();
        let url = Url::parse(self.invite.trim()).map_err(|_| invalid())?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || self
                .invite
                .trim()
                .chars()
                .any(|c| c.is_control() || c.is_whitespace())
        {
            return Err(invalid());
        }
        let room = url
            .path()
            .strip_prefix("/sala/")
            .ok_or_else(invalid)?
            .to_string();
        if room.len() != 64
            || !room
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(invalid());
        }
        let n = self.name.trim().encode_utf16().count();
        if !(2..=24).contains(&n) || self.name.chars().any(char::is_control) {
            return Err("Use um nome de 2 a 24 caracteres.".into());
        }
        let profile = match self.profile.as_str() {
            "720p30" => Profile {
                width: 1280,
                height: 720,
                fps: 30,
                bitrate: 3_000_000,
            },
            "1080p30" => Profile {
                width: 1920,
                height: 1080,
                fps: 30,
                bitrate: 5_000_000,
            },
            "1080p60" => Profile {
                width: 1920,
                height: 1080,
                fps: 60,
                bitrate: 8_000_000,
            },
            _ => return Err("Perfil de qualidade inválido.".into()),
        };
        if !["none", "system", "application", "exclude"].contains(&self.audio.as_str()) {
            return Err("Modo de áudio inválido.".into());
        }
        if self.audio == "application" && self.audio_pid.is_none_or(|p| p == 0) {
            return Err("Selecione o processo cujo áudio será transmitido.".into());
        }
        if self.target.is_empty() {
            return Err("Selecione um monitor ou janela.".into());
        }
        Ok((url, room, profile))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> Config {
        Config {
            invite: format!(
                "https://discord-2-kuau.onrender.com/sala/{}",
                "a".repeat(64)
            ),
            name: "Vivi".into(),
            profile: "1080p60".into(),
            target: "monitor:1".into(),
            audio: "none".into(),
            audio_pid: None,
        }
    }
    #[test]
    fn preserves_profiles() {
        let mut c = config();
        for (p, w, h, f) in [
            ("720p30", 1280, 720, 30),
            ("1080p30", 1920, 1080, 30),
            ("1080p60", 1920, 1080, 60),
        ] {
            c.profile = p.into();
            let v = c.validate().unwrap().2;
            assert_eq!((v.width, v.height, v.fps), (w, h, f));
        }
    }
    #[test]
    fn rejects_invalid_invites() {
        for v in [
            "http://host/sala/",
            "https://host/sala/xyz",
            "https://u:p@host/sala/",
            "file:///tmp/a",
        ] {
            let mut c = config();
            c.invite = v.into();
            assert!(c.validate().is_err());
        }
        for suffix in ["?x=1", "#a", "/"] {
            let mut c = config();
            c.invite += suffix;
            assert!(c.validate().is_err());
        }
    }
    #[test]
    fn isolation_requires_process() {
        let mut c = config();
        c.audio = "application".into();
        assert!(c.validate().is_err());
        c.audio_pid = Some(0);
        assert!(c.validate().is_err());
        c.audio_pid = Some(123);
        assert!(c.validate().is_ok());
        c.audio = "microphone".into();
        assert!(c.validate().is_err());
    }
    #[test]
    fn rejects_unknown_fields() {
        assert!(serde_json::from_str::<Config>(r#"{"invite":"x","name":"a","profile":"x","target":"x","audio":"none","audioPid":null,"microphone":true}"#).is_err());
    }
}
