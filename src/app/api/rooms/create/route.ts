import { NextResponse } from "next/server";
import { createRoomInvite } from "@/lib/room/server-invite";

// Limite provisório por processo, somente para desenvolvimento.
const WINDOW_MS = 60_000;
const CREATE_LIMIT = 10;

type RateWindow = {
  count: number;
  resetAt: number;
};

const scope = globalThis as typeof globalThis & {
  discord2CreateRate?: RateWindow;
};

const rate = scope.discord2CreateRate ??= {
  count: 0,
  resetAt: 0,
};

export async function POST() {
  // Nunca publicar esta versão da API sem proteções adicionais.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Criação ainda indisponível em produção." },
      { status: 403 }
    );
  }

  const now = Date.now();

  if (now >= rate.resetAt) {
    rate.count = 0;
    rate.resetAt = now + WINDOW_MS;
  }

  if (rate.count >= CREATE_LIMIT) {
    const retryAfter = Math.max(
      1,
      Math.ceil((rate.resetAt - now) / 1000)
    );

    return NextResponse.json(
      { error: "Muitos convites criados. Aguarde um minuto." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  rate.count += 1;

  const secret = process.env.ROOM_INVITE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Servidor não configurado." },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { roomId: createRoomInvite(secret) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
