import Link from "next/link";

// Barra de botões da sala.
// A captura continua desativada. "Sair" apenas volta à página inicial.
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
        A transmissão continua indisponível: ainda não existe conexão real.
      </p>
    </section>
  );
}
