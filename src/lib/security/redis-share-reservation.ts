import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// Prazo de segurança para reservas abandonadas.
// A presença e as permissões no LiveKit também precisam ser verificadas.
const RESERVATION_SECONDS = 6 * 60 * 60;

function reservationKey(roomId: string): string {
  return `discord2:room:publisher:v1:${roomId}`;
}

export async function getShareReservation(
  roomId: string
): Promise<string | null> {
  return redis.get<string>(reservationKey(roomId));
}

export async function reserveShare(
  roomId: string,
  identity: string
): Promise<boolean> {
  const result = await redis.set(
    reservationKey(roomId),
    identity,
    { nx: true, ex: RESERVATION_SECONDS }
  );

  return result === "OK";
}

// Só remove a reserva se ela ainda pertence ao participante.
export async function releaseShareReservation(
  roomId: string,
  identity: string
): Promise<boolean> {
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;

  const result = await redis.eval(
    script,
    [reservationKey(roomId)],
    [identity]
  );

  return result === 1;
}
