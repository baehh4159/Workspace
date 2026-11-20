# Universal Workspace (데모 모드 포함)

## 로그인 없이 UI 확인하기 (데모 모드)

Supabase 설정 없이 샘플 데이터로 화면을 클릭해 볼 수 있습니다.

```bash
pnpm install
pnpm dev
```

브라우저에서 http://localhost:3000 을 열면 바로 `오늘` 화면이 나옵니다.

- `apps/web/.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`이 **없으면** 자동으로 데모 모드로 동작합니다.
  (실제 Supabase가 설정되어 있어도 `NEXT_PUBLIC_DEMO_MODE=1`이면 데모 모드)
- 상단 노란 배너가 데모 모드 표시입니다.
- 데이터는 서버 메모리에만 저장되며, 개발 서버를 재시작하면 초기화됩니다.
- 우측 상단 선택 상자로 `개인` / `데모 팀` 워크스페이스를 전환할 수 있습니다.
- 파일 업로드, AI 처리, 실제 공유 링크 등 외부 서비스가 필요한 기능은 흉내만 냅니다.

데모 관련 코드: `apps/web/src/lib/demo/` (`seed.ts`에서 샘플 데이터 수정 가능)

## 원본 문서
- `NEXT_STEPS_GUIDE.md`, `DEPLOYMENT_CHECKLIST.md`, `docs/workspace-app-design-plan.md`
