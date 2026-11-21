# Workspace — 종이 서류를 5초 만에 할 일로

고지서·영수증·계약서를 찍거나 올리면 AI가 읽고, 마감일과 금액을 찾아 할 일로 만들어 주는 개인·소규모 팀용 워크스페이스입니다. (Next.js + Supabase 모노레포)

- 제품 리뷰와 개선 내역, 다음 할 일: [`docs/product-review.md`](docs/product-review.md)
- 원래 설계서: [`docs/workspace-app-design-plan.md`](docs/workspace-app-design-plan.md)
- 실제 배포 절차: [`NEXT_STEPS_GUIDE.md`](NEXT_STEPS_GUIDE.md), [`DEPLOYMENT_CHECKLIST.md`](DEPLOYMENT_CHECKLIST.md)

## 로그인 없이 UI 확인하기 (데모 모드)

Supabase 설정 없이 샘플 데이터로 모든 화면을 클릭해 볼 수 있습니다.

```bash
pnpm install
pnpm dev
```

브라우저에서 http://localhost:3000 을 열면 소개 페이지가 나오고, `데모 열어 보기`를 누르면 앱으로 들어갑니다.

데모 모드는 이렇게 동작합니다.

- `pnpm dev`로 실행할 때 `apps/web/.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`이 **없으면** 자동으로 켜집니다. Supabase가 설정되어 있어도 `NEXT_PUBLIC_DEMO_MODE=1`이면 데모 모드입니다.
- 배포용 빌드(`pnpm build`)에서는 자동으로 켜지지 않습니다. 설정을 빠뜨린 실제 배포가 로그인 없는 가짜 앱이 되는 것을 막기 위해서입니다. 데모를 배포하려면 빌드할 때 `NEXT_PUBLIC_DEMO_MODE=1`을 지정하세요.
- 데이터는 서버 메모리에만 있고, 개발 서버를 다시 켜면 처음 상태로 돌아갑니다.
- 상단 선택 상자로 `개인`(무료 플랜)과 `데모 팀`(팀 플랜) 워크스페이스를 오갈 수 있습니다.
- 샘플 데이터는 `apps/web/src/lib/demo/seed.ts`에서 고칠 수 있습니다.

### 데모에서 해 볼 만한 것

1. **입력함**에서 `건강검진 결과 통보서`의 `AI로 읽기`를 누릅니다. 요약이 생기고 마감일이 감지되며, `할 일로 · 마감`을 누르면 마감일이 붙은 할 일이 됩니다.
2. **입력함**에 PDF나 사진을 끌어다 놓습니다. 업로드되고 AI 처리가 자동으로 시작됩니다. 데모에서는 AI 결과 대신 안내 문구가 나옵니다.
3. **오늘**에서 `🎙️ 30초 음성`으로 실제로 녹음하고 저장합니다. 마이크 권한이 필요합니다.
4. **검색**에서 `영수증`을 찾으면 무료 플랜이라 30일 이전 결과가 잠겨 있습니다. `전체 기간 검색 열기` → 요금제 → `프로로 업그레이드`를 누르면 바로 적용되고, 다시 검색하면 전부 나옵니다. 요금제 페이지에서 `무료로 되돌리기`로 원래대로 돌릴 수 있습니다.
5. **설정**에서 팀을 만들면 무료 팀 좌석이 3명으로 표시됩니다.
6. **연말정산**에서 영수증이 의료비·교육비·기부금·월세로 자동 분류되고, 합계와 엑셀(CSV) 파일을 볼 수 있습니다. 무료 플랜에서 원본이 정리된 영수증은 따로 표시됩니다.

## 요금제·가격 바꾸기

- 가격, 플랜 이름, 기능 목록, 한도: `apps/web/src/lib/plans.ts` (현재 가격은 제안값)
- 서비스 이름과 한 줄 소개: `apps/web/src/lib/brand.ts`
- 사업자 정보(하단 표시·약관): `apps/web/src/lib/company.ts` — 이용약관·개인정보처리방침·환불정책(`/legal/*`)은 **초안**이므로 공개 전에 법률 검토를 받으세요.
- 실제 모드에서 결제사 연동 전까지는 업그레이드 클릭이 `billing_upgrade_intents` 테이블에 사전 신청으로 쌓입니다. `supabase/migrations/0008_phase8_upgrade_intents.sql`을 적용하세요.

## 개발 명령어

```bash
pnpm dev                      # 개발 서버 (apps/web)
pnpm build                    # 프로덕션 빌드
pnpm --filter web typecheck   # 타입 검사
pnpm --filter web test        # 마감일·금액 감지 테스트
```
