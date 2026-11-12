import { aiConfig } from "./ai-config.js";
import { loadQuiz, saveQuiz, themes, escapeHtml as esc } from "./store.js";
import { auth, watchAuth, login } from "./auth.js";
import { readManuscript } from "./manuscript.js";

const $ = id => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id");
let quiz = { id: crypto.randomUUID(), title: "", description: "", theme: "cosmic", questions: [] };
let ownerUid = "", authRequest = 0;
let imagesLoading = 0;

// 난이도: 정답을 판단하는 데 필요한 사고 수준으로 구분합니다.
const LEVELS = {
  easy: { name: "하", label: "하 · 쉬움", hint: "핵심 개념·정의·기본 사실을 묻는 1단계 사고 문제예요. 예상 정답률 80~90%" },
  medium: { name: "중", label: "중 · 보통", hint: "간단한 사례에 개념을 적용하거나 혼동하기 쉬운 개념을 구별하는 2단계 사고 문제예요. 예상 정답률 55~75%" },
  hard: { name: "상", label: "상 · 어려움", hint: "복합 사례에서 원칙과 예외, 조건 충족 여부를 종합해 판단하는 3단계 이상 추론 문제예요. 예상 정답률 25~45%" }
};
const MIX_HINT = "선택한 비율대로 하·중·상을 섞고, 쉬운 문제부터 순서대로 추가해요.";
let aiLevel = "medium";

