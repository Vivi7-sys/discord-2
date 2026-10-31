"use client";

import { useRouter } from "next/navigation";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef, useState, type FormEvent } from "react";
import styles from "./home.module.css";
import { readRoomId } from "@/lib/room/room-id";

/** Cria IDs e navega para as salas; participantes se conectam pelo LiveKit. */
export default function RoomEntry() {
  const router = useRouter();
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [verificationError, setVerificationError] = useState(false);
  const [joining, setJoining] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  async function createRoom() {
    if (creating) return;

    setCreateError("");
    if (!turnstileToken) {
      setCreateError("Aguarde a verificação de segurança.");
      return;
    }
    setCreating(true);

    try {
      const response = await fetch("/api/rooms/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstileToken }),
        cache: "no-store",
      });

      const data: { roomId?: unknown; error?: unknown } = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Não foi possível criar a sala."
        );
      }

      if (
        typeof data.roomId !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.roomId)
      ) {
        throw new Error("O servidor retornou um convite inválido.");
      }

      router.push(`/sala/${data.roomId}`);
    } catch (cause) {
      setCreateError(
        cause instanceof Error ? cause.message : "Não foi possível criar a sala."
      );
    } finally {
      // Tokens Turnstile são de uso único.
      // Preparar uma nova verificação mesmo se a criação falhar.
      setTurnstileToken(null);
      turnstileRef.current?.reset();
      setCreating(false);
    }
  }

  function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joining) return;
    const roomId = readRoomId(roomInput, window.location.origin);
    if (!roomId) {
      setError("Digite um ID válido ou cole um link de sala deste site.");
      return;
    }

    setError("");
    setJoining(true);
    router.push(`/sala/${roomId}`);
  }

  return (
    <div className={styles.panel}>
      <section className={`${styles.column} ${styles.create}`} aria-labelledby="create-title" aria-busy={creating}>
        <h2 id="create-title">Criar sala</h2>
        <p className={styles.description}>Inicie uma nova sala e convide outras pessoas.</p>
        <div className={styles.verification}>
          <Turnstile
            ref={turnstileRef}
            siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
            options={{ theme: "dark", size: "compact", language: "pt-BR" }}
            onSuccess={(token) => {
              setTurnstileToken(token);
              setVerificationError(false);
            }}
            onExpire={() => setTurnstileToken(null)}
            onError={() => {
              setTurnstileToken(null);
              setVerificationError(true);
            }}
            onTimeout={() => setTurnstileToken(null)}
          />
        </div>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          onClick={createRoom}
          disabled={creating || !turnstileToken}
          aria-describedby="create-feedback"
        >
          {creating ? "Criando sala…" : !turnstileToken ? "Aguardando verificação…" : "Criar sala"}
        </button>
        <div id="create-feedback" className={styles.feedback}>
          {createError ? (
            <p role="alert" className={styles.error}>{createError}</p>
          ) : (
            <p role="status">
              {creating ? "Criando sua sala…" : verificationError
                ? "A verificação não foi concluída. Tente novamente no painel de segurança."
                : !turnstileToken ? "Conclua a verificação de segurança acima." : ""}
            </p>
          )}
        </div>
      </section>
      <form className={styles.column} onSubmit={joinRoom} aria-labelledby="join-title" aria-busy={joining}>
        <h2 id="join-title">Entrar com convite</h2>
        <p id="join-description" className={styles.description}>Use o código ou link da sala.</p>
        <label htmlFor="room-link" className={styles.srOnly}>Código ou link da sala</label>
        <input
          id="room-link"
          name="room-link"
          className={styles.input}
          placeholder="Cole o código ou link aqui"
          value={roomInput}
          onChange={(event) => {
            setRoomInput(event.target.value);
            if (error) setError("");
          }}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={joining}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "join-description room-input-error" : "join-description"}
          required
        />
        <button type="submit" className={`${styles.button} ${styles.primary} ${styles.joinButton}`} disabled={joining}>
          {joining ? "Entrando…" : "Entrar na sala"}
        </button>
        <div className={styles.feedback}>
          {error && <p role="alert" id="room-input-error" className={styles.error}>{error}</p>}
          {joining && <p role="status">Abrindo a sala…</p>}
        </div>
      </form>
    </div>
  );
}
