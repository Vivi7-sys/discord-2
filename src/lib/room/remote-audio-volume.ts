import type { RemoteAudioTrack } from "livekit-client";

/** Mantém mute nativo para navegadores que ignoram HTMLMediaElement.volume. */
export function applyRemoteAudioVolume(
  track: Pick<RemoteAudioTrack, "setVolume"> | null,
  element: Pick<HTMLAudioElement, "muted">,
  volume: number,
  muted: boolean,
  webAudioMix: boolean,
) {
  track?.setVolume(muted ? 0 : Math.max(0, Math.min(1, volume / 100)));
  // Com mix Web Audio, o SDK mantém a saída HTML muda para evitar reprodução dupla.
  element.muted = muted || volume <= 0 || webAudioMix;
}
