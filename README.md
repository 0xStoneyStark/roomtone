# Roomtone

ASCII pictures, art-directed by [Jev](https://docs.typesafe.ai) from the music around you.

Not a waveform. What the microphone hears is turned into words — tempo, loudness, bass,
brightness, rhythm, texture, dynamics — and Jev (TypeSafe's System One decision model)
answers fourteen questions about them, on two clocks:

**Taste** — the scene, judged over the last six seconds whenever the music turns or the hold runs out (slider, default 45 s):

| question | type | what it decides |
| --- | --- | --- |
| picture | Choice over 9 | rain · life · flow · plasma · tunnel · lattice · glitch · ripple · embers |
| ground | Choice over 6 | none · plasma · flow · lattice · tunnel · embers |
| glyphs | Choice over 9 | blocks · dots · braille · lines · katakana · symbols · classic · strokes · hatching |
| colour | Choice over 11 | ember · glacier · phosphor · violet · acid · dusk · bone · blood · ink · sepia · riso |
| motion | Choice over 5 | drift · pulse · surge · stutter · breathe |
| camera | Choice over 5 | hold · push · pull · drift · sway |
| placement | Choice over 6 | bleed · horizon · island · diagonal · constellation · edge |
| emptiness | Score, 4 levels | none reserved → a little breathing room → generous → mostly silence |
| accent | Score, 3 levels | no accent → a few sparks → bold counterpoint |

**Pulse** — the live feel, asked continuously over the last two seconds: the next call fires the
moment the previous one returns, about twice a second (the "live feel" checkbox; off, these ride
along on the taste call instead):

| question | type | what it decides |
| --- | --- | --- |
| fill | Score, 5 levels | how much of the screen carries characters |
| order | Score, 5 levels | clockwork → chaotic |
| arc | Score, 4 levels | quiet opening → steady groove → building → peak; sets the overall brightness |
| drop soon | Noul | probability a drop is imminent; above 0.4 the picture shimmers on each beat, and a confirmed hard hit releases a flash and a re-roll |
| turned | Noul | probability the music has changed enough since the last picture to warrant a new one; the picture's maximum hold falls back on it |

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

## The artistic pass

Six moves turn "which pattern, which colour" into something that reads as art-directed rather
than randomised.

**Marks, not pixels.** Two of the nine glyph families, `strokes` and `hatching`, don't pick a
character by brightness alone — they pick one that leans with the direction the figure is moving,
like a brush stroke or a quick pen sketch, so the same field of numbers reads as drawn rather than
printed.

**Composition.** Jev places the mass of the picture — full bleed, a low horizon, a centred island,
a rising diagonal, a scattered constellation, or lit from one edge — as a soft mask laid over
whatever pattern is playing. `emptiness` is a second, independent dial: how much of the frame Jev
holds back as reserved dark space around that mass, from none at all to mostly silence.

**Camera.** The pattern field is now rendered larger than the screen grid — overscan — so the
`camera` question has room to move the frame across it: hold, push, pull, drift, or sway. The
camera resamples the field rather than transforming the glyphs, which is what keeps the character
lattice intact as the view moves.

**Colour with restraint.** Every palette ramps in two tones, dark through a mood's primary hue and
then drifting toward a second hue as it brightens, and `accent` decides how much of a sparse,
contrasting colour lands on only the loudest marks — from none, to a few sparks, to a bold second
voice. Three of the eleven palettes are paper: ink, sepia, riso — a light ground with dark ink,
the reverse of every other palette's dark ground and bright marks. The HUD follows: on a paper
palette the chrome turns to ink on paper too, not just the canvas.

**Layers.** `ground` is a slow, dim layer behind the figure — a rolling plasma, a drifting wind, a
breathing grid, or none at all — chosen on its own axis rather than tied to the foreground pattern,
so the scene can carry depth without competing with what's in front.

**Scenes that end when the music turns.** Instead of a fixed clock, the Noul `turned` compares the
sound right now against the sound at the moment of the last picture and says whether enough has
changed to earn a new one — a new section, a drop, a different feel. The taste cadence becomes a
maximum hold rather than a fixed interval: a picture runs no longer than that ceiling, but a clear
turn in the music can end it sooner.

## Run it

Node 20.6+.

```bash
npm install
cp .env.example .env   # then put your TypeSafe key in it
npm start
```

Open <http://localhost:8790>, press **Start listening**, allow the microphone, and play music in
the room. **Play the demo loop** runs two synthesised songs instead, no mic needed: a 128 BPM build-and-drop and a slow, airy piece at 84 BPM, changing over every 45 s so the "has the music turned" judgment has a turn to notice.

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
- **hold a picture at most** — 10–120 s; a new picture comes sooner when Jev judges the music has turned.
- **direction chips** — darker, slower, emptier, warmer, break it, or type your own; tapped chips and the typed note combine into one sentence sent to Jev as `listener_direction`. Jev is told to follow it where the music allows, not obey it blindly — the audio still gets a say.
- **press and hold** the picture to keep it past its usual hold time; **swipe** it away to reject it, and Jev avoids that choice the next time it rolls.
- **Start Jev again** — each press of Start opens a server-side session (`POST /api/session`) good for 2½ minutes of Jev (`SESSION_S`, default 150, on the server; the page's copy says "2½ minutes", change both together). Every judgment carries the session token; when it expires the server answers 429 `session_expired`, the picture keeps moving on its last odds, and the button opens the next session. An address gets `SESSIONS_PER_IP_PER_HOUR` (default 6) starts per rolling hour, then 429 `sessions_exhausted` with a retry time. Together with the per-IP rate limit (300 calls/min) and the hourly token budget this bounds what a public deployment can spend.

## What people try (words, never audio)

The server appends one JSON line per event to `data/sessions.jsonl` (`DATA_DIR` to move it; the directory is excluded from deploys, so it survives them):

- `session` — hashed address (`IP_SALT`), country (Cloudflare's `cf-ipcountry`), phone or desktop, mic or demo
- `taste` — seconds into the session, the ear's word buckets for the sound (tempo, loudness, bass, brightness, rhythm, texture, dynamics), the listener note as typed, and Jev's headline pick for every question
- `end` — how long the session ran, calls, pictures, tokens

No audio is ever sent to the server; the browser turns sound into those words locally. `npm run sessions` (or `node scripts/sessions.mjs path/to/sessions.jsonl`) prints a summary: sessions per day, sources, countries, the most typed notes, the most common sound words, and what Jev picked.
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
