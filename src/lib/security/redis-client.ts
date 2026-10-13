import { Redis } from "@upstash/redis";

/** Inicializa dentro da operação, para falhas serem tratadas pela rota. */
export function createSecurityRedis(): Redis {
  return Redis.fromEnv({
    signal: () => AbortSignal.timeout(5_000),
    retry: { retries: 0 },
  });
}
