"use client";

import { useEffect, useRef, useState } from "react";
import type { AudioMode, QualityProfile } from "./RoomControls";

type Props = {
  audioMode: AudioMode;
  onAudioModeChange: (mode: AudioMode) => void;
  qualityProfile: QualityProfile;
  onQualityProfileChange: (profile: QualityProfile) => void;
  canStart: boolean;
  onStart: () => void;
  onCancel: () => void;
};

export default function ShareDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [ownAudioSupported] = useState(() => typeof navigator !== "undefined" && Boolean(
    (navigator.mediaDevices?.getSupportedConstraints() as MediaTrackSupportedConstraints & { restrictOwnAudio?: boolean })?.restrictOwnAudio
  ));
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
      aria-describedby="share-dialog-description" onCancel={(event) => { event.preventDefault(); props.onCancel(); }}>
      <h2 id="share-dialog-title">Compartilhar tela</h2>
      <p id="share-dialog-description">Escolha as opções antes de selecionar a tela no navegador.</p>
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
      {!props.canStart && <p role="status">Solicite a transmissão na barra e aguarde a liberação.</p>}
      <div className="share-dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={props.onCancel}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={!props.canStart} onClick={props.onStart}>Selecionar tela</button>
      </div>
    </dialog>
  );
}
