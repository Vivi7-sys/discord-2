import Link from "next/link";
import RoomEntry from "@/components/home/RoomEntry";

export default function HomePage() {
  return (
    <main className="page page-home">
      <header className="home-topbar">
        <Link href="/" className="home-brand" aria-label="Discord 2 — Início">
          <span className="home-brand-mark" aria-hidden="true">D<span>2</span></span>
          <span className="home-brand-name">
            <strong>DISCORD 2</strong>
            <small>SCREEN SHARING</small>
          </span>
        </Link>
        <nav className="home-navigation" aria-label="Navegação principal">
          <span className="home-development"><span aria-hidden="true" /> Em desenvolvimento</span>
          <a href="#salas" className="home-nav-link">Acessar sala <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <p className="home-eyebrow"><span aria-hidden="true" /> UM LINK. UMA SALA. SUA GALERA.</p>
          <h1 id="home-title">Sua tela.<br />Seu jogo.<br /><span>Seu momento.</span></h1>
          <p className="lead home-hero-lead">
            Compartilhe sua tela e o áudio do computador com os amigos, ao vivo,
            direto no navegador. Sem complicação para quem só quer assistir.
          </p>
          <div className="home-hero-actions">
            <a href="#salas" className="btn btn-primary home-hero-cta">
              Entrar na ação <span aria-hidden="true">↗</span>
            </a>
            <span className="home-hero-caption">Crie uma sala ou entre por convite.</span>
          </div>
          <div className="home-feature-chips" aria-label="Recursos atuais">
            <span><span aria-hidden="true" className="home-feature-icon">●</span> Até 6 pessoas</span>
            <span><span aria-hidden="true" className="home-feature-icon">●</span> Um transmissor</span>
            <span><span aria-hidden="true" className="home-feature-icon">●</span> PC e celular</span>
          </div>
        </div>

        <div className="home-preview" aria-label="Ilustração da área de transmissão do Discord 2">
          <div className="home-preview-top">
            <span className="home-preview-traffic" aria-hidden="true"><i /><i /><i /></span>
            <span>TRANSMISSÃO / PRÉVIA VISUAL</span>
            <span className="home-preview-live"><span aria-hidden="true" /> LIVE</span>
          </div>
          <div className="home-preview-screen" aria-hidden="true">
            <div className="home-preview-beam" />
            <div className="home-preview-emblem">D<span>2</span></div>
            <span className="home-preview-subtitle">NO SEU RITMO. NA SUA SALA.</span>
          </div>
          <div className="home-preview-footer">
            <div className="home-preview-watchers">
              <span className="home-preview-user">V</span>
              <span className="home-preview-user">A</span>
              <span className="home-preview-user">+</span>
              <span className="home-preview-footer-label">Assistindo juntos</span>
            </div>
            <span className="home-preview-quality">720p <span aria-hidden="true">•</span> 30 FPS</span>
          </div>
          <span className="home-preview-corner" aria-hidden="true">01 / SHARE</span>
        </div>
      </section>

      <div id="salas" className="home-room-section">
        <RoomEntry />
      </div>

      <section className="home-benefits" aria-label="O que você encontra aqui">
        <article className="home-benefit">
          <span className="home-benefit-number">01</span>
          <h2>Crie. Convide.</h2>
          <p>Gere sua sala e compartilhe o link com seus amigos.</p>
        </article>
        <article className="home-benefit">
          <span className="home-benefit-number">02</span>
          <h2>Compartilhe.</h2>
          <p>Uma pessoa transmite por vez, com vídeo e áudio da tela.</p>
        </article>
        <article className="home-benefit">
          <span className="home-benefit-number">03</span>
          <h2>Assista junto.</h2>
          <p>Acompanhe pelo computador ou pelo celular.</p>
        </article>
      </section>

      <aside className="home-safety-note" aria-label="Aviso de desenvolvimento">
        <strong>VERSÃO DE DESENVOLVIMENTO</strong>
        <p>
          No momento, o Discord 2 é para testes na rede local. As salas ainda
          não têm senha nem autenticação: possuir o link não é uma proteção de acesso.
          Não disponibilize este servidor publicamente.
        </p>
      </aside>

      <footer className="home-footer">
        <span>DISCORD 2 <span aria-hidden="true">/</span> FEITO PARA COMPARTILHAR</span>
        <a href="/api/health" target="_blank" rel="noreferrer">Status técnico ↗</a>
      </footer>
    </main>
  );
}
