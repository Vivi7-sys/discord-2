import RoomIcon from "./RoomIcon";

export type AudioMode = "none" | "browser" | "linux-virtual";
export type QualityProfile = "economico" | "equilibrado" | "alta" | "maxima";

type RoomControlsProps = {
  connected: boolean;
  sharing: boolean;
  busy: boolean;
  anotherSharing: boolean;
  broadcastAllowed: boolean;
  hasReservation: boolean;
  onRequestBroadcast: () => void;
  onCancelBroadcast: () => void;
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
  hasReservation,
  onRequestBroadcast,
  onCancelBroadcast,
  audioStatus,
  pendingAudioConfirmation,
  onApproveVirtualAudio,
  onRejectVirtualAudio,
  onToggleShare,
}: RoomControlsProps) {
  const actionLabel = sharing ? "Parar transmissão" : busy ? "Aguarde…" :
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
        disabled={!connected || (busy && !sharing) || (anotherSharing && !sharing)}
        onClick={sharing || broadcastAllowed ? onToggleShare : onRequestBroadcast}
      >
        <RoomIcon name={actionIcon} size={21} />
      </button>
      {(broadcastAllowed || hasReservation) && !sharing && (
        <button type="button" className="room-icon-btn desktop-broadcast-only"
          aria-label="Cancelar vez" title="Cancelar vez"
          disabled={!connected || busy} onClick={onCancelBroadcast}>
          <RoomIcon name="cancel" />
        </button>
      )}
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
