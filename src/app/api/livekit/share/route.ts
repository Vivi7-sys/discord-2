import { readRequestJson, RequestBodyError } from "@/lib/security/request-json";
import { grantReservedShare } from "@/lib/security/grant-reserved-share";
import { strictRateLimit } from "@/lib/security/strict-rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { RoomServiceClient, TokenVerifier } from "livekit-server-sdk";
import { isShareActionEnabled, screenPermission, viewerPermission } from "@/lib/security/share-permissions";
import {
  getShareReservation,
  markShareGrantPending,
  hasPendingShareGrant,
  clearPendingShareGrant,
  isShareReservationOld,
  reserveShare,
  releaseShareReservation,
} from "@/lib/security/redis-share-reservation";
import {
  acquireRedisRoomLock,
  hasRedisRoomLock,
  releaseRedisRoomLock,
} from "@/lib/security/redis-room-lock";
import {
  getShareGlobalLimiter,
  getShareAcquireLimiter,
} from "@/lib/security/share-rate-limit";

// A fila local evita disputa na instância; a trava Redis coordena instâncias.

const scope = globalThis as typeof globalThis & {
  discord2RoomQueues?: Map<string, Promise<void>>;
};
const roomQueues = scope.discord2RoomQueues ??= new Map<string, Promise<void>>();

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

