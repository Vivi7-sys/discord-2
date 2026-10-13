import { randomUUID } from "node:crypto";
import { createSecurityRedis } from "./redis-client";

let redis: ReturnType<typeof createSecurityRedis> | undefined;
function getRedis() {
  return redis ??= createSecurityRedis();
}
const LOCK_SECONDS = 120;

function lockKey(roomId: string): string {
  return `discord2:room:mutex:v1:${roomId}`;
}

// Adquire uma trava temporária para operações na sala.
// Retorna null caso outra operação já possua a trava.
export async function acquireRedisRoomLock(
  roomId: string
): Promise<string | null> {
  const owner = randomUUID();

  const result = await getRedis().set(lockKey(roomId), owner, {
    nx: true,
    ex: LOCK_SECONDS,
  });

  return result === "OK" ? owner : null;
}

/** Exige margem para a chamada LiveKit (8 s), mesmo após uma pausa do processo. */
export async function hasRedisRoomLock(roomId: string, owner: string, identity: string): Promise<boolean> {
  const result = await getRedis().eval(`
    if redis.call("GET", KEYS[1]) == ARGV[1] and redis.call("TTL", KEYS[1]) >= 20
      and redis.call("GET", KEYS[2]) == ARGV[2] and redis.call("TTL", KEYS[2]) >= 20 then
      return 1
    end
    return 0
  `, [lockKey(roomId), `discord2:room:publisher:v1:${roomId}`], [owner, identity]);
  return result === 1;
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

  const result = await getRedis().eval(script, [lockKey(roomId)], [owner]);
  return result === 1;
}
