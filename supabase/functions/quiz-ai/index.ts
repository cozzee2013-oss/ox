import { decodeProtectedHeader, importX509, jwtVerify } from "npm:jose@5.9.6";
import { createHandler, buildPrompt, buildNotesPrompt } from "./core.mjs";

const project = Deno.env.get("FIREBASE_PROJECT_ID") || "";
const certUrl = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certificates: Record<string, string> = {}, validUntil = 0;
async function verify(token: string) {
  const header = decodeProtectedHeader(token);
  if (header.alg !== "RS256" || !header.kid) throw new Error("invalid token");
  if (Date.now() >= validUntil || !certificates[header.kid]) {
    const response = await fetch(certUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("certificate unavailable");
    certificates = await response.json();
    const maxAge = Number((response.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || 300);
    validUntil = Date.now() + maxAge * 1000;
  }
  if (!certificates[header.kid]) throw new Error("unknown certificate");
  const key = await importX509(certificates[header.kid], "RS256");
  const { payload } = await jwtVerify(token, key, { algorithms: ["RS256"], audience: project, issuer: `https://securetoken.google.com/${project}`, requiredClaims: ["exp", "iat", "auth_time", "sub"] });
  const now = Math.floor(Date.now() / 1000);
  const firebase = payload.firebase as { sign_in_provider?: string } | undefined;
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128 || typeof payload.iat !== "number" || payload.iat > now || typeof payload.auth_time !== "number" || payload.auth_time > now || firebase?.sign_in_provider !== "google.com" || payload.email_verified !== true) throw new Error("invalid identity");
  return payload.sub;
}
async function reserve(uid: string) {
  // No application-imposed generation quota; Google identity validation remains.
  return { allowed: true };
}
function apiKey() {
  const key = Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!key) throw new Error("OpenAI API key not configured");
  return key;
}
const outputText = (result: {output?: Array<{type?: string; content?: Array<{type?: string; text?: string}>}>}) =>
  (result.output || []).flatMap(part => part.type === "message" ? (part.content || []) : []).filter(part => part.type === "output_text").map(part => part.text || "").join("");
// 긴 원고의 한 구간을 학습 노트로 정리합니다.
async function summarize(part: string, index: number, total: number) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({ model: "gpt-4o-mini", input: [{ role: "user", content: buildNotesPrompt(part, index, total) }], max_output_tokens: 8000, store: false }),
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) { console.error("OpenAI notes status", response.status); throw new Error("AI unavailable"); }
  const result = await response.json();
  if (result.status !== "completed" && result.incomplete_details?.reason !== "max_output_tokens") throw new Error("incomplete notes");
  return outputText(result);
}
async function generate(source: string, count: number, type: string, plan: string[], condensed = false) {
  const key = apiKey();
  const item = { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["ox", "choice"] }, q: { type: "string" }, options: { type: "array", items: { type: "string" } }, answer: { type: "integer" }, exp: { type: "string" }, difficulty: { type: "string", enum: ["easy", "medium", "hard"] } }, required: ["type", "q", "options", "answer", "exp", "difficulty"] };
  const schema = { type: "object", additionalProperties: false, properties: { questions: { type: "array", items: item } }, required: ["questions"] };
  const prompt = buildPrompt(source, count, type, plan, condensed);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-4o-mini", input: [{ role: "user", content: prompt }], text: { format: { type: "json_schema", name: "quiz_questions", strict: true, schema } }, max_output_tokens: 12000, store: false }),
    signal: AbortSignal.timeout(110000)
  });
  if (!response.ok) { console.error("OpenAI request status", response.status); throw new Error("AI unavailable"); }
  const result = await response.json();
  if (result.status !== "completed") throw new Error("incomplete");
  const raw = outputText(result);
  if (!raw) throw new Error("empty AI response");
  return JSON.parse(raw).questions;
}
Deno.serve(createHandler({ verify, reserve, generate, summarize }));
