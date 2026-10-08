import Link from "next/link";

type RoomControlsProps = {
  connected: boolean;
  sharing: boolean;
  busy: boolean;
  anotherSharing: boolean;
  onToggleShare: () => void;
};

export default function RoomControls({
  connected,
  sharing,
  busy,
  anotherSharing,
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
        {busy
          ? "Aguarde…"
          : sharing
            ? "Parar transmissão"
            : "Compartilhar tela"}
      </button>
      <Link href="/" className="btn btn-secondary">
        Voltar ao início
      </Link>
      <p className="controls-note">
        {anotherSharing && !sharing
          ? "Já existe uma transmissão nesta sala."
          : "Fase 4: somente vídeo da tela, sem áudio."}
      </p>
    </section>
  );
}
