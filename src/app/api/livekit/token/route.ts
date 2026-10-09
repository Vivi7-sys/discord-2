
import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { randomUUID } from "node:crypto";

export async function POST(request: NextRequest) {
  // Temporariamente disponível apenas no desenvolvimento.
  // Antes da publicação, implementaremos autorização.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Rota ainda não disponível em produção." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const roomId = body?.roomId;

    if (
      typeof roomId !== "string" ||
      !/^[a-zA-Z0-9_-]{6,64}$/.test(roomId)
    ) {
      return NextResponse.json(
        { error: "ID de sala inválido." },
        { status: 400 }
      );
    }

    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } =
      process.env;

    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return NextResponse.json(
        { error: "LiveKit não configurado." },
        { status: 500 }
      );
    }

    const token = new AccessToken(
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      {
        identity: randomUUID(),
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