function renderThemes() {
  $("themes").innerHTML = themes.map(theme => `<button type="button" class="theme-choice ${quiz.theme === theme.id ? "selected" : ""}" data-theme="${theme.id}" aria-pressed="${quiz.theme === theme.id}"><span class="theme-preview theme-${theme.id}"><i>✦</i><b>✳</b></span><strong>${theme.name}</strong><small>${theme.detail}</small></button>`).join("");
}
function renderQuestions() {
  $("question-count").textContent = quiz.questions.length;
  $("questions").innerHTML = quiz.questions.map((item, i) => `<article class="question-editor"><div class="question-head"><div><span class="number-badge">${String(i + 1).padStart(2, "0")}</span><strong>${item.type === "ox" ? "O/X 문제" : "객관식 문제"}</strong><select class="level-select" data-field="difficulty" data-i="${i}" data-level="${item.difficulty || ""}" aria-label="${i + 1}번 문제 난이도"><option value="" ${!item.difficulty ? "selected" : ""}>난이도 없음</option>${Object.entries(LEVELS).map(([key, level]) => `<option value="${key}" ${item.difficulty === key ? "selected" : ""}>${level.label}</option>`).join("")}</select></div><div class="question-tools"><button data-action="regen" data-i="${i}" aria-label="${i + 1}번 문제를 선택한 난이도로 AI가 다시 만들기" title="선택한 난이도로 다시 만들기">↻</button><button data-action="up" data-i="${i}" aria-label="문제 위로 이동" ${i === 0 ? "disabled" : ""}>↑</button><button data-action="down" data-i="${i}" aria-label="문제 아래로 이동" ${i === quiz.questions.length - 1 ? "disabled" : ""}>↓</button><button data-action="delete" data-i="${i}" aria-label="문제 삭제">✕</button></div></div><label class="field">문제<input data-field="q" data-i="${i}" value="${esc(item.q)}" maxlength="250" placeholder="문제를 입력하세요"></label><div class="image-field"><label class="upload-label">🖼️ 문제 이미지 추가<input type="file" accept="image/jpeg,image/png,image/webp" data-field="image" data-i="${i}"></label><span>선택 · 사진은 자동으로 크기를 줄여 저장해요</span>${item.image ? `<div class="image-preview"><img src="${esc(item.image)}" alt="문제 이미지 미리보기"><button type="button" data-action="remove-image" data-i="${i}">이미지 삭제</button></div>` : ""}</div><div class="field"><span>정답 선택 <small class="optional">정답을 눌러 선택하세요</small></span><div class="editor-options">${item.options.map((option, j) => `<div class="option-edit"><button class="correct-pick ${item.answer === j ? "picked" : ""}" data-action="answer" data-i="${i}" data-j="${j}" aria-label="${j + 1}번 정답 선택" aria-pressed="${item.answer === j}">${item.answer === j ? "✓" : j + 1}</button><input data-field="option" data-i="${i}" data-j="${j}" value="${esc(option)}" maxlength="100" ${item.type === "ox" ? "readonly" : ""} placeholder="보기 ${j + 1}"></div>`).join("")}</div></div><div class="question-details"><label class="field">해설 <span class="optional">선택</span><input data-field="exp" data-i="${i}" value="${esc(item.exp)}" maxlength="300" placeholder="정답에 대한 설명을 입력하세요"></label><label class="field time-field">제한 시간<select data-field="time" data-i="${i}">${[10, 20, 30, 45, 60, 90, 120].map(n => `<option value="${n}" ${item.time === n ? "selected" : ""}>${n}초</option>`).join("")}</select></label></div></article>`).join("");
}
$("themes").addEventListener("click", event => {
  const button = event.target.closest("[data-theme]");
  if (button) { quiz.theme = button.dataset.theme; renderThemes(); }
});
$("questions").addEventListener("input", event => {
  const el = event.target, item = quiz.questions[Number(el.dataset.i)];
  if (!item) return;
  if (el.dataset.field === "image") return;
  if (el.dataset.field === "difficulty") {
    if (el.value) item.difficulty = el.value; else delete item.difficulty;
    el.dataset.level = el.value;
    return;
  }
  if (el.dataset.field === "option") item.options[Number(el.dataset.j)] = el.value;
  else if (el.dataset.field === "time") item.time = Number(el.value);
  else if (el.dataset.field) item[el.dataset.field] = el.value;
});
$("questions").addEventListener("change", event => {
  const input = event.target;
  if (input.dataset.field !== "image" || !input.files[0]) return;
  const item = quiz.questions[Number(input.dataset.i)];
  const file = input.files[0];
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    $("editor-message").textContent = "JPG, PNG 또는 WebP 이미지를 10MB 이하로 선택해 주세요.";
    input.value = "";
    return;
  }
  imagesLoading++;
  $("editor-message").textContent = "이미지를 준비하고 있어요.";
  const reader = new FileReader();
  reader.onerror = () => { imagesLoading--; $("editor-message").textContent = "이미지를 읽지 못했어요. 다시 선택해 주세요."; };
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => { imagesLoading--; $("editor-message").textContent = "이미지를 열지 못했어요. 다른 파일을 선택해 주세요."; };
    image.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (quiz.questions.includes(item)) item.image = canvas.toDataURL("image/jpeg", .75);
      imagesLoading--;
      $("editor-message").textContent = imagesLoading ? "이미지를 준비하고 있어요." : "";
      renderQuestions();
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});
$("questions").addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const i = Number(button.dataset.i), action = button.dataset.action;
  if (action === "regen") return regenerate(i, button);
  if (action === "answer") quiz.questions[i].answer = Number(button.dataset.j);
  if (action === "delete") quiz.questions.splice(i, 1);
  if (action === "remove-image") delete quiz.questions[i].image;
  if (action === "up" && i > 0) [quiz.questions[i - 1], quiz.questions[i]] = [quiz.questions[i], quiz.questions[i - 1]];
  if (action === "down" && i < quiz.questions.length - 1) [quiz.questions[i + 1], quiz.questions[i]] = [quiz.questions[i], quiz.questions[i + 1]];
  renderQuestions();
});
function add(type) {
  quiz.questions.push({ type, q: "", options: type === "ox" ? ["O", "X"] : ["", "", "", ""], answer: 0, exp: "", time: 20 });
  renderQuestions();
  $("questions").lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
}
$("add-ox").onclick = () => add("ox");
$("add-choice").onclick = () => add("choice");
async function save() {
  if (imagesLoading) { $("editor-message").textContent = "이미지 준비가 끝나면 저장해 주세요."; return; }
  if (!ownerUid || auth.currentUser?.uid !== ownerUid) { $("editor-message").textContent = "다시 로그인한 후 저장해 주세요."; return; }
  quiz.title = $("quiz-title").value.trim();
  quiz.description = $("quiz-description").value.trim();
  let error = !quiz.title ? "퀴즈 제목을 입력해 주세요." : !quiz.questions.length ? "문제를 하나 이상 추가해 주세요." : "";
  for (let i = 0; !error && i < quiz.questions.length; i++) {
    const item = quiz.questions[i];
    if (!item.q.trim()) error = `${i + 1}번 문제를 입력해 주세요.`;
    else if (item.options.some(option => !option.trim())) error = `${i + 1}번 문제의 보기를 모두 입력해 주세요.`;
  }
  if (error) { $("editor-message").textContent = error; $("editor-message").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  $("save-btn").disabled = true;
  $("save-bottom").disabled = true;
  try { await saveQuiz(ownerUid, quiz); location.href = "index.html"; }
  catch (error) { console.error(error); $("editor-message").textContent = "저장하지 못했어요. 인터넷 연결과 Firebase 설정을 확인해 주세요."; }
  finally { $("save-btn").disabled = false; $("save-bottom").disabled = false; }
}
$("save-btn").onclick = save;
$("save-bottom").onclick = save;
$("ai-file").onchange = async event => {
  const input = event.target;
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  $("ai-file-name").textContent = file.name + " 읽는 중…";
  $("ai-message").textContent = "";
  try {
    let text = await readManuscript(file);
    const cut = text.length > 15000;
    if (cut) text = text.slice(0, 15000);
    $("ai-source").value = text;
    $("ai-file-name").textContent = file.name;
    $("ai-message").textContent = cut ? "원고가 길어 앞쪽 15,000자만 불러왔어요. 필요한 부분만 남겨 주세요." : `${text.length.toLocaleString()}자를 불러왔어요. 내용을 확인한 뒤 문제를 만들어 주세요.`;
  } catch (error) {
    $("ai-file-name").textContent = "한글·PPT·PDF·워드·텍스트 파일 (.hwp .hwpx .pptx .pdf .docx .txt)";
    $("ai-message").textContent = error.message || "파일을 읽지 못했어요.";
  }
};
// AI 서버에 문제 생성을 요청합니다. 난이도를 아직 모르는 이전 버전 서버면 난이도 없이 다시 요청합니다.
async function requestQuestions(user, body) {
  const token = await user.getIdToken();
  const call = payload => fetch(aiConfig.functionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: aiConfig.publishableKey, Authorization: "Bearer " + token },
    body: JSON.stringify(payload)
  }).then(async response => ({ response, result: await response.json() }));
  let { response, result } = await call(body);
  let legacy = false;
  if (response.status === 400 && body.difficulty && result.error === "요청 형식을 확인해 주세요.") {
    const { difficulty, ...rest } = body;
    ({ response, result } = await call(rest));
    legacy = true;
  }
  if (!response.ok) throw new Error(result.error || "문제를 만들지 못했어요.");
  if (!Array.isArray(result.questions) || !result.questions.length) throw new Error("생성된 문제를 확인하지 못했어요.");
  return { questions: result.questions, legacy };
}
const LEGACY_NOTE = " (AI 서버가 아직 난이도를 지원하지 않아 난이도 없이 만들었어요. Supabase의 quiz-ai 함수를 새 버전으로 다시 배포해 주세요.)";

