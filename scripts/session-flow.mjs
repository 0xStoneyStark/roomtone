// Drives the session flow against a running server (start with SESSION_S=20 SESSIONS_PER_IP_PER_HOUR=2
// for a quick run): start the demo, watch judgments flow, see the session expire, resume once, then
// hit the per-address cap. Needs playwright (media/work has it): node scripts/session-flow.mjs
import { chromium } from "../media/work/node_modules/playwright/index.mjs";

const PAGE_URL = process.env.URL ?? "http://localhost:8790/?nogov";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
const api = [];
page.on("response", (res) => { if (res.url().includes("/api/")) api.push(`${res.request().method()} ${new URL(res.url()).pathname} ${res.status()}`); });
await page.goto(PAGE_URL, { waitUntil: "networkidle" });
const state = () => page.evaluate(() => ({
  status: [...document.querySelectorAll("#status [data-k]")].map((n) => n.textContent).join(" | "),
  resting: !document.getElementById("rest").hidden,
  restBody: document.getElementById("rest-body").textContent.slice(0, 90),
}));
const health = async () => (await (await page.request.get(`${new URL(PAGE_URL).origin}/api/health`)).json());
const sessionS = (await health()).session_s;
console.log(`server session_s=${sessionS}`);

await page.click("#start-demo");
await sleep(8000);
console.log("after 8 s:", await state());
await sleep((sessionS - 8 + 4) * 1000);
console.log(`after expiry (+${sessionS + 4} s):`, await state());
const calls1 = api.filter((l) => l.includes("/api/judge 200")).length;
await sleep(5000);
const calls2 = api.filter((l) => l.includes("/api/judge 200")).length;
console.log(`judge 200s while resting: ${calls2 - calls1} (over 5 s)`);
await page.click("#resume");
await sleep(6000);
console.log("after resume:", await state());
await sleep((sessionS - 6 + 4) * 1000);
console.log("after second expiry:", await state());
await page.click("#resume");
await sleep(2000);
console.log("after third start:", await state());
const codes = {};
for (const line of api) codes[line] = (codes[line] ?? 0) + 1;
console.log(codes);
await browser.close();
