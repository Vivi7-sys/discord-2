import { test, expect } from "@playwright/test";
// UI contract only; this fixture is never counted as real media validation.
test("Linux shows portal choices and explicitly disables unsupported isolation", async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { value: "Linux x86_64" });
    const host = globalThis as unknown as { isTauri: boolean; __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } };
    host.isTauri = true;
    host.__TAURI_INTERNALS__ = { invoke: async (command) => {
      if (command === "list_targets") return [
        { id: "portal:monitor", label: "Escolher monitor no portal do sistema…", kind: "monitor", pid: null },
        { id: "portal:window", label: "Escolher janela no portal do sistema…", kind: "window", pid: null },
      ];
      if (command === "snapshot") return {phase:"idle",message:"Pronto para conectar",captured:0,submitted:0,dropped:0,capturedFps:0,encodedFps:null,publishedFps:null,processingMs:0,encoder:null,releaseConfirmed:null};
      throw new Error("No media implementation in the UI fixture");
    }};
  });
  await page.goto("/", { waitUntil:"domcontentloaded" });
  await expect(page.locator('option[value="portal:monitor"]')).toHaveCount(1);
  await expect(page.locator('option[value="portal:window"]')).toHaveCount(1);
  await expect(page.locator('option[value="application"]')).toHaveJSProperty("disabled", true);
  await expect(page.locator('option[value="exclude"]')).toHaveJSProperty("disabled", true);
  await expect(page.locator('option[value="exclude"]')).toContainText("indisponível no Linux");
  await page.getByLabel("O que seus amigos vão ouvir").selectOption("system");
  await expect(page.getByText("Monitor da saída do sistema, sem microfone.", { exact:false })).toBeVisible();
  await page.screenshot({ path:"evidence/linux-ui-ipc-fixture.png",fullPage:true });
});
