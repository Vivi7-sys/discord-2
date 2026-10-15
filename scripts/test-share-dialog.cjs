/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS para executar o harness DOM sem alterar dependências do projeto. */
// Teste DOM isolado. Dependência de teste opcional, instalada fora do projeto:
// npm install --prefix /tmp/discord2-integration --no-audit --no-fund jsdom@26.1.0
// node scripts/test-share-dialog.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require(process.env.DISCORD2_JSDOM_MODULE || '/tmp/discord2-integration/node_modules/jsdom');
const dom = new JSDOM('<button id="trigger">Compartilhar tela</button><div id="root"></div>', { url: 'https://discord2.test' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Event', 'MouseEvent']) global[name] = dom.window[name];
Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'jsdom', mediaDevices: { getSupportedConstraints: () => ({}) } } });
global.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom não implementa top layer/foco preso do diálogo nativo. Esses itens exigem navegador real.
HTMLDialogElement.prototype.showModal = function () { this.open = true; this.querySelector('select')?.focus(); };
HTMLDialogElement.prototype.close = function () { this.open = false; };
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const file = path.resolve('src/components/room/ShareDialog.tsx');
const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const moduleObject = { exports: {} };
new Function('require', 'module', 'exports', source)(require, moduleObject, moduleObject.exports);
const Dialog = moduleObject.exports.default;
(async () => {
  const root = createRoot(document.getElementById('root'));
  const trigger = document.getElementById('trigger');
  let starts = 0, cancels = 0, quality, audio;
  const props = { audioMode: 'browser', qualityProfile: 'alta', canStart: true,
    onStart: () => { starts++; }, onCancel: () => { cancels++; },
    onQualityProfileChange: value => { quality = value; }, onAudioModeChange: value => { audio = value; } };
  trigger.focus();
  await act(async () => root.render(React.createElement(Dialog, props)));
  assert.equal(starts, 0, 'abrir não inicia captura');
  assert.equal(document.querySelector('dialog').open, true);
  assert.equal(document.activeElement, document.querySelector('select'));
  assert.equal(document.querySelectorAll('option').length, 7);
  const selects = document.querySelectorAll('select');
  assert.equal(selects[0].value, 'alta');
  assert.equal(selects[0].options.length, 4);
  assert.equal(selects[0].options[3].textContent, 'Máxima qualidade — 1080p / até 60 FPS');
  await act(async () => { selects[0].value = 'maxima'; selects[0].dispatchEvent(new Event('change', { bubbles: true })); selects[1].value = 'none'; selects[1].dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(quality, 'maxima'); assert.equal(audio, 'none');
  await act(async () => document.querySelector('dialog').dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true })));
  assert.equal(cancels, 1); assert.equal(starts, 0);
  const buttons = document.querySelectorAll('dialog button');
  await act(async () => buttons[0].click());
  assert.equal(cancels, 2); assert.equal(starts, 0);
  await act(async () => buttons[1].click()); assert.equal(starts, 1);
  await act(async () => root.render(React.createElement(Dialog, { ...props, canStart: false })));
  assert.equal(document.querySelectorAll('dialog button')[1].disabled, true);
  await act(async () => root.unmount());
  assert.equal(document.activeElement, trigger);
  console.log('PASS: abertura sem captura, opções, eventos de cancelar/Escape, iniciar, bloqueio por permissão e restauração de foco (DOM simulado).');
})().catch(error => { console.error(error); process.exitCode = 1; });
