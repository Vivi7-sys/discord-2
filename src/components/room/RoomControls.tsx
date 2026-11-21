import RoomIcon from "./RoomIcon";

export type AudioMode = "none" | "browser" | "linux-virtual";
export type QualityProfile = "economico" | "equilibrado" | "alta" | "maxima";

type RoomControlsProps = {
  connected: boolean;
  sharing: boolean;
  busy: boolean;
  anotherSharing: boolean;
  audioStatus: string | null;
  pendingAudioConfirmation: boolean;
  onApproveVirtualAudio: () => void;
  onRejectVirtualAudio: () => void;
  onStopShare: () => void;
};

export default function RoomControls({
  connected,
  sharing,
  busy,
  anotherSharing,
  audioStatus,
  pendingAudioConfirmation,
  onApproveVirtualAudio,
  onRejectVirtualAudio,
  onStopShare,
}: RoomControlsProps) {
  return (
    <section className="controls" aria-label="Controles da sala">
      {sharing && (
        <button
          type="button"
          className="room-icon-btn room-broadcast-btn room-broadcast-stop desktop-broadcast-only"
          aria-label="Parar transmissão"
          title="Parar transmissão"
          disabled={!connected}
          onClick={onStopShare}
        >
          <RoomIcon name="stop" size={21} />
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