import { test, expect } from "@playwright/test";

// IPC fixture only. These tests do not capture or publish any real media.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type Host = typeof globalThis & {
      isTauri: boolean;
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
      fixtureCalls: string[];
    };
    const host = globalThis as Host;
    host.isTauri = true;
    host.fixtureCalls = [];
    let phase = "idle";
    host.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        host.fixtureCalls.push(cmd);
        if (cmd === "list_targets")
          return [
            {
              id: "monitor:fixture",
              kind: "monitor",
              label: "Monitor de teste IPC",
              pid: null,
            },
          ];
        if (cmd === "start") {
          phase = "streaming";
          return;
        }
        if (cmd === "stop") {
          phase = "idle";
          return;
        }
        if (cmd === "snapshot")
          return {
            phase,
            message: phase === "streaming" ? "Sessão simulada IPC" : "Parado",
            captured: 0,
            submitted: 0,
            dropped: 0,
            capturedFps: 0,
            encodedFps: null,
            publishedFps: null,
            processingMs: 0,
            encoder: null,
            releaseConfirmed: null,
          };
        throw new Error("Unexpected IPC command");
      },
    };
  });
});

test("start, restart and stop reach native IPC in sequence", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Convite da sala")
    .fill(`https://fixture.invalid/sala/${"a".repeat(64)}`);
  await page.getByLabel("Seu nome", { exact: true }).fill("Fixture");
  await page.getByLabel("Tela ou janela").selectOption("monitor:fixture");
  await page.getByRole("button", { name: "Iniciar transmissão" }).click();
  await expect(page.getByText("Sessão simulada IPC")).toBeVisible();
  await expect(page.getByLabel("Tela ou janela")).toBeDisabled();
  await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          globalThis as unknown as { fixtureCalls: string[] }
        ).fixtureCalls.filter((c) => c === "start" || c === "stop"),
      ),
    )
    .toEqual(["start", "stop", "start"]);
  await page.getByRole("button", { name: "Parar", exact: true }).click();
  await expect(page.getByLabel("Tela ou janela")).toBeEnabled();
});

test("room conflict is displayed and controls recover", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const host = globalThis as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: unknown) => Promise<unknown>;
      };
    };
    const previous = host.__TAURI_INTERNALS__.invoke;
    host.__TAURI_INTERNALS__.invoke = (cmd, args) =>
      cmd === "start"
        ? Promise.reject("Outra pessoa está transmitindo nesta sala.")
        : previous(cmd, args);
  });
  await page
    .getByLabel("Convite da sala")
    .fill(`https://fixture.invalid/sala/${"a".repeat(64)}`);
  await page.getByLabel("Seu nome", { exact: true }).fill("Fixture");
  await page.getByLabel("Tela ou janela").selectOption("monitor:fixture");
  await page.getByRole("button", { name: "Iniciar transmissão" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Outra pessoa está transmitindo nesta sala.",
  );
  await expect(
    page.getByRole("button", { name: "Iniciar transmissão" }),
  ).toBeEnabled();
});
