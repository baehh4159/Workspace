# Universal Workspace — 다음 단계 실행 가이드 (베타 출시 로드맵)

핵심 MVP 기능과 UX(웹 6대 화면 · 모바일 3대 탭 · DB `0001`~`0007` · 오프라인 큐 · 푸시 · 우클릭/롱프레스 컨텍스트 메뉴) 구현이 완료되었습니다.
아래 **3단계 순서**대로 진행하면 로컬 검증부터 실기기 스캐너 연동, 유료화 결제 오픈까지 차근차근 마무리할 수 있습니다.

---

## 전체 진행 순서 한눈에 보기

| 단계 | 목표 | 핵심 작업 | 완료 기준 |
| :--- | :--- | :--- | :--- |
| **1단계** | 로컬·스테이징 실구동 스모크 테스트 | Supabase DB/Auth 설정 → 웹·모바일 실행 → 핵심 시나리오 검증 | 로그인·메모·음성·공유·우클릭/롱프레스가 에러 없이 동작 |
| **2단계** | 기존 스캐너 SDK 실연동 | `scan.tsx` 플레이스홀더 교체 → EAS 빌드 → 딥링크 실기기 테스트 | 스캔 완료 문서가 입력함에 자동 저장(오프라인 시 대기열 복구) |
| **3단계** | 결제 및 플랜 업그레이드 (Phase 8) | 결제사 연동(토스/Stripe/IAP) → 웹훅으로 플랜·용량·시트 갱신 | 결제 완료 시 `workspaces.plan` 갱신 및 30일 잠금 해제 |

---

## 1단계: 로컬·스테이징 실구동 스모크 테스트

가장 먼저 현재 완성된 코드가 내 PC와 실제 Supabase 환경에서 문제없이 돌아가는지 확인하는 단계입니다. (`DEPLOYMENT_CHECKLIST.md` 기준)

### 1-1. 작업 폴더 정리 (드라이브 백업 파일 제거)
Google Drive에서 `universal-workspace` 폴더를 로컬 PC로 내려받았다면, 버전 백업용으로 남겨둔 `.v1`, `.v2`, `.v3`, `.v4` 파일(`*.v*.ts`, `*.v*.tsx`, `*.v*.json`, `.env.v*.example`)은 빌드 충돌을 막기 위해 로컬 폴더에서 삭제하거나 별도 `archive/` 폴더로 옮겨둡니다.

