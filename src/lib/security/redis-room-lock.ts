import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const LOCK_SECONDS = 30;

function lockKey(roomId: string): string {
  return `discord2:room:mutex:v1:${roomId}`;
}

// Adquire uma trava temporária para operações na sala.
// Retorna null caso outra operação já possua a trava.
export async function acquireRedisRoomLock(
  roomId: string
): Promise<string | null> {
  const owner = randomUUID();

  const result = await redis.set(lockKey(roomId), owner, {
    nx: true,
    ex: LOCK_SECONDS,
  });

  return result === "OK" ? owner : null;
}

// Somente o dono da trava pode liberá-la.
export async function releaseRedisRoomLock(
  roomId: string,
  owner: string
): Promise<boolean> {
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;

  const result = await redis.eval(script, [lockKey(roomId)], [owner]);
  return result === 1;
}
