/** Perfil temporário exibido apenas aos participantes da sala. */
export type RoomProfile = {
  displayName: string;
  avatar: string | null;
};

export const MAX_AVATAR_DATA_URL_LENGTH = 16_000;

/** Nunca usar nome digitado como identidade única no LiveKit. */
export function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== "string" || Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
  )) return null;
  const name = value.trim().replace(/ +/g, " ");
  return name.length >= 2 && name.length <= 24 ? name : null;
}

/** Aceita apenas JPEG reduzido; não aceita links nem SVG enviados pelo usuário. */
export function safeAvatarDataUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_AVATAR_DATA_URL_LENGTH) return null;
  return /^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
    ? value
    : null;
}

export function avatarFromMetadata(metadata: string | undefined): string | null {
  if (!metadata) return null;
  try {
    const decoded: unknown = JSON.parse(metadata);
    if (!decoded || typeof decoded !== "object" || !("avatar" in decoded)) return null;
    return safeAvatarDataUrl(decoded.avatar);
  } catch {
    return null;
  }
}
