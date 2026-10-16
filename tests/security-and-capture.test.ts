import { audioEnergyState, startMediaDiagnostics } from "../src/lib/capture/media-diagnostics";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Redis } from "@upstash/redis";
import { grantReservedShare } from "../src/lib/security/grant-reserved-share";
import { ServerError, TrackSource } from "livekit-server-sdk";
import type { LocalTrack } from "livekit-client";
import { readRequestJson } from "../src/lib/security/request-json";
import { strictRateLimit } from "../src/lib/security/strict-rate-limit";
import { cleanupScreenTracks, publishScreenTracks } from "../src/lib/capture/publish-screen-tracks";
import { createSecurityRedis } from "../src/lib/security/redis-client";
import { acquireRedisRoomLock, hasRedisRoomLock, releaseRedisRoomLock } from "../src/lib/security/redis-room-lock";
import { reserveShare, getShareReservation, releaseShareReservation } from "../src/lib/security/redis-share-reservation";
import { isShareActionEnabled, screenPermission, viewerPermission } from "../src/lib/security/share-permissions";
import { rateLimitPrefix } from "../src/lib/security/rate-limit-prefix";
import { createRoomInvite, verifyRoomInvite } from "../src/lib/room/server-invite";
import { applyRemoteAudioVolume } from "../src/lib/room/remote-audio-volume";

import { DEFAULT_QUALITY_PROFILE, QUALITY_PRESETS, browserAudioOptions, findVirtualAudioDevice } from "../src/lib/capture/screen-options";

test("captura mantém perfis menores e solicita 1080p30 com teto LiveKit de 5 Mbps", () => {
  assert.deepEqual(QUALITY_PRESETS.alta, { width: 1920, height: 1080, fps: 30, bitrate: 5_000_000 });
  assert.deepEqual(QUALITY_PRESETS.economico, { width: 854, height: 480, fps: 20, bitrate: 900_000 });
  assert.deepEqual(QUALITY_PRESETS.equilibrado, { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 });
});

test("máxima solicita 1080p60 com teto de 8 Mbps e padrão continua em 1080p30", () => {
  assert.deepEqual(QUALITY_PRESETS.maxima, { width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 });
  assert.equal(DEFAULT_QUALITY_PROFILE, "alta");
  assert.equal(QUALITY_PRESETS[DEFAULT_QUALITY_PROFILE].fps, 30);
});

test("áudio pede exclusão da própria aba só com suporte e mantém reprodução local", () => {
  assert.deepEqual(browserAudioOptions({}), { suppressLocalAudioPlayback: false });
  assert.deepEqual(browserAudioOptions({ restrictOwnAudio: true }), {
    restrictOwnAudio: true, suppressLocalAudioPlayback: false,
  });
  assert.equal("deviceId" in browserAudioOptions({}), false);
});

function request(body: string, headers = {}) {
  return new Request("https://discord2.test/api", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
  });
}

test("mute nativo é preservado mesmo se o navegador ignorar ganho/volume HTML", () => {
  const element = { muted: false };
  const ignoredVolume = { setVolume() {} };
  applyRemoteAudioVolume(ignoredVolume, element, 75, true, false);
  assert.equal(element.muted, true);
  applyRemoteAudioVolume(ignoredVolume, element, 75, false, false);
  assert.equal(element.muted, false);
});

test("mix Web Audio mantém o elemento HTML mudo e controla o ganho do SDK", () => {
  const element = { muted: false };
  let gain = 1;
  const track = { setVolume(value: number) { gain = value; } };
  applyRemoteAudioVolume(track, element, 35, false, true);
  assert.equal(gain, 0.35);
  assert.equal(element.muted, true);
  applyRemoteAudioVolume(track, element, 35, true, true);
  assert.equal(gain, 0);
  assert.equal(element.muted, true);
});

