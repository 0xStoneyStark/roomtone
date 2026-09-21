# Roomtone

ASCII pictures, art-directed by [Jev](https://docs.typesafe.ai) from the music around you.

Not a waveform. What the microphone hears is turned into words — tempo, loudness, bass,
brightness, rhythm, texture, dynamics — and Jev (TypeSafe's System One decision model)
answers eight questions about them, on two clocks:

**Taste** — the scene, asked every few seconds over the last six seconds (slider, default 6 s):

| question | type | what it decides |
| --- | --- | --- |
| picture | Choice over 9 | rain · life · flow · plasma · tunnel · lattice · glitch · ripple · embers |
| glyphs | Choice over 7 | blocks · dots · braille · lines · katakana · symbols · classic |
| colour | Choice over 8 | ember · glacier · phosphor · violet · acid · dusk · bone · blood |
| motion | Choice over 5 | drift · pulse · surge · stutter · breathe |

**Pulse** — the live feel, asked continuously over the last two seconds: the next call fires the
moment the previous one returns, about twice a second (the "live feel" checkbox; off, these ride
along on the taste call instead):

| question | type | what it decides |
| --- | --- | --- |
| fill | Score, 5 levels | how much of the screen carries characters |
| order | Score, 5 levels | clockwork → chaotic |
| arc | Score, 4 levels | quiet opening → steady groove → building → peak; sets the overall brightness |
| drop soon | Noul | probability a drop is imminent; above 0.4 the picture shimmers on each beat, and a confirmed hard hit releases a flash and a re-roll |

The next picture is **rolled from Jev's own probability distributions**, so the same song never
plays the same way twice, but every roll is weighted by what Jev thinks fits. Type what's playing
or where you are ("solo piano, raining outside", "wedding sangeet") and Jev fuses that with the
audio — something no amplitude-driven visualiser can do. The ledger on the right shows exactly
what Jev heard, every answer's odds, and which option the dice landed on.

Code owns the clock: beats, crossfades, and per-frame reactivity are local and instant, at 60 fps
(glyphs are rasterised once into an atlas, so a frame is one `drawImage` per lit cell). A new
picture is simulated off-screen for a moment before it fades in, and pattern, glyphs, colour and
motion all cross over together over 2.2 s, so one hearing melts into the next. Jev only
supplies taste. A taste call is about 2.5k input tokens and a pulse call about 1k; with the live
loop on that is roughly 2k tokens a second, ≈ $0.35 an hour at Jev's list price, and the ledger
header keeps a running token count. Turn live feel off for ≈ $0.06 an hour.

## Run it

Node 20.6+.

```bash
npm install
cp .env.example .env   # then put your TypeSafe key in it
npm start
```

Open <http://localhost:8790>, press **Start listening**, allow the microphone, and play music in
the room. **Play the demo loop** runs a synthesised 128 BPM build-and-drop instead, no mic needed.

### On a phone

Browsers only hand over the microphone on a secure origin, and `http://<laptop-ip>` is not one.
Make a self-signed certificate once, then the server also listens on https:

```bash
npm run cert
npm start
```

It prints a `https://192.168.x.x:8791` address; open that on a phone on the same Wi-Fi and accept
the certificate warning once (Android: *Advanced → Proceed*; iPhone: *Show details → visit this
website*). The ledger starts collapsed on phones — tap ▴ to open it; **New picture now** is in its
footer. The glyph grid starts smaller on phones and shrinks further on its own if frames run long.

The key is read on the server (`TYPESAFE_API_KEY`) and never sent to the browser; the browser
only posts word-descriptions of the sound to `/api/judge`, which owns the question set. Every
response carries a Content-Security-Policy (own origin plus Google Fonts; the import map gets a
per-request nonce), `nosniff`, `frame-ancestors 'none'` and a microphone-only Permissions-Policy.

## Controls

- **what's playing, or where are you?** — free text that goes into Jev's state with the audio description.
- **H** hides the ledger, **N** asks Jev for a new picture right now.
- **new picture every** — taste cadence, 3–20 s.
- **live feel** — the continuous pulse loop (on by default).
- **Save this frame** (or **S**) — the frame on screen as a PNG of the art alone (no HUD, no
  caption), re-rasterised at print resolution: the same glyph grid drawn at a much larger font size,
  up to 16 megapixels (the size is in the filename). On phones it opens the share sheet ("Save Image").
- **Enter** in the note field applies it immediately: Jev re-judges with the new context.
- The status line top-left shows `fps · ms · cols×rows`: frames per second, CPU time spent per frame,
  and the glyph grid. If fps is low while ms is small, the browser itself is the bottleneck (check
  `chrome://gpu` for hardware acceleration, or a power-saving mode); if ms is high the quality
  governor shrinks the grid automatically after two slow checks.

## Tuning

- `questions.mjs` — the art director's brief. Option descriptions are what Jev matches against; edit them to change its taste.
- `public/audio.js` — the word buckets (what counts as "loud", "heavy bass", "fast"). Jev reads words far better than numbers, so all thresholds live here in code. Loudness is described both absolutely and relative to the loudest the session has heard, so mic gain drops out; the tempo estimate carries a log-Gaussian prior around 120 BPM against half/double/3:2 errors.
- `test/options.test.mjs` (`npm test`) — checks every option Jev can choose has a generator, glyph ramp, palette or motion behind it.
- `public/app.js` — `ROLL_SHARPNESS` (1 = roll straight from Jev's odds; 1.5 default favours its stronger options), `PULSE_WINDOW_S` / `PULSE_MIN_GAP_MS` for the live loop, drop-release thresholds, crossfade time.
- `public/render.js` — `MAX_CELLS` (7000) caps the glyph budget; `app.js` starts every device at 5500 and the font size adapts to the window to stay under it (`MIN_FONT_PX` 8 is what limits small phones); the governor steps down on slow devices. `LOOK_FADE_S` is the glyph + palette crossfade.
- `public/style.css` — the HUD's `--accent` is set from JS to the mid tone of whatever palette Jev last chose, so the chrome recolours with the art. Chakra Petch for titles/labels, IBM Plex Mono for data.
- `public/patterns.js` — the nine generators; each reads `density`, `turbulence`, `speed` and the live `energy` / `bass` / `beat`.

`node scripts/smoke.mjs` sends two hand-written descriptions (techno, solo piano) to Jev and
prints every answer, for checking the question set after edits.

## Limits

- Jev is text-only: it judges the words the ear produces, not the audio itself. Better descriptors → better taste.
- Laptop microphones roll off below ~100 Hz, so "bass" is under-reported compared with a line-in or "Stereo Mix" input.
- Tempo detection needs a clear periodic beat; ambient or rubato music reads as "no steady beat", which is itself useful signal for Jev.
- Score values are used as smooth 0–1 parameters; TypeSafe notes that Score expectations are not numerically precise between levels, which is fine for a visualiser but not for anything that needs exact magnitudes.

## Hosting

The public instance is **<https://roomtone.heneryshop.com>**.

It runs on a small VPS as pm2 app `roomtone`, published through a Cloudflare Tunnel (Cloudflare owns
the DNS record and TLS; nothing is exposed on the box). The server's `.env` holds `TYPESAFE_API_KEY`,
`PORT`, `TRUST_PROXY=1` (so per-IP limits see the `CF-Connecting-IP` header) and
`TOKEN_BUDGET_PER_HOUR` (default 8M ≈ $0.34/h, the worst-case bill for the whole site; `/api/health`
reports the hour's usage).

To run your own: create `/opt/roomtone/.env` on the server once, then deploy from your machine with

```bash
ROOMTONE_HOST=user@your-vps bash deploy/deploy.sh
```

and route a hostname to `localhost:<PORT>` (a Cloudflare Tunnel "published application route" is the
least-effort option; nginx + Let's Encrypt works too). To keep an instance private, put Cloudflare
Access (email + one-time PIN) in front of the hostname.

Cloudflare caches `.js`/`.css` at its edge for hours whatever the origin says, so the server bakes a
build id (hash of `public/`) into every asset URL in `index.html` (an import map covers the module
imports); `index.html` itself is `no-store`. A deploy therefore takes effect on the next reload,
even on phones that had the old build.
