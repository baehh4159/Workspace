# 범용 워크스페이스 앱 설계 계획서 및 코드 구조 (v2.1 완성본)

## 0. 프로젝트 개요

### 이 앱은 무엇인가요?

이 프로젝트는 **개인 사용자와 10명 이하 소규모 팀이 흩어진 업무 정보(스캔 문서·메모·일정·할 일·프로젝트)를 한곳으로 모아 실행으로 연결하는 '범용 메인 워크스페이스'**입니다.

특정 직군(영업·미팅) 전용 앱으로 제한하지 않고, **누구나 매일 쓰는 범용 업무 코어(입력함 · 할 일 · 자체 일정 · 프로젝트)**를 중심에 둡니다. 이미 존재하는 **기존 스캐너**에서 들어오는 스캔 문서와 현장의 빠른 기록을 모두 **입력함(Inbox)**으로 받아 정리한 뒤, 할 일·자체 일정·프로젝트로 연결하는 흐름이 제품의 뼈대입니다. 명함 관리, 미팅 브리핑, 외부 예약 링크, 외부 캘린더 연동 같은 특화 기능은 메인 코어를 건드리지 않고 얹을 수 있는 **선택형 플러그인(Plugin)** 구조로 분리합니다.

### 왜 이 앱을 쓰게 되나요? (킬러 워크플로우)

노션은 처음부터 구조를 짜야 하는 **백지 정리 피로도**가 크고, 카카오톡 '나와의 채팅'은 올려둔 파일과 메모를 **다시 찾지 못하는 무덤**이 됩니다. 이 앱은 **'스캔 직후 5초 안에 끝나는 액션화'**로 그 사이를 파고듭니다.

```text
[기존 스캐너(계약서·견적서·영수증·자료)] ──┐
                                           ├──▶ [입력함 (Inbox)] ──▶ [2초 원터치 분류]
[빠른 입력 (3초 태그 · 10초 텍스트 · 30초 음성)] ┘                         │
                                                                          ▼
                                                       [할 일 · 자체 일정 · 프로젝트 연결]
                                                                          │
                                                                          ▼
                                                       [선택형 플러그인: 명함 · 미팅 · 예약]
```

- **입력함 피로도 차단:** 입력함은 정성껏 문서화하는 공간이 아니라 **카드당 2초 안에 치우는 공간**(원터치 3버튼: `할 일로` / `프로젝트로` / `보관`)으로 설계합니다. **7일 이상 미처리된 스캔 문서**는 '미분류 아카이브'로 자동 접어두어 쌓인 배지 숫자로 인한 죄책감을 없앱니다.
- **기존 스캐너 연동 깊이:** 리텐션 극대화를 위해 **계정(SSO) 공유 + 스캔 완료 직후 3초 태그/액션 바텀시트 노출**을 이상적 목표로 두되, 기존 스캐너 앱 수정 범위에 따라 **딥링크/Share Sheet + 푸시 알림**으로도 동작하도록 표준 인입 계약을 이중 지원합니다.
- **주력 클라이언트 우선순위:** 기존 스캐너가 돌아가는 환경을 1차 주력 클라이언트(수집·빠른 입력·오늘 확인)로 완성하고, 보조 클라이언트는 대량 정리(Triage)·프로젝트 보드·팀 관리용으로 얇게 가져갑니다.

### 1차 집중 범위 vs 선택형 플러그인

| 구분 | 포함 범위 | 설계 원칙 |
| :--- | :--- | :--- |
| **1차 집중 (범용 메인 코어)** | 입력함(Inbox), 기존 스캐너 2단계 인입 API, 빠른 입력(상태/액션 태그·텍스트·음성), OCR 본문 검색, 할 일, 자체 일정, 프로젝트, 게스트 공유 링크, 개인/팀 멀티 워크스페이스 | 외부 서비스 의존 없이 **자체 일정·할 일·스캔 문서 흐름만으로 완결** |
| **기존 자산 연동** | 기존 스캐너 모듈 | 별도 재개발 없이 표준 2단계 업로드(`upload-url` → `ingest`)로 입력함에 문서 전달 |
| **선택형 플러그인 (확장)** | 명함·인물 관리, 미팅 브리핑(외부 참석자 필터 선택 옵션 포함), 외부 예약 링크, 외부 캘린더(Google/Apple 등) 연동 | 메인 코어의 `entity_links`와 이벤트 훅을 구독하는 독립 모듈로 수요 검증 후 탑재 |

