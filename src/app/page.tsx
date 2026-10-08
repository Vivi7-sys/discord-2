import Link from "next/link";
import RoomEntry from "@/components/home/RoomEntry";

export default function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <span className="badge">Fase 2 · estrutura de salas</span>
        <h1>Discord 2</h1>
        <p className="lead">
          Um sistema privado de compartilhamento de tela. Uma pessoa transmite a
          tela do computador, com o áudio, e os amigos convidados assistem em
          tempo real, direto no navegador.
        </p>
      </section>

      <section className="cards" aria-label="Como vai funcionar">
        <article className="card">
          <h2>Privado</h2>
          <p>
            Pensado para um grupo pequeno de amigos, com no máximo 6 pessoas por
            sala.
          </p>
        </article>
        <article className="card">
          <h2>Um transmissor</h2>
          <p>
            No começo, uma pessoa transmite e as outras assistem. A transmissão
            será feita pelo computador.
          </p>
        </article>
        <article className="card">
          <h2>Assista de qualquer lugar</h2>
          <p>
            No computador ou no celular. O celular será usado principalmente
            para assistir.
          </p>
        </article>
      </section>

      <p className="notice">
        <strong>Ainda em construção.</strong> Agora é possível abrir salas por ID ou link, mas
        ainda não existe conexão real, login nem compartilhamento de tela.
        Ter um link não significa que a sala seja protegida por senha.
      </p>

      <RoomEntry />

      <div className="actions">
        <Link href="/sala/exemplo" className="btn btn-primary">
          Ver sala de exemplo
        </Link>
        <a
          href="/api/health"
          target="_blank"
          rel="noreferrer"
          className="btn btn-secondary"
        >
          Testar o backend (/api/health)
        </a>
      </div>
    </main>
  );
}
