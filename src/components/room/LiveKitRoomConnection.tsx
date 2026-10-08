"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectionState, Room, RoomEvent, Track } from "livekit-client";
import Link from "next/link";
import ParticipantList from "./ParticipantList";
import RoomControls from "./RoomControls";
import StreamArea from "./StreamArea";
import type { SharedScreen } from "./StreamArea";
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

export default function LiveKitRoomConnection({ roomId }: { roomId: string }) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [roomInstance, setRoomInstance] = useState<Room | null>(null);
  const [screen, setScreen] = useState<SharedScreen | null>(null);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

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

    // Consulta as trilhas existentes também ao entrar, para quem chegou depois
    // de o transmissor já estar compartilhando conseguir assistir.
    function updateScreen() {
      if (cancelled) return;
      const local = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      setSharing(Boolean(local?.videoTrack));
      if (local?.videoTrack) {
        setScreen({
          track: local.videoTrack,
          ownerId: room.localParticipant.identity,
          ownerLabel: "você",
        });
        return;
      }
      for (const person of room.remoteParticipants.values()) {
        const publication = person.getTrackPublication(Track.Source.ScreenShare);
        if (publication?.videoTrack && publication.isSubscribed && !publication.isMuted) {
          setScreen({
            track: publication.videoTrack,
            ownerId: person.identity,
            ownerLabel: person.name || `participante ${person.identity.slice(0, 8)}`,
          });
          return;
        }
      }
      setScreen(null);
    }

    room.on(RoomEvent.ParticipantConnected, updateParticipants);
    room.on(RoomEvent.ParticipantDisconnected, () => {
      updateParticipants();
      updateScreen();
    });
    room.on(RoomEvent.TrackSubscribed, updateScreen);
    room.on(RoomEvent.TrackUnsubscribed, updateScreen);
    room.on(RoomEvent.TrackPublished, updateScreen);
    room.on(RoomEvent.TrackUnpublished, updateScreen);
    room.on(RoomEvent.LocalTrackPublished, updateScreen);
    room.on(RoomEvent.LocalTrackUnpublished, updateScreen);
    room.on(RoomEvent.TrackMuted, updateScreen);
    room.on(RoomEvent.TrackUnmuted, updateScreen);
    room.on(RoomEvent.Connected, () => {
      if (cancelled) return;
      setPhase("connected");
      updateParticipants();
      updateScreen();
    });
    room.on(RoomEvent.Reconnecting, () => {
      if (!cancelled) setPhase("reconnecting");
    });
    room.on(RoomEvent.Reconnected, () => {
      if (cancelled) return;
      setPhase("connected");
      updateParticipants();
      updateScreen();
    });
    room.on(RoomEvent.Disconnected, () => {
      if (cancelled) return;
      setPhase("disconnected");
      setRoomInstance(null);
      setParticipants([]);
      setScreen(null);
      setSharing(false);
    });

    async function connect() {
      setPhase("connecting");
      setRoomInstance(null);
      setParticipants([]);
      setScreen(null);
      setSharing(false);
      setCaptureError(null);
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
        setRoomInstance(room);
        setPhase("connected");
        updateParticipants();
        updateScreen();
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
      void room.disconnect(); // Libera a captura e a conexão ao sair da sala.
    };
  }, [roomId, attempt]);

  const localId = roomInstance?.localParticipant.identity;
  const anotherSharing = Boolean(screen && screen.ownerId !== localId);

  async function toggleShare() {
    const room = roomInstance;
    if (!room || room.state !== ConnectionState.Connected || busyRef.current) return;
    if (anotherSharing && !sharing) return;
    busyRef.current = true;
    setBusy(true);
    setCaptureError(null);
    try {
      if (room.localParticipant.isScreenShareEnabled) {
        await room.localParticipant.setScreenShareEnabled(false);
      } else {
        // Chamado diretamente pelo clique para preservar a ativação de usuário.
        // 720p/30 é um perfil de teste; o hardware pode entregar menos FPS.
        await room.localParticipant.setScreenShareEnabled(
          true,
          {
            audio: false,
            contentHint: "motion",
            resolution: { width: 1280, height: 720, frameRate: 30 },
          },
          {
            screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
            degradationPreference: "maintain-framerate",
            simulcast: true,
          }
        );
      }
      // Eventos do LiveKit também atualizam o vídeo ao iniciar ou parar.
      setSharing(room.localParticipant.isScreenShareEnabled);
    } catch (cause) {
      // Cancelar o seletor de tela não deve interromper a conexão da sala.
      const name = cause instanceof Error ? cause.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setCaptureError(cause instanceof Error ? cause.message : "Falha ao compartilhar a tela.");
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

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
      {captureError && (
        <div className="connection-error" role="alert">Falha na captura: {captureError}</div>
      )}

      <div className="room-layout">
        <StreamArea screen={screen} />
        <ParticipantList participants={participants} phase={phase} sharingId={screen?.ownerId ?? null} />
      </div>

      <RoomInvite roomId={roomId} />
      <RoomControls
        connected={phase === "connected" && !!roomInstance}
        sharing={sharing}
        busy={busy}
        anotherSharing={anotherSharing}
        onToggleShare={() => void toggleShare()}
      />
    </main>
  );
}