### 초기 검증이 필요한 가설 (확정 사실로 전제하지 않음)

- 개인 무료 사용자의 30일 경과 시점 유료 전환율 및 소규모 팀 대표의 실제 결제 트리거
- 게스트 공유 링크를 통한 동료 1클릭 팀 합류 전환율
- 국내 타겟 직군별 외부 캘린더(Google·Apple·Naver 등) 실제 사용 비중 및 연동 우선순위

---

## 1. 제품·운영·보안 핵심 정책 (확정안)

### 1) 빠른 입력: `3초 태그 → 10초 텍스트 → 30초 음성`

조용한 환경에서도 AI 없이 즉시 기록되도록 3가지 입력을 나란히 제공합니다.

- **상태 기록 태그(`kind = 'status'`) vs 할 일 생성 태그(`kind = 'action_trigger'`) 분리:**
  - `완료`, `회신 대기`, `관심 높음`, `보류` 같은 상태 태그는 항목의 상태만 기록합니다.
  - `내일 확인`, `이번 주 마감`, `2주 뒤 재연락`처럼 명시적으로 액션 생성이 정의된 태그만 할 일(`tasks`)을 생성합니다.
- **10초 텍스트:** 한 줄 메모를 AI 호출 없이 즉시 저장하고, 필요할 때만 선택형 AI 분류를 실행합니다.
- **30초 음성:** 말로 길게 남겨야 할 때 선택 사용합니다.

### 2) 멀티 워크스페이스 전환 및 기록 공개 범위 분리

- **개인 → 팀 전환 모델 (승격 비권장):** 모든 사용자는 가입 시 영구적인 **`personal` 워크스페이스 1개**를 기본 보유하며, 팀을 만들면 **별도의 `team` 워크스페이스(최대 10인)**가 생성됩니다. 1인이 여러 팀에 동시 소속될 수 있고, 퇴사 시에도 개인 워크스페이스가 안전하게 유지됩니다.
- **선택 이동 및 기록 공개 분리:** 개인 항목을 팀으로 복사/이동하거나 동일 인물을 연결하더라도, 연결되어 있던 **기존 개인 기록(`records`)은 비공개(`private`) 상태를 유지**합니다. 팀에 공개할 기록은 사용자가 항목별로 명시 선택하며, 통합 타임라인에서도 각 레코드의 RLS 권한을 개별 유지합니다.

### 3) 요금제 경계 · AI 원가 통제 · 원본 보관 정책

| 구분 | 무료 플랜 (체험 및 습관 형성) | 유료 플랜 (개인 프로 / 10인 이하 팀) |
| :--- | :--- | :--- |
| **원본 보관 & 본문 검색** | **최근 30일 또는 500MB** (검색 체험·보관 기간 '30일' 통일) | **원본 장기 보관 + 전체 기간 본문 검색·AI 질의** |
| **만료 및 삭제 정책** | `user_confirmed_at` 여부와 무관하게 30일(또는 500MB) 도달 시 원본 정리 (만료 **7일·1일 전 알림 + 원본 다운로드** 제공, 추출 텍스트·요약·할 일은 유지 / 단, AI 처리 `failed` 상태 원본은 삭제 유예) | **`user_confirmed_at` 전 자동 삭제 금지** + 사용자 설정 기반 보관 |
| **월간 AI 한도** | **문서 OCR 30페이지 + 음성 STT 15분 + 텍스트 분류 100회** | 플랜별 유형 단위 크레딧 풀 제공 (정액제라도 원가 상한 적용, 초과 시 애드온) |
| **전환 힌트 UX** | 30일 이전 문서 키워드 검색 시 *"30일 이전 스캔 문서에서 N건 더 발견됨"* 건수 힌트 노출 | 전체 기간 검색 결과 및 원본 파일 즉시 열람 |

- **AI 한도 동시성 방어:** `workspace_ai_quotas` 테이블에 `FOR UPDATE` 행 락을 걸어 실행 전 **원자적 선차감(Reserve) → 성공 시 확정(Commit) / 실패 시 즉시 환불(Release)** 패턴을 적용합니다.

### 4) 게스트 공유 링크 (팀 전환 마찰 제거)

