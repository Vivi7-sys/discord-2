"use client";

import { useEffect, useRef } from "react";
import type { LocalVideoTrack, RemoteVideoTrack } from "livekit-client";

export type SharedScreen = {
  track: LocalVideoTrack | RemoteVideoTrack;
  ownerId: string;
  ownerLabel: string;
};

type StreamAreaProps = {
  screen: SharedScreen | null;
};

// Usa a trilha recebida do LiveKit; não abre outra captura de tela.
export default function StreamArea({ screen }: StreamAreaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const track = screen?.track;

  useEffect(() => {
    const element = videoRef.current;
    if (!track || !element) return;

    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  if (screen) {
    return (
      <section className="stream stream-active" aria-label="Transmissão de tela">
        <video ref={videoRef} className="stream-video" autoPlay playsInline muted />
        <span className="stream-overlay">Tela de {screen.ownerLabel} · sem áudio</span>
      </section>
    );
  }

  return (
    <section className="stream" aria-label="Área da transmissão">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
        <path d="M8.5 20.5h7M12 16.5v4" />
      </svg>
      <p className="stream-title">Nenhuma transmissão ainda</p>
      <p className="stream-hint">
        Quando alguém compartilhar a tela, o vídeo aparecerá aqui.
      </p>
    </section>
  );
}
