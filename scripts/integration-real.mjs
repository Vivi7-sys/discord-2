// Integração real: API HTTP, Redis e LiveKit. Sem fetch mocks; só recursos isolados.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { randomBytes, createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const { Redis } = require("@upstash/redis");
const { RoomServiceClient } = require("livekit-server-sdk");
const run = randomBytes(16).toString("hex");
process.env.DISCORD2_INTEGRATION_RUN = run;
const nonce = randomBytes(16).toString("hex");
const roomId = nonce + createHmac("sha256", process.env.ROOM_INVITE_SECRET).update("discord2:room-invite:v1:").update(nonce).digest("hex").slice(0, 32);
const metadata = `discord2-integration:${run}`;
const mutexKey = `discord2:room:mutex:v1:${roomId}`;
const reservationKey = `discord2:room:publisher:v1:${roomId}`;
const redis = Redis.fromEnv({ signal: () => AbortSignal.timeout(8000), retry: { retries: 0 } });
const endpoint = new URL(process.env.LIVEKIT_URL);
endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : endpoint.protocol === "ws:" ? "http:" : endpoint.protocol;
const service = new RoomServiceClient(endpoint.origin, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { requestTimeout: 8, failover: false });
const locks = require("../.test-build/src/lib/security/redis-room-lock.js");
const reservations = require("../.test-build/src/lib/security/redis-share-reservation.js");
const children = new Set();
const results = [];
let created = false;
let stage = "setup";
let failed = false;