test("integração isola cotas Redis sem alterar o prefixo normal", () => {
  const previous = process.env.DISCORD2_INTEGRATION_RUN;
  try {
    delete process.env.DISCORD2_INTEGRATION_RUN;
    assert.equal(rateLimitPrefix("token:global:v1"), "discord2:rate:token:global:v1");
    process.env.DISCORD2_INTEGRATION_RUN = "a".repeat(32);
    assert.equal(rateLimitPrefix("token:global:v1"), `discord2:integration:${"a".repeat(32)}:rate:token:global:v1`);
    process.env.DISCORD2_INTEGRATION_RUN = "invalid";
    assert.throws(() => rateLimitPrefix("token:global:v1"));
  } finally {
    if (previous === undefined) delete process.env.DISCORD2_INTEGRATION_RUN;
    else process.env.DISCORD2_INTEGRATION_RUN = previous;
  }
});

test("JSON aceita o limite exato e rejeita bytes extras sem Content-Length", async () => {
  assert.equal(await readRequestJson(request('"á"'), 4), "á");
  await assert.rejects(readRequestJson(request('"á"'), 3), { status: 413 });
});

test("JSON rejeita tipo incorreto, sintaxe inválida e comprimento declarado excessivo", async () => {
  await assert.rejects(readRequestJson(request("{}", { "Content-Type": "text/plain" }), 10), { status: 415 });
  await assert.rejects(readRequestJson(request("{"), 10), { status: 400 });
  await assert.rejects(readRequestJson(request("{}", { "Content-Length": "20" }), 10), { status: 413 });
});

test("JSON interrompe corpo enviado em chunks quando ultrapassa o limite", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"a":'));
      controller.enqueue(new TextEncoder().encode('"muito grande"}'));
    },
    cancel() { cancelled = true; },
  });
  const req = new Request("https://discord2.test", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: stream, duplex: "half",
  } as RequestInit);
  await assert.rejects(readRequestJson(req, 8), { status: 413 });
  assert.equal(cancelled, true);
});

test("timeout do limitador nunca é tratado como autorização", async () => {
  const limiter = { limit: async () => ({ success: true, reason: "timeout" as const, limit: 10, remaining: 0, reset: 123, pending: Promise.resolve() }) };
  await assert.rejects(strictRateLimit(limiter, "global"));
});

test("limitador mantém uma rejeição real e propaga falha de conexão", async () => {
  const denied = { success: false, reset: 123, limit: 10, remaining: 0, pending: Promise.resolve() };
  const limiter = { limit: async () => denied };
  assert.equal(await strictRateLimit(limiter, "room"), denied);
  const broken = { limit: async () => { throw new Error("offline"); } };
  await assert.rejects(strictRateLimit(broken, "global"), /offline/);
});

test("convite assinado rejeita adulteração e outra chave", () => {
  const invite = createRoomInvite("test-secret");
  assert.equal(verifyRoomInvite(invite, "test-secret"), true);
  assert.equal(verifyRoomInvite(invite, "other-secret"), false);
  assert.equal(verifyRoomInvite((invite[0] === "a" ? "b" : "a") + invite.slice(1), "test-secret"), false);
  assert.equal(verifyRoomInvite("x".repeat(64), "test-secret"), false);
});

function tracks() {
  const stopped: number[] = [];
  const captured = [0, 1].map((i) => ({ stop() { stopped.push(i); } })) as LocalTrack[];
  return { stopped, captured };
}

test("captura que chega após sair da sala é parada sem publicar", async () => {
  const { stopped, captured } = tracks();
  let publications = 0;
  assert.equal(await publishScreenTracks({
    tracks: captured, isActive: () => false,
    publish: async () => { publications++; }, unpublish: async () => {},
  }), false);
  assert.deepEqual(stopped, [0, 1]);
  assert.equal(publications, 0);
});

