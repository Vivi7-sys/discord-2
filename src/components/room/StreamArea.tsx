// Quadro onde a tela compartilhada vai aparecer.
// Fase 1: apenas um espaço reservado, sem vídeo.
export default function StreamArea() {
  return (
    <section className="stream" aria-label="Área da transmissão">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
        <path d="M8.5 20.5h7M12 16.5v4" />
      </svg>
      <p className="stream-title">Nenhuma transmissão ainda</p>
      <p className="stream-hint">
        Quando a conexão existir, a tela compartilhada aparecerá aqui.
      </p>
    </section>
  );
}
