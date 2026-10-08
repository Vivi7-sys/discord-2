"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { generateRoomId, readRoomId } from "@/lib/room/room-id";

/** Só navegação por URL. A sala ainda não é registrada em servidor algum. */
export default function RoomEntry() {
  const router = useRouter();
  const [roomInput, setRoomInput] = useState("");
  const [error, setError] = useState("");

  function createRoom() {
    setError("");
    router.push(`/sala/${generateRoomId()}`);
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
      <h2 id="room-entry-title">Comece por aqui</h2>
      <p className="room-entry-note">
        Por enquanto, criar ou entrar significa abrir uma página com ID próprio.
        Ainda não existe conexão entre participantes.
      </p>
      <div className="room-entry-grid">
        <div className="room-entry-panel">
          <h3>Criar sala</h3>
          <p>Gere um endereço aleatório para compartilhar depois.</p>
          <button type="button" className="btn btn-primary" onClick={createRoom}>
            Criar nova sala
          </button>
        </div>
        <form className="room-entry-panel" onSubmit={joinRoom}>
          <label htmlFor="room-link">Entrar em sala</label>
          <p>Cole um link deste site ou digite o ID da sala.</p>
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
            Abrir sala
          </button>
        </form>
      </div>
    </section>
  );
}
