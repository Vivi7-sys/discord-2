import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.goto("http://127.0.0.1:3191/", {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await mkdir("evidence", { recursive: true });
  await page.screenshot({
    path: "evidence/linux-local-site.png",
    fullPage: true,
  });
  const computed = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    const root = getComputedStyle(document.documentElement);
    return {
      source: "local Next.js source, not deployed Render page",
      platform: navigator.platform,
      font: style.fontFamily,
      tokens: Object.fromEntries(
        [
          "--bg",
          "--surface",
          "--surface-2",
          "--border",
          "--text",
          "--muted",
          "--accent",
          "--radius",
        ].map((key) => [key, root.getPropertyValue(key).trim()]),
      ),
    };
  });
  await writeFile(
    "evidence/site-comparison.json",
    JSON.stringify(computed, null, 2) + "\n",
  );
  console.log("Local site screenshot and computed tokens saved.");
} finally {
  await browser.close();
}
