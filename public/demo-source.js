// Two synthesised songs for trying Roomtone without a microphone: a 128 BPM loop that builds
// and drops, and a slow, airy piece at 84 BPM. The demo alternates between them so the
// "has the music turned" judgment has a real turn to notice. Both play out loud and into the
// analyser exactly like the mic would.

const SONG_S = 45; // how long each song plays before the demo changes over
const CHANGE_FADE_S = 2.5;

/** `demoControl.next()` changes the song now (the demo does it by itself every SONG_S). */
export const demoControl = { song: 0, next: () => {} };

/** The build-and-drop loop: kick, hats, saw bass and a filtered pad in A minor. */
function technoLoop(ctx, noiseBuf, bus) {
  const BPM = 128;
  const BEAT = 60 / BPM;
  const BARS_PER_PHRASE = 4; // 4 bars of build, 4 of drop: the arc shows within ten seconds
  let beatIndex = 0;
  let nextAt = 0;
  let active = false;

  // A sustained pad (detuned saws through a lowpass) under the drums, so the loop has body
  // between hits; its filter opens with the build and its level lifts on the drop.
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 500;
  padFilter.Q.value = 0.8;
  const padGain = ctx.createGain();
  padGain.gain.value = 0.11;
  padFilter.connect(padGain).connect(bus);
  for (const hz of [110, 130.81, 164.81, 220]) {
    for (const detune of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = hz;
      osc.detune.value = detune;
      osc.connect(padFilter);
      osc.start();
    }
  }

  function kick(at, level = 1) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.25);
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
    osc.connect(g).connect(bus);
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
    src.connect(hp).connect(g).connect(bus);
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
    osc.connect(lp).connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + BEAT);
  }

  function schedule() {
    if (!active) return;
    while (nextAt < ctx.currentTime + 0.5) {
      const bar = Math.floor(beatIndex / 4);
      const phrasePos = (bar % (BARS_PER_PHRASE * 2)) / (BARS_PER_PHRASE * 2); // 0..1 build, then drop
      const building = phrasePos < 0.5;
      const build = building ? phrasePos * 2 : 0; // rises 0..1 over the first 4 bars
      const inBeat = beatIndex % 4;
      padFilter.frequency.linearRampToValueAtTime(building ? 400 + 1800 * build : 2600, nextAt);
      padGain.gain.linearRampToValueAtTime(building ? 0.1 + 0.04 * build : 0.16, nextAt);

      // The build keeps a softer kick under the hats, so it reads as a passage rather than a gap.
      kick(nextAt, building ? 0.55 + 0.45 * build : 1);
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

  return {
    schedule,
    start(at) {
      active = true;
      nextAt = at;
      beatIndex = 0;
    },
    stop() {
      active = false;
    },
  };
}

/**
 * The slow one, voiced to read differently in the ear's own words: quarter-note triangle plucks
 * in D major with a soft attack (slow tempo, few hits), a pad above the bass band (light bass),
 * a shaker and an air bed (bright, some noise), and everything well under the loop's level.
 */
function driftSong(ctx, noiseBuf, bus) {
  const BPM = 84;
  const BEAT = 60 / BPM;
  const ARP = [587.33, 880, 739.99, 1174.66, 659.25, 880, 987.77, 1318.51]; // D5 A5 F#5 D6 E5 A5 B5 E6, two bars of quarters
  let beatIndex = 0;
  let nextAt = 0;
  let active = false;

  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 2200;
  const padGain = ctx.createGain();
  padGain.gain.value = 0.03;
  padFilter.connect(padGain).connect(bus);
  for (const hz of [293.66, 440, 739.99]) {
    for (const detune of [-5, 5]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = hz;
      osc.detune.value = detune;
      osc.connect(padFilter);
      osc.start();
    }
  }
  // A continuous breath of air up top: it lifts the spectral centroid the way a real room's hiss does.
  const air = ctx.createBufferSource();
  air.buffer = noiseBuf;
  air.loop = true;
  const airHp = ctx.createBiquadFilter();
  airHp.type = "highpass";
  airHp.frequency.value = 6000;
  const airGain = ctx.createGain();
  airGain.gain.value = 0.008;
  air.connect(airHp).connect(airGain).connect(bus);
  air.start();

  function pluck(at, hz, level) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(level, at + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
    osc.connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + 0.65);
  }

  function shaker(at, level) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 6000;
    bp.Q.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(level, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.14);
    src.connect(bp).connect(g).connect(bus);
    src.start(at);
    src.stop(at + 0.16);
  }

  function thump(at, level) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(110, at);
    osc.frequency.exponentialRampToValueAtTime(70, at + 0.1);
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
    osc.connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + 0.2);
  }

  function schedule() {
    if (!active) return;
    while (nextAt < ctx.currentTime + 0.5) {
      const bar = Math.floor(beatIndex / 4);
      const inBeat = beatIndex % 4;
      const swell = 0.5 + 0.5 * Math.sin((bar / 8) * Math.PI * 2 - Math.PI / 2); // an eight-bar breath
      padGain.gain.linearRampToValueAtTime(0.025 + 0.015 * swell, nextAt);
      if (!(bar % 4 === 3 && inBeat === 3)) pluck(nextAt, ARP[(bar % 2) * 4 + inBeat], 0.1 + 0.04 * swell); // a rest at the end of every fourth bar
      shaker(nextAt + BEAT / 2, 0.035);
      if (inBeat === 0 || inBeat === 2) thump(nextAt, 0.16);
      nextAt += BEAT;
      beatIndex += 1;
    }
  }

  return {
    schedule,
    start(at) {
      active = true;
      nextAt = at;
      beatIndex = 0;
    },
    stop() {
      active = false;
    },
  };
}

export async function demoSource(ctx) {
  const out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(ctx.destination);

  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const buses = [ctx.createGain(), ctx.createGain()];
  for (const bus of buses) {
    bus.gain.value = 0;
    bus.connect(out);
  }
  const songs = [technoLoop(ctx, noiseBuf, buses[0]), driftSong(ctx, noiseBuf, buses[1])];

  function changeOver() {
    const from = demoControl.song;
    const to = (from + 1) % songs.length;
    const at = ctx.currentTime + 0.05;
    buses[from].gain.cancelScheduledValues(at);
    buses[from].gain.setValueAtTime(buses[from].gain.value, at);
    buses[from].gain.linearRampToValueAtTime(0, at + CHANGE_FADE_S);
    buses[to].gain.cancelScheduledValues(at);
    buses[to].gain.setValueAtTime(0, at);
    buses[to].gain.linearRampToValueAtTime(1, at + CHANGE_FADE_S);
    songs[from].stop();
    songs[to].start(at);
    demoControl.song = to;
  }

  buses[0].gain.value = 1;
  songs[0].start(ctx.currentTime + 0.1);
  demoControl.song = 0;
  demoControl.next = changeOver;
  setInterval(() => songs.forEach((song) => song.schedule()), 100);
  setInterval(changeOver, SONG_S * 1000);
  songs[0].schedule();
  return out;
}
