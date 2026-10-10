"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { generateRoomId, readRoomId } from "@/lib/room/room-id";

/** Cria IDs e navega para as salas; participantes se conectam pelo LiveKit. */
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
          <button type="button" className="btn btn-primary" onClick={createRoom}>
            Criar nova sala <span aria-hidden="true">↗</span>
          </button>
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
