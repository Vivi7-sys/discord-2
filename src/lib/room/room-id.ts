/** Regras de IDs usadas pelo navegador e pela página da sala. */
const ROOM_ID_PATTERN = /^[a-z0-9-]{3,64}$/;

export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_PATTERN.test(roomId);
}

/** Gera um identificador difícil de adivinhar, sem cadastro ou banco. */
export function generateRoomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** Aceita um ID ou um link de sala deste mesmo site. Nunca abre URLs externas. */
export function readRoomId(input: string, currentOrigin: string): string | null {
  const value = input.trim();
  if (isValidRoomId(value)) return value;

  try {
    const url = new URL(value);
    if (url.origin !== currentOrigin) return null;

    const match = url.pathname.match(/^\/sala\/([^/]+)\/?$/);
    if (!match) return null;

    const roomId = decodeURIComponent(match[1]);
    return isValidRoomId(roomId) ? roomId : null;
  } catch {
    return null;
  }
}
