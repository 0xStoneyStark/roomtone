// Roomtone server: serves the page and proxies one endpoint to TypeSafe so the
// API key and the question set stay on this side of the network. With a
// certificate in cert/ (see `npm run cert`) it also listens on https, which
// phones need before they will hand over the microphone.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { APIError, TypeSafeClient } from "@typesafe-ai/sdk";
import { QUESTION_SETS, SOUND_FIELDS } from "./questions.mjs";

// .env next to this file, if present (Node 20.12+); real environment variables win.
try {
  process.loadEnvFile(fileURLToPath(new URL("./.env", import.meta.url)));
} catch {
  // no .env: fine when the variables come from the environment
}

const PORT = Number(process.env.PORT) || 8790;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || PORT + 1;
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const CERT_DIR = fileURLToPath(new URL("./cert/", import.meta.url));
// Pinned rather than the `jev-latest` alias: during a TypeSafe overload on 21 Sep 2026 the alias
// itself intermittently failed to resolve ("Unknown model: jev-latest"). Override with JEV_MODEL.
const MODEL = process.env.JEV_MODEL || "jev-1.13.0";
// Overload (529) and 5xx are retried here so the browser sees fewer transient failures.
const RETRY = { maxRetries: 4, backoffInitialMs: 600, backoffMaxMs: 6000 };
const MAX_BODY_BYTES = 8 * 1024;
const MAX_FIELD_CHARS = 160;
const MAX_NOTE_CHARS = 200;
const RATE_LIMIT_PER_MIN = 300; // the live loop peaks at 150/min; the rest is headroom for the taste calls
// Behind Cloudflare / a reverse proxy every socket is local; TRUST_PROXY=1 reads the forwarded client IP instead.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
// Hard ceiling on what all visitors together can spend, per rolling hour. 8M tokens ≈ $0.34 at list price.
const TOKEN_BUDGET_PER_HOUR = Number(process.env.TOKEN_BUDGET_PER_HOUR) || 8_000_000;
// Each press of Start opens a session: a token the browser sends with every judgment, good for
// SESSION_S seconds. An address gets SESSIONS_PER_IP_PER_HOUR of them, so the browser's timer is
// a mirror of a limit the server owns. (The page's copy says "2½ minutes": change both together.)
const SESSION_S = Number(process.env.SESSION_S) || 150;
const SESSIONS_PER_IP_PER_HOUR = Number(process.env.SESSIONS_PER_IP_PER_HOUR) || 6;
// What people try, in words only: the note they typed, the ear's descriptors, Jev's picks, mic or
// demo, country and device. No audio ever reaches the server; addresses are stored hashed.
const DATA_DIR = process.env.DATA_DIR || fileURLToPath(new URL("./data/", import.meta.url));
const LOG_FILE = join(DATA_DIR, "sessions.jsonl");
const IP_SALT = process.env.IP_SALT || "roomtone";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
};

// Sent with every response. The CSP allows only this origin's scripts (plus the nonce'd import
// map), Google Fonts, and blob/data images for the frame export.
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "microphone=(self), camera=(), geolocation=()",
};
const csp = (nonce) =>
  `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' https://fonts.googleapis.com; ` +
  "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

// Build id from the public files, baked into index.html's asset URLs. Cloudflare caches .js/.css at
// the edge for hours regardless of origin no-cache, so every deploy must change the URLs.
const BUILD = createHash("sha1")
  .update(readdirSync(PUBLIC_DIR).map((f) => `${f}:${statSync(join(PUBLIC_DIR, f)).size}:${statSync(join(PUBLIC_DIR, f)).mtimeMs}`).join("|"))
  .digest("hex")
  .slice(0, 10);

const hasKey = Boolean(process.env.TYPESAFE_API_KEY);
const client = hasKey ? new TypeSafeClient({ model: MODEL, retry: RETRY }) : null;
if (!hasKey) {
  console.warn("TYPESAFE_API_KEY is not set: the page will run but Jev calls will fail with 503.");
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "?";
}

/** Fixed-window per-IP limiter; enough to keep a stray tab from burning the key. */
const windows = new Map();
function rateLimited(ip) {
  const now = Date.now();
  for (const [key, w] of windows) if (now - w.start > 120_000) windows.delete(key);
  const w = windows.get(ip);
  if (!w || now - w.start > 60_000) {
    windows.set(ip, { start: now, count: 1 });
    return false;
  }
  w.count += 1;
  return w.count > RATE_LIMIT_PER_MIN;
}

/** Rolling-hour token ledger across every visitor, so a public deployment has a known worst-case bill. */
const spend = []; // { t, tokens }
function tokensThisHour(now) {
  while (spend.length && now - spend[0].t > 3_600_000) spend.shift();
  return spend.reduce((sum, s) => sum + s.tokens, 0);
}

