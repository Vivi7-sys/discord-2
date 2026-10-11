import RoomIcon from "./RoomIcon";

export type AudioMode = "none" | "browser" | "linux-virtual";
export type QualityProfile = "economico" | "equilibrado" | "alta";

type RoomControlsProps = {
  connected: boolean;
  sharing: boolean;
  busy: boolean;
  anotherSharing: boolean;
  broadcastAllowed: boolean;
  onRequestBroadcast: () => void;
  onCancelBroadcast: () => void;
  audioMode: AudioMode;
  onAudioModeChange: (value: AudioMode) => void;
  qualityProfile: QualityProfile;
  onQualityProfileChange: (value: QualityProfile) => void;
  audioStatus: string | null;
  pendingAudioConfirmation: boolean;
  onApproveVirtualAudio: () => void;
  onRejectVirtualAudio: () => void;
  onToggleShare: () => void;
};

export default function RoomControls({
  connected,
  sharing,
  busy,
  anotherSharing,
  broadcastAllowed,
  onRequestBroadcast,
  onCancelBroadcast,
  audioMode,
  onAudioModeChange,
  qualityProfile,
  onQualityProfileChange,
  audioStatus,
  pendingAudioConfirmation,
  onApproveVirtualAudio,
  onRejectVirtualAudio,
  onToggleShare,
}: RoomControlsProps) {
  const actionLabel = busy ? "Aguarde…" : sharing ? "Parar transmissão" :
    broadcastAllowed ? "Compartilhar tela" : "Solicitar transmissão";
  // Play solicita a vez; ao liberar, volta ao ícone de compartilhar tela.
  const actionIcon = sharing ? "stop" : broadcastAllowed ? "share" : "play";

  return (
    <section className="controls" aria-label="Controles da sala">
      <button
        type="button"
        className={`room-icon-btn room-broadcast-btn desktop-broadcast-only${sharing ? " room-broadcast-stop" : ""}`}
        aria-label={actionLabel}
        title={actionLabel}
        disabled={!connected || busy || (anotherSharing && !sharing)}
        onClick={sharing || broadcastAllowed ? onToggleShare : onRequestBroadcast}
      >
        <RoomIcon name={actionIcon} size={21} />
      </button>
      {broadcastAllowed && !sharing && (
        <button type="button" className="room-icon-btn desktop-broadcast-only"
          aria-label="Cancelar vez" title="Cancelar vez"
          disabled={!connected || busy} onClick={onCancelBroadcast}>
          <RoomIcon name="cancel" />
        </button>
      )}
      <details className="room-settings desktop-broadcast-only">
        <summary className="room-icon-btn" title="Configurações da transmissão"
          aria-label="Configurações da transmissão">
          <RoomIcon name="settings" size={21} />
        </summary>
        <div className="room-settings-panel">
          <p className="room-settings-title">Configurações</p>
          <label className="audio-mode-label">
            Áudio da transmissão
            <select
              className="audio-mode-select"
              value={audioMode}
              disabled={!connected || busy || sharing}
              onChange={(event) => onAudioModeChange(event.target.value as AudioMode)}
            >
              <option value="browser">Automático — áudio do navegador (recomendado)</option>
              <option value="none">Somente vídeo — sem áudio</option>
              <option value="linux-virtual">Avançado — fonte virtual Linux</option>
            </select>
          </label>
          <label className="audio-mode-label">
            Qualidade da transmissão
            <select
              className="audio-mode-select"
              value={qualityProfile}
              disabled={!connected || busy || sharing}
              onChange={(event) => onQualityProfileChange(event.target.value as QualityProfile)}
            >
              <option value="economico">Econômico — 480p / até 20 FPS</option>
              <option value="equilibrado">Equilibrado — 720p / até 30 FPS</option>
              <option value="alta">Alta qualidade — 1080p / até 60 FPS</option>
            </select>
          </label>
        </div>
      </details>
      {pendingAudioConfirmation && sharing && (
        <div className="audio-verification desktop-broadcast-only" role="group" aria-label="Confirmar fonte virtual de áudio">
          <p>
            Confira em pavucontrol → Gravando se a captura <strong>do navegador</strong>
            está em <strong>Screen Share Audio</strong>, não em nenhum microfone.
            O áudio ainda não foi enviado.
          </p>
          <button type="button" className="btn btn-primary"
            disabled={!connected || busy} onClick={onApproveVirtualAudio}>
            Conferi a fonte — enviar áudio
          </button>
          <button type="button" className="btn btn-secondary"
            disabled={busy} onClick={onRejectVirtualAudio}>
            Continuar sem áudio
          </button>
        </div>
      )}
      {(anotherSharing && !sharing || (audioStatus && /não foi|erro|falha|ainda não/i.test(audioStatus))) && (
        <p className="controls-note desktop-broadcast-only" aria-live="polite">
          {anotherSharing && !sharing ? "Transmissão em andamento." : audioStatus}
        </p>
      )}
    </section>
  );
}
