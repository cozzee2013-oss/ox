// 게임 화면의 배경음악을 Web Audio로 직접 합성합니다.
// 음원 파일이 없어 저작권 걱정이 없고 오프라인에서도 재생됩니다.
// 공부·집중용 로파이(lo-fi) 스타일: 느린 템포, 가사·멜로디 없이 따뜻한 재즈 화음과 일정한 비트.
// 대기·결과 화면은 피아노 화음과 베이스만, 문제 화면은 부드러운 드럼을 더해 일정한 리듬으로 집중을 돕습니다.

const BPM = 74;
const STEP = 60 / BPM / 4; // 16분음표 길이(초)
const SWING = 0.18;        // 엇박 16분음표를 살짝 늦춰 느긋한 느낌
const LOOKAHEAD = 0.15;
const LOOKAHEAD_HIDDEN = 2;  // 다른 탭에 있을 때는 타이머가 느려지므로 더 멀리 예약해 끊김을 막습니다
const VOLUME = 0.9;

// 로파이에서 흔한 편안한 진행: Fmaj9 – Em7 – Dm9 – Cmaj9 (각 1마디)
const CHORDS = [
  { root: 41, keys: [57, 60, 64, 67] }, // F  : A C E G
  { root: 40, keys: [55, 59, 62, 64] }, // Em : G B D E
  { root: 38, keys: [53, 57, 60, 64] }, // Dm : F A C E
  { root: 36, keys: [55, 59, 62, 64] }  // C  : G B D E
];
// 한 마디(16칸) 안에서 화음을 누르는 위치와 세기
const COMP = { 0: 1, 6: 0.55, 10: 0.7 };
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

let ctx, out, warm, noise, loop = null, step = 0, nextTime = 0, mode = "calm";

function setup(audio) {
  if (ctx === audio) return;
  ctx = audio;
  // 악기 → 따뜻한 저역통과 필터 → 컴프레서 → 마스터 음량
  warm = ctx.createBiquadFilter();
  warm.type = "lowpass";
  warm.frequency.value = 2600;
  warm.Q.value = 0.5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  out = ctx.createGain();
  out.gain.value = 0;
  warm.connect(comp).connect(out).connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

const env = (start, peak, attack, decay) => {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(peak, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  return g;
};

// 일렉트릭 피아노: 사인파 본음 + 짧게 울리는 고음 배음으로 부드러운 종소리 느낌
function epiano(freq, start, gain) {
  const body = ctx.createOscillator(), bell = ctx.createOscillator();
  body.type = "sine"; body.frequency.value = freq;
  bell.type = "sine"; bell.frequency.value = freq * 4.01;
  const g1 = env(start, gain, 0.008, 2.4), g2 = env(start, gain * 0.18, 0.004, 0.35);
  body.connect(g1).connect(warm);
  bell.connect(g2).connect(warm);
  body.start(start); bell.start(start);
  body.stop(start + 2.5); bell.stop(start + 0.4);
}

function bass(freq, start, length, gain) {
  const osc = ctx.createOscillator(), sub = ctx.createOscillator();
  osc.type = "triangle"; osc.frequency.value = freq;
  sub.type = "sine"; sub.frequency.value = freq / 2;
  const g = env(start, gain, 0.02, length);
  osc.connect(g); sub.connect(g); g.connect(warm);
  osc.start(start); sub.start(start);
  osc.stop(start + length + 0.05); sub.stop(start + length + 0.05);
}

function kick(start, gain) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(110, start);
  osc.frequency.exponentialRampToValueAtTime(42, start + 0.12);
  const g = env(start, gain, 0.003, 0.3);
  osc.connect(g).connect(warm);
  osc.start(start); osc.stop(start + 0.35);
}

function noiseHit(start, gain, type, freq, decay) {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
  src.buffer = noise;
  f.type = type; f.frequency.value = freq; f.Q.value = 0.8;
  const g = env(start, gain, 0.002, decay);
  src.connect(f).connect(g).connect(warm);
  src.start(start); src.stop(start + decay + 0.05);
}

function playStep(i, t) {
  const pos = i % 16, chord = CHORDS[Math.floor(i / 16) % CHORDS.length];
  const focus = mode === "focus";
  // 화음
  if (COMP[pos]) {
    const strength = COMP[pos] * (focus ? 0.11 : 0.13);
    chord.keys.forEach((note, n) => epiano(hz(note), t + n * 0.012, strength)); // 살짝 굴려 치기
  }
  // 베이스: 1박과 3박 앞
  if (pos === 0) bass(hz(chord.root), t, 1.3, 0.32);
  if (pos === 10) bass(hz(chord.root + 7), t, 0.6, 0.22);
  if (!focus) return;
  // 드럼: 문제 화면에서만, 크지 않게
  if (pos === 0 || pos === 7 || pos === 10) kick(t, pos === 0 ? 0.55 : 0.4);
  if (pos === 4 || pos === 12) noiseHit(t, 0.16, "bandpass", 1800, 0.16);
  if (pos % 2 === 0) noiseHit(t, pos % 4 ? 0.035 : 0.055, "highpass", 8000, 0.04);
}

function schedule() {
  if (ctx.state === "suspended") ctx.resume();
  const ahead = document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD;
  // 너무 뒤처졌으면(기기 절전 등) 박자를 현재 시각으로 다시 맞춥니다
  if (nextTime < ctx.currentTime - 0.5) nextTime = ctx.currentTime + 0.05;
  while (nextTime < ctx.currentTime + ahead) {
    const swing = step % 2 ? STEP * SWING : 0;
    playStep(step, nextTime + swing);
    step++;
    nextTime += STEP;
  }
}

/** 배경음악을 시작하거나 분위기만 바꿉니다. mood: "calm" | "focus" */
export function startBgm(audio, mood = "calm") {
  if (!audio) return;
  setup(audio);
  mode = mood;
  if (loop) return;
  step = 0;
  nextTime = ctx.currentTime + 0.05;
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setTargetAtTime(VOLUME, ctx.currentTime, 0.5);
  loop = setInterval(schedule, 25);
  schedule();
}

/** 배경음악을 부드럽게 멈춥니다. */
export function stopBgm() {
  if (!loop) return;
  clearInterval(loop);
  loop = null;
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
}
