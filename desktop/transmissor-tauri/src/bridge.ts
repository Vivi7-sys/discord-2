import { invoke, isTauri } from "@tauri-apps/api/core";
export type Target = {
  id: string;
  label: string;
  kind: "monitor" | "window";
  pid: number | null;
};
export type Config = {
  invite: string;
  name: string;
  profile: string;
  target: string;
  audio: string;
  audioPid: number | null;
};
export type Snapshot = {
  phase: string;
  message: string;
  captured: number;
  submitted: number;
  dropped: number;
  capturedFps: number;
  encodedFps: number | null;
  publishedFps: number | null;
  processingMs: number;
  encoder: string | null;
  releaseConfirmed: boolean | null;
};
export const initial: Snapshot = {
  phase: "idle",
  message: "Pronto para conectar",
  captured: 0,
  submitted: 0,
  dropped: 0,
  capturedFps: 0,
  encodedFps: null,
  publishedFps: null,
  processingMs: 0,
  encoder: null,
  releaseConfirmed: null,
};
export const native = isTauri();
export const bridge = {
  targets: () =>
    native ? invoke<Target[]>("list_targets") : Promise.resolve([]),
  snapshot: () =>
    native
      ? invoke<Snapshot>("snapshot")
      : Promise.resolve({
          ...initial,
          message: "Prévia no navegador · captura disponível no Windows",
        }),
  start: (config: Config) => invoke<void>("start", { config }),
  stop: () => invoke<void>("stop"),
};
