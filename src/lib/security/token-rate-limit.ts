import { rateLimitPrefix } from "./rate-limit-prefix";
import { createSecurityRedis } from "./redis-client";
import { Ratelimit } from "@upstash/ratelimit";

const scope = globalThis as typeof globalThis & {
  discord2TokenGlobalLimiter?: Ratelimit;
  discord2TokenRoomLimiter?: Ratelimit;
};

export function getTokenGlobalLimiter(): Ratelimit {
  return (scope.discord2TokenGlobalLimiter ??= new Ratelimit({
    redis: createSecurityRedis(),
    limiter: Ratelimit.fixedWindow(60, "1 m"),
    prefix: rateLimitPrefix("token:global:v1"),
    analytics: false,
  }));
}

export function getTokenRoomLimiter(): Ratelimit {
  return (scope.discord2TokenRoomLimiter ??= new Ratelimit({
    redis: createSecurityRedis(),
    limiter: Ratelimit.fixedWindow(20, "1 m"),
    prefix: rateLimitPrefix("token:room:v1"),
    analytics: false,
  }));
}
