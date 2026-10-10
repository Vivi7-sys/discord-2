import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const INVITE_PATTERN = /^[a-f0-9]{64}$/;

function signature(nonce: string, secret: string): string {
  return createHmac("sha256", secret)
    .update("discord2:room-invite:v1:")
    .update(nonce)
    .digest("hex")
    .slice(0, 32);
}

export function createRoomInvite(secret: string): string {
  const nonce = randomBytes(16).toString("hex");
  return nonce + signature(nonce, secret);
}

export function verifyRoomInvite(roomId: string, secret: string): boolean {
  if (!INVITE_PATTERN.test(roomId)) return false;

  const nonce = roomId.slice(0, 32);
  const provided = Buffer.from(roomId.slice(32), "hex");
  const expected = Buffer.from(signature(nonce, secret), "hex");

  return timingSafeEqual(provided, expected);
}
