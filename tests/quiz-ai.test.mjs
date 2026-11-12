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
  assert.equal((await run(request({ ...valid, count: 21 }))).status, 400);
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
  const run = handler({ generate: async (_s, count, _t, plan) => { received = plan; return plan.map(level => ({ ...question, difficulty: level })); } });
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
