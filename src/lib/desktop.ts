"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

export type AudioApp = { key: string; name: string };
export type AudioSelection =
  | { mode: "none" }
  | { mode: "system"; excluded: string[] }
  | { mode: "app"; selected: string };

type DesktopBridge = {
  isDesktop: true;
  audio: {
    listApps: () => Promise<AudioApp[]>;
    setSelection: (sel: AudioSelection) => Promise<boolean>;
    clearSelection: () => Promise<void>;
    onAppsChanged: (cb: () => void) => () => void;
  };
};

export function getDesktop(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { discord2Desktop?: DesktopBridge }).discord2Desktop ?? null;
}

const noopSubscribe = () => () => {};

// false no servidor e na hidratação; o valor real no navegador, sem efeito nem setState
export function useIsDesktop() {
  return useSyncExternalStore(noopSubscribe, () => getDesktop() !== null, () => false);
}

export function useDesktopAudioApps(active: boolean) {
  const [state, setState] = useState<{ playing: AudioApp[]; known: Record<string, string> }>({
    playing: [],
    known: {},
  });
  useEffect(() => {
    const d = getDesktop();
    if (!active || !d) return;
    let alive = true;
    const refresh = () =>
      d.audio
        .listApps()
        .then((found) => {
          if (!alive) return;
          setState((prev) => {
            // guarda todo app já visto, para poder remarcá-lo se ele parar de tocar
            const known = { ...prev.known };
            for (const app of found) known[app.key] = app.name;
            return { playing: found, known };
          });
        })
        .catch(() => {});
    refresh();
    const stop = d.audio.onAppsChanged(refresh);
    return () => { alive = false; stop(); };
  }, [active]);
  return state;
}