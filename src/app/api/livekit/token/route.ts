import { readRequestJson, RequestBodyError } from "@/lib/security/request-json";
import { strictRateLimit } from "@/lib/security/strict-rate-limit";

import { NextRequest, NextResponse } from "next/server";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { randomUUID } from "node:crypto";
import { verifyRoomInvite } from "@/lib/room/server-invite";
import { cleanDisplayName, safeAvatarDataUrl } from "@/lib/room/participant-profile";
import {
  getTokenGlobalLimiter,
  getTokenRoomLimiter,
} from "@/lib/security/token-rate-limit";

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
  try {
    const parsed = await readRequestJson(request, 24000);
    const body = parsed as Record<string, unknown> | null;
    const roomId = body?.roomId;
    const displayName = cleanDisplayName(body?.displayName);
    const avatar = body?.avatar == null ? null : safeAvatarDataUrl(body.avatar);

    if (
      typeof roomId !== "string" ||
      !/^[a-f0-9]{64}$/.test(roomId) ||
      !displayName ||
      (body?.avatar != null && !avatar)
    ) {
      return NextResponse.json(
        { error: "Dados de entrada inválidos. Confira nome e foto." },
        { status: 400 }
      );
    }

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

    const inviteSecret = process.env.ROOM_INVITE_SECRET;
    if (!inviteSecret) {
      return NextResponse.json(
        { error: "Servidor de convites não configurado." },
        { status: 500 }
      );
    }

    // Somente convites assinados pelo servidor podem abrir salas.
    if (!verifyRoomInvite(roomId, inviteSecret)) {
      return NextResponse.json(
        { error: "Convite inválido. Solicite um novo link de sala." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Somente dados válidos e convites assinados consomem cotas de emissão.
    // Limite compartilhado específico para esta sala.
    try {
      const result = await strictRateLimit(getTokenRoomLimiter(), roomId);
      if (!result.success) {
        return tooManyRequests(
          Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Proteção de segurança indisponível. Tente novamente." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Limite global compartilhado entre reinícios do servidor.
    try {
      const result = await strictRateLimit(getTokenGlobalLimiter(), "global");
      if (!result.success) {
        return tooManyRequests(
          Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Proteção de segurança indisponível. Tente novamente." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
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
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof RequestBodyError ? cause.message : "Não foi possível processar a solicitação." },
      { status: cause instanceof RequestBodyError ? cause.status : 400 }
    );
  }
}
