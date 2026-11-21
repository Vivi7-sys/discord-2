"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioMode, QualityProfile } from "./RoomControls";
import {
  getDesktop,
  useDesktopAudioApps,
  useIsDesktop,
  type AudioSelection,
} from "../../lib/desktop";

type Props = {
  audioMode: AudioMode;
  onAudioModeChange: (mode: AudioMode) => void;
  qualityProfile: QualityProfile;
  onQualityProfileChange: (profile: QualityProfile) => void;
  canStart: boolean;
  onStart: () => void;
  onCancel: () => void;
};

type DesktopAudio = "system" | "app" | "none";

const DESKTOP_HINTS: Record<DesktopAudio, string> = {
  system:
    "Tudo o que tocar será compartilhado. Desmarque o que não quer incluir. Aplicativos que começarem a tocar depois entram automaticamente.",
  app: "Só o aplicativo escolhido será compartilhado. Ele entra assim que estiver tocando som.",
  none: "A transmissão será feita sem áudio.",
};

export default function ShareDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [ownAudioSupported] = useState(() => typeof navigator !== "undefined" && Boolean(
    (navigator.mediaDevices?.getSupportedConstraints() as MediaTrackSupportedConstraints & { restrictOwnAudio?: boolean })?.restrictOwnAudio
  ));

  // --- Aplicativo desktop (Electron) ---
  const isDesktop = useIsDesktop();
  const [desktopAudio, setDesktopAudio] = useState<DesktopAudio>("system");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const { playing: playingApps, known } = useDesktopAudioApps(isDesktop && desktopAudio !== "none");
  const playing = useMemo(() => new Set(playingApps.map((app) => app.key)), [playingApps]);

  // O resto do site só precisa saber se há áudio ou não.
  const onAudioModeChangeRef = useRef(props.onAudioModeChange);
  useEffect(() => { onAudioModeChangeRef.current = props.onAudioModeChange; });
  useEffect(() => {
    if (!isDesktop) return;
    onAudioModeChangeRef.current(desktopAudio === "none" ? "none" : "browser");
  }, [isDesktop, desktopAudio]);

  const knownList = Object.entries(known);
  const desktopReady = !isDesktop || desktopAudio !== "app" || selected !== null;

  function toggleExcluded(key: string, include: boolean) {
    setExcluded((prev) => (include ? prev.filter((k) => k !== key) : [...new Set([...prev, key])]));
  }

  function handleCancel() {
    if (isDesktop) void getDesktop()?.audio.clearSelection();
    props.onCancel();
  }

  async function handleStart() {
    const desktop = isDesktop ? getDesktop() : null;
    if (desktop) {
      setStarting(true);
      setError(null);
      const selection: AudioSelection =
        desktopAudio === "none" ? { mode: "none" }
        : desktopAudio === "system" ? { mode: "system", excluded }
        : { mode: "app", selected: selected ?? "" };
      let ok = false;
      try { ok = await desktop.audio.setSelection(selection); } catch { ok = false; }
      setStarting(false);
      if (!ok) {
        setError("Não foi possível configurar o áudio. A transmissão não foi iniciada.");
        return;
      }
    }
    props.onStart();
  }

  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector("select")?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog ref={ref} className="share-dialog" aria-labelledby="share-dialog-title"
      aria-describedby="share-dialog-description" onCancel={(event) => { event.preventDefault(); handleCancel(); }}>
      <h2 id="share-dialog-title">Compartilhar tela</h2>
      <p id="share-dialog-description">
        {isDesktop
          ? "Escolha as opções antes de selecionar a tela."
          : "Escolha as opções antes de selecionar a tela no navegador."}
      </p>
      <label className="audio-mode-label">Qualidade da transmissão
        <select className="audio-mode-select" value={props.qualityProfile}
          onChange={(event) => props.onQualityProfileChange(event.target.value as QualityProfile)}>
          <option value="economico">Econômico — 480p / até 20 FPS</option>
          <option value="equilibrado">Equilibrado — 720p / até 30 FPS</option>
          <option value="alta">Alta qualidade — 1080p / até 30 FPS</option>
          <option value="maxima">Máxima qualidade — 1080p / até 60 FPS</option>
        </select>
      </label>
      <p>Resolução e FPS são solicitados; a qualidade se adapta à conexão e ao dispositivo.</p>

      {isDesktop ? (
        <fieldset className="share-audio-fieldset">
          <legend>Áudio da transmissão</legend>
          {([
            ["system", "Sistema inteiro"],
            ["app", "Aplicativo específico"],
            ["none", "Somente vídeo — sem áudio"],
          ] as const).map(([value, label]) => (
            <label key={value} className="share-audio-option">
              <input type="radio" name="desktop-audio" value={value}
                checked={desktopAudio === value} onChange={() => setDesktopAudio(value)} />
              {label}
            </label>
          ))}
          <p role="status">{DESKTOP_HINTS[desktopAudio]}</p>
          {desktopAudio !== "none" && (
            <div className="share-audio-list" role="group" aria-label="Aplicativos com áudio">
              {knownList.length === 0 && (
                <p className="share-audio-muted">Nada está tocando agora. A lista atualiza sozinha.</p>
              )}
              {knownList.map(([key, name]) => (
                <label key={key} className={`share-audio-option${playing.has(key) ? "" : " share-audio-muted"}`}>
                  {desktopAudio === "system" ? (
                    <input type="checkbox" checked={!excluded.includes(key)}
                      onChange={(event) => toggleExcluded(key, event.target.checked)} />
                  ) : (
                    <input type="radio" name="desktop-app" checked={selected === key}
                      onChange={() => setSelected(key)} />
                  )}
                  {name}{playing.has(key) ? "" : " — sem som no momento"}
                </label>
              ))}
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </fieldset>
      ) : (
        <>
          <label className="audio-mode-label">Áudio da transmissão
            <select className="audio-mode-select" value={props.audioMode}
              onChange={(event) => props.onAudioModeChange(event.target.value as AudioMode)}>
              <option value="browser">Automático — áudio do navegador (recomendado)</option>
              <option value="none">Somente vídeo — sem áudio</option>
              <option value="linux-virtual">Avançado — fonte virtual Linux</option>
            </select>
          </label>
          {props.audioMode === "browser" && <p role="status">{ownAudioSupported
            ? "Este navegador permite solicitar a exclusão do som desta aba da captura do sistema. O isolamento depende do navegador e precisa ser conferido com quem assiste."
            : "Este navegador não informa suporte para excluir o som desta aba do áudio do sistema."} Para evitar eco, prefira compartilhar outra guia com áudio. Chamadas em outros aplicativos podem voltar na captura da tela inteira. Você continuará ouvindo normalmente.</p>}
          {props.audioMode === "linux-virtual" && <p>Use Screen Share Audio com apenas o jogo/aplicativo desejado. Mantenha a chamada na saída normal, fora dessa fonte. A fonte deve estar identificada pelo navegador antes da captura; a entrada padrão não será aberta. Confira a origem antes de enviar; nunca selecione o microfone.</p>}
        </>
      )}

      {!props.canStart && <p role="status">Reservando a transmissão. Aguarde um instante…</p>}
      <div className="share-dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancelar</button>
        <button type="button" className="btn btn-primary"
          disabled={!props.canStart || starting || !desktopReady} onClick={handleStart}>
          Selecionar tela
        </button>
      </div>
    </dialog>
  );
}