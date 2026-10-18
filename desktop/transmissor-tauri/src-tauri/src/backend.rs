use crate::config::Config;
use reqwest::{redirect::Policy, Client};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use url::Url;
// Tokens never cross IPC, appear in diagnostics, or go to disk.
pub struct Backend {
    client: Client,
    base: Url,
    room: String,
    token: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Grant {
    token: String,
    server_url: String,
}
impl Backend {
    pub fn new(config: &Config) -> Result<Self, String> {
        let (mut base, room, _) = config.validate()?;
        base.set_path("/");
        Ok(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(Policy::none())
                .build()
                .map_err(|_| "Falha ao preparar conexão segura.")?,
            base,
            room,
            token: String::new(),
        })
    }
    pub async fn login(&mut self, name: &str) -> Result<(String, String), String> {
        let value = self
            .post(
                "api/livekit/token",
                json!({"roomId":self.room,"displayName":name.trim()}),
                false,
            )
            .await?;
        let grant: Grant = serde_json::from_value(value)
            .map_err(|_| "O servidor não forneceu uma sessão válida.")?;
        let endpoint = Url::parse(&grant.server_url).map_err(|_| "Endereço LiveKit inválido.")?;
        if endpoint.scheme() != "wss"
            || endpoint.host_str().is_none()
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || grant.token.is_empty()
        {
            return Err("Endereço LiveKit inseguro ou sessão inválida.".into());
        }
        self.token = grant.token.clone();
        Ok((grant.server_url, grant.token))
    }
    async fn post(&self, path: &str, body: Value, auth: bool) -> Result<Value, String> {
        let mut req = self
            .client
            .post(self.base.join(path).map_err(|_| "Endereço inválido.")?)
            .json(&body);
        if auth {
            req = req.bearer_auth(&self.token);
        }
        let res = req
            .send()
            .await
            .map_err(|_| "Falha de rede. Confira a conexão.")?;
        match res.status().as_u16() {
            200 => res
                .json()
                .await
                .map_err(|_| "Resposta inválida do servidor.".into()),
            409 => Err("Outra pessoa está transmitindo nesta sala.".into()),
            429 => Err("Muitas tentativas. Aguarde um minuto.".into()),
            401 | 403 => Err("Acesso recusado. Confira o convite e a autorização da sala.".into()),
            _ => Err("Não foi possível acessar a sala.".into()),
        }
    }
    pub async fn share(&self, action: &str) -> Result<Value, String> {
        self.post(
            "api/livekit/share",
            json!({"roomId":self.room,"action":action}),
            true,
        )
        .await
    }
    pub async fn release(&self) -> bool {
        for _ in 0..2 {
            if let Ok(Ok(v)) =
                tokio::time::timeout(Duration::from_secs(6), self.share("release")).await
            {
                if v.get("reservationHeld") == Some(&Value::Bool(false)) {
                    return true;
                }
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    fn fixture(responses: Vec<(u16, Value)>) -> (Backend, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            responses.into_iter().map(|(status,body)|{
   let (mut stream,_)=listener.accept().unwrap();stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
   let mut data=Vec::new();let mut buffer=[0u8;2048];
   loop{let len=stream.read(&mut buffer).unwrap();assert!(len>0);data.extend_from_slice(&buffer[..len]);
    if let Some(end)=data.windows(4).position(|w|w==b"\r\n\r\n") {let headers=String::from_utf8_lossy(&data[..end]);let length=headers.lines().find_map(|l|l.to_lowercase().strip_prefix("content-length:").and_then(|v|v.trim().parse::<usize>().ok())).unwrap_or(0);if data.len()>=end+4+length{break;}}
   }
   let body=body.to_string();write!(stream,"HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();String::from_utf8(data).unwrap()
  }).collect()
        });
        (
            Backend {
                client: Client::builder()
                    .timeout(Duration::from_secs(3))
                    .redirect(Policy::none())
                    .build()
                    .unwrap(),
                base: Url::parse(&format!("http://{address}/")).unwrap(),
                room: "a".repeat(64),
                token: String::new(),
            },
            handle,
        )
    }
    #[tokio::test]
    async fn authentication_and_reservation_contract() {
        let (mut backend, server) = fixture(vec![
            (
                200,
                json!({"token":"fixture-bearer","serverUrl":"wss://rtc.example.test"}),
            ),
            (200, json!({"reservationHeld":true})),
            (200, json!({"reservationHeld":false})),
        ]);
        backend.login("Vivi").await.unwrap();
        backend.share("acquire").await.unwrap();
        assert!(backend.release().await);
        let requests = server.join().unwrap();
        assert!(!requests[0].contains("authorization:"));
        assert!(requests[1].contains("authorization: Bearer fixture-bearer"));
        assert!(requests[1].contains("\"action\":\"acquire\""));
        assert!(requests[2].contains("\"action\":\"release\""));
    }
    #[tokio::test]
    async fn refuses_insecure_livekit() {
        let (mut backend, server) = fixture(vec![(
            200,
            json!({"token":"fixture","serverUrl":"ws://rtc.example.test"}),
        )]);
        assert!(backend.login("Vivi").await.is_err());
        server.join().unwrap();
        assert!(backend.token.is_empty());
    }
    #[tokio::test]
    async fn surfaces_room_exclusivity() {
        let (backend, server) = fixture(vec![(409, json!({"error":"sensitive server detail"}))]);
        let error = backend.share("acquire").await.unwrap_err();
        assert_eq!(error, "Outra pessoa está transmitindo nesta sala.");
        assert!(!error.contains("sensitive"));
        server.join().unwrap();
    }
}
