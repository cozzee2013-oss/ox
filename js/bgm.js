// 게임 화면의 배경음악을 Web Audio로 직접 합성합니다.
// 음원 파일이 없어 저작권 걱정이 없고 오프라인에서도 재생됩니다.
// 대기·결과 화면은 잔잔하게, 문제 화면은 하이햇과 베이스를 더해 긴장감 있게 연주합니다.

const BPM = 100;
const STEP = 60 / BPM / 2; // 8분음표 길이(초)
const LOOKAHEAD = 0.12;    // 미리 예약하는 시간(초)
const VOLUME = 0.16;

// 우주 테마에 맞춘 몽환적인 4마디 진행: Am9 – Fmaj7 – Cadd9 – G6
const CHORDS = [
  { bass: 45, pad: [57, 60, 64, 71], arp: [69, 72, 76, 79, 83, 79, 76, 72] },
  { bass: 41, pad: [53, 57, 60, 64], arp: [65, 69, 72, 76, 81, 76, 72, 69] },
  { bass: 48, pad: [55, 60, 62, 64], arp: [67, 72, 74, 76, 79, 76, 74, 72] },
  { bass: 43, pad: [55, 59, 62, 64], arp: [67, 71, 74, 76, 79, 76, 74, 71] }
];
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

let ctx, master, filter, noise, loop = null, step = 0, nextTime = 0, mode = "calm";

function setup(audio) {
  if (ctx === audio) return;
  ctx = audio;
  master = ctx.createGain();
  master.gain.value = 0;
  filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2400;
  filter.connect(master).connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function tone(freq, start, length, { type = "triangle", gain = 0.1, attack = 0.01, detune = 0 } = {}) {
  const osc = ctx.createOscillator(), env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(gain, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(env).connect(filter);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

function hat(start, gain) {
  const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), env = ctx.createGain();
  src.buffer = noise;
  hp.type = "highpass";
  hp.frequency.value = 7000;
  env.gain.setValueAtTime(gain, start);
  env.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
  src.connect(hp).connect(env).connect(filter);
  src.start(start);
  src.stop(start + 0.06);
}

function playStep(i, t) {
  const bar = Math.floor(i / 8) % CHORDS.length, beat = i % 8, chord = CHORDS[bar];
  const tense = mode === "tense";
  if (beat === 0) chord.pad.forEach(note => {
    tone(hz(note), t, STEP * 8.4, { type: "sawtooth", gain: 0.012, attack: 0.6, detune: -7 });
    tone(hz(note), t, STEP * 8.4, { type: "sawtooth", gain: 0.012, attack: 0.6, detune: 7 });
  });
  if (beat === 0 || beat === 4 || (tense && beat % 2 === 0)) tone(hz(chord.bass), t, STEP * (tense ? 1.8 : 3.6), { type: "sine", gain: tense ? 0.16 : 0.13 });
  if (tense || beat % 2 === 0) tone(hz(chord.arp[beat]), t, STEP * 1.6, { gain: tense ? 0.05 : 0.04 });
  if (tense) hat(t, beat % 2 ? 0.035 : 0.02);
}

function schedule() {
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    playStep(step++, nextTime);
    nextTime += STEP;
  }
}

/** 배경음악을 시작하거나 분위기만 바꿉니다. mood: "calm" | "tense" */
export function startBgm(audio, mood = "calm") {
  if (!audio) return;
  setup(audio);
  mode = mood;
  filter.frequency.setTargetAtTime(mood === "tense" ? 3400 : 2000, ctx.currentTime, 0.4);
  if (loop) return;
  step = 0;
  nextTime = ctx.currentTime + 0.05;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(VOLUME, ctx.currentTime, 0.6);
  loop = setInterval(schedule, 25);
  schedule();
}

/** 배경음악을 부드럽게 멈춥니다. */
export function stopBgm() {
  if (!loop) return;
  clearInterval(loop);
  loop = null;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
}
