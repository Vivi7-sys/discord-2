import { NextRequest, NextResponse } from "next/server";
import { RoomServiceClient, TokenVerifier, TrackSource } from "livekit-server-sdk";

// Exclusividade apenas por processo: suficiente para a instância única de
// desenvolvimento, NÃO para múltiplos servidores ou deployment em produção.

const scope = globalThis as typeof globalThis & {
  discord2RoomQueues?: Map<string, Promise<void>>;
  discord2Reservations?: Map<string, string>;
};
const roomQueues = scope.discord2RoomQueues ??= new Map<string, Promise<void>>();
const reservations = scope.discord2Reservations ??= new Map<string, string>();

// Fase 9B: limitação inicial da API de transmissão (apenas um processo).
// Não é uma proteção distribuída: em produção, combinar com limites na borda
// e, caso haja mais de uma instância, estado/controle compartilhado.
const SHARE_WINDOW_MS = 60_000;
const SHARE_GLOBAL_LIMIT = 120; // todas as tentativas, inclusive inválidas
const SHARE_ACQUIRE_LIMIT = 12; // solicitações de transmissão por participante

type ShareRateWindow = { count: number; resetAt: number };
type ShareRateState = {
  global: ShareRateWindow;
  acquires: Map<string, ShareRateWindow>;
};
const shareRateScope = globalThis as typeof globalThis & {
  discord2ShareRateState?: ShareRateState;
};
const shareRate = shareRateScope.discord2ShareRateState ??= {
  global: { count: 0, resetAt: 0 },
  acquires: new Map<string, ShareRateWindow>(),
};

function consumeShareWindow(bucket: ShareRateWindow, limit: number, now: number): number | null {
  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + SHARE_WINDOW_MS;
  }
  if (bucket.count >= limit) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }
  bucket.count += 1;
  return null;
}

function globalShareRetry(): number | null {
  const now = Date.now();
  if (now >= shareRate.global.resetAt) {
    for (const [identity, bucket] of shareRate.acquires) {
      if (now >= bucket.resetAt) shareRate.acquires.delete(identity);
    }
  }
  return consumeShareWindow(shareRate.global, SHARE_GLOBAL_LIMIT, now);
}

function acquireShareRetry(identity: string): number | null {
  let bucket = shareRate.acquires.get(identity);
  if (!bucket) {
    bucket = { count: 0, resetAt: 0 };
    shareRate.acquires.set(identity, bucket);
  }
  return consumeShareWindow(bucket, SHARE_ACQUIRE_LIMIT, Date.now());
}

function shareTooManyRequests(seconds: number) {
  return NextResponse.json(
    { error: "Muitas solicitações de transmissão. Aguarde um pouco e tente novamente." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(seconds) } }
  );
}

async function withRoomLock<T>(roomId: string, work: () => Promise<T>): Promise<T> {
  const previous = roomQueues.get(roomId) ?? Promise.resolve();
  let unlock = () => {};
  const completed = new Promise<void>((resolve) => { unlock = resolve; });
  const current = previous.catch(() => {}).then(() => completed);
  roomQueues.set(roomId, current);
  await previous.catch(() => {});
  try {
    return await work();
  } finally {
    unlock();
    if (roomQueues.get(roomId) === current) roomQueues.delete(roomId);
  }
}

const screenPermission = {
  canPublish: true,
  canSubscribe: true,
  canPublishData: false,
  canPublishSources: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
};
const viewerPermission = {
  canPublish: false,
  canSubscribe: true,
  canPublishData: false,
  canPublishSources: [],
};

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Disponível somente em desenvolvimento." }, { status: 403 });
  }

  const globalRetry = globalShareRetry();

  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "LiveKit não configurado." }, { status: 500 });
  }

  let roomId: string;
  let action: "acquire" | "release";
  try {
    const body = await request.json();
    roomId = body?.roomId;
    action = body?.action;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  // Mesmo com o limite global atingido, permitir a tentativa de
  // encerrar transmissão. A autorização continua obrigatória.
  if (globalRetry !== null && action !== "release") {
    return shareTooManyRequests(globalRetry);
  }

  if (typeof roomId !== "string" || !/^[a-zA-Z0-9_-]{6,64}$/.test(roomId) ||
      (action !== "acquire" && action !== "release")) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Autorização necessária." }, { status: 401 });
  }


  

let identity: string;
try {
  const verifier = new TokenVerifier(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  const claims = await verifier.verify(authorization.slice(7));

  if (
    typeof claims.sub !== "string" ||
    !claims.sub ||
    !claims.video?.roomJoin ||
    claims.video.room !== roomId
  ) {
    throw new Error("Token não pertence a esta sala.");
  }

  identity = claims.sub;
} catch {
  return NextResponse.json(
    { error: "Autorização inválida ou expirada. Entre na sala novamente." },
    { status: 401 }
  );
}


  // Limitar pedidos de adquirir transmissão, sem impedir o participante
  // de liberar a vaga quando já alcançou o limite.
  if (action === "acquire") {
    const acquireRetry = acquireShareRetry(identity);
    if (acquireRetry !== null) return shareTooManyRequests(acquireRetry);
  }


  try {
    const endpoint = new URL(LIVEKIT_URL);
    if (endpoint.protocol === "wss:") endpoint.protocol = "https:";
    else if (endpoint.protocol === "ws:") endpoint.protocol = "http:";
    else if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new Error("Protocolo LiveKit inválido.");
    }
    const service = new RoomServiceClient(endpoint.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    return await withRoomLock(roomId, async () => {
      // LiveKit é a fonte de verdade: a permissão existe somente enquanto o
      // participante estiver na sala. Sair da sala libera a vaga naturalmente.
      const people = await service.listParticipants(roomId);
      const person = people.find((participant) => participant.identity === identity);
      if (!person) {
        return NextResponse.json({ error: "Você não está conectado à sala." }, { status: 409 });
      }

      // Reserva em memória cobre o intervalo entre a atualização de permissão
      // no LiveKit e sua propagação para listParticipants. Reconcilia ausências
      // para liberar a vaga quando um navegador sai abruptamente da sala.
      const holder = reservations.get(roomId);
      if (holder && !people.some((participant) => participant.identity === holder)) {
        reservations.delete(roomId);
      }

      if (action === "acquire") {
        if ((reservations.has(roomId) && reservations.get(roomId) !== identity) ||
            people.some((participant) => participant.identity !== identity && participant.permission?.canPublish)) {
          return NextResponse.json({ error: "Outra pessoa já reservou ou está transmitindo. Aguarde." }, { status: 409 });
        }
        if (!person.permission?.canPublish) {
          await service.updateParticipant(roomId, identity, { permission: screenPermission });
        }
        reservations.set(roomId, identity);
      } else {
        // Revoke mesmo se listParticipants ainda não refletiu a concessão.
        await service.updateParticipant(roomId, identity, { permission: viewerPermission });
        if (reservations.get(roomId) === identity) reservations.delete(roomId);
      }
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch {
    // Não expor a API secret nem mensagens internas do servidor.
    return NextResponse.json({ error: "Não foi possível atualizar a permissão no LiveKit." }, { status: 502 });
  }
}
