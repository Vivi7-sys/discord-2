import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
test("packaged visual primitives exactly match the source website", () => {
  assert.equal(read("../src/site.css"), read("../../../src/app/globals.css"));
  assert.equal(
    read("../src/RoomIcon.tsx"),
    read("../../../src/components/room/RoomIcon.tsx"),
  );
});
test("desktop payload denies remote pages and includes no Python sidecar", () => {
  const conf = JSON.parse(read("../src-tauri/tauri.conf.json"));
  assert.equal(conf.build.frontendDist, "../dist");
  assert.equal(conf.app.windows[0].url, undefined);
  assert.ok(conf.app.security.csp.includes("frame-src 'none'"));
  assert.equal(conf.bundle.externalBin, undefined);
});
