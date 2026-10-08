import Link from "next/link";

// Barra de botões da sala.
// A captura continua desativada. "Voltar" desmonta a sala e encerra a conexão.
export default function RoomControls() {
  return (
    <section className="controls" aria-label="Controles da sala">
      <button
        type="button"
        className="btn btn-primary"
        disabled
        title="Disponível em uma fase futura"
      >
        Compartilhar tela
      </button>
      <Link href="/" className="btn btn-secondary">
        Voltar ao início
      </Link>
      <p className="controls-note">
        A conexão é apenas para presença. Compartilhar tela fica para a Fase 4.
      </p>
    </section>
  );
}
