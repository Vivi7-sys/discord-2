import Link from "next/link";

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
  return (
    <section className="controls" aria-label="Controles da sala">
      <button
        type="button"
        className={`${sharing ? "btn btn-secondary" : "btn btn-primary"} desktop-broadcast-only`}
        disabled={!connected || busy || (anotherSharing && !sharing)}
        onClick={sharing || broadcastAllowed ? onToggleShare : onRequestBroadcast}
      >
        {busy ? "Aguarde…" : sharing ? "Parar transmissão" :
          broadcastAllowed ? "Compartilhar tela" : "Solicitar transmissão"}
      </button>
      {broadcastAllowed && !sharing && (
        <button type="button" className="btn btn-secondary desktop-broadcast-only"
          disabled={!connected || busy} onClick={onCancelBroadcast}>
          Cancelar vez
        </button>
      )}
      <Link href="/" className="btn btn-secondary">
        Voltar ao início
      </Link>
      <label className="audio-mode-label desktop-broadcast-only">
        Áudio da transmissão
        <select
          className="audio-mode-select"
          value={audioMode}
          disabled={!connected || busy || sharing}
          onChange={(event) => onAudioModeChange(event.target.value as AudioMode)}
        >
          <option value="none">Sem áudio</option>
          <option value="browser">Áudio nativo do navegador</option>
          <option value="linux-virtual">Fonte virtual Linux (Screen Share Audio)</option>
        </select>
      </label>
      <label className="audio-mode-label desktop-broadcast-only">
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
        <span className="controls-note">
          Escolha antes de compartilhar. A qualidade real depende do PC e da conexão.
        </span>
      </label>
      {pendingAudioConfirmation && sharing && (
        <div className="audio-verification desktop-broadcast-only" role="group" aria-label="Confirmar fonte virtual de áudio">
          <p>
            Confira em pavucontrol → Gravando se a captura <strong>Brave input</strong>
            está em <strong>Screen Share Audio</strong>, não no microfone USB.
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
      <p className="mobile-viewer-note">Modo espectador: assista à tela e ative o som, se necessário.</p>
      <p className="controls-note desktop-broadcast-only" aria-live="polite">
        {anotherSharing && !sharing
          ? "Alguém já está transmitindo. Aguarde essa pessoa encerrar para compartilhar sua tela."
          : !broadcastAllowed && !sharing
            ? "Solicite a transmissão primeiro. Se a vaga estiver livre, o botão mudará para Compartilhar tela."
            : audioStatus || "Escolha o áudio antes de iniciar. A opção Linux exige a fonte virtual previamente configurada."}
      </p>
    </section>
  );
}
