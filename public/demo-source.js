// A synthesised 128 BPM loop that builds for 16 bars and drops, for trying
// Roomtone without a microphone (open ?source=demo). It plays out loud and
// into the analyser exactly like the mic would.

const BPM = 128;
const BEAT = 60 / BPM;
const BARS_PER_PHRASE = 4; // 4 bars of build, 4 of drop: the arc shows within ten seconds

export async function demoSource(ctx) {
  const out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(ctx.destination);

  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  let beatIndex = 0;
  let nextAt = ctx.currentTime + 0.1;

  function kick(at) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.25);
    g.gain.setValueAtTime(1, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + 0.4);
  }

  function hat(at, level) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    src.connect(hp).connect(g).connect(out);
    src.start(at);
    src.stop(at + 0.08);
  }

  function bass(at, cutoff) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 55;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.35, at + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, at + BEAT * 0.9);
    osc.connect(lp).connect(g).connect(out);
    osc.start(at);
    osc.stop(at + BEAT);
  }

  function schedule() {
    while (nextAt < ctx.currentTime + 0.5) {
      const bar = Math.floor(beatIndex / 4);
      const phrasePos = (bar % (BARS_PER_PHRASE * 2)) / (BARS_PER_PHRASE * 2); // 0..1 build, then drop
      const building = phrasePos < 0.5;
      const build = building ? phrasePos * 2 : 0; // rises 0..1 over the first 8 bars
      const inBeat = beatIndex % 4;

      if (!building || build > 0.35) kick(nextAt);
      if (building) {
        hat(nextAt, 0.15 + 0.35 * build);
        if (build > 0.6) hat(nextAt + BEAT / 2, 0.3 * build);
        if (build > 0.85) for (let i = 1; i < 4; i++) hat(nextAt + (BEAT * i) / 4, 0.4);
        bass(nextAt, 200 + 3000 * build);
      } else {
        hat(nextAt + BEAT / 2, 0.4);
        if (inBeat === 1 || inBeat === 3) hat(nextAt, 0.2);
        bass(nextAt, 1200);
      }
      nextAt += BEAT;
      beatIndex += 1;
    }
  }

  setInterval(schedule, 100);
  schedule();
  return out;
}
