"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioPresets, ConnectionState, Room, RoomEvent, Track } from "livekit-client";
import Link from "next/link";
import ParticipantList from "./ParticipantList";
import RoomControls from "./RoomControls";
import type { AudioMode, QualityProfile } from "./RoomControls";
import RemoteScreenAudio from "./RemoteScreenAudio";
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

// Valores desejados: o navegador e o hardware podem entregar menos FPS/resolução.
const QUALITY_PRESETS: Record<QualityProfile, {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}> = {
  economico: { width: 854, height: 480, fps: 20, bitrate: 900_000 },
  equilibrado: { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  alta: { width: 1920, height: 1080, fps: 60, bitrate: 6_000_000 },
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
  const [broadcastAllowed, setBroadcastAllowed] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const virtualTrackRef = useRef<MediaStreamTrack | null>(null);
  const pendingVirtualTrackRef = useRef<MediaStreamTrack | null>(null);
  const [pendingAudioConfirmation, setPendingAudioConfirmation] = useState(false);
  const [audioMode, setAudioMode] = useState<AudioMode>("none");
  const [qualityProfile, setQualityProfile] = useState<QualityProfile>("equilibrado");
  const [audioStatus, setAudioStatus] = useState<string | null>(null);

  // Enquanto o usuário confere o pavucontrol, a entrada está capturando,
  // mas NÃO está publicada no LiveKit.
  const discardPendingVirtualAudio = useCallback(() => {
    pendingVirtualTrackRef.current?.stop();
    pendingVirtualTrackRef.current = null;
    setPendingAudioConfirmation(false);
  }, []);

  const releaseVirtualAudio = useCallback(async (room: Room) => {
    discardPendingVirtualAudio();
    const track = virtualTrackRef.current;
    virtualTrackRef.current = null;
    if (!track) return;
    try {
      await room.localParticipant.unpublishTrack(track, true);
    } catch {
      // Pode ter desconectado enquanto a trilha estava sendo removida.
    } finally {
      track.stop();
    }
  }, [discardPendingVirtualAudio]);

  async function requestBroadcastAction(action: "acquire" | "release") {
    const token = tokenRef.current;
    if (!token) throw new Error("Entre na sala novamente para solicitar a transmissão.");
    const response = await fetch("/api/livekit/share", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ roomId, action }),
      cache: "no-store",
    });
    const result: { error?: string } = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível solicitar a transmissão.");
  }

  async function requestBroadcast() {
    const room = roomInstance;
    if (!room || room.state !== ConnectionState.Connected || busyRef.current || anotherSharing) return;
    busyRef.current = true;
    setBusy(true);
    setCaptureError(null);
    try {
      await requestBroadcastAction("acquire");
      // A atualização também chega ao navegador pelo evento de permissões.
      setBroadcastAllowed(Boolean(room.localParticipant.permissions?.canPublish));
      if (!room.localParticipant.permissions?.canPublish) {
        setAudioStatus("Permissão concedida pelo servidor. Aguarde o botão mudar para Compartilhar tela.");
      } else {
        setAudioStatus(null);
      }
    } catch (cause) {
      setCaptureError(cause instanceof Error ? cause.message : "Não foi possível reservar a transmissão.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function cancelBroadcast() {
    if (busyRef.current || !roomInstance || sharing) return;
    busyRef.current = true;
    setBusy(true);
    setCaptureError(null);
    try {
      await requestBroadcastAction("release");
      setBroadcastAllowed(false);
      setAudioStatus(null);
    } catch (cause) {
      setCaptureError(cause instanceof Error ? cause.message : "Não foi possível liberar a transmissão.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function publishVirtualAudio(room: Room, audio: MediaStreamTrack) {
    if (audio.readyState !== "live" ||
        !room.localParticipant.isScreenShareEnabled ||
        room.state !== ConnectionState.Connected) {
      audio.stop();
      setAudioStatus("A captura ou a conexão terminou; áudio não enviado.");
      return;
    }
    virtualTrackRef.current = audio;
    try {
      await room.localParticipant.publishTrack(audio, {
        source: Track.Source.ScreenShareAudio,
        audioPreset: AudioPresets.musicHighQualityStereo,
        dtx: false,
        forceStereo: true,
      });
      if (!room.localParticipant.isScreenShareEnabled || room.state !== ConnectionState.Connected) {
        await releaseVirtualAudio(room);
      } else {
        setAudioStatus("Transmitindo áudio do sistema via fonte virtual Linux.");
      }
    } catch {
      await releaseVirtualAudio(room);
      setAudioStatus("Não foi possível enviar a fonte virtual; o vídeo continua funcionando.");
    }
  }

  async function approveVirtualAudio() {
    const room = roomInstance;
    const audio = pendingVirtualTrackRef.current;
    if (!room || !audio || !pendingAudioConfirmation || busyRef.current) return;
    pendingVirtualTrackRef.current = null;
    setPendingAudioConfirmation(false);
    busyRef.current = true;
    setBusy(true);
    try {
      // Permissão apenas para diagnóstico local; não é uma validação do sistema.
      if (process.env.NODE_ENV !== "development" ||
          !/^(padrão|padrao|default)$/i.test(audio.label.trim())) {
        audio.stop();
        setAudioStatus("Confirmação manual indisponível; áudio não enviado.");
        return;
      }
      await publishVirtualAudio(room, audio);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function rejectVirtualAudio() {
    discardPendingVirtualAudio();
    setAudioStatus("Áudio cancelado; vídeo continua funcionando.");
  }

  useEffect(() => {
    const room = new Room({ adaptiveStream: true });
    const controller = new AbortController();
    let cancelled = false;

    function updateBroadcastPermission() {
      if (!cancelled) {
        setBroadcastAllowed(Boolean(room.localParticipant.permissions?.canPublish));
      }
    }

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

    room.on(RoomEvent.ParticipantPermissionsChanged, updateBroadcastPermission);
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
    room.on(RoomEvent.LocalTrackUnpublished, () => {
      updateScreen();
      // Se o usuário usar "Parar compartilhamento" no próprio navegador,
      // encerra também a captura virtual de áudio.
      if (!room.localParticipant.isScreenShareEnabled) {
        void releaseVirtualAudio(room);
        setAudioStatus(null);
        // Também funciona quando a pessoa usa "Parar" na interface do navegador.
        if (room.state === ConnectionState.Connected && room.localParticipant.permissions?.canPublish) {
          void requestBroadcastReleaseAfterBrowserStop(room);
        }
      }
    });
    room.on(RoomEvent.TrackMuted, updateScreen);
    room.on(RoomEvent.TrackUnmuted, updateScreen);
    async function requestBroadcastReleaseAfterBrowserStop(roomToRelease: Room) {
      const token = tokenRef.current;
      if (!token || roomToRelease.state !== ConnectionState.Connected) return;
      try {
        const response = await fetch("/api/livekit/share", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ roomId, action: "release" }),
          cache: "no-store",
        });
        if (!response.ok && !cancelled) {
          setCaptureError("A tela parou, mas não foi possível liberar a vaga. Use Cancelar vez.");
        }
      } catch {
        if (!cancelled) setCaptureError("Não foi possível liberar a vaga. Use Cancelar vez.");
      }
    }

    room.on(RoomEvent.Connected, () => {
      if (cancelled) return;
      setPhase("connected");
      updateParticipants();
      updateScreen();
      updateBroadcastPermission();
    });
    room.on(RoomEvent.Reconnecting, () => {
      if (cancelled) return;
      setPhase("reconnecting");
      setError(null);
    });
    room.on(RoomEvent.Reconnected, () => {
      if (cancelled) return;
      setPhase("connected");
      setError(null);
      updateParticipants();
      updateScreen();
      updateBroadcastPermission();
    });
    room.on(RoomEvent.Disconnected, () => {
      discardPendingVirtualAudio();
      if (cancelled) return;
      // Não manter a fonte virtual gravando após a saída definitiva da sala.
      void releaseVirtualAudio(room);
      setPhase("disconnected");
      setError("A conexão com a sala foi encerrada. Confira sua internet e clique em Tentar novamente.");
      setCaptureError(null);
      setAudioStatus(null);
      setRoomInstance(null);
      setParticipants([]);
      setScreen(null);
      setSharing(false);
      setBroadcastAllowed(false);
      tokenRef.current = null;
    });

    async function connect() {
      setPhase("connecting");
      setRoomInstance(null);
      setParticipants([]);
      setScreen(null);
      setSharing(false);
      setBroadcastAllowed(false);
      tokenRef.current = null;
      setCaptureError(null);
      setAudioStatus(null);
      discardPendingVirtualAudio();
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
        tokenRef.current = data.token;
        setRoomInstance(room);
        setPhase("connected");
        updateParticipants();
        updateScreen();
        updateBroadcastPermission();
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
      void releaseVirtualAudio(room);
      void room.disconnect(); // Libera a captura e a conexão ao sair da sala.
    };
  }, [roomId, attempt, releaseVirtualAudio, discardPendingVirtualAudio]);

  const localId = roomInstance?.localParticipant.identity;
  const anotherSharing = Boolean(screen && screen.ownerId !== localId);

  async function toggleShare() {
    const room = roomInstance;
    if (!room || room.state !== ConnectionState.Connected || busyRef.current) return;
    if (anotherSharing && !sharing) return;
    if (!room.localParticipant.isScreenShareEnabled && !room.localParticipant.permissions?.canPublish) {
      setCaptureError("Solicite a transmissão e aguarde a liberação antes de compartilhar.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setCaptureError(null);
    try {
      if (room.localParticipant.isScreenShareEnabled) {
        await releaseVirtualAudio(room);
        await room.localParticipant.setScreenShareEnabled(false);
        await requestBroadcastAction("release");
        setBroadcastAllowed(false);
        setAudioStatus(null);
      } else {
        // Chamado diretamente pelo clique para preservar a ativação de usuário.
        // Perfil selecionado vale para esta captura; não interfere no áudio.
        const quality = QUALITY_PRESETS[qualityProfile];
        await room.localParticipant.setScreenShareEnabled(
          true,
          {
            audio: audioMode === "browser",
            systemAudio: audioMode === "browser" ? "include" : "exclude",
            contentHint: "motion",
            resolution: { width: quality.width, height: quality.height, frameRate: quality.fps },
          },
          {
            screenShareEncoding: { maxBitrate: quality.bitrate, maxFramerate: quality.fps },
            degradationPreference: "maintain-framerate",
            simulcast: true,
          }
        );

        if (audioMode === "browser") {
          const publication = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
          setAudioStatus(publication?.audioTrack
            ? "O navegador está transmitindo áudio da tela."
            : "O navegador compartilhou apenas o vídeo. No Linux, use a opção Fonte virtual Screen Share Audio.");
        } else if (audioMode === "linux-virtual") {
          // É uma escolha explícita: jamais publicamos a entrada padrão às cegas.
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 2,
              },
              video: false,
            });
            const audio = stream.getAudioTracks()[0];
            // Se o nome for "Padrão", mantemos a trilha local sem publicar.
            // O usuário inspeciona esta CAPTURA ATIVA no pavucontrol e só então
            // autoriza manualmente o envio, em vez de usar window.confirm().
            const verifiedByName = Boolean(
              audio && /^screen[ -]share[ -]audio$/i.test(audio.label.trim())
            );
            const genericDefault = Boolean(
              audio && /^(padrão|padrao|default)$/i.test(audio.label.trim())
            );
            if (!audio ||
                !room.localParticipant.isScreenShareEnabled ||
                room.state !== ConnectionState.Connected) {
              stream.getTracks().forEach((track) => track.stop());
              setAudioStatus("A conexão ou a captura foi encerrada; áudio não enviado.");
            } else if (verifiedByName) {
              await publishVirtualAudio(room, audio);
            } else if (genericDefault && process.env.NODE_ENV === "development") {
              pendingVirtualTrackRef.current = audio;
              setPendingAudioConfirmation(true);
              setAudioStatus("Áudio ainda NÃO enviado. Confira esta captura do Brave em pavucontrol → Gravando antes de confirmar.");
            } else {
              stream.getTracks().forEach((track) => track.stop());
              setAudioStatus("Não foi possível confirmar a fonte de áudio; vídeo continua funcionando.");
            }
          } catch {
            setAudioStatus("Não foi possível abrir a fonte virtual. O vídeo continua funcionando.");
          }
        } else {
          setAudioStatus("Transmitindo somente vídeo.");
        }
      }
      // Eventos do LiveKit também atualizam o vídeo ao iniciar ou parar.
      setSharing(room.localParticipant.isScreenShareEnabled);
    } catch (cause) {
      // Cancelar o seletor de tela não deve interromper a conexão da sala.
      const name = cause instanceof Error ? cause.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setCaptureError(cause instanceof Error ? cause.message : "Falha ao compartilhar a tela.");
      }
      // Se a seleção de tela for cancelada, não reter a vaga da sala.
      if (!room.localParticipant.isScreenShareEnabled) {
        try {
          await requestBroadcastAction("release");
          setBroadcastAllowed(false);
        } catch {
          setCaptureError("A captura foi cancelada, mas não foi possível liberar a vaga. Use Cancelar vez.");
        }
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

      {phase === "reconnecting" && (
        <div className="connection-error" role="status">
          Conexão instável. O LiveKit está tentando reconectar automaticamente.
          O vídeo e o áudio podem pausar por alguns instantes.
        </div>
      )}
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

      {roomInstance && <RemoteScreenAudio room={roomInstance} />}
      <RoomInvite roomId={roomId} />
      <RoomControls
        connected={phase === "connected" && !!roomInstance}
        sharing={sharing}
        busy={busy}
        anotherSharing={anotherSharing}
        broadcastAllowed={broadcastAllowed}
        onRequestBroadcast={() => void requestBroadcast()}
        onCancelBroadcast={() => void cancelBroadcast()}
        audioMode={audioMode}
        onAudioModeChange={setAudioMode}
        qualityProfile={qualityProfile}
        onQualityProfileChange={setQualityProfile}
        audioStatus={audioStatus}
        pendingAudioConfirmation={pendingAudioConfirmation}
        onApproveVirtualAudio={() => void approveVirtualAudio()}
        onRejectVirtualAudio={rejectVirtualAudio}
        onToggleShare={() => void toggleShare()}
      />
    </main>
  );
}