test("falha na publicação de áudio desfaz o vídeo e para ambas as capturas", async () => {
  const { stopped, captured } = tracks();
  const removed: LocalTrack[] = [];
  await assert.rejects(publishScreenTracks({
    tracks: captured, isActive: () => true,
    publish: async (track) => { if (track === captured[1]) throw new Error("audio failed"); },
    unpublish: async (track) => { removed.push(track); },
  }), /audio failed/);
  assert.deepEqual(stopped, [0, 1]);
  assert.deepEqual(removed, captured);
});

test("desconexão durante a última publicação desfaz todas as trilhas", async () => {
  const { stopped, captured } = tracks();
  let active = true;
  const removed: LocalTrack[] = [];
  assert.equal(await publishScreenTracks({
    tracks: captured, isActive: () => active,
    publish: async (track) => { if (track === captured[1]) active = false; },
    unpublish: async (track) => { removed.push(track); },
  }), false);
  assert.deepEqual(stopped, [0, 1]);
  assert.deepEqual(removed, captured);
});

test("falha de despublicação não deixa a captura aberta nem oculta o erro original", async () => {
  const { stopped, captured } = tracks();
  await assert.rejects(publishScreenTracks({
    tracks: captured, isActive: () => true,
    publish: async () => { throw new Error("original"); },
    unpublish: async () => { throw new Error("offline"); },
  }), /original/);
  assert.deepEqual(stopped, [0, 1]);
});

test("desconexão após vídeo impede a publicação do áudio", async () => {
  const { stopped, captured } = tracks();
  let active = true;
  const published: LocalTrack[] = [];
  assert.equal(await publishScreenTracks({
    tracks: captured, isActive: () => active,
    publish: async (track) => { published.push(track); active = false; },
    unpublish: async () => {},
  }), false);
  assert.deepEqual(published, [captured[0]]);
  assert.deepEqual(stopped, [0, 1]);
});

test("publicação completa mantém as trilhas capturadas ativas", async () => {
  const { stopped, captured } = tracks();
  const published: LocalTrack[] = [];
  const removed: LocalTrack[] = [];
  assert.equal(await publishScreenTracks({
    tracks: captured, isActive: () => true,
    publish: async (track) => { published.push(track); },
    unpublish: async (track) => { removed.push(track); },
  }), true);
  assert.deepEqual(published, captured);
  assert.deepEqual(stopped, []);
  assert.deepEqual(removed, []);
});

test("encerramento de tela para vídeo e áudio antes de esperar a despublicação", async () => {
  const { stopped, captured } = tracks();
  let finish = () => {};
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const cleanup = cleanupScreenTracks(captured, async () => pending);
  assert.deepEqual(stopped, [0, 1]);
  finish();
  await cleanup;
});

test("encerramento tenta remover ambas as trilhas mesmo com erro síncrono do SDK", async () => {
  const { stopped, captured } = tracks();
  const removed: LocalTrack[] = [];
  const result = await cleanupScreenTracks(captured, (track) => {
    removed.push(track);
    if (track === captured[0]) throw new Error("offline");
    return Promise.resolve();
  });
  assert.deepEqual(stopped, [0, 1]);
  assert.deepEqual(removed, captured);
  assert.deepEqual(result.map((item) => item.status), ["rejected", "fulfilled"]);
});

test("desabilitar publicação em produção conserva a possibilidade de liberar", () => {
  assert.equal(isShareActionEnabled("acquire", "production", "false"), false);
  assert.equal(isShareActionEnabled("acquire", "production", undefined), false);
  assert.equal(isShareActionEnabled("release", "production", "false"), true);
  assert.equal(isShareActionEnabled("release", "production", undefined), true);
  assert.equal(isShareActionEnabled("acquire", "production", "true"), true);
});

test("permissão de transmissor restringe fontes a tela e seu áudio", () => {
  assert.equal(screenPermission.canPublish, true);
  assert.equal(screenPermission.canPublishData, false);
  assert.deepEqual(screenPermission.canPublishSources, [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]);
  assert.equal(screenPermission.canPublishSources.includes(TrackSource.MICROPHONE), false);
  assert.equal(screenPermission.canPublishSources.includes(TrackSource.CAMERA), false);
});

