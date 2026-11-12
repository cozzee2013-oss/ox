import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../supabase/functions/quiz-ai/core.mjs";

const origin = "https://example.github.io";
const source = "컴퓨터는 정보를 0과 1로 표현합니다. 이진수는 두 개의 숫자를 사용합니다.";
const question = { type: "ox", q: "컴퓨터는 0과 1을 사용한다.", options: ["O", "X"], answer: 0, exp: "원고에서 0과 1을 사용한다고 설명합니다." };
const request = (body, overrides = {}) => new Request("https://example.test", { method: "POST", headers: { origin, authorization: "Bearer valid" }, body: JSON.stringify(body), ...overrides });
const valid = { source, count: 1, type: "ox" };
const handler = overrides => createHandler({ verify: async token => token === "valid" ? "user-a" : null, reserve: async () => ({ allowed: true }), generate: async () => [question], ...overrides });

test("로그인과 허용 출처를 확인한다", async () => {
  assert.equal((await handler()(request(valid, { headers: { origin } }))).status, 401);
  assert.equal((await handler()(request(valid, { headers: { origin: "https://other.example", authorization: "Bearer valid" } }))).status, 403);
  assert.equal((await handler()(request(valid, { headers: { origin, authorization: "Bearer invalid" } }))).status, 401);
});
test("입력이 유효할 때만 사용량을 예약한다", async () => {
  let reservations = 0;
  const run = handler({ reserve: async () => { reservations++; return { allowed: true }; } });
  assert.equal((await run(request({ ...valid, source: "" }))).status, 400);
  assert.equal((await run(request({ ...valid, count: 51 }))).status, 400);
  assert.equal(reservations, 0);
  const result = await run(request({ ...valid, source: "성경인물" }));
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).questions, [{ ...question, time: 20, difficulty: "medium" }]);
  assert.equal(reservations, 1);
});
test("호출 제한은 AI 호출 전에 적용된다", async () => {
  let generated = 0;
  const run = handler({ reserve: async () => ({ allowed: false, reason: "daily" }), generate: async () => { generated++; return [question]; } });
  assert.equal((await run(request(valid))).status, 429);
  assert.equal(generated, 0);
});
test("유형·보기·정답이 잘못된 AI 결과는 표시하지 않는다", async () => {
  const cases = [
    { ...question, options: ["X", "O"] },
    { ...question, answer: 2 },
    { ...question, exp: "" },
    { ...question, type: "choice", options: ["1", "2", "3", "4"] },
  ];
  for (const item of cases) assert.equal((await handler({ generate: async () => [item] })(request(valid))).status, 502);
});

test("AI가 정답을 모두 1번에 배치해도 객관식 정답 위치를 골고루 바꾼다", async () => {
  const generated = Array.from({ length: 12 }, (_, index) => ({
    type: "choice",
    q: `성경 인물 문제 ${index + 1}`,
    options: [`정답 ${index}`, `오답 A ${index}`, `오답 B ${index}`, `오답 C ${index}`],
    answer: 0,
    exp: `해설 ${index}`
  }));
  const originalOptions = generated.map(item => [...item.options]);
  const run = handler({ generate: async () => generated });
  const result = await run(request({ source, count: 12, type: "choice" }));
  assert.equal(result.status, 200);
  const { questions } = await result.json();
  assert.equal(questions.length, 12);
  const positionCounts = [0, 0, 0, 0];
  questions.forEach((item, index) => {
    positionCounts[item.answer]++;
    assert.equal(item.options[item.answer], `정답 ${index}`);
    assert.deepEqual([...item.options].sort(), originalOptions[index].sort());
    assert.equal(item.exp, `해설 ${index}`);
  });
  assert.deepEqual(positionCounts, [3, 3, 3, 3]);
});

import { difficultyPlan, buildPrompt } from "../supabase/functions/quiz-ai/core.mjs";
const tally = plan => plan.reduce((t, level) => ({ ...t, [level]: (t[level] || 0) + 1 }), {});

test("난이도별·혼합 출제 비율대로 문항 난이도를 배분한다", () => {
  assert.deepEqual(difficultyPlan(5, "hard"), Array(5).fill("hard"));
  assert.deepEqual(difficultyPlan(3), Array(3).fill("medium"));
  assert.deepEqual(tally(difficultyPlan(10, "basic")), { easy: 5, medium: 4, hard: 1 });
  assert.deepEqual(tally(difficultyPlan(10, "standard")), { easy: 2, medium: 6, hard: 2 });
  assert.deepEqual(tally(difficultyPlan(10, "advanced")), { easy: 1, medium: 4, hard: 5 });
  for (const mix of ["basic", "standard", "advanced"]) for (let n = 1; n <= 20; n++) assert.equal(difficultyPlan(n, mix).length, n);
  assert.deepEqual(difficultyPlan(5, "standard"), ["easy", "medium", "medium", "medium", "hard"]);
});

test("지시문에는 요청한 난이도의 기준만 넣는다", () => {
  const easy = buildPrompt("평등선거", 3, "ox", difficultyPlan(3, "easy"));
  assert.match(easy, /하\(쉬움\) 3개/);
  assert.match(easy, /1단계 사고/);
  assert.doesNotMatch(easy, /3단계 이상의 논리적 추론/);
  const mixed = buildPrompt("평등선거", 10, "mixed", difficultyPlan(10, "advanced"));
  assert.match(mixed, /하\(쉬움\) 1개, 중\(보통\) 4개, 상\(어려움\) 5개/);
  assert.match(mixed, /3단계 이상의 논리적 추론/);
});

