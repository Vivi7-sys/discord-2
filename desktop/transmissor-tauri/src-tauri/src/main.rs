#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(any(windows, target_os = "linux"))]
mod desktop {
    use d2_transmitter::{
        config::Config,
        model::{phase, Shared, Snapshot},
        native, session,
    };
    use std::sync::{Arc, Mutex};
    use tauri::{Manager, State};
    use tokio::sync::{watch, Mutex as AsyncMutex};
    struct Running {
        cancel: watch::Sender<bool>,
        task: tokio::task::JoinHandle<()>,
    }
    struct AppState {
        snapshot: Shared,
        running: AsyncMutex<Option<Running>>,
    }
    #[tauri::command]
    fn snapshot(state: State<'_, AppState>) -> Snapshot {
        state
            .snapshot
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
    #[tauri::command]
    async fn list_targets() -> Result<Vec<native::Target>, String> {
        tokio::task::spawn_blocking(native::targets)
            .await
            .map_err(|_| "Não foi possível listar fontes.".to_string())?
    }
    #[tauri::command]
    async fn start(config: Config, state: State<'_, AppState>) -> Result<(), String> {
        config.validate()?;
        #[cfg(target_os = "linux")]
        native::validate(&config)?;
        let mut guard = state.running.lock().await;
        if guard.as_ref().is_some_and(|r| !r.task.is_finished()) {
            return Err("Uma sessão já está em andamento.".into());
        }
        if let Some(previous) = guard.take() {
            if previous.task.await.is_err() {
                state
                    .snapshot
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .restart_safe = false;
            }
        }
        if !state
            .snapshot
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .restart_safe
        {
            return Err(
                "Encerramento nativo não confirmado. Feche o aplicativo antes de reiniciar.".into(),
            );
        }
        *state.snapshot.lock().unwrap_or_else(|p| p.into_inner()) = Snapshot::default();
        phase(
            &state.snapshot,
            "connecting",
            "Conectando e reservando a sala…",
        );
        let (cancel, rx) = watch::channel(false);
        let snapshot = state.snapshot.clone();
        let task = tokio::spawn(session::run(config, snapshot, rx));
        *guard = Some(Running { cancel, task });
        Ok(())
    }
    async fn shutdown(state: &AppState) -> Result<(), String> {
        let mut guard = state.running.lock().await;
        if let Some(running) = guard.take() {
            let _ = running.cancel.send(true);
            if running.task.await.is_err() {
                state
                    .snapshot
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .restart_safe = false;
                return Err("Falha ao encerrar a sessão. Feche o aplicativo.".into());
            }
        }
        Ok(())
    }
    #[tauri::command]
    async fn stop(state: State<'_, AppState>) -> Result<(), String> {
        shutdown(&state).await
    }
    pub fn run() {
        tauri::Builder::default()
            .manage(AppState {
                snapshot: Arc::new(Mutex::new(Snapshot::default())),
                running: AsyncMutex::new(None),
            })
            .invoke_handler(tauri::generate_handler![
                snapshot,
                list_targets,
                start,
                stop
            ])
            .on_window_event(|window, event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let app = window.app_handle().clone();
                    let window = window.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<AppState>();
                        let _ = shutdown(&state).await;
                        let _ = window.destroy();
                    });
                }
            })
            .run(tauri::generate_context!())
            .expect("Falha ao iniciar Discord 2 Transmissor");
    }
}
fn main() {
    #[cfg(target_os = "linux")]
    if std::env::args().any(|a| a == "--check") {
        let runtime = tokio::runtime::Runtime::new().expect("Runtime Linux");
        let report = runtime.block_on(d2_transmitter::native::preflight());
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
        std::process::exit(if report["ready"] == true { 0 } else { 1 });
    }

    #[cfg(any(windows, target_os = "linux"))]
    desktop::run();
    #[cfg(not(any(windows, target_os = "linux")))]
    eprintln!("O transmissor nativo requer Windows 11.");
}
