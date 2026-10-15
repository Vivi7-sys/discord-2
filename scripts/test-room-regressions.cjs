/* eslint-disable @typescript-eslint/no-require-imports -- Regressões React/DOM sem dependências de produção. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { JSDOM } = require(process.env.DISCORD2_JSDOM_MODULE || '/tmp/discord2-integration/node_modules/jsdom');
const makeLoader = require('./test-support/load-typescript.cjs');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://discord2.test', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Event', 'KeyboardEvent']) global[name] = dom.window[name];
global.IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const sdk = require('livekit-client');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
let currentRoom, audioRequests, enumeration, release, publishedAudio, audioPublication, unpublishedAudio;
function track(kind = 'video', label = 'Screen Share Audio') {
  const native = new dom.window.EventTarget();
  native.readyState = 'live'; native.label = label;
  native.stop = () => { native.readyState = 'ended'; };
  return { source: kind === 'video' ? sdk.Track.Source.ScreenShare : sdk.Track.Source.ScreenShareAudio,
    mediaStreamTrack: native, stop: native.stop, attach() {}, detach() {} };
}
class FakeRoom extends EventEmitter {
  constructor() {
    super();
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Expõe a sala simulada para os gestos de regressão.
    currentRoom = this;
    this.state = sdk.ConnectionState.Disconnected; this.options = {}; this.remoteParticipants = new Map();
    this.localParticipant = {
      identity: 'test', permissions: { canPublish: true }, trackPublications: new Map(), isScreenShareEnabled: false,
      getTrackPublication: source => source === sdk.Track.Source.ScreenShare && this.localParticipant.isScreenShareEnabled ? { videoTrack: this.video } : undefined,
      createScreenTracks: async () => { this.video = track(); return [this.video]; },
      publishTrack: async item => {
        if (item.source === sdk.Track.Source.ScreenShare) this.localParticipant.isScreenShareEnabled = true;
        else { if (audioPublication) await audioPublication.promise; publishedAudio.push(item); }
        this.emit(sdk.RoomEvent.LocalTrackPublished, { source: item.source });
      },
      unpublishTrack: async item => {
        if (item.source === sdk.Track.Source.ScreenShare) this.localParticipant.isScreenShareEnabled = false;
        else unpublishedAudio.push(item);
        this.emit(sdk.RoomEvent.LocalTrackUnpublished, { source: item.source });
      },
    };
  }
  async connect() { this.state = sdk.ConnectionState.Connected; }
  async disconnect() { this.state = sdk.ConnectionState.Disconnected; }
}
const overrides = {
  'livekit-client': { ...sdk, Room: FakeRoom },
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
  './ParticipantList': { __esModule: true, default: () => null },
  './RemoteScreenAudio': { __esModule: true, default: () => null },
  './RoomInvite': { __esModule: true, default: () => null },
};
const load = makeLoader(overrides);
const App = load('src/components/room/LiveKitRoomConnection.tsx').default;
function click(selector) { const element = document.querySelector(selector); assert.ok(element, selector); element.click(); return element; }
async function mount() {
  audioRequests = []; publishedAudio = []; unpublishedAudio = []; enumeration = null; release = null; audioPublication = null;
  Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'jsdom', mediaDevices: {
    getSupportedConstraints: () => ({}),
    enumerateDevices: async () => enumeration ? enumeration.promise : [{ kind: 'audioinput', deviceId: 'virtual', label: 'Screen Share Audio' }],
    getUserMedia: options => { assert.deepEqual(options.audio.deviceId, { exact: 'virtual' }); const request = deferred(); audioRequests.push(request); return request.promise; },
  } } });
  global.fetch = async (url, options) => {
    if (url.endsWith('/token')) return Response.json({ token: 'test', serverUrl: 'wss://test.invalid' });
    const { action } = JSON.parse(options.body);
    if (action === 'release' && release) await release.promise;
    currentRoom.localParticipant.permissions.canPublish = action === 'acquire';
    currentRoom.emit(sdk.RoomEvent.ParticipantPermissionsChanged);
    return Response.json({ ok: true });
  };
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(App, { roomId: 'a'.repeat(64), profile: { displayName: 'Teste', avatar: null } })));
  return root;
}
async function shareLinux() {
  const request = document.querySelector('button[aria-label="Solicitar transmissão"]');
  if (request) await act(async () => request.click());
  await act(async () => click('button[aria-label="Compartilhar tela"]'));
  const audio = document.querySelectorAll('dialog select')[1];
  await act(async () => { audio.value = 'linux-virtual'; audio.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => click('dialog .btn-primary'));
}
function audioStream(label) { const audio = track('audio', label).mediaStreamTrack; return { audio, stream: { getAudioTracks: () => [audio], getTracks: () => [audio] } }; }

test('Parar interrompe vídeo antes da rede e descarta áudio que chega após nova transmissão', async () => {
  const root = await mount();
  try {
    await shareLinux();
    assert.equal(audioRequests.length, 1);
    const oldVideo = currentRoom.video;
    const stop = document.querySelector('button[aria-label="Parar transmissão"]');
    assert.equal(stop.disabled, false);
    release = deferred();
    await act(async () => stop.click());
    assert.equal(oldVideo.mediaStreamTrack.readyState, 'ended');
    release.resolve(); await act(async () => {}); release = null;
    await shareLinux();
    const late = audioStream();
    await act(async () => audioRequests[0].resolve(late.stream));
    assert.equal(late.audio.readyState, 'ended');
    assert.equal(publishedAudio.length, 0);
    const current = audioStream();
    await act(async () => audioRequests[1].resolve(current.stream));
    assert.equal(publishedAudio.length, 1);
    await act(async () => click('button[aria-label="Parar transmissão"]'));
    assert.equal(current.audio.readyState, 'ended');
  } finally { await act(async () => root.unmount()); }
});

test('Parar durante enumerateDevices impede abrir uma entrada tardia', async () => {
  const root = await mount();
  try {
    enumeration = deferred();
    await shareLinux();
    await act(async () => click('button[aria-label="Parar transmissão"]'));
    await act(async () => enumeration.resolve([{ kind: 'audioinput', deviceId: 'virtual', label: 'Screen Share Audio' }]));
    assert.equal(audioRequests.length, 0);
  } finally { await act(async () => root.unmount()); }
});

for (const cause of ['disconnect', 'revoke', 'browser-stop']) {
  test(`áudio autorizado após ${cause} é parado sem publicação`, async () => {
    const root = await mount();
    try {
      await shareLinux();
      await act(async () => {
        if (cause === 'disconnect') { currentRoom.state = sdk.ConnectionState.Disconnected; currentRoom.emit(sdk.RoomEvent.Disconnected); }
        else if (cause === 'revoke') { currentRoom.localParticipant.permissions.canPublish = false; currentRoom.emit(sdk.RoomEvent.ParticipantPermissionsChanged); }
        else currentRoom.video.mediaStreamTrack.dispatchEvent(new Event('ended'));
      });
      const late = audioStream();
      await act(async () => audioRequests[0].resolve(late.stream));
      assert.equal(late.audio.readyState, 'ended');
      assert.equal(publishedAudio.length, 0);
    } finally { await act(async () => root.unmount()); }
  });
}

test('reserva incerta permite Cancelar vez sem fingir permissão de publicar', async () => {
  const root = await mount();
  try {
    await act(async () => { currentRoom.localParticipant.permissions.canPublish = false; currentRoom.emit(sdk.RoomEvent.ParticipantPermissionsChanged); });
    const previousFetch = global.fetch;
    global.fetch = async (url, options) => JSON.parse(options.body).action === 'acquire'
      ? Response.json({ error: 'resultado incerto', reservationHeld: true }, { status: 502 }) : previousFetch(url, options);
    await act(async () => click('button[aria-label="Solicitar transmissão"]'));
    assert.equal(document.querySelector('button[aria-label="Compartilhar tela"]'), null);
    await act(async () => click('button[aria-label="Cancelar vez"]'));
    assert.equal(document.querySelector('button[aria-label="Cancelar vez"]'), null);
  } finally { await act(async () => root.unmount()); }
});

test('timer oculta sem foco; Tab, teclado e foco nos botões preservam acesso; mouse/toque revelam', async () => {
  const originalTimeout = global.setTimeout, originalClear = global.clearTimeout;
  const timers = new Set();
  global.setTimeout = (callback, ms, ...args) => { if (ms !== 3000) return originalTimeout(callback, ms, ...args); const timer = { callback }; timers.add(timer); return timer; };
  global.clearTimeout = timer => { if (!timers.delete(timer)) originalClear(timer); };
  const css = fs.readFileSync('src/app/globals.css', 'utf8');
  assert.equal((css.match(/^\.room \.stream\.stream-active\.stream-controls-hidden/gm) ?? []).length, 1, 'uma única regra de ocultação');
  const block = css.slice(css.indexOf('/* Ocultação única:'), css.indexOf('.share-dialog {'));
  const style = document.createElement('style'); style.textContent = block; document.head.append(style);
  const root = await mount();
  try {
    await shareLinux();
    const section = document.querySelector('.stream-active');
    const bar = section.querySelector('.stream-player-bar');
    section.querySelector('button')?.blur();
    await act(async () => { for (const timer of [...timers]) { timers.delete(timer); timer.callback(); } });
    assert.ok(section.classList.contains('stream-controls-hidden'));
    assert.equal(window.getComputedStyle(bar).visibility, 'hidden');
    assert.equal(section.tabIndex, 0, 'área permanece no percurso de Tab');
    await act(async () => section.focus());
    assert.equal(window.getComputedStyle(bar).visibility, 'visible');
    await act(async () => section.querySelector('button').focus());
    await act(async () => { for (const timer of [...timers]) { timers.delete(timer); timer.callback(); } });
    assert.notEqual(window.getComputedStyle(bar).opacity, '0');
    assert.equal(window.getComputedStyle(bar).visibility, 'visible');
    await act(async () => section.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    assert.equal(section.classList.contains('stream-controls-hidden'), false);
    for (const eventName of ['mousemove', 'touchstart']) {
      document.activeElement.blur();
      await act(async () => { for (const timer of [...timers]) { timers.delete(timer); timer.callback(); } });
      await act(async () => section.dispatchEvent(eventName === 'mousemove' ? new window.MouseEvent(eventName, { bubbles: true, clientX: 40, clientY: 40 }) : new Event(eventName, { bubbles: true })));
      assert.equal(section.classList.contains('stream-controls-hidden'), false);
    }
  } finally {
    await act(async () => root.unmount()); style.remove();
    global.setTimeout = originalTimeout; global.clearTimeout = originalClear;
  }
});


test('Parar também funciona enquanto a publicação de áudio confirmada aguarda o SDK', async () => {
  const root = await mount();
  try {
    await shareLinux();
    const captured = audioStream('default');
    await act(async () => audioRequests[0].resolve(captured.stream));
    audioPublication = deferred();
    await act(async () => click('.audio-verification .btn-primary'));
    assert.equal(document.querySelector('button[aria-label="Parar transmissão"]').disabled, false);
    await act(async () => click('button[aria-label="Parar transmissão"]'));
    assert.equal(captured.audio.readyState, 'ended');
    audioPublication.resolve();
    await act(async () => {});
    assert.ok(unpublishedAudio.includes(captured.audio));
  } finally { await act(async () => root.unmount()); }
});


test('resposta HTTP perdida mantém Cancelar vez; rejeição conhecida não inventa reserva', async () => {
  const root = await mount();
  try {
    await act(async () => { currentRoom.localParticipant.permissions.canPublish = false; currentRoom.emit(sdk.RoomEvent.ParticipantPermissionsChanged); });
    const previousFetch = global.fetch;
    global.fetch = async () => Response.json({ error: 'inválido' }, { status: 403 });
    await act(async () => click('button[aria-label="Solicitar transmissão"]'));
    assert.equal(document.querySelector('button[aria-label="Cancelar vez"]'), null);
    global.fetch = async () => { throw new Error('resposta perdida'); };
    await act(async () => click('button[aria-label="Solicitar transmissão"]'));
    assert.ok(document.querySelector('button[aria-label="Cancelar vez"]'));
    global.fetch = previousFetch;
    await act(async () => click('button[aria-label="Cancelar vez"]'));
    assert.equal(document.querySelector('button[aria-label="Cancelar vez"]'), null);
  } finally { await act(async () => root.unmount()); }
});


test('revogação com limpeza Redis pendente mantém Cancelar vez para repetir', async () => {
  const root = await mount();
  try {
    // Faz uma aquisição explícita para registrar a reserva neste cliente.
    await act(async () => { currentRoom.localParticipant.permissions.canPublish = false; currentRoom.emit(sdk.RoomEvent.ParticipantPermissionsChanged); });
    await act(async () => click('button[aria-label="Solicitar transmissão"]'));
    const previousFetch = global.fetch;
    global.fetch = async (url, options) => {
      const response = await previousFetch(url, options);
      return JSON.parse(options.body).action === 'release'
        ? Response.json({ ok: true, reservationHeld: true }) : response;
    };
    await act(async () => click('button[aria-label="Cancelar vez"]'));
    assert.ok(document.querySelector('button[aria-label="Cancelar vez"]'));
    global.fetch = previousFetch;
    await act(async () => click('button[aria-label="Cancelar vez"]'));
    assert.equal(document.querySelector('button[aria-label="Cancelar vez"]'), null);
  } finally { await act(async () => root.unmount()); }
});