test("revogação remove todas as fontes de publicação e preserva recepção", () => {
  assert.equal(viewerPermission.canPublish, false);
  assert.equal(viewerPermission.canPublishData, false);
  assert.equal(viewerPermission.canSubscribe, true);
  assert.deepEqual(viewerPermission.canPublishSources, []);
});

test("fronteira HTTP do SDK Redis: configuração, serialização e falhas", async (t) => {
  const commands: unknown[][] = [];
  let result: unknown = "OK";
  let offline = false;
  let calls = 0;
  const signals: AbortSignal[] = [];
  t.mock.method(Redis, "fromEnv", (options: Parameters<typeof Redis.fromEnv>[0]) => {
    assert.deepEqual(options?.retry, { retries: 0 });
    assert.equal(typeof options?.signal, "function");
    return new Redis({ ...options, url: "https://redis.invalid", token: "test-only" });
  });
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls++;
    signals.push(init.signal as AbortSignal);
    const body = JSON.parse(init.body as string);
    const pipeline = Array.isArray(body[0]);
    commands.push(...(pipeline ? body : [body]));
    if (init.signal?.aborted) throw init.signal.reason;
    if (offline) throw new TypeError("offline");
    const response = { result: typeof result === "string" ? Buffer.from(result).toString("base64") : result };
    return Response.json(pipeline ? body.map(() => response) : response);
  });

  await t.test("cada comando recebe um sinal novo e não repete falha de rede", async () => {
    const client = createSecurityRedis();
    await client.get("one");
    await client.get("two");
    assert.notEqual(signals[0], signals[1]);
    offline = true;
    const before = calls;
    await assert.rejects(client.get("broken"), /offline/);
    assert.equal(calls - before, 1);
    offline = false;
  });

  await t.test("aquisição usa NX e prazo; resposta perdida nunca concede a trava", async () => {
    result = "OK";
    const owner = await acquireRedisRoomLock("room");
    assert.ok(owner);
    const command = commands.at(-1)!;
    assert.deepEqual(command.slice(0, 3), ["set", "discord2:room:mutex:v1:room", owner]);
    assert.ok(command.slice(3).includes("nx"));
    assert.equal(command[command.indexOf("ex") + 1], 120);
    result = null;
    assert.equal(await acquireRedisRoomLock("room"), null);
    offline = true;
    await assert.rejects(acquireRedisRoomLock("room"), /offline/);
    offline = false;
  });

  await t.test("timeout do transporte Redis rejeita a operação sem sucesso artificial", async (subtest) => {
    subtest.mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new Error("transport timeout")));
    await assert.rejects(createSecurityRedis().get("timeout"), /transport timeout/);
  });

  await t.test("verificação antes do grant envia dono da trava e dono da reserva", async () => {
    result = 1;
    assert.equal(await hasRedisRoomLock("room", "mutex-owner", "participant"), true);
    const command = commands.at(-1)!;
    assert.equal(command[0], "eval");
    assert.deepEqual(command.slice(2), [2, "discord2:room:mutex:v1:room", "discord2:room:publisher:v1:room", "mutex-owner", "participant"]);
    assert.match(command[1] as string, /redis\.call\("GET", KEYS\[2\]\) == ARGV\[2\]/);
    result = 0;
    assert.equal(await hasRedisRoomLock("room", "old-owner", "participant"), false);
  });

  await t.test("liberação usa comparação de dono em Lua e respeita rejeição", async () => {
    result = 0;
    assert.equal(await releaseRedisRoomLock("room", "wrong-owner"), false);
    assert.deepEqual(commands.at(-1)!.slice(2), [1, "discord2:room:mutex:v1:room", "wrong-owner"]);
    result = 1;
    assert.equal(await releaseShareReservation("room", "participant"), true);
    assert.deepEqual(commands.at(-1)!.slice(2), [2, "discord2:room:publisher:v1:room", "discord2:room:publisher:v1:room:pending", "participant"]);
    assert.match(commands.at(-1)![1] as string, /return redis\.call\("DEL", KEYS\[1\]\)/);
  });

  await t.test("reserva usa a mesma chave conferida no grant e retorna a identidade intacta", async () => {
    result = "OK";
    assert.equal(await reserveShare("room", "participant"), true);
    const command = commands.at(-1)!;
    assert.deepEqual(command.slice(0, 3), ["set", "discord2:room:publisher:v1:room", "participant"]);
    assert.ok(command.slice(3).includes("nx"));
    assert.equal(command[command.indexOf("ex") + 1], 21600);
    result = "participant";
    assert.equal(await getShareReservation("room"), "participant");
  });
});


