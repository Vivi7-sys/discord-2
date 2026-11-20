"use client";
import { useEffect, useState } from "react";

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

// Começa false no servidor e no primeiro render, para não dar erro de hidratação
export function useIsDesktop() {
  const [is, setIs] = useState(false);
  useEffect(() => setIs(getDesktop() !== null), []);
  return is;
}

export function useDesktopAudioApps(active: boolean) {
  const [apps, setApps] = useState<AudioApp[]>([]);
  useEffect(() => {
    const d = getDesktop();
    if (!active || !d) return;
    let alive = true;
    const refresh = () => d.audio.listApps().then((a) => alive && setApps(a)).catch(() => {});
    refresh();
    const stop = d.audio.onAppsChanged(refresh);
    return () => { alive = false; stop(); };
  }, [active]);
  return apps;
}