async function scenario(name, work) {
  stage = name;
  await work();
  results.push({ scenario: name, status: "passed", type: "real-integration" });
  console.log(JSON.stringify(results.at(-1)));
}
async function until(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(500);
  }
  throw new Error("Condition deadline exceeded");
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function apiServer(overrides = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", ENABLE_SHARE_IN_PRODUCTION: "true", ...overrides },
    stdio: "ignore",
  });
  children.add(child);
  const base = `http://127.0.0.1:${port}`;
  await until(async () => {
    if (child.exitCode !== null) throw new Error("API process exited");
    try { return (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
  });
  return { base, child };
}
function rtcClient() {
  const rtcModule = process.env.DISCORD2_RTC_MODULE ?? "/tmp/discord2-integration/node_modules/@livekit/rtc-node/dist/index.cjs";
  const child = spawn(process.execPath, ["scripts/integration-client.mjs"], {
    cwd: process.cwd(), env: { PATH: process.env.PATH, DISCORD2_RTC_MODULE: rtcModule, RUST_LOG: "off" }, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  children.add(child);
  let next = 0;
  function command(action, extra = {}) {
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("RTC deadline exceeded")), 30000);
      const onExit = () => finish(new Error("RTC process exited"));
      const onMessage = (message) => {
        if (message.id !== id) return;
        if (!message.ok) finish(new Error("RTC command rejected")); else finish(null, message.result);
      };
      function finish(error, result) {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        if (error) reject(error); else resolve(result);
      }
      child.on("message", onMessage);
      child.once("exit", onExit);
      child.send({ id, action, ...extra });
    });
  }
  return { child, command };
}
async function token(base) {
  const response = await fetch(`${base}/api/livekit/token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, displayName: "Integration " + randomUUID().slice(0, 6) }), signal: AbortSignal.timeout(45000),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  const identity = JSON.parse(Buffer.from(data.token.split(".")[1], "base64url").toString()).sub;
  return { ...data, identity };
}
async function action(base, session, value) {
  const response = await fetch(`${base}/api/livekit/share`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ roomId, action: value }), signal: AbortSignal.timeout(45000),
  });
  return response.status;
}
async function publisherCount() {
  return (await service.listParticipants(roomId)).filter((p) => p.permission?.canPublish).length;
}
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([closed, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

try {
  const room = await service.createRoom({ name: roomId, metadata, maxParticipants: 6, emptyTimeout: 120, departureTimeout: 30 });
  assert.equal(room.metadata, metadata);
  created = true;
  await scenario("redis_mutex_reservation_and_expiry", async () => {
    const owners = await Promise.all(Array.from({ length: 8 }, () => locks.acquireRedisRoomLock(roomId)));
    assert.equal(owners.filter(Boolean).length, 1);
    const owner = owners.find(Boolean);
    assert.equal(await locks.releaseRedisRoomLock(roomId, "wrong-owner"), false);
    const candidates = ["integration-a", "integration-b"];
    const claims = await Promise.all(candidates.map((id) => reservations.reserveShare(roomId, id)));
    assert.equal(claims.filter(Boolean).length, 1);
    const identity = candidates[claims.findIndex(Boolean)];
    assert.equal(await locks.hasRedisRoomLock(roomId, owner, identity), true);
    assert.equal(await locks.hasRedisRoomLock(roomId, owner, "wrong-owner"), false);
    assert.equal(await reservations.releaseShareReservation(roomId, "wrong-owner"), false);
    await redis.expire(mutexKey, 1);
    await until(async () => !await redis.exists(mutexKey), 5000);
    const newer = await locks.acquireRedisRoomLock(roomId);
    assert.ok(newer);
    assert.equal(await locks.releaseRedisRoomLock(roomId, owner), false);
    assert.equal(await locks.hasRedisRoomLock(roomId, newer, identity), true);
    await redis.expire(reservationKey, 1);
    await until(async () => !await redis.exists(reservationKey), 5000);
    assert.equal(await locks.hasRedisRoomLock(roomId, newer, identity), false);
    assert.equal(await locks.releaseRedisRoomLock(roomId, newer), true);
  });
  const [api1, api2] = await Promise.all([apiServer(), apiServer()]);
  const [a, b] = await Promise.all([token(api1.base), token(api2.base)]);
  const clientA = rtcClient();
  const clientB = rtcClient();
  await scenario("two_simultaneous_real_webrtc_connections", async () => {
    await Promise.all([clientA.command("connect", { url: a.serverUrl, token: a.token }), clientB.command("connect", { url: b.serverUrl, token: b.token })]);
    await until(async () => (await service.listParticipants(roomId)).length === 2);
    await until(async () => (await clientA.command("stats")).participants === 1 && (await clientB.command("stats")).participants === 1);
  });
  let holder;
  let viewer;
  let holderSession;
  let viewerSession;
  await scenario("exclusive_acquisition_across_two_http_instances", async () => {
    const statuses = await Promise.all([action(api1.base, a, "acquire"), action(api2.base, b, "acquire")]);
    assert.deepEqual([...statuses].sort(), [200, 409]);
    const first = statuses[0] === 200;
    holder = first ? clientA : clientB;
    viewer = first ? clientB : clientA;
    holderSession = first ? a : b;
    viewerSession = first ? b : a;
    assert.equal(await publisherCount(), 1);
    assert.equal(await redis.get(reservationKey), holderSession.identity);
    assert.equal(await redis.get(mutexKey), null);
  });
  await scenario("actual_video_and_audio_received_over_webrtc", async () => {
    await holder.command("publish");
    await until(async () => { const stats = await viewer.command("stats"); return stats.videoFrames >= 5 && stats.audioFrames >= 5; });
    const person = await service.getParticipant(roomId, holderSession.identity);
    assert.deepEqual(person.tracks.map((track) => track.source).sort(), [3, 4]);
  });
  await scenario("stop_video_audio_and_transfer_publisher", async () => {
    await holder.command("stop");
    assert.equal(await action(api1.base, holderSession, "release"), 200);
    await until(async () => (await viewer.command("stats")).remoteTracks === 0);
    await delay(1000);
    const before = await viewer.command("stats");
    await delay(1500);
    const after = await viewer.command("stats");
    assert.equal(after.videoFrames, before.videoFrames);
    assert.equal(after.audioFrames, before.audioFrames);
    assert.equal(await redis.get(reservationKey), null);
    assert.equal(await action(api2.base, viewerSession, "acquire"), 200);
    assert.equal(await publisherCount(), 1);
    await viewer.command("publish");
    await until(async () => { const stats = await holder.command("stats"); return stats.videoFrames >= 5 && stats.audioFrames >= 5; });
  });
  await scenario("publisher_process_crash_and_reservation_recovery", async () => {
    viewer.child.kill("SIGKILL"); // queda real do processo, sem disconnect/release
    await until(async () => !(await service.listParticipants(roomId)).some((p) => p.identity === viewerSession.identity), 45000);
    assert.equal(await action(api1.base, holderSession, "acquire"), 200);
    assert.equal(await redis.get(reservationKey), holderSession.identity);
    assert.equal(await publisherCount(), 1);
  });
  const clientC = rtcClient();
  const c = await token(api2.base);
  await scenario("new_participant_rejoins_after_crash", async () => {
    await clientC.command("connect", { url: c.serverUrl, token: c.token });
    await until(async () => (await service.listParticipants(roomId)).length === 2);
    await holder.command("publish");
    await until(async () => { const stats = await clientC.command("stats"); return stats.videoFrames >= 5 && stats.audioFrames >= 5; });
  });
  const closedPort = await freePort();
  const badRedis = await apiServer({ UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${closedPort}`, UPSTASH_REDIS_REST_TOKEN: "integration-only" });
  await scenario("redis_connection_failure_blocks_grant_and_allows_real_revocation", async () => {
    assert.equal(await action(badRedis.base, c, "acquire"), 503);
    assert.equal(await action(badRedis.base, holderSession, "release"), 200);
    assert.equal(await publisherCount(), 0);
    await until(async () => (await service.getParticipant(roomId, holderSession.identity)).tracks.length === 0);
    await until(async () => (await clientC.command("stats")).remoteTracks === 0);
    await holder.command("stop");
    // Reserva real abandonada durante a falha, envelhecida só na sala isolada.
    assert.equal(await redis.get(reservationKey), holderSession.identity);
    await redis.expire(reservationKey, 21530);
    assert.equal(await action(api2.base, c, "acquire"), 200);
    assert.equal(await redis.get(reservationKey), c.identity);
    assert.equal(await publisherCount(), 1);
    assert.equal(await action(api1.base, c, "release"), 200);
  });
  await stopChild(badRedis.child);
  const badLivekit = await apiServer({ LIVEKIT_URL: `http://127.0.0.1:${closedPort}` });
  await scenario("livekit_connection_failure_returns_error_and_releases_real_mutex", async () => {
    assert.equal(await action(badLivekit.base, c, "acquire"), 502);
    assert.equal(await redis.get(mutexKey), null);
    assert.equal(await redis.get(reservationKey), null);
    assert.equal(await action(api1.base, c, "acquire"), 200);
    assert.equal(await action(api2.base, c, "release"), 200);
  });
  await Promise.allSettled([holder.command("disconnect"), clientC.command("disconnect")]);
} catch (error) {
  failed = true;
  results.push({ scenario: stage, status: "failed", type: "real-integration", errorType: error.name });
  console.log(JSON.stringify(results.at(-1)));
} finally {
  // Nenhuma varredura global: encerra só processos próprios e remove só a sala criada.
  await Promise.allSettled([...children].map(stopChild));
  let cleaned = !created;
  if (created) {
    try {
      const [room] = await service.listRooms([roomId]);
      if (room && room.metadata !== metadata) throw new Error("Ownership mismatch");
      if (room) await service.deleteRoom(roomId);
      await redis.del(mutexKey, reservationKey);
      cleaned = (await service.listRooms([roomId])).length === 0 && !await redis.exists(mutexKey, reservationKey);
    } catch { cleaned = false; }
  }
  results.push({ scenario: "isolated_resource_cleanup", status: cleaned ? "passed" : "failed", type: "real-integration" });
  console.log(JSON.stringify(results.at(-1)));
  const report = {
    date: new Date().toISOString(), isolated: true, mocked: false,
    media: "synthetic input; actual WebRTC transmission and decoding",
    results,
    notTested: ["browser getDisplayMedia and user interaction", "Linux virtual device", "Safari/iOS autoplay", "arbitrary network partitions and transaction fencing"],
  };
  await writeFile("docs/INTEGRACAO-REAL-RESULTADOS.json", JSON.stringify(report, null, 2) + "\n");
  process.exitCode = failed || !cleaned ? 1 : 0;
}
