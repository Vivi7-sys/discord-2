import type { LocalTrack } from "livekit-client";

/** Para toda captura imediatamente, antes de qualquer espera de rede/SDK. */
export async function cleanupScreenTracks(
  tracks: LocalTrack[], unpublish: (track: LocalTrack) => Promise<unknown>
) {
  tracks.forEach((track) => track.stop());
  return Promise.allSettled(tracks.map((track) => Promise.resolve().then(() => unpublish(track))));
}

/** Faz rollback da captura inteira se a conexão terminar ou uma publicação falhar. */
export async function publishScreenTracks({ tracks, isActive, publish, unpublish }: {
  tracks: LocalTrack[];
  isActive: () => boolean;
  publish: (track: LocalTrack) => Promise<unknown>;
  unpublish: (track: LocalTrack) => Promise<unknown>;
}): Promise<boolean> {
  const cleanup = () => cleanupScreenTracks(tracks, unpublish);
  if (!isActive()) {
    tracks.forEach((track) => track.stop());
    return false;
  }
  try {
    for (const track of tracks) {
      if (!isActive()) {
        await cleanup();
        return false;
      }
      await publish(track);
    }
    if (!isActive()) {
      await cleanup();
      return false;
    }
    return true;
  } catch (cause) {
    await cleanup();
    throw cause;
  }
}
