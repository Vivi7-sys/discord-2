import { readRequestJson, RequestBodyError } from "@/lib/security/request-json";
import { strictRateLimit } from "@/lib/security/strict-rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { verifyTurnstileToken } from "@/lib/security/turnstile";
import { createRoomInvite } from "@/lib/room/server-invite";
import { limitTurnstileVerification } from "@/lib/security/verification-rate-limit";
import { getCreateLimiter } from "@/lib/security/redis-rate-limit";

export async function POST(request: NextRequest) {
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

  if (typeof turnstileToken !== "string" || !turnstileToken || turnstileToken.length > 2048) {
    return NextResponse.json({ error: "Verificação de segurança inválida." }, { status: 403 });
  }
  try {
    const result = await limitTurnstileVerification(turnstileToken);
    if (!result.success) {
      return NextResponse.json({ error: "Muitas verificações. Aguarde e tente novamente." }, {
        status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))) },
      });
    }
  } catch {
    return NextResponse.json({ error: "Proteção de segurança indisponível. Tente novamente." }, { status: 503 });
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
