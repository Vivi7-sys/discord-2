"use client";

import { useEffect, useRef, useState } from "react";
import { RemoteAudioTrack, Room, RoomEvent, Track } from "livekit-client";

// Apenas a trilha de áudio de tela é reproduzida, nunca o microfone.
export default function RemoteScreenAudio({ room }: { room: Room }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [track, setTrack] = useState<RemoteAudioTrack | null>(null);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function update() {
      let current: RemoteAudioTrack | null = null;
      for (const participant of room.remoteParticipants.values()) {
        const publication = participant.getTrackPublication(Track.Source.ScreenShareAudio);
        if (publication?.audioTrack instanceof RemoteAudioTrack && publication.isSubscribed && !publication.isMuted) {
          current = publication.audioTrack;
          break;
        }
      }
      setTrack(current);
      if (!current) setPlaybackActive(false);
    }

    room.on(RoomEvent.TrackSubscribed, update);
    room.on(RoomEvent.TrackUnsubscribed, update);
    room.on(RoomEvent.TrackPublished, update);
    room.on(RoomEvent.TrackUnpublished, update);
    room.on(RoomEvent.TrackMuted, update);
    room.on(RoomEvent.TrackUnmuted, update);
    room.on(RoomEvent.ParticipantDisconnected, update);
    update();
    return () => {
      room.off(RoomEvent.TrackSubscribed, update);
      room.off(RoomEvent.TrackUnsubscribed, update);
      room.off(RoomEvent.TrackPublished, update);
      room.off(RoomEvent.TrackUnpublished, update);
      room.off(RoomEvent.TrackMuted, update);
      room.off(RoomEvent.TrackUnmuted, update);
      room.off(RoomEvent.ParticipantDisconnected, update);
    };
  }, [room]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element || !track) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  async function enablePlayback() {
    try {
      await room.startAudio();
      await audioRef.current?.play();
      setError(null);
      setPlaybackActive(true);
    } catch {
      setError("O navegador bloqueou o som. Clique novamente para habilitar a reprodução.");
    }
  }

  return (
    <div className="remote-audio" aria-live="polite">
      <audio ref={audioRef} autoPlay />
      {track && (
        <>
          <span>Áudio da tela recebido.</span>
          <button className="btn btn-secondary" type="button" onClick={() => void enablePlayback()}>
            {playbackActive ? "Som ativado · repetir" : "Ativar som"}
          </button>
          {error && <span role="alert">{error}</span>}
        </>
      )}
    </div>
  );
}
