import { test, expect } from "@playwright/test";
test("preview does not impersonate native capture", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Compartilhe o momento." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Iniciar transmissão" }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Prévia visual · abra o aplicativo no Windows para transmitir",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1080p 60 FPS" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: `evidence/${process.platform}-browser-desktop.png`,
    fullPage: true,
  });
});
test("audio modes and diagnostic unavailable values", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("O que seus amigos vão ouvir")
    .selectOption("application");
  await expect(page.getByLabel("Aplicativo", { exact: true })).toBeVisible();
  await page.getByLabel("O que seus amigos vão ouvir").selectOption("exclude");
  await expect(
    page.getByText("Exclusão por processo.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Diagnósticos", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Diagnósticos da sessão" }),
  ).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: "—" })).toHaveCount(4);
});
test("layout and controls fit desktop sizes", async ({ page }) => {
  for (const [width, height] of [
    [1120, 820],
    [800, 600],
    [740, 600],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Iniciar transmissão" }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
});
test("all assets are local and reduced motion is respected", async ({
  page,
}) => {
  const remote: string[] = [];
  page.on("request", (req) => {
    if (!req.url().startsWith("http://127.0.0.1:5173")) remote.push(req.url());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(remote).toEqual([]);
  expect(
    await page
      .getByRole("button", { name: "720p 30 FPS" })
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
});