function selectLevel(level) {
  aiLevel = level;
  $("ai-level").querySelectorAll("[data-level]").forEach(button => {
    const on = button.dataset.level === level;
    button.classList.toggle("selected", on);
    button.setAttribute("aria-checked", String(on));
  });
  $("ai-mix").hidden = level !== "mix";
  $("ai-level-hint").textContent = level === "mix" ? MIX_HINT : LEVELS[level].hint;
}
$("ai-level").addEventListener("click", event => {
  const button = event.target.closest("[data-level]");
  if (button) selectLevel(button.dataset.level);
});
$("ai-level").addEventListener("keydown", event => {
  const keys = ["easy", "medium", "hard", "mix"], move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (!move) return;
  event.preventDefault();
  const next = keys[(keys.indexOf(aiLevel) + move + keys.length) % keys.length];
  selectLevel(next);
  $("ai-level").querySelector(`[data-level="${next}"]`).focus();
});
selectLevel("medium");

$("ai-generate").onclick = async () => {
  const user = auth.currentUser;
  const source = $("ai-source").value.trim();
  const targetQuiz = quiz;
  if (!user || user.uid !== ownerUid) { $("ai-message").textContent = "Google 로그인 후 이용해 주세요."; return; }
  if (!source || source.length > 15000) { $("ai-message").textContent = "원고나 퀴즈 주제를 입력해 주세요. (최대 15,000자)"; return; }
  $("ai-generate").disabled = true;
  $("ai-message").textContent = "원고를 읽고 문제를 만들고 있어요.";
  try {
    const difficulty = aiLevel === "mix" ? $("ai-mix").value : aiLevel;
    const { questions, legacy } = await requestQuestions(user, { source, type: $("ai-type").value, count: Number($("ai-count").value), difficulty });
    if (auth.currentUser?.uid !== user.uid || targetQuiz !== quiz) throw new Error("계정이 변경되어 문제를 추가하지 않았어요.");
    quiz.questions.push(...questions);
    renderQuestions();
    const tally = Object.keys(LEVELS).map(key => [LEVELS[key].name, questions.filter(q => q.difficulty === key).length]).filter(([, n]) => n).map(([name, n]) => `${name} ${n}`).join(" · ");
    $("ai-message").textContent = `${questions.length}개 문제를 추가했어요${tally ? ` (${tally})` : ""}. 정답·해설·난이도를 확인한 뒤 저장해 주세요.` + (legacy ? LEGACY_NOTE : "");
    $("questions").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("ai-message").textContent = error.message || "연결에 실패했어요. 다시 시도해 주세요.";
  } finally {
    $("ai-generate").disabled = false;
  }
};