test("난이도를 검사하고 문항마다 저장한다", async () => {
  let received;
  const run = handler({ generate: async (_s, count, _t, plan) => { received = plan; return plan.map((level, i) => ({ ...question, q: `문제 ${i}`, difficulty: level })); } });
  assert.equal((await run(request({ ...valid, difficulty: "extreme" }))).status, 400);
  const plain = await (await run(request(valid))).json();
  assert.equal(plain.questions[0].difficulty, "medium");
  const result = await run(request({ ...valid, count: 5, difficulty: "standard" }));
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).questions.map(q => q.difficulty), ["easy", "medium", "medium", "medium", "hard"]);
  assert.deepEqual(received, ["easy", "medium", "medium", "medium", "hard"]);
  // AI가 요청하지 않은 난이도를 붙이면 배분 계획을 따른다
  const wrong = handler({ generate: async () => [{ ...question, difficulty: "easy" }] });
  assert.equal((await (await wrong(request({ ...valid, difficulty: "hard" }))).json()).questions[0].difficulty, "hard");
});

import { splitSource, condenseSource, SINGLE_LIMIT, MAX_SOURCE } from "../supabase/functions/quiz-ai/core.mjs";

test("긴 원고는 문단 경계에서 빠짐없이 구간으로 나눈다", () => {
  const paragraphs = Array.from({ length: 400 }, (_, i) => `제${i + 1}문단 ` + "가".repeat(600));
  const text = paragraphs.join("\n\n");
  const parts = splitSource(text);
  assert.ok(parts.length >= 3);
  assert.ok(parts.every(part => part.length <= SINGLE_LIMIT));
  assert.equal(parts.join("\n\n"), text);
  assert.ok(parts.every(part => part.startsWith("제")));
  assert.deepEqual(splitSource("짧은 원고"), ["짧은 원고"]);
});

test("긴 원고는 모든 구간을 정리해 순서대로 합친다", async () => {
  const seen = [];
  const notes = await condenseSource("A".repeat(SINGLE_LIMIT * 2 + 10), async (part, i, total) => { seen.push([i, total, part.length]); return `노트${i}`; });
  assert.deepEqual(seen.map(([i]) => i).sort(), [1, 2, 3]);
  assert.match(notes, /\[구간 1\/3\]\n노트1[\s\S]*\[구간 3\/3\]\n노트3/);
});

test("15,000자를 넘는 원고도 받고, 긴 원고는 전체를 정리한 노트로 출제한다", async () => {
  let material, condensedFlag, summaries = 0;
  const run = handler({
    summarize: async (part, i) => { summaries++; return `구간${i} 핵심`; },
    generate: async (src, count, type, plan, condensed) => { material = src; condensedFlag = condensed; return [question]; }
  });
  const medium = "가".repeat(50000);
  assert.equal((await run(request({ ...valid, source: medium }))).status, 200);
  assert.equal(material, medium);
  assert.equal(condensedFlag, false);
  assert.equal(summaries, 0);
  const long = "나".repeat(250000);
  const result = await run(request({ ...valid, source: long }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).sections, 4);
  assert.equal(summaries, 4);
  assert.equal(condensedFlag, true);
  assert.match(material, /구간1 핵심[\s\S]*구간4 핵심/);
  assert.equal((await run(request({ ...valid, source: "다".repeat(MAX_SOURCE + 1) }))).status, 413);
});

import { batchPlan, partitionSource } from "../supabase/functions/quiz-ai/core.mjs";

test("20문제가 넘으면 하·중·상이 고르게 섞인 묶음으로 나눈다", () => {
  const batches = batchPlan(difficultyPlan(50, "standard"));
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map(b => b.length), [17, 17, 16]);
  assert.ok(batches.every(b => b.includes("easy") && b.includes("medium") && b.includes("hard")));
  assert.equal(batchPlan(difficultyPlan(20)).length, 1);
});

test("긴 원고는 묶음마다 앞뒤 부분을 나눠 주고, 짧은 주제는 함께 쓴다", () => {
  const text = Array.from({ length: 30 }, (_, i) => `문단${i} ` + "다".repeat(300)).join("\n");
  const { parts, shared } = partitionSource(text, 3);
  assert.equal(shared, false);
  assert.equal(parts.length, 3);
  assert.equal(parts.join("\n"), text);
  assert.ok(parts[0].startsWith("문단0") && parts[2].includes("문단29"));
  assert.deepEqual(partitionSource("성경인물 퀴즈", 3), { parts: ["성경인물 퀴즈", "성경인물 퀴즈", "성경인물 퀴즈"], shared: true });
});

test("50문제까지 묶음으로 만들어 합치고, 겹치는 문제는 하나만 남긴다", async () => {
  const calls = [];
  const run = handler({ generate: async (src, count, type, plan, condensed, batch) => {
    calls.push({ count, batch });
    return plan.map((level, i) => ({ ...question, q: `묶음${batch.index} 문제${i} ${level}`, difficulty: level }));
  } });
  const result = await run(request({ ...valid, count: 50, difficulty: "advanced" }));
  assert.equal(result.status, 200);
  const { questions } = await result.json();
  assert.equal(questions.length, 50);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.count <= 20 && c.batch.total === 3));
  const order = { easy: 0, medium: 1, hard: 2 };
  assert.ok(questions.every((q, i) => !i || order[questions[i - 1].difficulty] <= order[q.difficulty]));
  assert.equal((await run(request({ ...valid, count: 51 }))).status, 400);
  const dup = handler({ generate: async (src, count, type, plan) => plan.map(level => ({ ...question, difficulty: level })) });
  assert.equal((await (await dup(request({ ...valid, count: 25 }))).json()).questions.length, 1);
});