export async function POST(request: NextRequest) {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "LiveKit não configurado." }, { status: 500 });
  }

  let roomId: string;
  let action: "acquire" | "release";
  try {
    const parsed = await readRequestJson(request, 1024);
    const body = parsed as Record<string, unknown> | null;
    roomId = body?.roomId as string;
    action = body?.action as typeof action;
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof RequestBodyError ? cause.message : "Requisição inválida." }, { status: cause instanceof RequestBodyError ? cause.status : 400 });
  }
  // Desabilitar novas transmissões nunca deve impedir a revogação das existentes.
  if (!isShareActionEnabled(action, process.env.NODE_ENV, process.env.ENABLE_SHARE_IN_PRODUCTION)) {
    return NextResponse.json({ error: "Transmissao ainda indisponivel." }, { status: 403 });
  }
  if (typeof roomId !== "string" || !/^[a-f0-9]{64}$/.test(roomId) ||
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
    try {
      const result = await strictRateLimit(getShareAcquireLimiter(), identity);
      if (!result.success) {
        return shareTooManyRequests(
          Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Proteção de segurança indisponível. Tente novamente." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    // A cota individual vem antes da global: repetir um JWT não esgota
    // indiscriminadamente o orçamento das outras identidades.
    try {
      const result = await strictRateLimit(getShareGlobalLimiter(), "global");
      if (!result.success) return shareTooManyRequests(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)));
    } catch {
      return NextResponse.json({ error: "Proteção de segurança indisponível. Tente novamente." }, { status: 503 });
    }

  }

  try {
    const endpoint = new URL(LIVEKIT_URL);
    if (endpoint.protocol === "wss:") endpoint.protocol = "https:";
    else if (endpoint.protocol === "ws:") endpoint.protocol = "http:";
    else if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new Error("Protocolo LiveKit inválido.");
    }
    const service = new RoomServiceClient(endpoint.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { requestTimeout: 8, failover: false });

    return await withRoomLock(roomId, async () => {
      let lockOwner: string | null;

      try {
        lockOwner = await acquireRedisRoomLock(roomId);
      } catch {
        // Se o Redis falhar, ainda permitir que um participante
        // autenticado encerre a propria transmissao no LiveKit.
        // Nunca usar esta alternativa para iniciar transmissao.
        if (action === "release") {
          try {
            const people = await service.listParticipants(roomId);
            const connected = people.some(
              (participant) => participant.identity === identity
            );

            if (!connected) {
              return NextResponse.json(
                { error: "Você não está conectado à sala." },
                { status: 409 }
              );
            }

            await service.updateParticipant(roomId, identity, {
              permission: viewerPermission,
            });

            // A permissão já foi revogada no LiveKit.
            // Tenta limpar a reserva mesmo se a trava falhou.
            // A remoção é condicional: só o dono libera sua reserva.
            let reservationHeld = false;
            try {
              await releaseShareReservation(roomId, identity);
            } catch {
              reservationHeld = true;
              // Se o Redis realmente estiver indisponível,
              // a reserva precisará ser reconciliada depois.
            }

            return NextResponse.json(
              { ok: true, reservationHeld },
              { headers: { "Cache-Control": "no-store" } }
            );
          } catch {
            return NextResponse.json(
              { error: "Não foi possível encerrar a transmissão no LiveKit." },
              { status: 502 }
            );
          }
        }

        return NextResponse.json(
          { error: "Proteção de transmissão indisponível. Tente novamente." },
          { status: 503 }
        );
      }

      if (!lockOwner) {
        return NextResponse.json(
          { error: "Outra operação está sendo processada nesta sala. Tente novamente." },
          { status: 409 }
        );
      }

      let reservationHeld = false;
      try {
      // LiveKit é a fonte de verdade: a permissão existe somente enquanto o
      // participante estiver na sala. Sair da sala libera a vaga naturalmente.
      const people = await service.listParticipants(roomId);
      const person = people.find((participant) => participant.identity === identity);
      if (!person) {
        return NextResponse.json({ error: "Você não está conectado à sala." }, { status: 409 });
      }

      // Redis guarda a reserva compartilhada entre instâncias.
      // O LiveKit confirma se o participante reservado ainda está na sala.
      let holder = action === "acquire"
        ? await getShareReservation(roomId)
        : null;

      if (holder && !people.some((participant) => participant.identity === holder)) {
        await releaseShareReservation(roomId, holder);
        holder = await getShareReservation(roomId);
      }

      // Recupera uma reserva antiga quando o dono ainda está
      // conectado, mas não possui mais permissão de transmitir.
      // Nunca remove reservas recentes ou de alguém publicando.
      if (action === "acquire" && holder && holder !== identity) {
        const reservedPerson = people.find(
          (participant) => participant.identity === holder
        );

        if (
          reservedPerson &&
          !reservedPerson.permission?.canPublish &&
          await isShareReservationOld(roomId, holder, 60) &&
          !await hasPendingShareGrant(roomId, holder)
        ) {
          const freshPeople = await service.listParticipants(roomId);

          const stillViewer = freshPeople.some(
            (participant) =>
              participant.identity === holder &&
              !participant.permission?.canPublish
          );

          const anyonePublishing = freshPeople.some(
            (participant) => participant.permission?.canPublish
          );

          if (
            stillViewer &&
            !anyonePublishing &&
            await getShareReservation(roomId) === holder
          ) {
            await releaseShareReservation(roomId, holder);
            holder = await getShareReservation(roomId);
          }
        }
      }

      if (action === "acquire") {
        if (
          (holder !== null && holder !== identity) ||
          people.some(
            (participant) =>
              participant.identity !== identity &&
              participant.permission?.canPublish
          )
        ) {
          return NextResponse.json(
            { error: "Outra pessoa já reservou ou está transmitindo. Aguarde." },
            { status: 409 }
          );
        }

        if (!holder) {
          const reserved = await reserveShare(roomId, identity);
          if (!reserved) {
            return NextResponse.json(
              { error: "Outra pessoa já reservou a transmissão. Aguarde." },
              { status: 409 }
            );
          }
        }

        if (!person.permission?.canPublish) {
          const outcome = await grantReservedShare(identity, {
            hasPending: () => hasPendingShareGrant(roomId, identity),
            markPending: () => markShareGrantPending(roomId, identity),
            ownsLock: () => hasRedisRoomLock(roomId, lockOwner!, identity),
            grant: () => service.updateParticipant(roomId, identity, { permission: screenPermission }),
            list: () => service.listParticipants(roomId),
            clearPending: () => clearPendingShareGrant(roomId, identity),
            release: () => releaseShareReservation(roomId, identity),
          });
          if (outcome !== "granted") {
            return NextResponse.json({
              error: outcome === "denied" ? "O LiveKit recusou a permissão. A reserva foi liberada; tente novamente."
                : "Não foi possível confirmar a permissão. Sua reserva foi mantida; tente novamente ou use Cancelar vez.",
              reservationHeld: outcome === "uncertain",
            }, { status: 502, headers: { "Cache-Control": "no-store" } });
          }
        }
      } else {
        // Revoga a permissão antes de liberar a reserva.
        await service.updateParticipant(roomId, identity, {
          permission: viewerPermission,
        });
        try {
          await releaseShareReservation(roomId, identity);
        } catch {
          reservationHeld = true;
          // A permissão já foi revogada no LiveKit.
          // A reserva pendente precisará ser reconciliada depois.
        }
      }
      return NextResponse.json({ ok: true, reservationHeld }, { headers: { "Cache-Control": "no-store" } });
      } finally {
        // A trava possui expiração de segurança no Redis.
        try {
          await releaseRedisRoomLock(roomId, lockOwner);
        } catch {
          // Se o Redis falhar, a trava expira automaticamente.
        }
      }
    });
  } catch {
    // Não expor a API secret nem mensagens internas do servidor.
    return NextResponse.json({ error: "Não foi possível atualizar a permissão no LiveKit." }, { status: 502 });
  }
}