// 한 문제를 그 문제에 지정한 난이도로 AI가 새로 만듭니다.
// 위의 '주제 또는 원고'가 있으면 그 내용에서, 없으면 지금 문제·해설의 내용을 바탕으로 만듭니다.
async function regenerate(i, button) {
  const user = auth.currentUser, item = quiz.questions[i], targetQuiz = quiz;
  if (!user || user.uid !== ownerUid) { $("editor-message").textContent = "Google 로그인 후 이용해 주세요."; return; }
  const source = ($("ai-source").value.trim() || [item.q, item.exp].filter(Boolean).join("\n")).slice(0, 15000);
  if (!source.trim()) { $("editor-message").textContent = `${i + 1}번 문제를 입력하거나 위에 주제·원고를 넣은 뒤 다시 만들어 주세요.`; return; }
  const level = item.difficulty || "medium";
  button.disabled = true;
  button.classList.add("spinning");
  $("editor-message").textContent = `${i + 1}번 문제를 '${LEVELS[level].label}' 난이도로 다시 만들고 있어요.`;
  try {
    const { questions: [made], legacy } = await requestQuestions(user, { source, type: item.type, count: 1, difficulty: level });
    if (auth.currentUser?.uid !== user.uid || targetQuiz !== quiz || quiz.questions[i] !== item) throw new Error("편집 중인 문제가 바뀌어 적용하지 않았어요.");
    Object.assign(item, { type: made.type, q: made.q, options: made.options, answer: made.answer, exp: made.exp, difficulty: legacy ? item.difficulty : made.difficulty });
    if (!item.difficulty) delete item.difficulty;
    renderQuestions();
    $("editor-message").textContent = `${i + 1}번 문제를 새로 만들었어요. 정답과 해설을 확인해 주세요.` + (legacy ? LEGACY_NOTE : "");
  } catch (error) {
    $("editor-message").textContent = error.message || "연결에 실패했어요. 다시 시도해 주세요.";
    button.disabled = false;
    button.classList.remove("spinning");
  }
}
$("editor-login").onclick = async () => {
  try { await login(); }
  catch (error) { console.error(error); $("auth-message").textContent = "로그인하지 못했어요. 팝업 허용과 Firebase 설정을 확인해 주세요."; }
};
watchAuth(async user => {
  const request = ++authRequest;
  ownerUid = "";
  $("editor-layout").hidden = true;
  $("editor-auth").hidden = false;
  if (!user || user.isAnonymous) return;
  $("auth-message").textContent = "내 퀴즈를 불러오는 중이에요.";
  try {
    const loaded = id ? await loadQuiz(user.uid, id) : null;
    if (request !== authRequest) return;
    if (id && !loaded) { $("auth-message").textContent = "이 계정에서 해당 퀴즈를 찾을 수 없어요."; return; }
    quiz = loaded || { id: crypto.randomUUID(), title: "", description: "", theme: "cosmic", questions: [] };
    ownerUid = user.uid;
    $("quiz-title").value = quiz.title;
    $("quiz-description").value = quiz.description || "";
    $("auth-message").textContent = "";
    $("editor-message").textContent = "";
    renderThemes();
    renderQuestions();
    $("editor-auth").hidden = true;
    $("editor-layout").hidden = false;
  } catch (error) {
    console.error(error);
    if (request === authRequest) $("auth-message").textContent = "퀴즈를 불러오지 못했어요. Firebase 설정을 확인해 주세요.";
  }
});
