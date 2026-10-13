import type { Ratelimit } from "@upstash/ratelimit";

/** O SDK retorna success=true no timeout: não conceder acesso nesse caso. */
export async function strictRateLimit(limiter: Pick<Ratelimit, "limit">, key: string) {
  const result = await limiter.limit(key);
  if (result.reason === "timeout") throw new Error("Rate limiter unavailable");
  return result;
}
