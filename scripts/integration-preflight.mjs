import { createRequire } from "node:module";
import { randomBytes, randomUUID, createHmac } from "node:crypto";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const { Redis } = require("@upstash/redis");
const { RoomServiceClient } = require("livekit-server-sdk");
const required = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "ROOM_INVITE_SECRET"];
if (required.some((key) => !process.env[key])) {
  console.log(JSON.stringify({ configured: false }));
  process.exit(1);
}
const result = { configured: true, redis: false, livekit: false, cleanup: null };
try {
  const redis = Redis.fromEnv({ signal: () => AbortSignal.timeout(8000), retry: { retries: 0 } });
  result.redis = await redis.ping() === "PONG";
} catch { result.redis = false; }
const nonce = randomBytes(16).toString("hex");
const name = nonce + createHmac("sha256", process.env.ROOM_INVITE_SECRET).update("discord2:room-invite:v1:").update(nonce).digest("hex").slice(0, 32);
const metadata = `discord2-integration:${randomUUID()}`;
const endpoint = new URL(process.env.LIVEKIT_URL);
endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : endpoint.protocol === "ws:" ? "http:" : endpoint.protocol;
const service = new RoomServiceClient(endpoint.origin, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { requestTimeout: 8, failover: false });
let created = false;
try {
  const room = await service.createRoom({ name, maxParticipants: 6, emptyTimeout: 60, metadata });
  created = room.name === name && room.metadata === metadata;
  result.livekit = created && room.maxParticipants === 6;
} catch { result.livekit = false; }
finally {
  if (created) {
    try { await service.deleteRoom(name); result.cleanup = true; }
    catch { result.cleanup = false; }
  }
}
console.log(JSON.stringify(result));
process.exitCode = result.redis && result.livekit && result.cleanup !== false ? 0 : 1;
