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

  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "LiveKit não configurado." }, { status: 500 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Autorização necessária." }, { status: 401 });
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
  if (typeof roomId !== "string" || !/^[a-zA-Z0-9_-]{6,64}$/.test(roomId) ||
      (action !== "acquire" && action !== "release")) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
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
