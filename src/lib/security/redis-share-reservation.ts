import { createSecurityRedis } from "./redis-client";

let redis: ReturnType<typeof createSecurityRedis> | undefined;
function getRedis() {
  return redis ??= createSecurityRedis();
}

// Prazo de segurança para reservas abandonadas.
// A presença e as permissões no LiveKit também precisam ser verificadas.
const RESERVATION_SECONDS = 6 * 60 * 60;

function reservationKey(roomId: string): string {
  return `discord2:room:publisher:v1:${roomId}`;
}

export async function getShareReservation(
  roomId: string
): Promise<string | null> {
  return getRedis().get<string>(reservationKey(roomId));
}

export async function reserveShare(
  roomId: string,
  identity: string
): Promise<boolean> {
  const result = await getRedis().set(
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
      redis.call("DEL", KEYS[2])
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;

  const result = await getRedis().eval(
    script,
    [reservationKey(roomId), `${reservationKey(roomId)}:pending`],
    [identity]
  );

  return result === 1;
}

// Verifica a idade aproximada da reserva sem alterar seu prazo.
// Exige também que a identidade ainda seja a mesma.
export async function isShareReservationOld(
  roomId: string,
  identity: string,
  minimumAgeSeconds: number
): Promise<boolean> {
  const script = `
    if redis.call("GET", KEYS[1]) ~= ARGV[1] then
      return 0
    end
    local remaining = redis.call("TTL", KEYS[1])
    if remaining >= 0 and remaining <= tonumber(ARGV[2]) then
      return 1
    end
    return 0
  `;

  const maximumRemaining = Math.max(
    0,
    RESERVATION_SECONDS - minimumAgeSeconds
  );

  const result = await getRedis().eval(
    script,
    [reservationKey(roomId)],
    [identity, String(maximumRemaining)]
  );

  return result === 1;
}


// Marcador durável escrito ANTES do RPC. Impede reconciliação por idade
// de liberar uma reserva cujo grant ainda pode estar em voo.
export async function markShareGrantPending(roomId: string, identity: string): Promise<boolean> {
  return await getRedis().eval(`
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2])
      return 1
    end
    return 0
  `, [reservationKey(roomId), `${reservationKey(roomId)}:pending`], [identity, String(RESERVATION_SECONDS)]) === 1;
}

export async function hasPendingShareGrant(roomId: string, identity: string): Promise<boolean> {
  return await getRedis().get(`${reservationKey(roomId)}:pending`) === identity;
}

export async function clearPendingShareGrant(roomId: string, identity: string): Promise<boolean> {
  return await getRedis().eval(`
    if redis.call("GET", KEYS[1]) == ARGV[1] and redis.call("GET", KEYS[2]) == ARGV[1] then
      return redis.call("DEL", KEYS[2])
    end
    return 0
  `, [reservationKey(roomId), `${reservationKey(roomId)}:pending`], [identity]) === 1;
}