/** One line per event in data/sessions.jsonl; a failing disk is logged, never fatal. */
let logChain = mkdir(DATA_DIR, { recursive: true }).catch((err) => console.error(`[log] cannot create ${DATA_DIR}: ${err.message}`));
function logEvent(event) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...event }) + "\n";
  logChain = logChain.then(() => appendFile(LOG_FILE, line)).catch((err) => console.error(`[log] ${err.message}`));
}

const hashIp = (ip) => createHash("sha256").update(IP_SALT + ip).digest("hex").slice(0, 16);
const deviceOf = (ua = "") => (/Mobi|Android|iPhone|iPad/i.test(ua) ? "phone" : "desktop");

const sessions = new Map(); // id → { id, ip, startedAt, expiresAt, calls, taste, tokens }
const sessionStarts = new Map(); // ip → start times within the last hour

function startsThisHour(ip, now) {
  const list = (sessionStarts.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  sessionStarts.set(ip, list);
  return list;
}

/** A press of Start. Returns { session } or { error: { status, body } }. */
function openSession(req, body) {
  const ip = clientIp(req);
  const now = Date.now();
  const starts = startsThisHour(ip, now);
  if (starts.length >= SESSIONS_PER_IP_PER_HOUR) {
    const retryS = Math.ceil((starts[0] + 3_600_000 - now) / 1000);
    return { error: { status: 429, body: { error: `This connection has had its ${SESSIONS_PER_IP_PER_HOUR} starts for the hour — Jev is back in about ${Math.max(1, Math.ceil(retryS / 60))} minutes.`, code: "sessions_exhausted", retry_s: retryS } } };
  }
  starts.push(now);
  const id = randomBytes(12).toString("hex");
  const session = { id, ip, startedAt: now, expiresAt: now + SESSION_S * 1000, calls: 0, taste: 0, tokens: 0 };
  sessions.set(id, session);
  const source = body?.source === "mic" || body?.source === "demo" ? body.source : "unknown";
  logEvent({ type: "session", session: id, ip: hashIp(ip), country: req.headers["cf-ipcountry"] ?? null, device: deviceOf(req.headers["user-agent"]), source });
  return { session };
}

function closeSession(session, reason) {
  sessions.delete(session.id);
  logEvent({ type: "end", session: session.id, reason, seconds: Math.round((Date.now() - session.startedAt) / 1000), calls: session.calls, taste: session.taste, tokens: session.tokens });
}

setInterval(() => {
  const now = Date.now();
  for (const session of sessions.values()) if (now >= session.expiresAt) closeSession(session, "expired");
  for (const [ip, list] of sessionStarts) if (!list.some((t) => now - t < 3_600_000)) sessionStarts.delete(ip);
}, 15_000).unref();

/** Jev's headline answer per question, for the log: the choice, the score, or the yes-probability. */
function picksOf(answers) {
  return Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.type === "choice" ? a.choice : a.type === "score" ? Math.round(a.score * 10) / 10 : Math.round(a.noul * 100) / 100]));
}

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Build the Jev state and pick the question set from the browser's request; rejects anything off-shape. */
function buildRequest(body) {
  if (!body || typeof body !== "object" || !body.sound || typeof body.sound !== "object") {
    throw new Error("expected { sound: {...}, set?, note?, local_time? }");
  }
  const set = body.set ?? "all";
  if (!Object.hasOwn(QUESTION_SETS, set)) throw new Error(`set must be one of ${Object.keys(QUESTION_SETS).join(", ")}`);
  const sound = {};
  for (const key of SOUND_FIELDS[set]) {
    const text = cleanText(body.sound[key], MAX_FIELD_CHARS);
    if (!text) throw new Error(`sound.${key} must be a non-empty string`);
    sound[key] = text;
  }
  // The pulse set may carry the description from when the current picture was chosen, so Jev can
  // judge whether the music has turned since.
  const before = {};
  if (set === "pulse" && body.before && typeof body.before === "object") {
    for (const key of SOUND_FIELDS.pulse) {
      const text = cleanText(body.before[key], MAX_FIELD_CHARS);
      if (text) before[key] = text;
    }
  }
  const state = set === "pulse"
    ? { sound, sound_at_last_picture: Object.keys(before).length ? before : "(same as now)" }
    : {
        sound,
        listener_note: cleanText(body.note, MAX_NOTE_CHARS) ?? "(none)",
        local_time: cleanText(body.local_time, 60) ?? "(unknown)",
      };
  return { set, state, questions: QUESTION_SETS[set] };
}

