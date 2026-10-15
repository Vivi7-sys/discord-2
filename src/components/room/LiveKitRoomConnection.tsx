"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioPresets, ConnectionState, Room, RoomEvent, Track, type LocalTrack, type LocalTrackPublication } from "livekit-client";
import Link from "next/link";
import ParticipantList from "./ParticipantList";
import RoomControls from "./RoomControls";
import ShareDialog from "./ShareDialog";
import { DEFAULT_QUALITY_PROFILE, QUALITY_PRESETS, browserAudioOptions, findVirtualAudioDevice } from "@/lib/capture/screen-options";
import { startMediaDiagnostics } from "@/lib/capture/media-diagnostics";
import type { AudioMode, QualityProfile } from "./RoomControls";
import RemoteScreenAudio from "./RemoteScreenAudio";
import StreamVolumeControl from "./StreamVolumeControl";
import StreamArea from "./StreamArea";
import type { SharedScreen } from "./StreamArea";
import RoomInvite from "./RoomInvite";
import { cleanupScreenTracks, publishScreenTracks } from "@/lib/capture/publish-screen-tracks";
import { avatarFromMetadata, type RoomProfile } from "@/lib/room/participant-profile";

type Phase = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

type ParticipantItem = {
  id: string;
  label: string;
  isLocal: boolean;
  avatar: string | null;
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

export default function LiveKitRoomConnection({ roomId, profile }: { roomId: string; profile: RoomProfile }) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [roomInstance, setRoomInstance] = useState<Room | null>(null);
  const [screen, setScreen] = useState<SharedScreen | null>(null);
  const [theaterMode, setTheaterMode] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [broadcastAllowed, setBroadcastAllowed] = useState(false);
  const tokenRef = useRef<{ room: Room; token: string } | null>(null);
  const activeRoomRef = useRef<Room | null>(null);
  const captureTracksRef = useRef<{ room: Room; tracks: LocalTrack[]; onEnded: () => void } | null>(null);
  const captureGenerationRef = useRef(0);
  const shareOperationRef = useRef(0);
  const [hasReservation, setHasReservation] = useState(false);
  const reservedRoomRef = useRef<Room | null>(null);
  const releasesRef = useRef(new WeakMap<Room, Promise<void>>());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const stoppingShareRef = useRef<Room | null>(null);
  const virtualTrackRef = useRef<MediaStreamTrack | null>(null);
  const pendingVirtualTrackRef = useRef<MediaStreamTrack | null>(null);
  const [pendingAudioConfirmation, setPendingAudioConfirmation] = useState(false);
  const [audioMode, setAudioMode] = useState<AudioMode>("browser");
  const [qualityProfile, setQualityProfile] = useState<QualityProfile>(DEFAULT_QUALITY_PROFILE);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [audioStatus, setAudioStatus] = useState<string | null>(null);

  const invalidateCapture = useCallback(() => { captureGenerationRef.current++; }, []);

  const releaseScreenCapture = useCallback(async (room: Room) => {
    const capture = captureTracksRef.current;
    if (!capture || capture.room !== room) return;
    invalidateCapture();
    captureTracksRef.current = null;
    capture.tracks[0]?.mediaStreamTrack.removeEventListener("ended", capture.onEnded);
    await cleanupScreenTracks(capture.tracks, (track) => room.localParticipant.unpublishTrack(track, true));
  }, [invalidateCapture]);

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
    track.stop();
    try {
      await room.localParticipant.unpublishTrack(track, true);
    } catch {
      // Pode ter desconectado enquanto a trilha estava sendo removida.
    }
  }, [discardPendingVirtualAudio]);

  const requestBroadcastAction = useCallback(async (room: Room, action: "acquire" | "release") => {
    const session = tokenRef.current;
    if (!session || session.room !== room) throw new Error("Entre na sala novamente para solicitar a transmissão.");
    const pendingRelease = releasesRef.current.get(room);
    if (action === "release" && pendingRelease) return pendingRelease;
    const work = async () => {
      // Se a resposta HTTP inteira se perder, a reserva pode existir no servidor.
      // Oferecer Cancelar vez é seguro: release continua autenticado por dono.
      if (action === "acquire" && activeRoomRef.current === room) {
        reservedRoomRef.current = room;
        setHasReservation(true);
      }
      const response = await fetch("/api/livekit/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.token}`,
        },
        body: JSON.stringify({ roomId, action }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const result: { error?: string; reservationHeld?: boolean } = await response.json();
      if (result.reservationHeld && activeRoomRef.current === room) {
        reservedRoomRef.current = room;
        setHasReservation(true);
      }
      if (response.ok && action === "release" && result.reservationHeld) {
        throw new Error("A permissão foi revogada, mas não foi possível limpar a reserva. Use Cancelar vez para tentar novamente.");
      }
      if (!response.ok) {
        const knownNotHeld = result.reservationHeld === false || (response.status < 500 && !result.reservationHeld);
        if (action === "acquire" && knownNotHeld && activeRoomRef.current === room) {
          if (reservedRoomRef.current === room) reservedRoomRef.current = null;
          setHasReservation(false);
        }
        throw new Error(result.error || "Não foi possível solicitar a transmissão.");
      }
      // A resposta HTTP pode chegar antes do evento de permissões do LiveKit.
      if (action === "acquire") reservedRoomRef.current = room;
      else if (reservedRoomRef.current === room) reservedRoomRef.current = null;
      if (activeRoomRef.current === room) setHasReservation(action === "acquire");
    };
    const request = work();
    if (action === "release") releasesRef.current.set(room, request);
    try {
      await request;
    } finally {
      if (action === "release") releasesRef.current.delete(room);
    }
  }, [roomId]);

  async function requestBroadcast() {
    const room = roomInstance;
    if (!room || room.state !== ConnectionState.Connected || busyRef.current || anotherSharing) return;
    busyRef.current = true;
    setBusy(true);
    setCaptureError(null);
    try {
      await requestBroadcastAction(room, "acquire");
      if (activeRoomRef.current !== room) return;
      // A atualização também chega ao navegador pelo evento de permissões.
      setBroadcastAllowed(Boolean(room.localParticipant.permissions?.canPublish));
      if (!room.localParticipant.permissions?.canPublish) {
        setAudioStatus("Permissão concedida pelo servidor. Aguarde o botão mudar para Compartilhar tela.");
      } else {
        setAudioStatus(null);
      }
    } catch (cause) {
      if (activeRoomRef.current !== room) return;
      setCaptureError(cause instanceof Error ? cause.message : "Não foi possível reservar a transmissão.");
    } finally {
      if (activeRoomRef.current === room) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function cancelBroadcast() {
    const room = roomInstance;
    if (busyRef.current || !room || sharing) return;
    busyRef.current = true;
    setBusy(true);
    setCaptureError(null);
    try {
      await requestBroadcastAction(room, "release");
      if (activeRoomRef.current !== room) return;
      setBroadcastAllowed(false);
      setAudioStatus(null);
    } catch (cause) {
      if (activeRoomRef.current !== room) return;
      setCaptureError(cause instanceof Error ? cause.message : "Não foi possível liberar a transmissão.");
    } finally {
      if (activeRoomRef.current === room) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function publishVirtualAudio(room: Room, audio: MediaStreamTrack, generation = captureGenerationRef.current) {
    if (generation !== captureGenerationRef.current || audio.readyState !== "live" ||
        activeRoomRef.current !== room ||
        !room.localParticipant.isScreenShareEnabled ||
        room.state !== ConnectionState.Connected) {
      audio.stop();
      setAudioStatus("A captura ou a conexão terminou; áudio não enviado.");
      return;
    }
    virtualTrackRef.current = audio;
    async function cleanupAudio() {
      if (virtualTrackRef.current === audio) virtualTrackRef.current = null;
      audio.stop();
      try { await room.localParticipant.unpublishTrack(audio, true); } catch { /* Já desconectou. */ }
    }
    try {
      await room.localParticipant.publishTrack(audio, {
        source: Track.Source.ScreenShareAudio,
        audioPreset: AudioPresets.musicHighQualityStereo,
        dtx: false,
        forceStereo: true,
      });
      if (generation !== captureGenerationRef.current || activeRoomRef.current !== room || !room.localParticipant.isScreenShareEnabled || room.state !== ConnectionState.Connected) {
        await cleanupAudio();
      } else {
        setAudioStatus("Transmitindo áudio do sistema via fonte virtual Linux.");
      }
    } catch {
      await cleanupAudio();
      if (generation !== captureGenerationRef.current || activeRoomRef.current !== room) return;
      setAudioStatus("Não foi possível enviar a fonte virtual; o vídeo continua funcionando.");
    }
  }

  async function approveVirtualAudio() {
    const room = roomInstance;
    const audio = pendingVirtualTrackRef.current;
    if (!room || !audio || !pendingAudioConfirmation || busyRef.current) return;
    pendingVirtualTrackRef.current = null;
    setPendingAudioConfirmation(false);
    const operation = ++shareOperationRef.current;
    busyRef.current = true;
    setBusy(true);
    try {
      // O usuário deve verificar a origem no pavucontrol antes de autorizar.
      // Nunca publicar automaticamente uma entrada genérica.
      if (!/^(padrão|padrao|default)$/i.test(audio.label.trim())) {
        audio.stop();
        setAudioStatus("Confirmação manual indisponível; áudio não enviado.");
        return;
      }
      await publishVirtualAudio(room, audio);
    } finally {
      if (activeRoomRef.current === room && shareOperationRef.current === operation) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function captureVirtualAudio(room: Room, generation: number) {
    const isCurrent = () => generation === captureGenerationRef.current &&
      activeRoomRef.current === room && room.state === ConnectionState.Connected &&
      room.localParticipant.isScreenShareEnabled;
    // É uma escolha explícita: jamais publicamos a entrada padrão às cegas.
    try {
      // Não abrir a entrada padrão: pode ser o microfone antes de o usuário
      // conseguir roteá-la. Exigir a fonte virtual identificada previamente.
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!isCurrent()) return;
      const virtualDevice = findVirtualAudioDevice(devices);
      if (!virtualDevice) {
        setAudioStatus("A fonte Screen Share Audio ainda não foi identificada. Configure e autorize a entrada virtual no navegador e tente novamente; nenhuma entrada padrão foi aberta. O vídeo continua funcionando.");
        return;
      }
      if (!isCurrent()) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: virtualDevice.deviceId },
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
      if (!audio || !isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        if (isCurrent()) setAudioStatus("A conexão ou a captura foi encerrada; áudio não enviado.");
      } else if (verifiedByName) {
        await publishVirtualAudio(room, audio, generation);
      } else if (genericDefault) {
        pendingVirtualTrackRef.current = audio;
        setPendingAudioConfirmation(true);
        setAudioStatus("Áudio NÃO enviado. Em pavucontrol → Gravando, escolha Screen Share Audio para este navegador. Confirme que NÃO é o microfone antes de autorizar.");
      } else {
        stream.getTracks().forEach((track) => track.stop());
        setAudioStatus("Não foi possível confirmar a fonte de áudio; vídeo continua funcionando.");
      }
    } catch {
      if (isCurrent()) setAudioStatus("Não foi possível abrir a fonte virtual. O vídeo continua funcionando.");
    }
  }

  function rejectVirtualAudio() {
    discardPendingVirtualAudio();
    setAudioStatus("Áudio cancelado; vídeo continua funcionando.");
  }

  useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    activeRoomRef.current = room;
    const controller = new AbortController();
    let cancelled = false;

    function updateBroadcastPermission() {
      if (!cancelled) {
        const allowed = Boolean(room.localParticipant.permissions?.canPublish);
        setBroadcastAllowed(allowed);
        if (!allowed) {
          invalidateCapture();
          void releaseScreenCapture(room);
          void releaseVirtualAudio(room);
        }
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
        avatar: avatarFromMetadata(person.metadata),
      }));
      setParticipants([
        { id: room.localParticipant.identity, label: profile.displayName, isLocal: true, avatar: avatarFromMetadata(room.localParticipant.metadata) ?? profile.avatar },
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
    room.on(RoomEvent.ParticipantMetadataChanged, updateParticipants);
    room.on(RoomEvent.ParticipantDisconnected, () => {
      updateParticipants();
      updateScreen();
    });
    room.on(RoomEvent.TrackSubscribed, updateScreen);
    room.on(RoomEvent.TrackUnsubscribed, updateScreen);
    room.on(RoomEvent.TrackPublished, updateScreen);
    room.on(RoomEvent.TrackUnpublished, updateScreen);
    room.on(RoomEvent.LocalTrackPublished, updateScreen);
    room.on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
      updateScreen();
      // Se o usuário usar "Parar compartilhamento" no próprio navegador,
      // encerra também a captura virtual de áudio.
      if (publication.source === Track.Source.ScreenShare && !room.localParticipant.isScreenShareEnabled) {
        void releaseScreenCapture(room);
        void releaseVirtualAudio(room);
        setAudioStatus(null);
        // Também funciona quando a pessoa usa "Parar" na interface do navegador.
        if (stoppingShareRef.current !== room && room.state === ConnectionState.Connected && room.localParticipant.permissions?.canPublish) {
          void requestBroadcastReleaseAfterBrowserStop(room);
        }
      }
    });
    room.on(RoomEvent.TrackMuted, updateScreen);
    room.on(RoomEvent.TrackUnmuted, updateScreen);
    async function requestBroadcastReleaseAfterBrowserStop(roomToRelease: Room) {
      if (cancelled || roomToRelease.state !== ConnectionState.Connected) return;
      try {
        await requestBroadcastAction(roomToRelease, "release");
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
      if (cancelled) return;
      activeRoomRef.current = null;
      invalidateCapture();
      setHasReservation(false);
      void releaseScreenCapture(room);
      // Não manter a fonte virtual gravando após a saída definitiva da sala.
      void releaseVirtualAudio(room);
      setShareDialogOpen(false);
      setPhase("disconnected");
      setError("A conexão com a sala foi encerrada. Confira sua internet e clique em Tentar novamente.");
      setCaptureError(null);
      setAudioStatus(null);
      setRoomInstance(null);
      setParticipants([]);
      setScreen(null);
      setSharing(false);
      setBroadcastAllowed(false);
      setHasReservation(false);
      tokenRef.current = null;
      busyRef.current = false;
      setBusy(false);
    });

    async function connect() {
      setPhase("connecting");
      setRoomInstance(null);
      setParticipants([]);
      setScreen(null);
      setSharing(false);
      setBroadcastAllowed(false);
      setHasReservation(false);
      tokenRef.current = null;
      setCaptureError(null);
      setAudioStatus(null);
      discardPendingVirtualAudio();
      setError(null);
      try {
        const response = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, displayName: profile.displayName, avatar: profile.avatar }),
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
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
        if (cancelled || activeRoomRef.current !== room || room.state !== ConnectionState.Connected) {
          void room.disconnect();
          return;
        }
        tokenRef.current = { room, token: data.token };
        setRoomInstance(room);
        setPhase("connected");
        updateParticipants();
        updateScreen();
        updateBroadcastPermission();
      } catch (cause) {
        if (cancelled) return;
        void room.disconnect();
        setPhase("error");
        setParticipants([]);
        setError(cause instanceof Error ? cause.message : "Não foi possível entrar na sala.");
      }
    }

    const stopDiagnostics = startMediaDiagnostics(room);
    void connect();
    return () => {
      cancelled = true;
      invalidateCapture();
      stopDiagnostics();
      controller.abort();
      tokenRef.current = null;
      if (activeRoomRef.current === room) activeRoomRef.current = null;
      busyRef.current = false;
      room.removeAllListeners();
      void releaseScreenCapture(room);
      void releaseVirtualAudio(room);
      void room.disconnect(); // Libera a captura e a conexão ao sair da sala.
    };
  }, [invalidateCapture, roomId, attempt, profile.displayName, profile.avatar, releaseScreenCapture, releaseVirtualAudio, discardPendingVirtualAudio, requestBroadcastAction]);

  // O navegador lembra o volume escolhido sem conta ou banco de dados.
  const [streamVolume, setStreamVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 100;
    try {
      const saved = window.localStorage.getItem("discord2-stream-volume");
      if (saved === null) return 100;
      const number = Number(saved);
      return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number) : 100;
    } catch {
      return 100;
    }
  });
  const [streamMuted, setStreamMuted] = useState(false);

  function updateStreamVolume(nextVolume: number) {
    const safeVolume = Math.max(0, Math.min(100, Math.round(nextVolume)));
    setStreamVolume(safeVolume);
    if (safeVolume > 0) setStreamMuted(false);
    try {
      window.localStorage.setItem("discord2-stream-volume", String(safeVolume));
    } catch {
      // O volume continua funcionando se o navegador bloquear o armazenamento.
    }
  }

  const localId = roomInstance?.localParticipant.identity;
  const anotherSharing = Boolean(screen && screen.ownerId !== localId);

  function openShareDialog() {
    if (!sharing) setShareDialogOpen(true);
    else void toggleShare();
  }

  async function dismissShareDialog() {
    setShareDialogOpen(false);
    // A reserva vem de Solicitar transmissão; fechar o modal devolve a vez.
    if (roomInstance && (reservedRoomRef.current === roomInstance || roomInstance.localParticipant.permissions?.canPublish)) {
      await cancelBroadcast();
    }
  }

  async function toggleShare() {
    const room = roomInstance;
    if (!room || room.state !== ConnectionState.Connected || stoppingShareRef.current === room) return;
    // Parar deve funcionar até durante uma publicação de áudio pendente.
    if (busyRef.current && !room.localParticipant.isScreenShareEnabled) return;
    if (anotherSharing && !sharing) return;
    if (!room.localParticipant.isScreenShareEnabled && !room.localParticipant.permissions?.canPublish) {
      setCaptureError("Solicite a transmissão e aguarde a liberação antes de compartilhar.");
      return;
    }
    setShareDialogOpen(false);
    const operation = ++shareOperationRef.current;
    busyRef.current = true;
    setBusy(true);
    setCaptureError(null);
    try {
      if (room.localParticipant.isScreenShareEnabled) {
        stoppingShareRef.current = room;
        await Promise.all([releaseScreenCapture(room), releaseVirtualAudio(room)]);
        await requestBroadcastAction(room, "release");
        if (activeRoomRef.current !== room) return;
        setBroadcastAllowed(false);
        setAudioStatus(null);
      } else {
        // Chamado diretamente pelo clique para preservar a ativação de usuário.
        // Perfil selecionado vale para esta captura; não interfere no áudio.
        const generation = ++captureGenerationRef.current;
        const quality = QUALITY_PRESETS[qualityProfile];
        const tracks = await room.localParticipant.createScreenTracks({
          audio: audioMode === "browser" ? browserAudioOptions(navigator.mediaDevices.getSupportedConstraints()) : false,
          selfBrowserSurface: "exclude",
          systemAudio: audioMode === "browser" ? "include" : "exclude",
          contentHint: "motion",
          resolution: { width: quality.width, height: quality.height, frameRate: quality.fps },
        });
        // O seletor pode continuar aberto após sair da sala. Toda captura que
        // chegar tarde é parada antes de publicar ou abrir uma fonte de áudio.
        if (generation !== captureGenerationRef.current || activeRoomRef.current !== room || room.state !== ConnectionState.Connected) {
          tracks.forEach((track) => track.stop());
          return;
        }
        const onEnded = () => {
          if (activeRoomRef.current !== room || captureTracksRef.current?.tracks !== tracks) return;
          // O SDK pode esperar uma publicação pendente antes de emitir
          // LocalTrackUnpublished. Pare o áudio já no evento nativo do vídeo.
          void releaseScreenCapture(room);
          void releaseVirtualAudio(room);
          setAudioStatus(null);
          if (room.state === ConnectionState.Connected && room.localParticipant.permissions?.canPublish) {
            void requestBroadcastAction(room, "release").catch(() => {
              if (activeRoomRef.current === room) setCaptureError("Não foi possível liberar a vaga. Use Cancelar vez.");
            });
          }
        };
        captureTracksRef.current = { room, tracks, onEnded };
        tracks[0]?.mediaStreamTrack.addEventListener("ended", onEnded, { once: true });
        const published = await publishScreenTracks({
          tracks,
          isActive: () => generation === captureGenerationRef.current && activeRoomRef.current === room &&
            room.state === ConnectionState.Connected &&
            tracks[0]?.mediaStreamTrack.readyState === "live",
          publish: (track) => room.localParticipant.publishTrack(track, {
            screenShareEncoding: { maxBitrate: quality.bitrate, maxFramerate: quality.fps },
            videoCodec: "vp8",
            degradationPreference: "balanced",
            simulcast: true,
            audioPreset: AudioPresets.musicHighQualityStereo,
            forceStereo: true,
            dtx: false,
          }),
          unpublish: (track) => room.localParticipant.unpublishTrack(track, true),
        });
        if (!published) {
          if (shareOperationRef.current === operation && activeRoomRef.current === room && room.state === ConnectionState.Connected) {
            await requestBroadcastAction(room, "release");
          }
          return;
        }

        if (audioMode === "browser") {
          const publication = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
          setAudioStatus(publication?.audioTrack
            ? "O navegador está transmitindo áudio da tela."
            : "Vídeo transmitido sem áudio: o navegador não forneceu uma faixa de som. Para áudio de guia, tente Chrome, Edge ou Brave e habilite o compartilhamento de áudio. Para jogos no Linux, use a fonte virtual nas configurações.");
        } else if (audioMode === "linux-virtual") {
          void captureVirtualAudio(room, generation);
        } else {
          setAudioStatus("Transmitindo somente vídeo.");
        }
      }
      if (shareOperationRef.current !== operation || activeRoomRef.current !== room) return;
      // Eventos do LiveKit também atualizam o vídeo ao iniciar ou parar.
      setSharing(room.localParticipant.isScreenShareEnabled);
    } catch (cause) {
      if (shareOperationRef.current !== operation || activeRoomRef.current !== room) return;
      // Cancelar o seletor de tela não deve interromper a conexão da sala.
      const name = cause instanceof Error ? cause.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setCaptureError(cause instanceof Error ? cause.message : "Falha ao compartilhar a tela.");
      }
      // Se a seleção de tela for cancelada, não reter a vaga da sala.
      if (!room.localParticipant.isScreenShareEnabled && stoppingShareRef.current !== room) {
        try {
          await requestBroadcastAction(room, "release");
          if (activeRoomRef.current !== room) return;
          setBroadcastAllowed(false);
        } catch {
          if (activeRoomRef.current === room) setCaptureError("A captura foi cancelada, mas não foi possível liberar a vaga. Use Cancelar vez.");
        }
      }
    } finally {
      if (shareOperationRef.current === operation && stoppingShareRef.current === room) stoppingShareRef.current = null;
      if (shareOperationRef.current === operation && activeRoomRef.current === room) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <main className={theaterMode && screen ? "room room-theater" : "room"}>
      <header className="room-header">
        <div className="room-heading">
          <h1 className="room-sr-only">Sala de transmissão</h1>
          <Link href="/" className="back-link">← Início</Link>
          <RoomInvite roomId={roomId} />
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

      <div className="room-section-bar">
        <span className="room-section-title">TELA COMPARTILHADA</span>
        <span className={`room-section-state${screen ? " room-section-state-live" : ""}`}>
          {screen ? "● AO VIVO" : "AGUARDANDO TRANSMISSÃO"}
        </span>
      </div>

      <div className="room-layout">
        <StreamArea
          screen={screen}
          theaterMode={theaterMode}
          onToggleTheater={() => setTheaterMode((enabled) => !enabled)}
          volumeControl={
            <StreamVolumeControl
              volume={streamVolume}
              muted={streamMuted}
              onVolumeChange={updateStreamVolume}
              onToggleMute={() => {
                if (streamVolume === 0) updateStreamVolume(50);
                else setStreamMuted((value) => !value);
              }}
            />
          }
          controls={
            <RoomControls
              connected={phase === "connected" && !!roomInstance}
              sharing={sharing}
              busy={busy}
              anotherSharing={anotherSharing}
              broadcastAllowed={broadcastAllowed}
              hasReservation={hasReservation}
              onRequestBroadcast={() => void requestBroadcast()}
              onCancelBroadcast={() => void cancelBroadcast()}
              audioStatus={audioStatus}
              pendingAudioConfirmation={pendingAudioConfirmation}
              onApproveVirtualAudio={() => void approveVirtualAudio()}
              onRejectVirtualAudio={rejectVirtualAudio}
              onToggleShare={openShareDialog}
            />
          }
        />
        <ParticipantList participants={participants} phase={phase} sharingId={screen?.ownerId ?? null} />
      </div>

      {shareDialogOpen && (
        <ShareDialog audioMode={audioMode} onAudioModeChange={setAudioMode}
          qualityProfile={qualityProfile} onQualityProfileChange={setQualityProfile}
          canStart={phase === "connected" && broadcastAllowed && !busy && !anotherSharing}
          onStart={() => void toggleShare()} onCancel={() => void dismissShareDialog()} />
      )}
      {roomInstance && (
        <RemoteScreenAudio room={roomInstance} volume={streamVolume} muted={streamMuted} />
      )}
    </main>
  );
}
