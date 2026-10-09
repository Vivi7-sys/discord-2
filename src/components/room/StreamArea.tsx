"use client";

import { useEffect, useRef, useState } from "react";
import type { LocalVideoTrack, RemoteVideoTrack } from "livekit-client";

export type SharedScreen = {
  track: LocalVideoTrack | RemoteVideoTrack;
  ownerId: string;
  ownerLabel: string;
};

type StreamAreaProps = {
  screen: SharedScreen | null;
  theaterMode: boolean;
  onToggleTheater: () => void;
};

// Usa a trilha recebida do LiveKit; não abre outra captura de tela.
export default function StreamArea({ screen, theaterMode, onToggleTheater }: StreamAreaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  // A tecla Esc sai da tela cheia pelo próprio navegador.
  useEffect(() => {
    const updateFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === sectionRef.current);
      setFullscreenError(null);
    };
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  async function toggleFullscreen() {
    const element = sectionRef.current;
    if (!element) return;
    setFullscreenError(null);
    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen();
      } else if (typeof element.requestFullscreen === "function") {
        await element.requestFullscreen();
      } else {
        setFullscreenError("Tela cheia não disponível neste navegador.");
      }
    } catch {
      setFullscreenError("O navegador não permitiu tela cheia.");
    }
  }
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
      <section ref={sectionRef} className="stream stream-active" aria-label="Transmissão de tela">
        <video ref={videoRef} className="stream-video" autoPlay playsInline muted />
        <span className="stream-overlay">Tela de {screen.ownerLabel}</span>
        <div className="stream-view-controls" role="group" aria-label="Visualização da transmissão">
          <button type="button" className="stream-view-button"
            aria-pressed={theaterMode} onClick={onToggleTheater}>
            {theaterMode ? "Sair do teatro" : "Modo teatro"}
          </button>
          <button type="button" className="stream-view-button"
            onClick={() => void toggleFullscreen()}>
            {isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          </button>
        </div>
        {fullscreenError && <p className="stream-view-error" role="alert">{fullscreenError}</p>}
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
