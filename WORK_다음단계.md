# OX 독립 설치 다음 단계

이 폴더는 원본 GitHub 계정·Firebase·Supabase 연결 정보를 제거한 **설치 전 소스**입니다.

1. 새 사용자의 GitHub 계정으로 새 `ox` 저장소를 만들어 이 폴더의 파일을 올립니다.
2. `js/config.js`에 새 Firebase 웹 앱 설정을 입력합니다. Authentication에서 Google/익명 로그인을 활성화하고 GitHub Pages 도메인을 승인합니다.
3. 새로운 Realtime Database를 생성해 `database.rules.json`의 규칙을 적용합니다. 기존 데이터베이스와 연결하지 않습니다.
4. 새 Supabase 프로젝트의 SQL Editor에서 `supabase/quiz-ai-quota.sql`을 실행합니다.
5. 새 Supabase의 Edge Function `quiz-ai`에 `supabase/functions/quiz-ai/index.ts`와 `core.mjs`를 배포합니다. 이 함수는 Firebase ID 토큰을 자체 검증하므로 **Supabase JWT 검사(verify_jwt)를 끄되** Firebase 검증 코드는 유지해야 합니다.
6. 새 Supabase 프로젝트의 Edge Function 비밀 환경변수에 `GEMINI_API_KEY`, `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGIN`을 설정합니다. `ALLOWED_ORIGIN`은 최종 GitHub Pages **origin만** 입력합니다. 예: `https://YOUR_GITHUB_USERNAME.github.io` (경로 `/ox` 제외).
7. `js/ai-config.js`에 새 프로젝트 Function URL과 Supabase **publishable** 키를 넣습니다. 서비스 역할 키나 Gemini 비밀 키를 넣지 않습니다.
8. HTML의 `YOUR_GITHUB_USERNAME`, `YOUR_REPOSITORY` 플레이스홀더를 실제 주소로 바꾸고 GitHub Pages 배포를 확인합니다.
9. AI 문제 생성, 저장, 실시간 PIN 참가, 보고서, 클래스, 야간 모드를 실제 브라우저에서 검증합니다.
10. **슬라이드 복습**에서 기본 퀴즈와 직접 저장한 퀴즈를 모두 시험합니다. 카드의 ‘슬라이드 보기’를 눌러 **문제·보기 → 정답·해설 → 다음 문제 → 마지막 종료 화면**이 순서대로 표시되는지 검사합니다. 이전 버튼, 방향키, 전체화면과 모바일 화면도 확인합니다. 슬라이드 복습은 학생 PIN이나 점수 기록 없이 읽기 전용으로 작동해야 합니다.

## 교수님 수업 페이지 연결 — 별도 후속 작업

교수님이 기존에 운영하는 수업 저장소의 HTML 본문을 읽어 OX 퀴즈 생성으로 연결하는 기능은 **본 패키지에 아직 구현되어 있지 않습니다.** 새 `ox` 저장소의 설치와 동작 검증을 먼저 마친 다음 교수님 수업 저장소 URL 및 HTML 본문 선택자를 확인해 별도 작업으로 진행하세요. 원고가 15,000자를 넘을 때의 처리 방식과 접근 권한/CORS도 검토해야 합니다.

**주의** ① `FIREBASE_PROJECT_ID`가 없으면 AI 인증 실패 ② `ALLOWED_ORIGIN`이 실제 사이트와 다르면 CORS 실패 ③ `quiz_ai_reserve` SQL이 없으면 AI 할당량 검사 실패입니다.

사용자 비밀번호, 개인 API 키, Supabase service-role 키는 채팅이나 공개 GitHub에 입력하지 않습니다. 필요한 승인은 사용자가 해당 사이트의 안전한 계정 설정 화면에서 직접 수행합니다.