async function handleJudge(req, res) {
  if (!client) {
    return sendJson(res, 503, { error: "TYPESAFE_API_KEY is not set on the server. Add it to .env and restart." });
  }
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return sendJson(res, 429, { error: "Too many judgments from this address. Slow the cadence down." });
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: `Bad request: ${err.message}` });
  }
  // The token is the credential (96 random bits); it is not tied to the address, because dual-stack
  // localhost and phones changing networks would otherwise lose their session mid-way.
  const session = typeof body?.session === "string" ? sessions.get(body.session) : undefined;
  if (!session) {
    return sendJson(res, 401, { error: "No open Jev session on this connection — press Start.", code: "session_expired" });
  }
  if (Date.now() >= session.expiresAt) {
    closeSession(session, "expired");
    return sendJson(res, 429, { error: `Jev has listened for ${SESSION_S} seconds on this start — press Start Jev again to keep going.`, code: "session_expired" });
  }
  if (tokensThisHour(Date.now()) >= TOKEN_BUDGET_PER_HOUR) {
    return sendJson(res, 503, { error: "This hour's Jev budget is used up. The pictures keep moving; judgments resume within the hour." });
  }
  let request;
  try {
    request = buildRequest(body);
  } catch (err) {
    return sendJson(res, 400, { error: `Bad request: ${err.message}` });
  }

  const started = performance.now();
  try {
    const result = await client.systemOne({ state: request.state, questions: request.questions });
    spend.push({ t: Date.now(), tokens: result.usage.input_tokens });
    session.calls += 1;
    session.tokens += result.usage.input_tokens;
    if (request.set !== "pulse") {
      session.taste += 1;
      logEvent({ type: "taste", session: session.id, at: Math.round((Date.now() - session.startedAt) / 1000), sound: request.state.sound, note: request.state.listener_note, picks: picksOf(result.answers) });
    }
    sendJson(res, 200, {
      set: request.set,
      model: result.model,
      answers: result.answers,
      usage: result.usage,
      ms: Math.round(performance.now() - started),
      state: request.state,
    });
  } catch (err) {
    const status = err instanceof APIError && Number.isInteger(err.status) ? err.status : 502;
    console.error(`[judge] ${status} ${err.message}`);
    sendJson(res, status, { error: `Jev call failed (${status}): ${err.message}` });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const path = normalize(join(PUBLIC_DIR, rel));
  if (!path.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not a file");
    const type = MIME[extname(path)] ?? "application/octet-stream";
    // Versioned asset URLs may be cached forever; everything else must not be cached at all.
    const versioned = url.searchParams.get("v") === BUILD;
    const cache = versioned ? "public, max-age=31536000, immutable" : "no-store";
    const headers = { ...SECURITY_HEADERS, "content-type": type, "cache-control": cache };
    if (rel === "index.html") {
      const nonce = randomBytes(16).toString("base64");
      const html = (await readFile(path, "utf8")).replaceAll("__V__", BUILD).replaceAll("__NONCE__", nonce);
      res.writeHead(200, { ...headers, "content-security-policy": csp(nonce) });
      return res.end(req.method === "HEAD" ? undefined : html);
    }
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : await readFile(path));
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
}

async function handleSession(req, res) {
  let body = null;
  try {
    body = await readJsonBody(req);
  } catch {
    // an empty or malformed body only loses the source label
  }
  const opened = openSession(req, body);
  if (opened.error) return sendJson(res, opened.error.status, opened.error.body);
  const left = SESSIONS_PER_IP_PER_HOUR - startsThisHour(opened.session.ip, Date.now()).length;
  sendJson(res, 200, { session: opened.session.id, seconds: SESSION_S, starts_left: left });
}

async function handle(req, res) {
  if (req.method === "POST" && req.url === "/api/judge") return handleJudge(req, res);
  if (req.method === "POST" && req.url === "/api/session") return handleSession(req, res);
  if (req.method === "GET" && req.url === "/api/health") {
    return sendJson(res, 200, { ok: true, hasKey, model: MODEL, build: BUILD, tokens_this_hour: tokensThisHour(Date.now()), budget_per_hour: TOKEN_BUDGET_PER_HOUR, sessions_active: sessions.size, session_s: SESSION_S });
  }
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  res.writeHead(405, SECURITY_HEADERS).end();
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

createServer(handle).listen(PORT, () => {
  console.log(`Roomtone  http://localhost:${PORT}  (Jev key: ${hasKey ? "present" : "MISSING"})`);
});

const certPath = join(CERT_DIR, "cert.pem");
const keyPath = join(CERT_DIR, "key.pem");
if (existsSync(certPath) && existsSync(keyPath)) {
  createHttpsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, handle).listen(HTTPS_PORT, () => {
    for (const ip of lanAddresses()) console.log(`  phone:  https://${ip}:${HTTPS_PORT}  (accept the certificate warning once)`);
  });
} else {
  console.log("  no cert/ found: run `npm run cert` to add an https address for phones on this Wi-Fi");
}