test("fonte virtual nunca escolhe entrada padrão, microfone, saída ou dispositivo sem nome", () => {
  const devices = [
    { kind: "audioinput" as const, deviceId: "default", label: "Screen Share Audio" },
    { kind: "audioinput" as const, deviceId: "communications", label: "Screen Share Audio" },
    { kind: "audioinput" as const, deviceId: "mic", label: "Microfone" },
    { kind: "audiooutput" as const, deviceId: "out", label: "Screen Share Audio" },
    { kind: "audioinput" as const, deviceId: "hidden", label: "" },
  ];
  assert.equal(findVirtualAudioDevice(devices), undefined);
  const virtual = { kind: "audioinput" as const, deviceId: "virtual-only", label: "Screen Share Audio" };
  assert.equal(findVirtualAudioDevice([...devices, virtual]), virtual);
});

// Regressão: confirmação do grant deve distinguir rejeição e resultado incerto.

function grantScenario(options: { error?: Error; published?: boolean; tracks?: boolean; lookupFails?: boolean; pending?: boolean; lock?: boolean } = {}) {
  let released = 0;
  let cleared = 0;
  let grants = 0;
  const deps = {
    hasPending: async () => options.pending ?? false,
    markPending: async () => true,
    ownsLock: async () => options.lock ?? true,
    grant: async () => { grants++; if (options.error) throw options.error; },
    list: async () => {
      if (options.lookupFails) throw new Error("lookup offline");
      return [{ identity: "owner", permission: { canPublish: options.published ?? false },
        tracks: options.tracks ? [{ source: TrackSource.SCREEN_SHARE }] : [] }];
    },
    release: async () => { released++; },
    clearPending: async () => { cleared++; },
  };
  return { deps, stats: () => ({ released, cleared, grants }) };
}

const refusedGrant = () => new ServerError("denied", "test only", 403, "permission_denied");
test("grant rejeitado explicitamente + viewer confirmado devolve reserva imediatamente", async () => {
  const scenario = grantScenario({ error: refusedGrant() });
  assert.equal(await grantReservedShare("owner", scenario.deps), "denied");
  assert.equal(scenario.stats().released, 1);
});

test("timeout sem grant visível conserva reserva: leitura viewer não prova cancelamento do RPC", async () => {
  const scenario = grantScenario({ error: new Error("fetch timeout") });
  assert.equal(await grantReservedShare("owner", scenario.deps), "uncertain");
  assert.equal(scenario.stats().released, 0);
});

test("resposta perdida com canPublish confirmado é sucesso sem liberar reserva", async () => {
  const scenario = grantScenario({ error: new Error("lost response"), published: true });
  assert.equal(await grantReservedShare("owner", scenario.deps), "granted");
  assert.deepEqual(scenario.stats(), { released: 0, cleared: 1, grants: 1 });
});

test("reconsulta indisponível, tracks ainda ativas e tentativa anterior incerta nunca liberam reserva", async () => {
  for (const options of [{ lookupFails: true }, { tracks: true }, { pending: true }]) {
    const scenario = grantScenario({ error: refusedGrant(), ...options });
    assert.equal(await grantReservedShare("owner", scenario.deps), "uncertain");
    assert.equal(scenario.stats().released, 0);
  }
});