- 동료에게 스캔 문서와 프로젝트 체크리스트를 공유할 때 로그인·앱 설치 없이 웹에서 바로 열람할 수 있게 합니다.
- 동료가 **완료 체크·댓글·담당 수락**을 누르는 순간 **1클릭(구글/카카오 OAuth)**으로 가입 및 팀 합류로 자연스럽게 이어집니다.
- **만료 및 회수:** 기본 만료 기간은 **14일**(생성 시 7일 / 14일 / 30일 선택 가능)이며, `revoked_at`으로 언제든 즉시 회수할 수 있습니다.
- **화이트리스트 렌더링 원칙:** `share_tokens`로 문서를 열 때 공유 대상 본체와 공개 지정된 체크리스트만 반환하며, 해당 대상에 연결된 개인 `records (visibility = 'private')`는 절대 함께 내려가지 않습니다.

### 5) 외부 심사 트랙 및 향후 예약 플러그인 기술 기준

- **출시 심사·테스트 분리:** Google Calendar 등 외부 OAuth 연동 시 민감 스코프 검증([공식 안내](https://developers.google.com/workspace/calendar/api/auth) 최대 10일 + 보완 여유)과 제한 스코프 보안 평가를 구분하고, Apple TestFlight 외부 테스트 리뷰 및 Google Play 내부 테스트 성격 차이를 반영해 '조기 테스트'와 '정식 심사 준비'를 별도 트랙으로 관리합니다.
- **향후 예약 플러그인 요구사항:** 단순 Free/Busy 재조회(잠금이 아님)에 의존하지 않고, ① 내부 DB 원자적 겹침 방지(`EXCLUDE USING gist` 또는 직렬화 트랜잭션), ② 재시도 중복 방지용 `Idempotency-Key`, ③ 외부 캘린더 반영 실패 시 보상·재처리 정책, ④ 외부 수동 일정 충돌 해소를 구현하며, 노쇼 방지(알림·재확인·취소)와 배정 방식(라운드 로빈 vs 다인 공동 참석)을 별도 설계합니다.

---

## 2. 기술 스택 및 모노레포 코드 구조

| 레이어 | 선정 기술 | 역할 |
| :--- | :--- | :--- |
| **모노레포** | [Turborepo](https://turborepo.dev/docs) + pnpm workspace | 웹·모바일·플러그인 간 타입, Zod 스키마, 도메인 로직 공유 |
| **웹 앱** | [Next.js](https://turborepo.dev/docs/guides/frameworks/nextjs) (App Router, Tailwind CSS) | 데스크톱 워크스페이스, 게스트 공유 웹뷰(`/s/[token]`), API Route |
| **모바일 앱** | [Expo (React Native)](https://docs.expo.dev/guides/monorepos/) | 빠른 입력(태그·텍스트·음성), 오늘 일정, 스캐너 연동, 푸시 알림 |
| **DB·인증·스토리지** | [Supabase](https://supabase.com/docs) (PostgreSQL + Auth + Private Storage) | [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) 권한 격리, `pg_trgm` 한국어 검색, 단기 Signed URL 발급 |
| **AI 파이프라인** | 유형별 멀티모달 LLM / STT | 페이지·음성 분량·텍스트 분류별 `Reserve → Commit/Release` 계량 처리 |

### 폴더 구조

```text
universal-workspace/
├── turbo.json
├── package.json
├── pnpm-workspace.yaml
├── apps/
│   ├── web/                          # Next.js (데스크톱 앱 + 게스트 공유 페이지 + API)
│   │   └── src/app/
│   │       ├── (auth)/               # 로그인, 개인/팀 멀티 워크스페이스 전환
│   │       ├── (main)/
│   │       │   ├── today/            # 오늘 할 일 + 자체 일정 통합 뷰
│   │       │   ├── inbox/            # 스캔 문서 + 빠른 입력 2초 Triage + 7일 자동 아카이브
│   │       │   ├── search/           # pg_trgm 본문 검색 + 무료 30일 이전 건수 힌트 UI
│   │       │   ├── projects/         # 프로젝트별 연결된 문서·할 일·일정·기록
│   │       │   ├── calendar/         # 자체 일정 (종일/타임존 지원)
│   │       │   └── settings/         # 팀 멤버(<=10), AI 한도/원본 보관, 플러그인 온/오프
│   │       ├── s/[token]/            # 게스트 공유 웹페이지 (화이트리스트 렌더링 + 1클릭 합류)
│   │       └── api/
│   │           ├── inbox/            # upload-url(Presigned), ingest(커밋), quick, triage, confirm
│   │           ├── files/            # RLS·share_tokens 검증 후 Private Storage 단기 Signed URL 발급
│   │           ├── search/           # 본문 검색 + 무료 플랜 기간 외 건수 힌트 반환
│   │           ├── tasks/            # 할 일 CRUD
│   │           ├── events/           # 자체 일정 CRUD
│   │           ├── projects/         # 프로젝트 및 연결 항목(보안 RPC) 조회
│   │           ├── records/          # 기록 저장 및 개별 visibility 변경
│   │           ├── shares/           # 게스트 share_tokens 생성(7/14/30일)·회수(revoke)
│   │           └── ai/               # Reserve → 실행 → Commit/Release 파이프라인
│   │
│   └── mobile/                       # Expo Router (현장 빠른 입력 + 오늘 뷰)
│       └── app/
│           ├── (tabs)/
│           │   ├── today.tsx         # 오늘 할 일 · 자체 일정
│           │   ├── inbox.tsx         # 스캔 문서 · 2초 원터치 Triage
│           │   ├── projects.tsx      # 프로젝트 목록·상세
│           │   └── quick-capture.tsx # 3초 태그 · 10초 텍스트 · 30초 음성 시트
│           └── services/             # 오프라인 임시 저장 큐, 기존 스캐너 SSO/딥링크 브리지
│
├── packages/
│   ├── core/                         # 범용 메인 순수 도메인 로직
│   │   ├── schemas/                  # Zod 스키마
│   │   ├── tagging/                  # status vs action_trigger 태그 엔진
│   │   ├── triage/                   # 입력함 분류 및 7일 자동 접기 규칙
│   │   ├── metering/                 # 유형별 AI 크레딧 계산 및 페이월 판정
│   │   └── sharing/                  # 게스트 화이트리스트 직렬화기
│   ├── db/                           # Supabase 타입, Repository, 보안 RPC 래퍼
│   ├── ai/                           # OCR, STT, 선택형 텍스트 분류·요약 파이프라인
│   ├── plugin-sdk/                   # 플러그인 인터페이스 (훅, 엔티티 확장)
│   ├── plugins/                      # 선택형 플러그인 (추후 순차 구현)
│   │   ├── contacts-card/            # 명함·인물 연결 플러그인
│   │   ├── meeting-brief/            # 미팅 브리핑 플러그인 (외부 참석자 필터 선택 옵션)
│   │   └── booking-link/             # 예약 링크 플러그인 (원자적 예약·노쇼 방지 분리)
│   └── api-client/                   # 웹·모바일 공용 API 클라이언트
│
└── supabase/
    ├── migrations/                   # 테이블, pg_trgm 인덱스, 활성 멤버 RLS, 보안 RPC, 트리거
    └── functions/                    # 비동기 AI 워커, 무료 30일 만료 7일/1일 전 알림·정리 잡
```

---

## 3. 데이터베이스 스키마 · 보안 RLS · 원자적 RPC (v2.1 확정)

```sql
create extension if not exists pg_trgm;

-- 1. 멀티 워크스페이스 (영구 personal 1개 + 별도 team <= 10인)
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('personal', 'team')),
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  max_seats int not null default 10,
  storage_used_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'deactivated')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- 2. 프로젝트
create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  title text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now()
);

-- 3. 입력함 (2단계 업로드 멱등성 + OCR 전문/요약 + 한국어 검색)
create table inbox_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  source_type text not null check (source_type in ('scanner_doc', 'quick_tag', 'quick_text', 'quick_voice')),
  idempotency_key text,               -- 외부 스캐너 external_scan_id 또는 클라이언트 멱등성 키
  title text,
  raw_text text,
  extracted_text text,                -- OCR/STT 추출 전문 (본문 검색 대상)
  summary_text text,                  -- AI 요약 텍스트
  ocr_completed_at timestamptz,
  storage_path text,                  -- Private 버킷 경로 (Signed URL로만 열람)
  file_size_bytes bigint not null default 0,
  page_count int,
  audio_seconds int,
  processing_status text not null default 'ready'
    check (processing_status in ('ready', 'processing', 'succeeded', 'failed')),
  user_confirmed_at timestamptz,      -- 유료 플랜 자동 삭제 금지 기준
  original_expires_at timestamptz,    -- 무료 플랜 30일 원본 만료 예정 시점
  original_purged_at timestamptz,     -- 원본 파일 정리 완료 시점 (텍스트·요약은 유지)
  triage_status text not null default 'unprocessed'
    check (triage_status in ('unprocessed', 'triaged', 'auto_folded', 'archived')),
  created_at timestamptz not null default now()
);

create unique index uq_inbox_idempotency
  on inbox_items (workspace_id, idempotency_key)
  where idempotency_key is not null;

-- 한국어 부분 일치 검색용 pg_trgm GIN 인덱스
create index idx_inbox_title_trgm on inbox_items using gin (title gin_trgm_ops);
create index idx_inbox_raw_text_trgm on inbox_items using gin (raw_text gin_trgm_ops);
create index idx_inbox_extracted_text_trgm on inbox_items using gin (extracted_text gin_trgm_ops);

-- 4. 태그 정의 및 항목 매핑 테이블
create table tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('status', 'action_trigger')),
  default_due_offset_days int,
  created_at timestamptz not null default now()
);

create table entity_tags (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  entity_type text not null check (entity_type in ('inbox_item', 'task', 'event', 'project', 'record')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, tag_id, entity_type, entity_id)
);

-- 5. 할 일 (비공개 할 일에 타인 배정 원천 차단)
create table tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  source_inbox_item_id uuid references inbox_items(id) on delete set null,
  owner_user_id uuid not null references auth.users(id),
  assignee_user_id uuid not null references auth.users(id),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  title text not null,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'waiting', 'done')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  check (visibility = 'team' or assignee_user_id = owner_user_id)
);

-- 6. 자체 일정 (종일 일정 및 타임존 지원)
create table events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  owner_user_id uuid not null references auth.users(id),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  title text not null,
  is_all_day boolean not null default false,
  timezone text not null default 'Asia/Seoul',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- 7. 기록·메모 (상위 항목 공유와 독립된 레코드별 접근 권한)
create table records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  content_markdown text not null,
  source_inbox_item_id uuid references inbox_items(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 8. 범용 연결 테이블 (직접 SELECT 차단, 보안 RPC 전용)
create table entity_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  from_type text not null check (from_type in ('inbox_item', 'task', 'event', 'project', 'record', 'plugin_entity')),
  from_id uuid not null,
  to_type text not null check (to_type in ('inbox_item', 'task', 'event', 'project', 'record', 'plugin_entity')),
  to_id uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, from_type, from_id, to_type, to_id)
);

-- 9. 게스트 공유 토큰 (기본 14일, 7/14/30일 선택, 즉시 회수)
create table share_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  token_hash text unique not null,
  entity_type text not null check (entity_type in ('inbox_item', 'project', 'task')),
  entity_id uuid not null,
  scope text not null default 'read_only' check (scope in ('read_only', 'view_and_join')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '14 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- 10. AI 월간 한도(원자적 선차감) 및 사용량 원장
create table workspace_ai_quotas (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  period_ym text not null,            -- 예: '2026-11'
  usage_type text not null check (usage_type in ('text_classify', 'doc_ocr_pages', 'voice_stt_seconds')),
  limit_units numeric not null,       -- 무료 기본: OCR 30, STT 900(15분), 분류 100
  reserved_units numeric not null default 0,
  used_units numeric not null default 0,
  primary key (workspace_id, period_ym, usage_type),
  check (reserved_units >= 0 and used_units >= 0 and (reserved_units + used_units) <= limit_units)
);

create table ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  usage_type text not null check (usage_type in ('text_classify', 'doc_ocr_pages', 'voice_stt_seconds')),
  units numeric not null,
  status text not null check (status in ('reserved', 'committed', 'released')),
  estimated_cost_usd numeric(10, 6),
  created_at timestamptz not null default now()
);
```

### 핵심 보안 RLS 및 원자적 선차감 RPC

```sql
-- 1) 활성 멤버 필수 단일 RLS 패턴 (퇴사자 deactivated 열람 원천 차단)
alter table records enable row level security;

create policy "records_active_member_select" on records
for select using (
  exists (
    select 1 from workspace_members wm
    where wm.workspace_id = records.workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  )
  and (author_user_id = auth.uid() or visibility = 'team')
);

-- 동일 패턴을 inbox_items, tasks, events, projects에도 일괄 적용

-- 2) entity_links 클라이언트 직접 SELECT 차단 (private UUID 존재 여부 노출 방지)
alter table entity_links enable row level security;

create policy "entity_links_deny_direct_select" on entity_links
for select using (false);

-- 연결 항목은 대상 테이블 RLS를 존중하는 보안 RPC(get_linked_entities) 내부 INNER JOIN으로만 반환

-- 3) AI 한도 원자적 선차감 (FOR UPDATE 행 락: Reserve → Commit / Release)
create or replace function reserve_ai_quota(
  p_workspace_id uuid,
  p_period_ym text,
  p_usage_type text,
  p_units numeric
) returns uuid language plpgsql security definer as $$
declare
  v_quota workspace_ai_quotas%rowtype;
  v_ledger_id uuid;
begin
  select * into v_quota
  from workspace_ai_quotas
  where workspace_id = p_workspace_id
    and period_ym = p_period_ym
    and usage_type = p_usage_type
  for update;

  if not found or (v_quota.used_units + v_quota.reserved_units + p_units) > v_quota.limit_units then
    raise exception 'AI_QUOTA_EXCEEDED';
  end if;

  update workspace_ai_quotas
  set reserved_units = reserved_units + p_units
  where workspace_id = p_workspace_id
    and period_ym = p_period_ym
    and usage_type = p_usage_type;

  insert into ai_usage_ledger (workspace_id, user_id, usage_type, units, status)
  values (p_workspace_id, auth.uid(), p_usage_type, p_units, 'reserved')
  returning id into v_ledger_id;

  return v_ledger_id;
end;
$$;
```

---

## 4. 핵심 API 엔드포인트 (범용 메인 v2.1)

| 메서드 및 경로 | 역할 | 핵심 동작 |
| :--- | :--- | :--- |
| `POST /api/inbox/upload-url` | 1단계 업로드 URL 발급 | 권한·용량(무료 500MB 상한) 검증 후 Private Storage Presigned PUT URL 발급 |
| `POST /api/inbox/ingest` | 2단계 스캐너/파일 커밋 | `idempotency_key` 중복 방지 → `inbox_items` 등록 → 무료 플랜 시 `original_expires_at = now() + 30 days` 설정 |
| `POST /api/inbox/quick` | 빠른 입력 등록 | AI 없이 즉시 저장; `status` 태그는 `entity_tags` 기록만, `action_trigger` 태그만 `tasks` 생성 |
| `POST /api/inbox/[id]/triage` | 입력함 2초 분류 | `project`·`task`·`event` 연결 후 `triage_status = 'triaged'` 처리 |
| `POST /api/inbox/[id]/ai-process` | 선택형 AI 분석 | `reserve_ai_quota` 선차감 → OCR/STT/요약 실행 → 성공 시 Commit(`extracted_text` 저장) / 실패 시 Release(`failed` 원본 삭제 유예) |
| `GET /api/search` | 본문 통합 검색 | `pg_trgm` 검색 실행; 무료 플랜은 최근 30일 결과 + **30일 이전 일치 건수 힌트(`older_match_count`)** 반환 |
| `GET /api/files/[inboxId]/signed-url` | Private 파일 열람 | `inbox_items` RLS 또는 유효한 `share_tokens` 검증 통과 시에만 단기 Signed URL(60초~5분) 발급 |
| `POST /api/shares` | 게스트 공유 링크 발급 | 7/14/30일(기본 14일) `share_tokens` 생성; `GET /s/[token]`은 본체+공개 체크리스트만 화이트리스트 반환 |
| `POST /api/workspaces/transfer-items` | 개인 → 팀 선택 이동 | 지정 항목을 `team` 워크스페이스로 복사/이동(연결된 개인 `records`는 명시 선택 시에만 포함) |

---

## 5. 단계별 실행 로드맵 (범용 메인 완성)

| 단계 | 핵심 목표 | 주요 산출물 |
| :--- | :--- | :--- |
| **Phase 1. 코어 DB·보안·2단계 인입** | 보안 결함 없는 멀티 워크스페이스 및 스캐너 인입 완성 | 활성 멤버 RLS, `entity_links` RPC, `entity_tags`, 2단계 Presigned 업로드·Private Signed URL, `3초 태그·10초 텍스트·30초 음성` |
| **Phase 2. 입력함 정리·자체 일정·검색** | 킬러 루프와 개인 유료화 기반 완성 | 2초 원터치 Triage + 7일 자동 접기, 자체 일정(`is_all_day`/`timezone`), `pg_trgm` 본문 검색 + 30일 이전 건수 힌트 |
| **Phase 3. AI 선차감·게스트 공유·원본 정책** | 원가 통제 및 팀 전환 브리지 완성 | `reserve_ai_quota` Reserve→Commit/Release 워커, 무료 30일/500MB 만료 알림·정리 잡, 게스트 공유 웹뷰(`/s/[token]`) + 1클릭 팀 합류 |
| **Phase 4. 플러그인 SDK & 심사 트랙** | 확장 기반 확보 및 출시 준비 | `packages/plugin-sdk` 확정, 스토어 조기 테스트 트랙과 정식 출시 심사 준비 트랙 분리 운영 |