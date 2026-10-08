// Barra de botões da sala.
// Fase 1: todos desativados. Na Fase 4 o botão "Compartilhar tela" será ligado.
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
      <button
        type="button"
        className="btn btn-secondary"
        disabled
        title="Disponível em uma fase futura"
      >
        Sair da sala
      </button>
      <p className="controls-note">
        Botões desativados: nesta fase ainda não há conexão nem captura de tela.
      </p>
    </section>
  );
}
