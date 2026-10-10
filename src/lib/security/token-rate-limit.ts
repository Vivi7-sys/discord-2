import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const scope = globalThis as typeof globalThis & {
  discord2TokenGlobalLimiter?: Ratelimit;
  discord2TokenRoomLimiter?: Ratelimit;
};

export function getTokenGlobalLimiter(): Ratelimit {
  return (scope.discord2TokenGlobalLimiter ??= new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.fixedWindow(60, "1 m"),
    prefix: "discord2:rate:token:global:v1",
    analytics: false,
  }));
}

export function getTokenRoomLimiter(): Ratelimit {
  return (scope.discord2TokenRoomLimiter ??= new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.fixedWindow(20, "1 m"),
    prefix: "discord2:rate:token:room:v1",
    analytics: false,
  }));
}
