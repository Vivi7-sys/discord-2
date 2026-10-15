/* eslint-disable @typescript-eslint/no-require-imports -- Regressões HTTP isoladas, executadas pelo Node. */
const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { NextRequest } = require('next/server');
const sdk = require('livekit-server-sdk');
const makeLoader = require('./test-support/load-typescript.cjs');
const cells = new Map(), buckets = new Map();
let redisOffline = false, grantMode = 'ok', verifyCalls = 0;
const rooms = new Map();
const get = key => { const cell = cells.get(key); if (cell && cell.expires > Date.now()) return cell.value; cells.delete(key); return null; };
const redis = {
  async get(key) { if (redisOffline) throw Error('offline'); return get(key); },
  async set(key, value, options) { if (redisOffline) throw Error('offline'); if (options.nx && get(key) !== null) return null; cells.set(key, { value, expires: Date.now() + options.ex * 1000 }); return 'OK'; },
  async eval(script, keys, args) {
    if (redisOffline) throw Error('offline');
    if (script.includes('discord2 verification')) {
      const ttl = key => Math.max(1, Math.ceil((cells.get(key).expires - Date.now()) / 1000));
      if (get(keys[1]) !== null) return [0, ttl(keys[1])];
      const used = Number(get(keys[0]) ?? 0);
      if (used >= Number(args[0])) return [0, ttl(keys[0])];
      cells.set(keys[0], { value: used + 1, expires: cells.get(keys[0])?.expires ?? Date.now() + Number(args[1]) * 1000 });
      cells.set(keys[1], { value: '1', expires: Date.now() + Number(args[2]) * 1000 });
      return [1, 0];
    }
    if (get(keys[0]) !== args[0]) return 0;
    if (script.includes('>= 20')) return get(keys[1]) === args[1] && keys.every(key => cells.get(key).expires - Date.now() >= 20_000) ? 1 : 0;
    if (script.includes('remaining >= 0')) return Math.floor((cells.get(keys[0]).expires - Date.now()) / 1000) <= Number(args[1]) ? 1 : 0;
    if (script.includes('"SET"')) { cells.set(keys[1], { value: args[0], expires: Date.now() + Number(args[1]) * 1000 }); return 1; }
    if (script.includes('and redis.call("GET", KEYS[2])')) { if (get(keys[1]) !== args[0]) return 0; return Number(cells.delete(keys[1])); }
    if (keys[1]) cells.delete(keys[1]);
    return Number(cells.delete(keys[0]));
  },
};
class Ratelimit {
  static fixedWindow(max, duration) { return { max, duration }; }
  constructor(options) { this.options = options; }
  async limit(key) {
    if (redisOffline) throw Error('offline');
    const { prefix, limiter } = this.options;
    const bucketKey = `${prefix}:${key}`;
    const count = (buckets.get(bucketKey) ?? 0) + 1;
    buckets.set(bucketKey, count);
    return { success: count <= limiter.max, reset: Date.now() + 60000, limit: limiter.max, remaining: Math.max(0, limiter.max - count), pending: Promise.resolve() };
  }
}
class RoomServiceClient {
  async createRoom() { return { maxParticipants: 6 }; }
  async listParticipants(id) { return structuredClone(rooms.get(id) ?? []); }
  async updateParticipant(id, identity, { permission }) {
    const person = rooms.get(id)?.find(p => p.identity === identity);
    if (permission.canPublish && grantMode === 'rejected') throw new sdk.ServerError('denied', 'test', 403, 'permission_denied');
    if (permission.canPublish && grantMode === 'timeout-viewer') throw new Error('timeout');
    if (person) person.permission = { ...permission };
    if (permission.canPublish && grantMode === 'lost-ack') throw new Error('lost ack');
    return person;
  }
}
const overrides = {
  'livekit-server-sdk': { ...sdk, RoomServiceClient },
  '@upstash/ratelimit': { Ratelimit },
  '@/lib/security/turnstile': { verifyTurnstileToken: async value => { verifyCalls++; return value.startsWith('valid-'); } },
  '@/lib/security/redis-client': { createSecurityRedis: () => redis },
};
// Os helpers usam imports relativos: ambos resolvem para o mesmo double.
overrides['./redis-client'] = overrides['@/lib/security/redis-client'];
const load = makeLoader(overrides);
const create = load('src/app/api/rooms/create/route.ts').POST;
const token = load('src/app/api/livekit/token/route.ts').POST;
const share = load('src/app/api/livekit/share/route.ts').POST;
// Outra instância de módulos, com os mesmos orçamentos externos simulados.
const tokenOther = makeLoader(overrides)('src/app/api/livekit/token/route.ts').POST;
const invite = load('src/lib/room/server-invite.ts');
const reservations = load('src/lib/security/redis-share-reservation.ts');
const secret = 'test-only-invite-secret';
const roomId = invite.createRoomInvite(secret);
function request(body, headers = {}) { return new NextRequest('https://discord2.test/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
async function jwt(identity, id = roomId) { const token = new sdk.AccessToken('test-key', 'test-secret', { identity }); token.addGrant({ roomJoin: true, room: id, canPublish: false }); return token.toJwt(); }
async function action(identity, operation = 'acquire') { return share(request({ roomId, action: operation }, { Authorization: `Bearer ${await jwt(identity)}` })); }
function bucket(suffix, key = 'global') { return buckets.get(`discord2:rate:${suffix}:${key}`) ?? 0; }
beforeEach(() => {
  cells.clear(); buckets.clear(); rooms.clear(); redisOffline = false; grantMode = 'ok'; verifyCalls = 0;
  process.env.LIVEKIT_URL = 'wss://test.invalid'; process.env.LIVEKIT_API_KEY = 'test-key'; process.env.LIVEKIT_API_SECRET = 'test-secret';
  process.env.ROOM_INVITE_SECRET = secret; process.env.ENABLE_SHARE_IN_PRODUCTION = 'true';
  rooms.set(roomId, ['a', 'b'].map(identity => ({ identity, permission: { canPublish: false }, tracks: [] })));
});

test('captcha inválido/replay com IPs forjados não consome emissão de convites', async () => {
  for (let i = 0; i < 25; i++) {
    const response = await create(request({ turnstileToken: 'bad-token' }, { 'x-forwarded-for': `10.0.0.${i}`, 'cf-connecting-ip': String(i) }));
    assert.equal(response.status, i === 0 ? 403 : 429);
  }
  assert.equal(verifyCalls, 1);
  assert.equal(bucket('create:v1'), 0);
  assert.equal((await create(request({ turnstileToken: 'valid-human' }))).status, 200);
  assert.equal(bucket('create:v1'), 1);
});

test('inundação de JSON/convites inválidos não consome cotas da sala nem globais', async () => {
  for (let i = 0; i < 65; i++) {
    assert.equal((await token(request({ roomId: 'a'.repeat(64), displayName: 'Teste' }))).status, 403);
    assert.equal((await token(request({ roomId, displayName: '' }))).status, 400);
  }
  assert.equal(bucket('token:global:v1'), 0);
  assert.equal(bucket('token:room:v1', roomId), 0);
  assert.equal((await token(request({ roomId, displayName: 'Humano' }))).status, 200);
});

test('limite distribuído por sala impede uma sala de drenar a cota global', async () => {
  for (let i = 0; i < 20; i++) assert.equal((await (i % 2 ? tokenOther : token)(request({ roomId, displayName: 'Teste' }))).status, 200);
  for (let i = 0; i < 70; i++) assert.equal((await tokenOther(request({ roomId, displayName: 'Teste' }))).status, 429);
  assert.equal(bucket('token:global:v1'), 20);
  assert.equal((await token(request({ roomId: invite.createRoomInvite(secret), displayName: 'Outro' }))).status, 200);
});

test('JWT inválido não consome global e abuso autenticado continua limitado por identidade', async () => {
  for (let i = 0; i < 125; i++) assert.equal((await share(request({ roomId, action: 'acquire' }, { Authorization: 'Bearer invalid' }))).status, 401);
  assert.equal(bucket('share:global:v1'), 0);
  for (let i = 0; i < 12; i++) assert.equal((await action('a')).status, 200);
  assert.equal((await action('a')).status, 429);
  assert.equal(bucket('share:global:v1'), 12);
  assert.equal((await action('a', 'release')).status, 200);
  assert.equal((await action('b')).status, 200);
});

test('falha Redis bloqueia emissão/aquisição; liberação autenticada continua possível', async () => {
  redisOffline = true;
  assert.equal((await token(request({ roomId, displayName: 'Teste' }))).status, 503);
  assert.equal((await create(request({ turnstileToken: 'valid-test' }))).status, 503);
  assert.equal((await action('a')).status, 503);
  const released = await action('a', 'release');
  assert.equal(released.status, 200);
  assert.equal((await released.json()).reservationHeld, true);
  assert.equal(rooms.get(roomId)[0].permission.canPublish, false);
});

test('rejeição explícita do grant devolve reserva e outro usuário pode transmitir', async () => {
  grantMode = 'rejected';
  assert.equal((await action('a')).status, 502);
  assert.equal(await reservations.getShareReservation(roomId), null);
  assert.equal(await reservations.hasPendingShareGrant(roomId, 'a'), false);
  grantMode = 'ok';
  assert.equal((await action('b')).status, 200);
});

test('ACK perdido com permissão confirmada retorna sucesso e preserva exclusividade', async () => {
  grantMode = 'lost-ack';
  assert.equal((await action('a')).status, 200);
  assert.equal(await reservations.getShareReservation(roomId), 'a');
  assert.equal((await action('b')).status, 409);
});

test('timeout ambíguo retém reserva inclusive após envelhecimento; dono pode cancelar', async () => {
  grantMode = 'timeout-viewer';
  const response = await action('a');
  assert.equal(response.status, 502);
  assert.equal((await response.json()).reservationHeld, true);
  cells.get(`discord2:room:publisher:v1:${roomId}`).expires -= 65_000;
  assert.equal((await action('b')).status, 409);
  assert.equal(await reservations.hasPendingShareGrant(roomId, 'a'), true);
  assert.equal((await action('a', 'release')).status, 200);
  assert.equal(await reservations.getShareReservation(roomId), null);
  assert.equal(await reservations.hasPendingShareGrant(roomId, 'a'), false);
});

test('marcador e reserva de outro dono não são removidos por liberação antiga', async () => {
  await reservations.reserveShare(roomId, 'b');
  await reservations.markShareGrantPending(roomId, 'b');
  assert.equal(await reservations.releaseShareReservation(roomId, 'a'), false);
  assert.equal(await reservations.getShareReservation(roomId), 'b');
  assert.equal(await reservations.hasPendingShareGrant(roomId, 'b'), true);
});

test('orçamento global de emissão continua limitado entre salas e instâncias', async () => {
  const ids = Array.from({ length: 4 }, () => invite.createRoomInvite(secret));
  for (let i = 0; i < 60; i++) assert.equal((await (i % 2 ? tokenOther : token)(request({ roomId: ids[Math.floor(i / 20)], displayName: 'Teste' }))).status, 200);
  assert.equal((await tokenOther(request({ roomId: ids[3], displayName: 'Teste' }))).status, 429);
});

test('tokens inválidos distintos têm orçamento de verificação separado e limitado', async () => {
  for (let i = 0; i < 600; i++) assert.equal((await create(request({ turnstileToken: `bad-${i}` }))).status, 403);
  assert.equal((await create(request({ turnstileToken: 'bad-over-budget' }))).status, 429);
  assert.equal(verifyCalls, 600);
  assert.equal(bucket('create:v1'), 0);
  assert.equal([...cells.keys()].filter(key => key.startsWith('discord2:rate:verify:token:v1:')).length, 600, 'acima da capacidade não cria novas chaves');
});
