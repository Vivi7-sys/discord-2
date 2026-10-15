import { ServerError, TrackSource } from "livekit-server-sdk";

type Person = { identity: string; permission?: { canPublish?: boolean }; tracks?: { source: TrackSource }[] };
type Dependencies = {
  hasPending: () => Promise<boolean>;
  markPending: () => Promise<boolean>;
  ownsLock: () => Promise<boolean>;
  grant: () => Promise<unknown>;
  list: () => Promise<Person[]>;
  clearPending: () => Promise<unknown>;
  release: () => Promise<unknown>;
};

/** Uma leitura viewer após timeout não prova que o grant deixou de executar. */
export async function grantReservedShare(identity: string, deps: Dependencies): Promise<"granted" | "denied" | "uncertain"> {
  let previouslyPending: boolean;
  try {
    previouslyPending = await deps.hasPending();
    if (!await deps.ownsLock() || !await deps.markPending() || !await deps.ownsLock()) return "uncertain";
  } catch { return "uncertain"; }
  try {
    await deps.grant();
  } catch (cause) {
    try {
      const person = (await deps.list()).find((entry) => entry.identity === identity);
      if (person?.permission?.canPublish === true) {
        // Resposta perdida, mas o efeito foi confirmado no LiveKit.
        await deps.clearPending();
        return "granted";
      }
      const rejected = cause instanceof ServerError && cause.status >= 400 && cause.status < 500 &&
        ["invalid_argument", "permission_denied", "unauthenticated", "not_found", "unimplemented"].includes(cause.code ?? "");
      const inactive = !person || (person.permission?.canPublish === false &&
        !person.tracks?.some((track) => track.source === TrackSource.SCREEN_SHARE || track.source === TrackSource.SCREEN_SHARE_AUDIO));
      if (!previouslyPending && rejected && inactive && await deps.ownsLock()) {
        await deps.release(); // Comparação de dono é atômica no Redis.
        return "denied";
      }
    } catch { /* Sem confirmação ou sem Redis: preservar a reserva. */ }
    return "uncertain";
  }
  // Falha de limpeza do marcador não invalida um grant confirmado por ACK.
  try { await deps.clearPending(); } catch { /* A próxima liberação limpa ambos. */ }
  return "granted";
}