### 1-2. Supabase 프로젝트 설정
1. [Supabase](https://supabase.com/)에서 새 프로젝트를 생성합니다.
2. **SQL 마이그레이션 순차 적용**: 좌측 **SQL Editor**에서 `supabase/migrations/` 폴더의 SQL 파일을 **반드시 아래 번호 순서대로** 복사·실행합니다.
   1. `0001_phase1_core_schema.sql`
   2. `0002_phase2_search_rpc.sql`
   3. `0003_phase3_maintenance_jobs.sql`
   4. `0004_phase4_auth_and_seats.sql`
   5. `0005_phase5_batch_tags_and_seed.sql`
   6. `0006_phase6_push_tokens.sql`
   7. `0007_phase7_team_transfer.sql`
   8. `0008_phase8_upgrade_intents.sql` (요금제 업그레이드 사전 신청 기록)
3. **Storage 버킷 생성**: 좌측 **Storage → New bucket**에서 이름이 `inbox-originals`인 버킷을 만듭니다.
   - ⚠️ **주의**: **Public bucket 체크를 반드시 해제(Private)** 해야 합니다.
4. **OAuth 로그인 설정**: 좌측 **Authentication → Providers**에서 **Google**과 **Kakao**를 활성화하고, **Authentication → URL Configuration → Redirect URLs**에 아래 3개 주소를 모두 등록합니다.
   - `http://localhost:3000/api/auth/callback`
   - `https://<실제-배포-도메인>/api/auth/callback`
   - `universal-workspace://auth/callback`

### 1-3. 환경변수 파일 세팅
1. **웹 (`apps/web`)**: `apps/web/.env.example`을 복사해 `apps/web/.env.local` 파일을 만들고 값을 채웁니다.
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase 대시보드 → Project Settings → API → Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: 같은 화면의 `anon` `public` 키
   - `SUPABASE_SERVICE_ROLE_KEY`: 같은 화면의 `service_role` `secret` 키 (절대 외부 노출 금지)
   - `NEXT_PUBLIC_APP_ORIGIN`: 로컬 테스트 시 `http://localhost:3000`
   - `CRON_SECRET`: 아무 긴 무작위 문자열 (예: `openssl rand -hex 32`로 생성)
   - `AI_PROVIDER_ENDPOINT`: 기본값 `https://api.openai.com/v1` (사용할 OpenAI 호환 엔드포인트)
   - `AI_PROVIDER_API_KEY`: 발급받은 AI API 키 (미입력 시 AI 기능 외 기본 기능은 정상 동작)
   - `NOTIFICATION_WEBHOOK_URL`: (선택) 무료 플랜 7일/1일 만료 알림용 웹훅 URL
2. **모바일 (`apps/mobile`)**: `apps/mobile/.env.example`을 복사해 `apps/mobile/.env` 파일을 만들고 값을 채웁니다.
   - `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`: 웹과 동일한 Supabase 값
   - `EXPO_PUBLIC_API_BASE_URL`:
     - 시뮬레이터/에뮬레이터 테스트 시: `http://localhost:3000`
     - **실제 스마트폰 테스트 시**: PC와 폰을 같은 와이파이에 연결한 뒤 PC의 내부 IP 입력 (예: `http://192.168.0.10:3000`)

### 1-4. 웹(Next.js) 실행 및 스모크 테스트
터미널에서 프로젝트 루트(`universal-workspace`)로 이동한 뒤 아래 명령어를 순서대로 실행합니다.

```bash
pnpm install
pnpm --filter web typecheck
pnpm --filter web build
pnpm --filter web dev
```

브라우저에서 `http://localhost:3000`을 열고 아래 항목을 하나씩 확인합니다.
- [ ] **로그인 (`/login`)**: Google 또는 카카오 로그인 → 개인 워크스페이스 자동 생성 및 기본 태그 4개 표시 확인
- [ ] **오늘 (`/today`)**: 3초 액션 태그(`내일 확인`) + 한 줄 메모 저장 → 오늘 할 일 자동 생성 확인
- [ ] **입력함 (`/inbox`)**: 2초 원터치 분류(`할 일로` / `프로젝트` / `보관`) + 5초 Undo(실행 취소) 동작 확인
- [ ] **우클릭 컨텍스트 메뉴**:
  - 각 화면 항목 위에서 우클릭 또는 `⋯` 버튼 클릭 시 메뉴가 정상 표시되는지 확인
  - 메뉴 열린 상태에서 `Esc` 또는 `Tab` 키를 눌렀을 때 깔끔하게 닫히는지 확인
  - `<input>`/`<textarea>` 입력창이나 게스트 공유 화면(`/s/[token]`)에서는 브라우저 기본 우클릭이 유지되는지 확인
- [ ] **프로젝트 & 공유 (`/projects/[id]`)**: 팀 프로젝트 안에 `나만 보기` 기록 생성 → `7/14/30일` 공유 링크 발급 → 브라우저 시크릿 창에서 `/s/[token]` 접속 시 `나만 보기` 기록이 보이지 않는지 확인
- [ ] **검색 (`/search`)**: 한국어 부분 문자열 검색, `음성 메모` 라벨 표시, 무료 플랜 30일 초과 잠금 카드 확인
- [ ] **설정 (`/settings`)**: 새 팀 워크스페이스 생성 → 개인 워크스페이스 항목을 팀으로 선택 이동 → 500MB 용량·AI 월간 한도·공유 링크 즉시 회수 확인

### 1-5. 모바일(Expo) 실행 및 실기기 테스트
```bash
cd apps/mobile
npx eas init   # 생성된 extra.eas.projectId가 app.json에 반영되었는지 확인
cd ../..
pnpm --filter mobile typecheck
pnpm --filter mobile start
```

스마트폰에서 앱을 열고 아래 항목을 확인합니다.
- [ ] **로그인 & 세션 유지**: Google/카카오 로그인 → 앱을 완전히 종료했다가 다시 켰을 때 로그인이 유지되는지 확인
- [ ] **오프라인 큐 & 30초 음성**: 스마트폰을 **비행기 모드**로 전환 → 한 줄 메모 + 30초 음성 녹음 저장 → 비행기 모드 해제 후 앱으로 돌아왔을 때 중복 없이 자동 업로드되는지 확인
- [ ] **롱프레스 컨텍스트 메뉴**: 입력함 항목을 길게 누르기(350ms) 또는 `⋯` 버튼 클릭 → 바텀시트 액션(분류/삭제 등) 정상 동작 확인
- [ ] **푸시 토큰**: Supabase `user_push_tokens` 테이블에 내 기기의 Expo Push Token이 저장되고, 로그아웃 시 삭제되는지 확인

### 1-6. 스테이징 배포 (Vercel 기준)
1. GitHub 저장소에 코드를 올린 뒤 Vercel에서 프로젝트를 Import합니다. (Root Directory: `apps/web`)
2. `.env.local`의 환경변수를 Vercel 프로젝트 설정에 입력하고, `NEXT_PUBLIC_APP_ORIGIN`을 배포된 `https://...` 도메인으로 변경합니다.
3. **유지보수 크론 등록**: Vercel Cron 또는 외부 크론 서비스에서 5~10분 주기로 아래 요청을 보내도록 설정합니다.
   - URL: `POST https://<실제-배포-도메인>/api/cron/maintenance`
   - Header: `Authorization: Bearer <CRON_SECRET>`

---

## 2단계: 기존 스캐너 SDK 실연동 & 딥링크 검증

스모크 테스트가 통과하면, 모바일 앱의 스캔 탭(`apps/mobile/app/(tabs)/scan.tsx`)에 실제 스캐너를 연결합니다.

### 2-1. 내장 스캐너 모듈 연결 (`apps/mobile/app/(tabs)/scan.tsx`)
현재 `apps/mobile/app/(tabs)/scan.tsx`의 **18~20행**은 플레이스홀더로 비워져 있습니다.

```ts
// 현재 상태 (apps/mobile/app/(tabs)/scan.tsx 18~20행)
async function launchExistingScannerModule(): Promise<ExistingScannerOutput | null> {
  return null;
}
```

이 함수 안에서 보유 중인 스캐너 SDK(예: 자체 네이티브 스캐너 모듈, `react-native-document-scanner-plugin`, Apple VisionKit / Google ML Kit 등)를 호출하고, 결과 파일을 아래 `ExistingScannerOutput` 형식에 맞춰 반환하도록 수정합니다.

```ts
// 연결 예시 (보유 중인 스캐너 SDK API에 맞게 교체)
async function launchExistingScannerModule(): Promise<ExistingScannerOutput | null> {
  const result = await MyScannerSDK.scanDocument(); // 보유 스캐너 실행
  if (!result || result.cancelled) return null;

  return {
    scanId: result.id ?? `scan_${Date.now()}`,       // 멱등성(중복 방지)용 고유 ID
    localUri: result.fileUri,                        // 예: "file:///.../document.pdf"
    fileName: result.fileName ?? 'scan.pdf',
    mimeType: result.mimeType ?? 'application/pdf',  // 'application/pdf' | 'image/jpeg' | 'image/png'
    pageCount: Math.max(1, result.pageCount ?? 1),
    suggestedTitle: result.title,                    // 선택: 문서 기본 제목
  };
}
```

> **참고**: 네이티브 스캐너 SDK를 설치하면 일반 Expo Go 앱에서는 실행되지 않습니다. 아래 명령어로 **Development Build**를 만들어 실기기에 설치한 뒤 테스트해야 합니다.
> ```bash
> cd apps/mobile
> npx eas build --profile development --platform android   # 또는 ios
> ```

### 2-2. 외부 스캐너 앱 딥링크 수신 테스트
별도의 외부 스캐너 앱에서 스캔 결과를 Universal Workspace로 넘겨줄 때는 아래 딥링크 규격을 사용합니다.

```text
universal-workspace://scan-ingest?uri=file:///경로/doc.pdf&fileName=doc.pdf&mimeType=application/pdf&pageCount=1&scanId=unique_id
```

**실기기·에뮬레이터에서 딥링크 테스트하는 방법:**
- **Android (USB 연결 후 PC 터미널에서 실행)**:
  ```bash
  adb shell am start -W -a android.intent.action.VIEW -d "universal-workspace://scan-ingest?uri=file:///sdcard/Download/sample.pdf&fileName=sample.pdf&mimeType=application/pdf&pageCount=1&scanId=test_001"
  ```
- **iOS 시뮬레이터 (Mac 터미널에서 실행)**:
  ```bash
  xcrun simctl openurl booted "universal-workspace://scan-ingest?uri=file:///tmp/sample.pdf&fileName=sample.pdf&mimeType=application/pdf&pageCount=1&scanId=test_001"
  ```
- **확인 포인트**:
  1. 딥링크 호출 시 앱의 `scan-ingest` 화면이 자동으로 열리는지 확인
  2. Presigned PUT 업로드 후 `/api/inbox/ingest`에 저장되고 입력함 목록에 뜨는지 확인
  3. 같은 `scanId`로 두 번 호출했을 때 중복 저장되지 않는지(멱등성) 확인
  4. 비행기 모드에서 호출했을 때 오프라인 대기열에 저장되었다가 온라인 복구 시 자동 전송되는지 확인

---

## 3단계: 결제 및 플랜 업그레이드 연동 (Phase 8)

베타 테스트가 안정화되고 유료화를 오픈할 시점에 진행하는 단계입니다.

### 3-1. 결제 수단 결정
서비스 대상과 배포 채널에 따라 결제 수단을 먼저 정합니다.
- **국내 웹 결제 중심**: **토스페이먼츠** (카드 정기결제 / 빌링키 발급 방식)
- **글로벌 웹 결제 중심**: **Stripe** (Stripe Checkout + Customer Portal)
- **iOS/Android 앱 내 결제**: 앱스토어·플레이스토어 정책상 디지털 구독은 **인앱결제(IAP)** 필수 → **RevenueCat**을 도입하면 웹(Stripe)과 모바일(IAP) 구독 상태를 하나의 웹훅으로 통합 관리할 수 있어 편리합니다.

### 3-2. DB 마이그레이션 추가 (`0008_phase8_billing.sql`)
결제 상태와 웹훅 중복 방지를 위한 테이블을 추가합니다.
- `workspace_subscriptions`: `workspace_id`, `provider` (`toss` | `stripe` | `revenuecat`), `customer_id`, `subscription_id`, `plan` (`free` | `pro` | `team`), `seat_limit`, `status`, `current_period_end`
- `billing_webhook_events`: `event_id` (UNIQUE) — 결제사가 같은 웹훅을 여러 번 보내도 1번만 처리되도록 멱등성 보장

### 3-3. 결제 API & 웹훅 구현 (`apps/web/src/app/api/billing/`)
1. `POST /api/billing/checkout`
   - 요청한 워크스페이스의 소유자(owner/admin) 권한을 확인한 뒤, 결제창 URL(토스페이먼츠 또는 Stripe Checkout Session)을 생성해 반환합니다.
2. `POST /api/billing/webhook`
   - 결제사 서명(Signature) 검증 → `billing_webhook_events`로 중복 여부 확인
   - 결제 성공 시 트랜잭션으로 아래 3가지를 한 번에 갱신:
     1. `workspaces.plan`을 유료 플랜(`pro` 또는 `team`)으로 변경
     2. 팀 플랜인 경우 구매한 시트 수(`seat_limit`) 반영
     3. 해당 워크스페이스 기존 항목의 **`original_expires_at = null` 초기화** (무료 플랜 30일 자동 삭제 예약 해제)
   - 구독 만료·결제 실패·환불 웹훅 수신 시 유예 기간 후 `free` 플랜으로 안전하게 다운그레이드
3. `POST /api/billing/portal` (선택)
   - 결제 수단 변경, 영수증 확인, 구독 해지를 위한 관리 페이지 URL 반환

### 3-4. 업그레이드 UI 버튼 연결
이미 만들어 둔 무료 플랜 제한 지점의 업그레이드 버튼에 `/api/billing/checkout` 호출을 연결합니다.
- **검색 화면 (`/search`)**: 무료 30일 초과 잠금(페이월) 카드의 업그레이드 버튼
- **설정 화면 (`/settings`)**: 500MB 용량 바 · 월간 AI 한도(OCR 30p / STT 15분 / 텍스트 분류 100회) · 플랜 업그레이드 버튼

### 3-5. 결제 테스트 체크리스트
- [ ] 결제사 테스트(샌드박스) 카드로 결제 진행 → 웹훅 정상 수신 확인
- [ ] 결제 직후 DB에서 `workspaces.plan` 변경 및 `original_expires_at = null` 반영 확인
- [ ] `/search`에서 30일 이전 기록의 블러/잠금 카드가 즉시 풀리고 전체 검색이 되는지 확인
- [ ] 구독 취소/만료 웹훅 테스트 시 플랜 상태가 정상적으로 반영되는지 확인

---

## 막힐 때 바로 진행하는 팁
- **1단계 진행 중** 에러가 나면 터미널 로그나 브라우저 콘솔 에러를 그대로 복사해 주시면 바로 원인을 짚어 수정해 드립니다.
- **2단계 착수 시** 사용 중인 스캐너 SDK 이름(또는 자체 모듈의 함수명·반환값)을 알려주시면 `scan.tsx` 연동 코드를 바로 작성해 드립니다.
- **3단계 착수 시** 선택하신 결제사(예: 토스페이먼츠 / Stripe / RevenueCat)와 요금제(가격·시트 수)를 알려주시면 `0008` SQL과 결제 API·웹훅 코드를 한 번에 만들어 드립니다.
