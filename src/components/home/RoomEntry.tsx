"use client";

import { useRouter } from "next/navigation";
import { Turnstile } from "@marsidev/react-turnstile";
import { useState, type FormEvent } from "react";
import { readRoomId } from "@/lib/room/room-id";

/** Cria IDs e navega para as salas; participantes se conectam pelo LiveKit. */
export default function RoomEntry() {
  const router = useRouter();
  const [roomInput, setRoomInput] = useState("");
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
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
      setCreating(false);
    }
  }

  function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roomId = readRoomId(roomInput, window.location.origin);
    if (!roomId) {
      setError("Digite um ID válido ou cole um link de sala deste site.");
      return;
    }

    setError("");
    router.push(`/sala/${roomId}`);
  }

  return (
    <section className="room-entry" aria-labelledby="room-entry-title">
      <div className="home-section-heading">
        <div>
          <span className="home-section-label">PRONTO PARA ENTRAR?</span>
          <h2 id="room-entry-title">Sua próxima sala começa aqui.</h2>
        </div>
        <p className="room-entry-note">Escolha como você quer participar.</p>
      </div>
      <div className="room-entry-grid">
        <div className="room-entry-panel">
          <span className="home-entry-number" aria-hidden="true">01 / HOST</span>
          <h3>Criar uma sala</h3>
          <p>Gere um link para chamar seus amigos e começar a transmissão.</p>
          <Turnstile
            siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
            options={{ theme: "dark", size: "compact", language: "pt-BR" }}
            onSuccess={setTurnstileToken}
            onExpire={() => setTurnstileToken(null)}
            onError={() => setTurnstileToken(null)}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={createRoom}
            disabled={creating || !turnstileToken}
          >
            {creating ? "Criando sala..." : "Criar nova sala"}
            <span aria-hidden="true">↗</span>
          </button>
          {createError && (
            <p role="alert" className="form-error">{createError}</p>
          )}
        </div>
        <form className="room-entry-panel" onSubmit={joinRoom}>
          <span className="home-entry-number" aria-hidden="true">02 / JOIN</span>
          <label htmlFor="room-link">Entrar com convite</label>
          <p>Cole o link enviado por alguém ou digite o ID da sala.</p>
          <input
            id="room-link"
            name="room-link"
            className="room-input"
            placeholder="ID ou link de convite"
            value={roomInput}
            onChange={(event) => {
              setRoomInput(event.target.value);
              if (error) setError("");
            }}
            autoComplete="off"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "room-input-error" : undefined}
            required
          />
          {error && (
            <p role="alert" id="room-input-error" className="form-error">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-secondary">
            Entrar na sala <span aria-hidden="true">→</span>
          </button>
        </form>
      </div>
    </section>
  );
}
