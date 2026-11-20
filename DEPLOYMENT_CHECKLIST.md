# Universal Workspace — Beta Deployment & Smoke Test Checklist

## 1. Git 커밋 전 백업 파일 정리
- 드라이브 보관용 `.v1` / `.v2` / `.v3` 파일(`*.v*.ts`, `*.v*.tsx`, `*.v*.json`, `.env.v*.example`)은 로컬 Git 저장소에서 제거하거나 별도 `archive/` 폴더로 이동합니다.

## 2. Supabase 프로젝트 설정
1. **SQL 마이그레이션 순차 적용** (`supabase/migrations/`):
   - `0001_phase1_core_schema.sql`
   - `0002_phase2_search_rpc.sql`
   - `0003_phase3_maintenance_jobs.sql`
   - `0004_phase4_auth_and_seats.sql`
   - `0005_phase5_batch_tags_and_seed.sql`
   - `0006_phase6_push_tokens.sql`
   - `0007_phase7_team_transfer.sql`
   - `0008_phase8_upgrade_intents.sql`
2. **Private Storage 버킷 생성**:
   - 버킷 이름: `inbox-originals` (반드시 **Private** — Public 체크 해제)
3. **Auth → URL Configuration / Providers**:
   - Google OAuth & Kakao OAuth 활성화
   - Redirect URLs 등록:
     - `http://localhost:3000/api/auth/callback`
     - `https://<YOUR_PROD_DOMAIN>/api/auth/callback`
     - `universal-workspace://auth/callback`

## 3. 웹(Next.js) 로컬 스모크 테스트 & 배포
1. `apps/web/.env.example`을 `apps/web/.env.local`로 복사하고 키 입력
2. 설치 및 검증:
   ```bash
   pnpm install
   pnpm --filter web typecheck
   pnpm --filter web build
   pnpm --filter web dev
   ```
3. **핵심 시나리오 검증**:
   - `/login` → Google/카카오 로그인 → 개인 워크스페이스 자동 생성 및 기본 태그 4개 시딩 확인
   - `/today` → 3초 액션 태그(`내일 확인`) + 한 줄 메모 저장 → 오늘 할 일 자동 생성 확인
   - `/inbox` → 2초 원터치 분류(`할 일로` / `프로젝트` / `보관`) + 3초 Undo 동작 확인
   - `/projects/[id]` → 팀 프로젝트 안에 `나만 보기` 기록 생성 → `7/14/30일` 공유 링크 발급 → 시크릿 창 `/s/[token]`에서 `나만 보기` 기록 미노출 확인
   - `/search` → 한국어 부분 문자열 검색 및 무료 플랜 30일 초과 잠금 카드 확인
   - `/settings` → 새 팀 워크스페이스 생성 → 개인 워크스페이스에서 선택 항목 팀 이동 → 500MB 용량·월간 AI 3종 한도·활성 공유 링크 즉시 회수 확인
4. **유지보수 크론 스케줄 등록** (Vercel Cron 등):
   - `POST https://<YOUR_PROD_DOMAIN>/api/cron/maintenance` (Header: `Authorization: Bearer <CRON_SECRET>`, 5~10분 주기 권장)

## 4. 모바일(Expo) EAS 빌드 & 실기기 테스트
1. `apps/mobile/.env.example`을 `apps/mobile/.env`로 복사 (`EXPO_PUBLIC_API_BASE_URL`은 실기기 테스트 시 PC LAN IP 또는 스테이징 HTTPS 도메인 입력)
2. `cd apps/mobile && npx eas init` 실행 후 생성된 `extra.eas.projectId`를 `app.json`에 반영
3. `apps/mobile/app/(tabs)/scan.tsx`의 `launchExistingScannerModule()`에 보유 중인 네이티브 스캐너 SDK 연결
4. `pnpm --filter mobile typecheck && pnpm --filter mobile start`
5. **실기기 시나리오 검증**:
   - Google/카카오 PKCE 딥링크 로그인 → 앱 완전 종료 후 재실행 시 세션 유지 확인 (`SecureStore` 청킹)
   - 비행기 모드에서 한 줄 메모 + 30초 음성 녹음 → 온라인 복귀 + 포그라운드 전환 시 중복 없이 자동 동기화 확인
   - `universal-workspace://scan-ingest?uri=file:///...` 딥링크 호출 → 입력함 저장 확인
   - `user_push_tokens` 테이블에 기기 Expo Push Token 정상 등록 및 로그아웃 시 삭제 확인
