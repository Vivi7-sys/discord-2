"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LocalVideoTrack, RemoteVideoTrack } from "livekit-client";
import RoomIcon from "./RoomIcon";

export type SharedScreen = {
  track: LocalVideoTrack | RemoteVideoTrack;
  ownerId: string;
  ownerLabel: string;
};

type StreamAreaProps = {
  screen: SharedScreen | null;
  theaterMode: boolean;
  onToggleTheater: () => void;
  controls: ReactNode;
  volumeControl: ReactNode;
};

// Usa a trilha recebida do LiveKit; não abre outra captura de tela.
export default function StreamArea({ screen, theaterMode, onToggleTheater, controls, volumeControl }: StreamAreaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsFocusedRef = useRef(false);

  function clearHideTimer() {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  function revealControls() {
    clearHideTimer();
    setControlsVisible(true);

    hideTimerRef.current = setTimeout(() => {
      if (!controlsFocusedRef.current) {
        setControlsVisible(false);
      }
      hideTimerRef.current = null;
    }, 3000);
  }

  useEffect(() => {
    if (!screen) return;

    const timer = setTimeout(() => {
      if (!controlsFocusedRef.current) {
        setControlsVisible(false);
      }
    }, 3000);

    return () => {
      clearTimeout(timer);
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [screen]);


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

  // A barra fica DENTRO da área do vídeo, inclusive antes de alguém transmitir.
  // Ações de captura continuam vinculadas ao clique direto do usuário.
  const playerBar = (
    <div
      className="stream-player-bar"
      onFocusCapture={() => {
        controlsFocusedRef.current = true;
        clearHideTimer();
        setControlsVisible(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          controlsFocusedRef.current = false;
          revealControls();
        }
      }}
    >
      {controls}
      {screen && volumeControl}
      {screen && (
        <div className="stream-view-controls" role="group" aria-label="Visualização da transmissão">
          <button type="button" className="stream-view-button"
            aria-pressed={theaterMode} onClick={onToggleTheater}
            aria-label={theaterMode ? "Sair do modo teatro" : "Modo teatro"}
            title={theaterMode ? "Sair do modo teatro" : "Modo teatro"}>
            <RoomIcon name="theater" size={19} />
          </button>
          <button type="button" className="stream-view-button"
            onClick={() => void toggleFullscreen()}
            aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}>
            <RoomIcon name={isFullscreen ? "minimize" : "maximize"} size={19} />
          </button>
        </div>
      )}
    </div>
  );

  if (screen) {
    return (
      <section
        ref={sectionRef}
        className={`stream stream-active${controlsVisible ? "" : " stream-controls-hidden"}`}
        aria-label="Transmissão de tela"
        onPointerMove={(event) => {
          if (event.pointerType === "mouse") revealControls();
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "touch" &&
              (event.target === event.currentTarget ||
               event.target === videoRef.current)) {
            revealControls();
          }
        }}
      >
        <video ref={videoRef} className="stream-video" autoPlay playsInline muted />
        <div className="stream-overlay">
          <span className="stream-live-dot" aria-hidden="true" />
          <strong>AO VIVO</strong>
          <span className="stream-overlay-owner">Tela de {screen.ownerLabel}</span>
        </div>
        {playerBar}
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
      {playerBar}
    </section>
  );
}
