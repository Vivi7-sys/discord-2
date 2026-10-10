
import { NextRequest, NextResponse } from "next/server";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { randomUUID } from "node:crypto";
import { cleanDisplayName, safeAvatarDataUrl } from "@/lib/room/participant-profile";

// Fase 9A: proteção INICIAL apenas para desenvolvimento em um processo.
// Em produção, usar limites por IP/identidade e armazenamento compartilhado.
const WINDOW_MS = 60_000;
const GLOBAL_LIMIT = 60;
const ROOM_LIMIT = 20;

type RateWindow = { count: number; resetAt: number };
type RateState = { global: RateWindow; rooms: Map<string, RateWindow> };

const scope = globalThis as typeof globalThis & {
  discord2TokenRateState?: RateState;
};
const rateState = scope.discord2TokenRateState ??= {
  global: { count: 0, resetAt: 0 },
  rooms: new Map<string, RateWindow>(),
};

function checkWindow(bucket: RateWindow, limit: number, now: number): number | null {
  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + WINDOW_MS;
  }
  if (bucket.count >= limit) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }
  bucket.count += 1;
  return null;
}

function checkGlobalLimit(): number | null {
  const now = Date.now();
  if (now >= rateState.global.resetAt) {
    for (const [id, bucket] of rateState.rooms) {
      if (now >= bucket.resetAt) rateState.rooms.delete(id);
    }
  }
  return checkWindow(rateState.global, GLOBAL_LIMIT, now);
}

function checkRoomLimit(roomId: string): number | null {
  let bucket = rateState.rooms.get(roomId);
  if (!bucket) {
    bucket = { count: 0, resetAt: 0 };
    rateState.rooms.set(roomId, bucket);
  }
  return checkWindow(bucket, ROOM_LIMIT, Date.now());
}

function tooManyRequests(seconds: number) {
  return NextResponse.json(
    { error: "Muitas solicitações. Aguarde um pouco e tente novamente." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(seconds),
      },
    }
  );
}


export async function POST(request: NextRequest) {
  // Temporariamente disponível apenas no desenvolvimento.
  // Antes da publicação, implementaremos autorização.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Rota ainda não disponível em produção." },
      { status: 403 }
    );
  }

  // Bloqueia excesso de pedidos, mesmo com conteúdo inválido.
  const globalRetry = checkGlobalLimit();
  if (globalRetry !== null) return tooManyRequests(globalRetry);

  try {
    const body = await request.json();
    const roomId = body?.roomId;
    const displayName = cleanDisplayName(body?.displayName);
    const avatar = body?.avatar == null ? null : safeAvatarDataUrl(body.avatar);

    if (
      typeof roomId !== "string" ||
      !/^[a-f0-9]{32}$/.test(roomId) ||
      !displayName ||
      (body?.avatar != null && !avatar)
    ) {
      return NextResponse.json(
        { error: "Dados de entrada inválidos. Confira nome e foto." },
        { status: 400 }
      );
    }

    const roomRetry = checkRoomLimit(roomId);
    if (roomRetry !== null) return tooManyRequests(roomRetry);

    // Valida a foto compactada antes de carregar o token do LiveKit.
    if (avatar) {
      const jpeg = Buffer.from(avatar.slice("data:image/jpeg;base64,".length), "base64");
      if (jpeg.length > 12_000 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 ||
          jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
        return NextResponse.json({ error: "Foto de perfil inválida." }, { status: 400 });
      }
    }

    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } =
      process.env;

    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return NextResponse.json(
        { error: "LiveKit não configurado." },
        { status: 500 }
      );
    }

    // Configura o limite no LiveKit antes de entregar qualquer token.
    // Assim, dois pedidos simultâneos não podem ultrapassar seis conexões.
    try {
      const endpoint = new URL(LIVEKIT_URL);
      if (endpoint.protocol === "wss:") endpoint.protocol = "https:";
      else if (endpoint.protocol === "ws:") endpoint.protocol = "http:";
      else if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
        throw new Error("URL do LiveKit inválida.");
      }

      const service = new RoomServiceClient(
        endpoint.origin,
        LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET
      );
      const room = await service.createRoom({ name: roomId, maxParticipants: 6 });
      if (room.maxParticipants !== 6) {
        return NextResponse.json(
          { error: "Esta sala não tem limite de seis participantes. Crie uma nova sala." },
          { status: 409 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Não foi possível preparar a sala no LiveKit." },
        { status: 502 }
      );
    }

    const token = new AccessToken(
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      {
        identity: randomUUID(),
        name: displayName,
        metadata: avatar ? JSON.stringify({ avatar }) : undefined,
        ttl: "6h",
      }
    );

    token.addGrant({
      room: roomId,
      roomJoin: true,
      canSubscribe: true,
      // Fase 6B: todos entram como espectadores. A permissão de transmitir
      // é concedida separadamente pelo servidor a apenas uma pessoa.
      canPublish: false,
      canPublishSources: [],
      canPublishData: false,
    });

    return NextResponse.json(
      {
        serverUrl: LIVEKIT_URL,
        token: await token.toJwt(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { error: "Não foi possível processar a solicitação." },
      { status: 400 }
    );
  }
}
