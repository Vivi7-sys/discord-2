import { readRequestJson, RequestBodyError } from "@/lib/security/request-json";
import { strictRateLimit } from "@/lib/security/strict-rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { verifyTurnstileToken } from "@/lib/security/turnstile";
import { createRoomInvite } from "@/lib/room/server-invite";
import { getCreateLimiter } from "@/lib/security/redis-rate-limit";

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

export async function POST(request: NextRequest) {
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

  // O servidor verifica o Turnstile antes de emitir o convite.
  let turnstileToken: unknown;

  try {
    const parsed = await readRequestJson(request, 4096);
    const body = parsed as Record<string, unknown> | null;
    turnstileToken = body?.turnstileToken;
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof RequestBodyError ? cause.message : "Solicitação inválida." },
      { status: cause instanceof RequestBodyError ? cause.status : 400 }
    );
  }

  if (!(await verifyTurnstileToken(turnstileToken))) {
    return NextResponse.json(
      { error: "Verificação de segurança inválida. Tente novamente." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Limite compartilhado no Redis, independente de reinícios do servidor.
  // Por enquanto, todos os visitantes compartilham o mesmo limite.
  try {
    const result = await strictRateLimit(getCreateLimiter(), "global");

    if (!result.success) {
      const retryAfter = Math.max(
        1,
        Math.ceil((result.reset - Date.now()) / 1000)
      );

      return NextResponse.json(
        { error: "Muitas salas criadas. Aguarde um pouco." },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(retryAfter),
          },
        }
      );
    }
  } catch {
    // Se o Redis falhar, não permitir criação sem proteção.
    return NextResponse.json(
      { error: "Proteção de segurança indisponível. Tente novamente." },
      { status: 503 }
    );
  }

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
