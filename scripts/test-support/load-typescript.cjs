/* eslint-disable @typescript-eslint/no-require-imports -- Harness Node sem dependências adicionais. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Executa os módulos reais em memória; permite doubles nas fronteiras externas.
module.exports = function makeLoader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const resolve = id => {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      if (!id.startsWith('.') && !id.startsWith('@/')) return require(id);
      const base = id.startsWith('@/') ? path.resolve('src', id.slice(2)) : path.resolve(path.dirname(file), id);
      return load(base + (fs.existsSync(base + '.ts') ? '.ts' : '.tsx'));
    };
    new Function('require', 'module', 'exports', code)(resolve, mod, mod.exports);
    return mod.exports;
  }
  return load;
};
