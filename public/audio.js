// The ear: turns the microphone into (a) per-frame numbers the renderer reacts
// to instantly and (b) a plain-English description of the last few seconds
// for Jev. Jev is text-only and weak with raw numbers, so every feature is
// bucketed into words here, in code.

const FFT_SIZE = 2048;
const WINDOW_S = 6; // how much history a Jev description covers
const BEAT_REFRACTORY_MS = 120;
const SILENCE_DB = -55;
// Tempo prior: a log-Gaussian around 120 BPM (one octave wide), the standard fix for the
// autocorrelation peak landing on a half, double or 3:2 tempo.
const TEMPO_PRIOR_BPM = 120;
const TEMPO_PRIOR_OCTAVES = 0.6;
const PEAK_DB_RELEASE = 0.4; // dB per second the session's loudest level relaxes by

const TEMPO_BUCKETS = [
  [72, "very slow"], [88, "slow"], [100, "walking pace"], [116, "mid-tempo"],
  [132, "upbeat"], [150, "fast"], [Infinity, "very fast"],
];
const LOUDNESS_BUCKETS = [
  [-42, "very quiet"], [-30, "quiet"], [-20, "moderate"], [-12, "loud"], [Infinity, "very loud"],
];
const BASS_BUCKETS = [
  [0.03, "hardly any bass"], [0.1, "light bass"], [0.25, "solid bass"], [Infinity, "heavy, sustained sub-bass"],
];
const BRIGHTNESS_BUCKETS = [
  [600, "dark and muffled"], [1200, "warm, soft top end"], [2500, "balanced"],
  [4500, "bright"], [Infinity, "piercing, lots of high-frequency sizzle"],
];
const TEXTURE_BUCKETS = [
  [0.1, "clearly pitched tones, melodic or harmonic"], [0.35, "a mix of tones and noise"],
  [Infinity, "mostly noise-like: percussive, distorted, or hiss"],
];
const DYNAMICS_BUCKETS = [
  [2, "flat and compressed, constant level"], [5, "moderate swings"], [Infinity, "big swings between hits and near-silence"],
];
// Where this passage sits against the loudest the session has heard: mic gain drops out of the comparison.
const RELATIVE_BUCKETS = [
  [-15, "far below the loudest heard so far"], [-8, "well below the loudest heard so far"],
  [-3, "a little below the loudest heard so far"], [Infinity, "at the loudest heard so far"],
];

function bucket(value, table) {
  return table.find(([limit]) => value < limit)[1];
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function slope(ts, ys) {
  const tm = mean(ts);
  const ym = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < ts.length; i++) {
    num += (ts[i] - tm) * (ys[i] - ym);
    den += (ts[i] - tm) ** 2;
  }
  return den ? num / den : 0;
}

