import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const scope = globalThis as typeof globalThis & {
  discord2ShareGlobalLimiter?: Ratelimit;
  discord2ShareAcquireLimiter?: Ratelimit;
};

export function getShareGlobalLimiter(): Ratelimit {
  return (scope.discord2ShareGlobalLimiter ??= new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.fixedWindow(120, "1 m"),
    prefix: "discord2:rate:share:global:v1",
    analytics: false,
  }));
}

export function getShareAcquireLimiter(): Ratelimit {
  return (scope.discord2ShareAcquireLimiter ??= new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.fixedWindow(12, "1 m"),
    prefix: "discord2:rate:share:acquire:v1",
    analytics: false,
  }));
}
