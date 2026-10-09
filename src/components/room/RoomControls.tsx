import Link from "next/link";

export type AudioMode = "none" | "browser" | "linux-virtual";

type RoomControlsProps = {
  connected: boolean;
  sharing: boolean;
  busy: boolean;
  anotherSharing: boolean;
  audioMode: AudioMode;
  onAudioModeChange: (value: AudioMode) => void;
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
  audioMode,
  onAudioModeChange,
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
        className={sharing ? "btn btn-secondary" : "btn btn-primary"}
        disabled={!connected || busy || (anotherSharing && !sharing)}
        onClick={onToggleShare}
      >
        {busy ? "Aguarde…" : sharing ? "Parar transmissão" : "Compartilhar tela"}
      </button>
      <Link href="/" className="btn btn-secondary">
        Voltar ao início
      </Link>
      <label className="audio-mode-label">
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
      {pendingAudioConfirmation && sharing && (
        <div className="audio-verification" role="group" aria-label="Confirmar fonte virtual de áudio">
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
      <p className="controls-note" aria-live="polite">
        {anotherSharing && !sharing
          ? "Já existe uma transmissão nesta sala."
          : audioStatus || "Escolha o áudio antes de iniciar. A opção Linux exige a fonte virtual previamente configurada."}
      </p>
    </section>
  );
}
