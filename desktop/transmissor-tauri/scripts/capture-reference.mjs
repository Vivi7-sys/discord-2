import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const proxyValue = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const endpoint = proxyValue ? new URL(proxyValue) : null;
const browser = await chromium.launch(
  endpoint
    ? {
        proxy: {
          server: `${endpoint.protocol}//${endpoint.host}`,
          username: decodeURIComponent(endpoint.username),
          password: decodeURIComponent(endpoint.password),
        },
      }
    : {},
);
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.goto("https://discord-2-kuau.onrender.com/", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: "evidence/reference-render-site.png",
    fullPage: true,
  });
  const computed = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      source: location.href,
      platform: navigator.platform,
      font: getComputedStyle(document.body).fontFamily,
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
    "evidence/reference-render-site.json",
    JSON.stringify(computed, null, 2) + "\n",
  );
  console.log("Published site reference captured read-only.");
} finally {
  await browser.close();
}
