import type { AudioCaptureOptions } from "livekit-client";

export const DEFAULT_QUALITY_PROFILE = "alta";

// Metas de captura e tetos de codificação, não garantias do navegador/hardware.
export const QUALITY_PRESETS = {
  economico: { width: 854, height: 480, fps: 20, bitrate: 900_000 },
  equilibrado: { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  // Mesmo teto do ScreenSharePresets.h1080fps30 do LiveKit.
  alta: { width: 1920, height: 1080, fps: 30, bitrate: 5_000_000 },
  // Perfil customizado: mais margem para movimento a 60 FPS; teto, não alvo fixo.
  maxima: { width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
};

type OwnAudioSupport = MediaTrackSupportedConstraints & { restrictOwnAudio?: boolean };
export function browserAudioOptions(support: OwnAudioSupport): AudioCaptureOptions & {
  restrictOwnAudio?: boolean; suppressLocalAudioPlayback: boolean;
} {
  // O SDK passa este objeto ao getDisplayMedia sem transformá-lo.
  // Nunca suprimir a reprodução local para tentar resolver eco.
  return {
    suppressLocalAudioPlayback: false,
    ...(support.restrictOwnAudio ? { restrictOwnAudio: true } : {}),
  };
}

export function findVirtualAudioDevice(devices: Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[]) {
  return devices.find((device) => device.kind === "audioinput" &&
    device.deviceId !== "default" && device.deviceId !== "communications" &&
    /^screen[ -]share[ -]audio$/i.test(device.label.trim()));
}