export class Ear {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.history = []; // { t, db, bassRatio, centroid, flatness, flux }
    this.onsets = []; // { t, strength }
    this.peakRms = 1e-4;
    this.peakBass = 1e-4;
    this.lastBeatAt = -Infinity;
    this.smoothEnergy = 0;
    this.smoothBass = 0;
    this.holdDb = -100;
    this.peakAvgDb = -100; // loudest window average described so far, for the relative loudness wording
    this.lastDescribedAt = 0;
    this.lastT = 0;
  }

  /** `source` is a function (ctx) => AudioNode, so the mic and the demo loop plug in the same way. */
  async start(source) {
    this.ctx = new AudioContext();
    // Resume inside the tap that called us: iOS only unlocks audio from a user gesture,
    // and the mic permission prompt below may outlive that gesture.
    const resumed = this.ctx.resume();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0;
    const node = await source(this.ctx);
    node.connect(this.analyser);
    await resumed;
    this.freq = new Float32Array(this.analyser.frequencyBinCount);
    this.time = new Float32Array(this.analyser.fftSize);
    this.mag = new Float32Array(this.analyser.frequencyBinCount);
    this.prevMag = new Float32Array(this.analyser.frequencyBinCount);
    this.binHz = this.ctx.sampleRate / FFT_SIZE;
  }

  /** Call once per animation frame. Returns the live numbers the renderer uses. */
  frame(nowMs) {
    const t = nowMs / 1000;
    this.analyser.getFloatFrequencyData(this.freq);
    this.analyser.getFloatTimeDomainData(this.time);

    let sum = 0;
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
    const rms = Math.sqrt(sum / this.time.length);
    const db = 20 * Math.log10(rms + 1e-9);

    const bins = this.freq.length;
    const mag = this.mag;
    let total = 0;
    let bass = 0;
    let weighted = 0;
    let magSum = 0;
    let logSum = 0;
    let linSum = 0;
    let count = 0;
    let flux = 0;
    const bassTop = Math.round(200 / this.binHz);
    const texLow = Math.round(100 / this.binHz);
    const texHigh = Math.round(8000 / this.binHz);
    for (let i = 1; i < bins; i++) {
      const m = 10 ** (this.freq[i] / 20);
      mag[i] = m;
      const p = m * m;
      total += p;
      if (i <= bassTop) bass += p;
      weighted += i * this.binHz * m;
      magSum += m;
      if (i >= texLow && i <= texHigh) {
        logSum += Math.log(p + 1e-12);
        linSum += p;
        count++;
      }
      flux += Math.max(0, m - this.prevMag[i]);
    }
    [this.mag, this.prevMag] = [this.prevMag, mag];
    const centroid = magSum > 0 ? weighted / magSum : 0;
    const flatness = count ? Math.exp(logSum / count) / (linSum / count + 1e-12) : 0;
    const bassRatio = total > 0 ? bass / total : 0;

    this.history.push({ t, db, bassRatio, centroid, flatness, flux });
    while (this.history.length && t - this.history[0].t > WINDOW_S) this.history.shift();
    while (this.onsets.length && t - this.onsets[0].t > WINDOW_S) this.onsets.shift();

    const beat = this.detectBeat(t, flux);

    // Peak-tracked normalisation so laptop mics and line-ins land in the same 0..1 range.
    this.peakRms = Math.max(rms, this.peakRms * 0.9995);
    this.peakBass = Math.max(bass, this.peakBass * 0.9995);
    const energy = rms / this.peakRms;
    const bassNorm = Math.sqrt(bass / this.peakBass);
    this.smoothEnergy += (energy - this.smoothEnergy) * 0.25;
    this.smoothBass += (bassNorm - this.smoothBass) * 0.3;

    // Loudness with a 25 dB/s release, so gaps between hits do not read as silence.
    this.holdDb = Math.max(db, this.holdDb - 25 * (t - this.lastT));
    this.lastT = t;

    return {
      energy: this.smoothEnergy,
      bass: this.smoothBass,
      beat,
      bpm: this.lastBpm ?? 0,
      silent: this.holdDb < SILENCE_DB,
    };
  }

  /** Seconds of history currently held. */
  span() {
    return this.history.length ? this.history[this.history.length - 1].t - this.history[0].t : 0;
  }

  detectBeat(t, flux) {
    const recent = this.history.filter((h) => t - h.t < 1.5).map((h) => h.flux);
    if (recent.length < 20) return 0;
    const threshold = mean(recent) + 1.5 * std(recent);
    if (flux > threshold && (t - this.lastBeatAt) * 1000 > BEAT_REFRACTORY_MS) {
      this.lastBeatAt = t;
      const strength = Math.min(1, (flux - threshold) / (threshold + 1e-9));
      this.onsets.push({ t, strength });
      return 0.4 + 0.6 * strength;
    }
    return 0;
  }

  /** Autocorrelation of the onset-strength envelope over the window; null when nothing repeats. */
  estimateTempo() {
    const RATE = 100;
    const n = Math.round(WINDOW_S * RATE);
    if (this.span() < WINDOW_S * 0.8) return null;
    const t0 = this.history[this.history.length - 1].t - WINDOW_S;
    const env = new Float32Array(n);
    for (const h of this.history) {
      const i = Math.floor((h.t - t0) * RATE);
      if (i >= 0 && i < n) env[i] = Math.max(env[i], h.flux);
    }
    const m = mean(Array.from(env));
    for (let i = 0; i < n; i++) env[i] -= m;
    let norm = 0;
    for (let i = 0; i < n; i++) norm += env[i] * env[i];
    if (norm < 1e-9) return null;
    let bestLag = 0;
    let best = 0;
    let bestRaw = 0;
    for (let lag = Math.round(RATE * 60 / 180); lag <= Math.round(RATE * 60 / 60); lag++) {
      let acc = 0;
      for (let i = lag; i < n; i++) acc += env[i] * env[i - lag];
      const r = acc / norm;
      const bpm = (60 * RATE) / lag;
      const prior = Math.exp(-0.5 * (Math.log2(bpm / TEMPO_PRIOR_BPM) / TEMPO_PRIOR_OCTAVES) ** 2);
      if (r * prior > best) {
        best = r * prior;
        bestRaw = r;
        bestLag = lag;
      }
    }
    if (bestRaw < 0.25) return null;
    return Math.round((60 * RATE) / bestLag);
  }

  /**
   * The words Jev reads, over the last `windowS` seconds (up to WINDOW_S).
   * Null while the room is effectively silent or the window is still filling.
   */
  describe(windowS = WINDOW_S) {
    if (this.span() < Math.min(2, windowS * 0.8)) return null;
    const tEnd = this.history[this.history.length - 1].t;
    const recent = this.history.filter((h) => tEnd - h.t <= windowS);
    const onsets = this.onsets.filter((o) => tEnd - o.t <= windowS);
    const dbs = recent.map((h) => h.db);
    const avgDb = mean(dbs);
    if (avgDb < SILENCE_DB) return null;
    // Compare window averages with window averages: an instantaneous kick peak would make every
    // passage read as "far below the loudest".
    this.peakAvgDb = Math.max(avgDb, this.peakAvgDb - PEAK_DB_RELEASE * Math.max(0, tEnd - this.lastDescribedAt));
    this.lastDescribedAt = tEnd;

    const ts = recent.map((h) => h.t);
    const dbSlope = slope(ts, dbs) * windowS; // dB change across the window
    const dbStd = std(dbs);
    let trend = "holding steady";
    if (dbSlope > 3) trend = "getting louder over the last few seconds";
    else if (dbSlope < -3) trend = "getting quieter over the last few seconds";
    else if (dbStd > 6) trend = "swelling and dropping";

    // Tempo and regularity always use the full history: two seconds holds too few hits to judge either.
    const bpm = this.estimateTempo();
    this.lastBpm = bpm ?? 0;
    const intervals = this.onsets.slice(1).map((o, i) => o.t - this.onsets[i].t);
    const cv = intervals.length > 3 ? std(intervals) / (mean(intervals) + 1e-9) : 1;
    const regularity = cv < 0.2 ? "steady" : cv < 0.45 ? "loose" : "irregular";
    const tempo = bpm ? `${bucket(bpm, TEMPO_BUCKETS)}, around ${bpm} beats per minute, ${regularity}` : "no steady beat";

    const rate = onsets.length / windowS;
    let rhythm = "no clear hits";
    if (rate >= 6) rhythm = "relentless machine-gun hits";
    else if (rate >= 3) rhythm = "dense, busy hits";
    else if (rate >= 1.2) rhythm = regularity === "irregular" ? "loose, scattered hits" : "steady hits on the beat";
    else if (rate >= 0.3) rhythm = "occasional hits";

    return {
      tempo,
      loudness: `${bucket(avgDb, LOUDNESS_BUCKETS)}, ${bucket(avgDb - this.peakAvgDb, RELATIVE_BUCKETS)}`,
      loudness_trend: trend,
      bass: bucket(mean(recent.map((h) => h.bassRatio)), BASS_BUCKETS),
      brightness: bucket(mean(recent.map((h) => h.centroid)), BRIGHTNESS_BUCKETS),
      rhythm,
      texture: bucket(mean(recent.map((h) => h.flatness)), TEXTURE_BUCKETS),
      dynamics: bucket(dbStd, DYNAMICS_BUCKETS),
    };
  }
}

export async function micSource(ctx) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  return ctx.createMediaStreamSource(stream);
}
