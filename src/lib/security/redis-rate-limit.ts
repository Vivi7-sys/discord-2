import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// Compartilhado pelo Redis, mesmo após reiniciar o servidor.
// O limite é aplicado separadamente a cada identificador recebido.
const scope = globalThis as typeof globalThis & {
  discord2CreateLimiter?: Ratelimit;
};

export function getCreateLimiter(): Ratelimit {
  if (!scope.discord2CreateLimiter) {
    scope.discord2CreateLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.fixedWindow(10, "1 m"),
      prefix: "discord2:rate:create:v1",
      analytics: false,
    });
  }

  return scope.discord2CreateLimiter;
}
