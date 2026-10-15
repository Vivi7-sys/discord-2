import { createHash } from "node:crypto";
import { createSecurityRedis } from "./redis-client";
import { rateLimitPrefix } from "./rate-limit-prefix";

let redis: ReturnType<typeof createSecurityRedis> | undefined;

/** Orçamento de verificação separado da emissão, sem confiar em IP do cliente. */
export async function limitTurnstileVerification(token: string) {
  const fingerprint = createHash("sha256").update(token).digest("hex");
  const result = await (redis ??= createSecurityRedis()).eval(`
    -- discord2 verification: decisão e criação das chaves são atômicas
    if redis.call("EXISTS", KEYS[2]) == 1 then
      return {0, math.max(1, redis.call("TTL", KEYS[2]))}
    end
    local used = tonumber(redis.call("GET", KEYS[1]) or "0")
    if used >= tonumber(ARGV[1]) then
      return {0, math.max(1, redis.call("TTL", KEYS[1]))}
    end
    local count = redis.call("INCR", KEYS[1])
    if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[2]) end
    redis.call("SET", KEYS[2], "1", "EX", ARGV[3])
    return {1, 0}
  `, [rateLimitPrefix("verify:capacity:v1"), `${rateLimitPrefix("verify:token:v1")}:${fingerprint}`], [600, 60, 300]);
  // O cliente Redis tem timeout e não repete falhas; erros propagam como 503.
  // Falhar fechado também se a resposta for inesperada.
  if (!Array.isArray(result) || result.length !== 2 ||
      ![0, 1].includes(result[0]) || !Number.isFinite(result[1])) throw new Error("Invalid verification budget response");
  return { success: result[0] === 1, reset: Date.now() + Math.max(1, result[1]) * 1000 };
}
