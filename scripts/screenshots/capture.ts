/**
 * Regenerates the README images from the real UI. Vite serves the app with the Tauri
 * bindings swapped for a scripted, fictional debate (scripts/screenshots/mock), and a
 * system browser drives it: Edge on Windows, Chrome elsewhere (BROWSER_CHANNEL overrides).
 *
 *   pnpm screenshots
 */
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { createServer } from "vite";
import { PARTICIPANTS } from "./fixture";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ASSETS = `${ROOT}.github/assets`;
const SHOTS = `${ASSETS}/screenshots`;

const SETTINGS = {
  llm: { preset: "ollama", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b", reasoning: "none" },
  asr: { preset: "whisperLocal", baseURL: "http://127.0.0.1:8765/v1", model: "large-v3-turbo", language: "pt" },
  search: { provider: "duckduckgo", googleCx: "" },
  voice: { voiceModel: "3dspeaker-campplus", threshold: 0.55, maxSpeakers: 4, captureFaces: true },
  source: { kind: "url", url: "https://www.youtube.com/live/debate-vila-aurora", speed: 1 },
  participants: PARTICIPANTS,
};

async function playDemo(browser: Browser, base: string, colorScheme: "dark" | "light"): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme, deviceScaleFactor: 1 });
  await page.addInitScript((s) => localStorage.setItem("treta.settings.v1", s), JSON.stringify(SETTINGS));
  await page.goto(base);
  await page.getByRole("button", { name: "Iniciar" }).click();
  // Every check judged and the leader crowned: the state the README describes.
  await page.getByText("6 concluídas · 0 em andamento").waitFor({ timeout: 120_000 });
  await page.locator(".crown").waitFor();
  await page.getByText(/salvo/).first().waitFor({ timeout: 15_000 });
  return page;
}

async function dialogShot(page: Page, open: () => Promise<void>, file: string, ready?: (dialog: Locator) => Locator) {
  await open();
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor();
  if (ready) await ready(dialog).first().waitFor({ state: "attached", timeout: 30_000 });
  await dialog.screenshot({ path: `${SHOTS}/${file}` });
  await page.keyboard.press("Escape");
}

async function features(page: Page) {
  const feed = page.locator("section[aria-labelledby='h-feed']");
  const doubtful = page.locator(".turn", { has: page.locator(".hint.uncertain") }).first();
  await doubtful.scrollIntoViewIfNeeded();
  await doubtful.getByRole("button", { name: "trocar falante" }).click();
  await feed.screenshot({ path: `${SHOTS}/review.png` });
  await page.keyboard.press("Escape");

  const lie = page.locator("article.check", { has: page.locator(".stamp[data-v='falso']") });
  await lie.scrollIntoViewIfNeeded();
  await page.locator("aside").screenshot({ path: `${SHOTS}/checks.png` });

  await dialogShot(page, () => page.getByRole("button", { name: "Editar Helena" }).click(), "speaker.png");
  await dialogShot(page, () => page.getByRole("button", { name: "Melhores momentos" }).click(), "moments.png", (d) => d.getByText("Momento mais quente"));
  await dialogShot(page, () => page.getByRole("button", { name: "Configurar" }).click(), "settings.png", (d) => d.locator("option[value='qwen3.5:9b']"));
}

/** 1280x640 banner (also GitHub's social preview size): name, promise and the real screen. */
async function header(browser: Browser) {
  const shot = readFileSync(`${SHOTS}/home-dark.png`).toString("base64");
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:640px;overflow:hidden;
    background:radial-gradient(circle at 15% 20%,#3b1d1d 0,#0f1115 55%);font-family:'Segoe UI',system-ui,sans-serif;color:#f5f1e8">
    <div style="position:absolute;left:64px;top:150px;width:470px">
      <div style="font-size:22px;letter-spacing:.18em;color:#f2c14e;font-weight:700">● AO VIVO</div>
      <div style="font-size:76px;font-weight:800;line-height:1.02;margin-top:14px">Treta<br>ao Vivo</div>
      <div style="font-size:30px;line-height:1.3;margin-top:22px;color:#cfc8bb">Quem disse o quê, quem mentiu e quem atacou a pessoa, enquanto o debate acontece.</div>
    </div>
    <img src="data:image/png;base64,${shot}" style="position:absolute;left:580px;top:114px;width:660px;border-radius:12px;
      box-shadow:0 30px 80px rgba(0,0,0,.6);border:1px solid #2c2f36"></body></html>`);
  await page.screenshot({ path: `${ASSETS}/readme-header.png` });
  await page.close();
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const server = await createServer({ configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)) });
  await server.listen();
  const base = `http://localhost:${server.config.server.port}/`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chrome") });
  try {
    const dark = await playDemo(browser, base, "dark");
    await dark.screenshot({ path: `${SHOTS}/home-dark.png` });
    await features(dark);
    const light = await playDemo(browser, base, "light");
    await light.screenshot({ path: `${SHOTS}/home-light.png` });
    await header(browser);
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(`screenshots written to ${SHOTS}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
