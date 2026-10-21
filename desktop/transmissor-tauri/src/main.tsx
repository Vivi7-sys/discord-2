import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import RoomIcon from "./RoomIcon";
import { bridge, initial, native, linux, type Config, type Target } from "./bridge";
import "./site.css";
import "./desktop.css";

function App() {
  const [tab, setTab] = useState("stream");
  const [targets, setTargets] = useState<Target[]>([]);
  const [state, setState] = useState(initial);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [config, setConfig] = useState<Config>({
    invite: "",
    name: "",
    profile: "1080p60",
    target: "",
    audio: "none",
    audioPid: null,
  });
  const busy =
    pending || ["connecting", "streaming", "stopping"].includes(state.phase);
  const selected = targets.find((t) => t.id === config.target);
  const update = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));
  async function refresh() {
    try {
      setTargets(await bridge.targets());
    } catch {
      setError("Não foi possível listar as telas e janelas.");
    }
  }
  useEffect(() => {
    void refresh();
    let alive = true;
    const tick = async () => {
      try {
        const s = await bridge.snapshot();
        if (alive) setState(s);
      } catch {
        if (alive) setError("Falha ao consultar o núcleo nativo.");
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function action(mode: "start" | "stop" | "restart") {
    setError("");
    setPending(true);
    try {
      if (mode !== "start") await bridge.stop();
      if (mode !== "stop") await bridge.start(config);
      setState(await bridge.snapshot());
    } catch (e) {
      setError(
        typeof e === "string" ? e : "Não foi possível concluir a operação.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="desktop-shell">
      <header className="home-topbar">
        <div className="home-brand">
          <span className="home-brand-mark">
            D<span>2</span>
          </span>
          <span className="home-brand-name">
            <strong>DISCORD 2</strong>
            <small>FEITO PARA COMPARTILHAR</small>
          </span>
        </div>
        <span className="desktop-platform">
          TRANSMISSOR <span>WINDOWS</span>
        </span>
        <span
          className={`status ${state.phase === "streaming" ? "status-connected" : ""}`}
        >
          <i className="status-dot" />
          {{
            idle: "Desconectado",
            connecting: "Conectando",
            streaming: "Ao vivo",
            stopping: "Encerrando",
            error: "Erro",
          }[state.phase] ?? "Desconectado"}
        </span>
      </header>
      <div className="workspace-heading">
        <div>
          <p className="home-eyebrow">
            <span /> SEU GRUPO. SUA TRANSMISSÃO.
          </p>
          <h1>
            Compartilhe o momento<span>.</span>
          </h1>
          <p className="lead">Sua tela e seu áudio, juntos na mesma sala.</p>
        </div>
        <span className="badge">v0.2 · experimental</span>
      </div>
      <nav className="desktop-tabs" aria-label="Seções">
        <button
          aria-current={tab === "stream" ? "page" : undefined}
          onClick={() => setTab("stream")}
        >
          <RoomIcon name="share" />
          Transmissão
        </button>
        <button
          aria-current={tab === "diagnostics" ? "page" : undefined}
          onClick={() => setTab("diagnostics")}
        >
          <RoomIcon name="request" />
          Diagnósticos
        </button>
      </nav>
      {(error || state.phase === "error") && (
        <div className="connection-error" role="alert">
          {error || state.message}
        </div>
      )}
      {tab === "stream" ? (
        <div className="desktop-grid">
          <section className="configuration">
            <article className="card desktop-card">
              <div className="section-title">
                <span className="step">01</span>
                <h2>Conecte sua sala</h2>
                <span className="badge">Privada</span>
              </div>
              <label>
                Convite da sala
                <input
                  className="room-input"
                  type="url"
                  placeholder="https://discord-2-kuau.onrender.com/sala/…"
                  value={config.invite}
                  disabled={busy}
                  onChange={(e) => update("invite", e.target.value)}
                />
              </label>
              <label>
                Seu nome
                <input
                  className="room-input"
                  placeholder="Como seus amigos te chamam?"
                  maxLength={24}
                  value={config.name}
                  disabled={busy}
                  onChange={(e) => update("name", e.target.value)}
                />
              </label>
            </article>
            <article className="card desktop-card">
              <div className="section-title">
                <span className="step">02</span>
                <h2>Escolha o que compartilhar</h2>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  Atualizar
                </button>
              </div>
              <label>
                Tela ou janela
                <select
                  value={config.target}
                  disabled={busy}
                  onChange={(e) => update("target", e.target.value)}
                >
                  <option value="">Selecione uma fonte</option>
                  <optgroup label="Monitores">
                    {targets
                      .filter((t) => t.kind === "monitor")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Janelas">
                    {targets
                      .filter((t) => t.kind === "window")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>
              <label>Qualidade</label>
              <div
                className="quality-options"
                role="group"
                aria-label="Qualidade"
              >
                {[
                  ["720p30", "720p", "30 FPS"],
                  ["1080p30", "1080p", "30 FPS"],
                  ["1080p60", "1080p", "60 FPS"],
                ].map(([value, label, fps]) => (
                  <button
                    key={value}
                    aria-pressed={config.profile === value}
                    disabled={busy}
                    onClick={() => update("profile", value)}
                  >
                    {label}
                    <small>{fps}</small>
                  </button>
                ))}
              </div>
            </article>
            <article className="card desktop-card">
              <div className="section-title">
                <span className="step">03</span>
                <h2>Áudio da transmissão</h2>
              </div>
              <label>
                O que seus amigos vão ouvir
                <select
                  value={config.audio}
                  disabled={busy}
                  onChange={(e) => update("audio", e.target.value)}
                >
                  <option value="none">Sem áudio</option>
                  <option value="application" disabled={linux}>Somente um aplicativo{linux ? " · indisponível no Linux" : ""}</option>
                  <option value="system">Todo o áudio do sistema</option>
                  <option value="exclude" disabled={linux}>Sistema, excluindo o Discord{linux ? " · indisponível no Linux" : ""}</option>
                </select>
              </label>
              {config.audio === "application" && (
                <label>
                  Aplicativo
                  <select
                    aria-label="Aplicativo"
                    value={config.audioPid ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      update("audioPid", Number(e.target.value) || null)
                    }
                  >
                    <option value="">Selecione o aplicativo</option>
                    {targets
                      .filter((t) => t.kind === "window" && t.pid)
                      .filter(
                        (t, i, a) => a.findIndex((x) => x.pid === t.pid) === i,
                      )
                      .map((t) => (
                        <option key={t.pid} value={t.pid!}>
                          {t.label}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <p className="audio-note">
                <span className="privacy-icon">◇</span>
                {config.audio === "none"
                  ? "Nenhum áudio será capturado."
                  : linux
                    ? "Monitor da saída do sistema, sem microfone. Exclusão do Discord indisponível no Linux."
                    : config.audio === "exclude"
                    ? "Exclusão por processo. Se o isolamento falhar, a transmissão será interrompida."
                    : "O som continua tocando normalmente no seu computador."}
              </p>
            </article>
          </section>
          <aside className="session-panel">
            <div className="session-preview">
              <div className="home-preview-top">
                <RoomIcon name="share" size={16} />
                <span>SUA TRANSMISSÃO</span>
                <span className="preview-state">
                  {state.phase === "streaming" ? "AO VIVO" : "EM ESPERA"}
                </span>
              </div>
              <div className="home-preview-screen">
                <div className="home-preview-beam" />
                <div className="home-preview-emblem">
                  D<span>2</span>
                </div>
                <span className="home-preview-subtitle">
                  FEITO PARA COMPARTILHAR
                </span>
              </div>
              <div className="preview-caption">
                <RoomIcon name="share" size={18} />
                <span>
                  {selected?.label || "Escolha uma tela ou janela"}
                  <small>
                    {config.profile.replace("p", "p · ")} FPS ·{" "}
                    {config.audio === "none"
                      ? "Sem áudio"
                      : "Áudio selecionado"}
                  </small>
                </span>
              </div>
            </div>
            <div className="session-info">
              <span className="tiny-label">STATUS DA SESSÃO</span>
              <p role="status">{state.message}</p>
              <div className="signal-bars" aria-hidden="true">
                {[
                  12, 19, 28, 22, 35, 27, 16, 24, 32, 19, 12, 25, 35, 22, 17,
                  28, 18, 12,
                ].map((h, i) => (
                  <i key={i} style={{ height: h }} />
                ))}
              </div>
              <p className="session-hint">
                Uma transmissão por sala.
                <br />
                Só compartilhe quando estiver pronto.
              </p>
            </div>
            <div className="mini-metrics">
              <div>
                <strong>{state.capturedFps.toFixed(0)}</strong>
                <small>FPS capturados</small>
              </div>
              <div>
                <strong>{state.publishedFps?.toFixed(0) ?? "—"}</strong>
                <small>FPS publicados</small>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <section className="card diagnostics">
          <h2>Diagnósticos da sessão</h2>
          <p>
            Estatísticas do núcleo nativo. Valores indisponíveis aparecem como
            “—”.
          </p>
          <dl>
            {[
              ["Frames capturados", state.captured],
              ["Frames entregues à fonte", state.submitted],
              ["Descartes", state.dropped],
              ["FPS capturados", state.capturedFps.toFixed(1)],
              ["FPS codificados", state.encodedFps?.toFixed(1) ?? "—"],
              ["FPS publicados (RTP)", state.publishedFps?.toFixed(1) ?? "—"],
              [
                "Processamento por frame",
                `${state.processingMs.toFixed(2)} ms`,
              ],
              ["Encoder observado", state.encoder ?? "—"],
              [
                "Liberação da sala",
                state.releaseConfirmed === null
                  ? "—"
                  : state.releaseConfirmed
                    ? "Confirmada"
                    : "Não confirmada",
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <footer className="desktop-controls">
        <div>
          <span className="status-dot" />
          <span>
            {state.phase === "streaming"
              ? "Sua transmissão está ao vivo"
              : "Tudo pronto para compartilhar?"}
            <small>
              {native
                ? "Experimental · captura e transmissão sem validação física"
                : "Prévia visual · abra o aplicativo no Windows para transmitir"}
            </small>
          </span>
        </div>
        <div className="control-actions">
          <button
            className="btn btn-secondary"
            disabled={
              !native ||
              !["streaming", "connecting"].includes(state.phase) ||
              pending
            }
            onClick={() => void action("stop")}
          >
            <RoomIcon name="stop" />
            Parar
          </button>
          <button
            className="btn btn-secondary"
            disabled={!native || state.phase !== "streaming" || pending}
            onClick={() => void action("restart")}
          >
            Reiniciar
          </button>
          <button
            className="btn btn-primary"
            disabled={
              !native ||
              busy ||
              !config.target ||
              !config.invite ||
              config.name.trim().length < 2
            }
            onClick={() => void action("start")}
          >
            <RoomIcon name="share" />
            Iniciar transmissão
          </button>
        </div>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