test("grant não executa sem lease válido e falha Redis conserva estado", async () => {
  const scenario = grantScenario({ lock: false });
  assert.equal(await grantReservedShare("owner", scenario.deps), "uncertain");
  assert.equal(scenario.stats().grants, 0);
  scenario.deps.hasPending = async () => { throw new Error("Redis offline"); };
  assert.equal(await grantReservedShare("owner", scenario.deps), "uncertain");
});

test("rejeição genérica 5xx é ambígua mesmo com viewer confirmado", async () => {
  const scenario = grantScenario({ error: new ServerError("internal", "test only", 500, "internal") });
  assert.equal(await grantReservedShare("owner", scenario.deps), "uncertain");
  assert.equal(scenario.stats().released, 0);
});

test("cancelamento durante grant não deixa uma rejeição posterior limpar incerteza anterior", async () => {
  const scenario = grantScenario({ pending: true, error: refusedGrant() });
  assert.equal(await grantReservedShare("owner", scenario.deps), "uncertain");
  assert.equal(scenario.stats().released, 0);
});

test("energia distingue silêncio de sinal apenas com amostras válidas do intervalo", () => {
  const previous = { totalAudioEnergy: 1, totalSamplesDuration: 10 };
  assert.equal(audioEnergyState({ totalAudioEnergy: 1, totalSamplesDuration: 15 }, previous), "silent");
  assert.equal(audioEnergyState({ totalAudioEnergy: 2, totalSamplesDuration: 15 }, previous), "signal");
  assert.equal(audioEnergyState({}, previous), "unknown");
  assert.equal(audioEnergyState(previous), "unknown");
  assert.equal(audioEnergyState(previous, previous), "unknown");
  assert.equal(audioEnergyState({ totalAudioEnergy: 0, totalSamplesDuration: 1 }, previous), "unknown");
});

test("volume zero usa mute nativo no celular mesmo sem suporte a volume HTML", () => {
  const element = { muted: false };
  const track = { setVolume() {} };
  applyRemoteAudioVolume(track, element, 0, false, false);
  assert.equal(element.muted, true);
  applyRemoteAudioVolume(track, element, 80, false, false);
  assert.equal(element.muted, false);
});

test("diagnósticos são opt-in e omitem identificadores, dispositivos e dados brutos", async () => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const debug = console.debug;
  const logs: unknown[] = [];
  let calls = 0;
  let stop = () => {};
  try {
    console.debug = (...args) => { logs.push(args); };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
    const track = {
      mediaStreamTrack: { readyState: "live", enabled: true, muted: false,
        getSettings: () => ({ deviceId: "secret-device", groupId: "secret-group", channelCount: 2 }) },
      getRTCStatsReport: async () => { calls++; return new Map([["secret-id", {
        id: "secret-id", type: "media-source", kind: "audio", timestamp: 1,
        totalAudioEnergy: 0, totalSamplesDuration: 1, arbitrary: "secret-payload",
      }]]); },
    };
    const participant = { identity: "secret-person", trackPublications: new Map([["secret-sid", { source: "screen_share_audio", track }]]) };
    const room = { localParticipant: participant, remoteParticipants: new Map() } as unknown as Parameters<typeof startMediaDiagnostics>[0];
    stop = startMediaDiagnostics(room);
    stop();
    assert.equal(calls, 0);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "1" } });
    stop = startMediaDiagnostics(room);
    await new Promise(resolve => setImmediate(resolve));
    stop();
    assert.equal(calls, 1);
    assert.ok(JSON.stringify(logs).includes('unknown'));
    assert.equal(JSON.stringify(logs).includes('secret-'), false);
  } finally {
    stop();
    console.debug = debug;
    if (storage) Object.defineProperty(globalThis, "localStorage", storage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
