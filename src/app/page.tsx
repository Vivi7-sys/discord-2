import Link from "next/link";
import RoomEntry from "@/components/home/RoomEntry";
import styles from "@/components/home/home.module.css";

export default function HomePage() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="D2 — Início">
          D<span>2</span>
        </Link>
      </header>
      <main className={styles.main}>
        <section className={styles.content} aria-labelledby="home-title">
          <h1 id="home-title" className={styles.title}>D<span>2</span></h1>
          <p className={styles.subtitle}>Salas privadas para assistir juntos</p>
          <RoomEntry />
        </section>
      </main>
    </div>
  );
}
