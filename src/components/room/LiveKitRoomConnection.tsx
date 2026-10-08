"use client";

import { useEffect, useState } from "react";
import { ConnectionState, Room, RoomEvent } from "livekit-client";
import Link from "next/link";
import ParticipantList from "./ParticipantList";
import RoomControls from "./RoomControls";
import StreamArea from "./StreamArea";
import RoomInvite from "./RoomInvite";

type Phase = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

type ParticipantItem = {
  id: string;
  label: string;
  isLocal: boolean;
};

type TokenResponse = {
  token?: unknown;
  serverUrl?: unknown;
  error?: unknown;
};

const labels: Record<Phase, string> = {
  connecting: "Conectando…",
  connected: "Conectado",
  reconnecting: "Reconectando…",
  disconnected: "Desconectado",
  error: "Falha na conexão",
};

// Conecta apenas a sinalização e a presença. A captura de mídia fica para fases futuras.
export default function LiveKitRoomConnection({ roomId }: { roomId: string }) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const room = new Room({ adaptiveStream: true });
    const controller = new AbortController();
    let cancelled = false;

    function updateParticipants() {
      if (cancelled) return;
      if (room.state !== ConnectionState.Connected) {
        setParticipants([]);
        return;
      }
      const others = Array.from(room.remoteParticipants.values()).map((person) => ({
        id: person.identity,
        label: person.name || `Participante ${person.identity.slice(0, 8)}`,
        isLocal: false,
      }));
      setParticipants([
        { id: room.localParticipant.identity, label: "Você", isLocal: true },
        ...others,
      ]);
    }

    room.on(RoomEvent.ParticipantConnected, updateParticipants);
    room.on(RoomEvent.ParticipantDisconnected, updateParticipants);
    room.on(RoomEvent.Connected, () => {
      if (cancelled) return;
      setPhase("connected");
      updateParticipants();
    });
    room.on(RoomEvent.Reconnecting, () => {
      if (cancelled) return;
      setPhase("reconnecting");
    });
    room.on(RoomEvent.Reconnected, () => {
      if (cancelled) return;
      setPhase("connected");
      updateParticipants();
    });
    room.on(RoomEvent.Disconnected, () => {
      if (cancelled) return;
      setPhase("disconnected");
      setParticipants([]);
    });

    async function connect() {
      setPhase("connecting");
      setParticipants([]);
      setError(null);
      try {
        const response = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId }),
          cache: "no-store",
          signal: controller.signal,
        });
        const data: TokenResponse = await response.json();
        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Falha na autorização.");
        }
        if (typeof data.token !== "string" || typeof data.serverUrl !== "string") {
          throw new Error("A API retornou dados incompletos.");
        }
        if (cancelled) return;
        await room.connect(data.serverUrl, data.token);
        if (cancelled) {
          void room.disconnect();
          return;
        }
        setPhase("connected");
        updateParticipants();
      } catch (cause) {
        if (cancelled) return;
        setPhase("error");
        setParticipants([]);
        setError(cause instanceof Error ? cause.message : "Não foi possível entrar na sala.");
      }
    }

    void connect();
    return () => {
      cancelled = true;
      controller.abort();
      room.removeAllListeners();
      void room.disconnect();
    };
  }, [roomId, attempt]);

  return (
    <main className="room">
      <header className="room-header">
        <div>
          <Link href="/" className="back-link">← Início</Link>
          <h1 className="room-title">Sala <code>{roomId}</code></h1>
        </div>
        <span className={`status status-${phase}`} aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {labels[phase]}
        </span>
      </header>

      {error && (
        <div className="connection-error" role="alert">
          <span>{error}</span>
          <button className="btn btn-secondary" type="button" onClick={() => setAttempt((n) => n + 1)}>
            Tentar novamente
          </button>
        </div>
      )}

      <div className="room-layout">
        <StreamArea />
        <ParticipantList participants={participants} phase={phase} />
      </div>

      <RoomInvite roomId={roomId} />
      <RoomControls />
    </main>
  );
}
