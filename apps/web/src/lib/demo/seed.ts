/**
 * apps/web/src/lib/demo/seed.ts
 * DEMO MODE ONLY: sample data loaded into the in-memory mock database.
 * Dates are generated relative to "now" so Today / Calendar always have content.
 */
export type Row = Record<string, unknown>;
export type Store = Record<string, Row[]>;

export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';
const TEAMMATE_ID = '00000000-0000-4000-8000-000000000002';
export const DEMO_PERSONAL_WS = '10000000-0000-4000-8000-000000000001';
const DEMO_TEAM_WS = '10000000-0000-4000-8000-000000000002';

function id(prefix: string, n: number): string {
  return `${prefix}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** Returns ISO string for today (KST) at the given hour, offset by `days`. */
function kst(days: number, hour: number, minute = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const base = new Date(`${today}T00:00:00+09:00`).getTime();
  return new Date(base + days * 86_400_000 + (hour * 60 + minute) * 60_000).toISOString();
}

/** KST calendar date `days` from today, for text inside sample documents. */
function day(days: number): { iso: string; m: number; d: number } {
  const k = new Date(Date.now() + 9 * 3_600_000 + days * 86_400_000);
  const y = k.getUTCFullYear();
  const m = k.getUTCMonth() + 1;
  const d = k.getUTCDate();
  return { iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, m, d };
}

export function createSeed(): Store {
  const W = DEMO_PERSONAL_WS;
  const T = DEMO_TEAM_WS;
  const U = DEMO_USER_ID;
  const now = new Date().toISOString();

  const projects: Row[] = [
    { id: id('20', 1), workspace_id: W, owner_user_id: U, visibility: 'private', title: '이사 준비', status: 'active', created_at: kst(-20, 9), updated_at: kst(-1, 10) },
    { id: id('20', 2), workspace_id: W, owner_user_id: U, visibility: 'private', title: '연말정산 2026', status: 'active', created_at: kst(-12, 9), updated_at: kst(-2, 15) },
    { id: id('20', 3), workspace_id: W, owner_user_id: U, visibility: 'private', title: '자동차 보험 갱신', status: 'paused', created_at: kst(-40, 9), updated_at: kst(-15, 9) },
    { id: id('20', 4), workspace_id: T, owner_user_id: U, visibility: 'team', title: '신규 거래처 계약', status: 'active', created_at: kst(-10, 9), updated_at: kst(0, 9) },
    { id: id('20', 5), workspace_id: T, owner_user_id: TEAMMATE_ID, visibility: 'team', title: '4분기 마케팅 캠페인', status: 'active', created_at: kst(-30, 9), updated_at: kst(-3, 9) },
  ];

  const billDue = day(9);
  const thisMonth = day(0).m;
  const dentalDay = day(-8);
  const leaseStart = day(-676);
  const leaseEnd = day(54);
  const DAY = 86_400_000;
  const expiresFrom = (createdIso: string) => new Date(new Date(createdIso).getTime() + 30 * DAY).toISOString();

  const inbox: Row[] = [
    { id: id('30', 1), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'scanner_doc', title: `전기요금 고지서 ${thisMonth}월`, raw_text: null, extracted_text: `한국전력공사 전기요금 청구서 납부기한 ${billDue.iso} 청구금액 48,320원 자동이체 미신청`, summary_text: `${thisMonth}월 전기요금 48,320원, ${billDue.m}/${billDue.d}까지 납부`, storage_path: 'demo/elec.pdf', file_size_bytes: 182_000, page_count: 1, processing_status: 'succeeded', triage_status: 'unprocessed', ocr_completed_at: kst(0, 8), original_expires_at: expiresFrom(kst(0, 8)), created_at: kst(0, 8) },
    { id: id('30', 10), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'scanner_doc', title: '건강검진 결과 통보서', raw_text: null, extracted_text: null, summary_text: null, storage_path: 'demo/checkup.pdf', file_size_bytes: 640_000, page_count: 2, processing_status: 'ready', triage_status: 'unprocessed', original_expires_at: expiresFrom(kst(0, 7, 50)), created_at: kst(0, 7, 50) },
    { id: id('30', 2), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'quick_text', title: '집주인에게 계약 만료일 확인 문자', raw_text: '집주인에게 계약 만료일 확인 문자 보내기', extracted_text: null, summary_text: null, storage_path: null, file_size_bytes: 0, processing_status: 'ready', triage_status: 'unprocessed', created_at: kst(0, 7, 30) },
    { id: id('30', 3), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'scanner_doc', title: '의료비 영수증 - 서울치과', extracted_text: `서울치과의원 진료비 영수증 본인부담금 120,000원 진료일 ${dentalDay.iso}`, summary_text: '치과 진료비 120,000원 (연말정산 의료비 공제 대상)', storage_path: 'demo/dental.jpg', file_size_bytes: 420_000, page_count: 1, processing_status: 'succeeded', triage_status: 'unprocessed', original_expires_at: expiresFrom(kst(-1, 18)), created_at: kst(-1, 18) },
    { id: id('30', 4), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'quick_voice', title: '음성 메모: 이사업체 견적', raw_text: '이사업체 세 군데 견적 받아보기. 다음 달 둘째 주 토요일 기준.', audio_seconds: 14, storage_path: 'demo/voice.m4a', file_size_bytes: 90_000, processing_status: 'succeeded', triage_status: 'unprocessed', original_expires_at: expiresFrom(kst(-1, 12)), created_at: kst(-1, 12) },
    { id: id('30', 5), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'quick_tag', title: '세탁소 맡긴 코트 찾기', raw_text: '세탁소 맡긴 코트 찾기', processing_status: 'ready', triage_status: 'triaged', created_at: kst(-3, 9) },
    { id: id('30', 6), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'scanner_doc', title: '임대차 계약서 사본', extracted_text: `주택임대차계약서 임대인 홍길동 임차인 계약기간 ${leaseStart.iso} ~ ${leaseEnd.iso} 보증금 5,000만원 월세 50만원`, summary_text: `현 거주지 임대차 계약서, ${leaseEnd.iso} 만료`, storage_path: 'demo/lease.pdf', file_size_bytes: 1_200_000, page_count: 4, processing_status: 'succeeded', triage_status: 'triaged', original_expires_at: expiresFrom(kst(-8, 20)), created_at: kst(-8, 20) },
    { id: id('30', 7), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'quick_text', title: '오래된 메모', raw_text: '언젠가 읽을 책 목록 정리', processing_status: 'ready', triage_status: 'auto_folded', created_at: kst(-35, 9) },
    { id: id('30', 11), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'scanner_doc', title: '도시가스 요금 영수증', extracted_text: '도시가스 요금 31,200원 자동이체 출금 완료', summary_text: '도시가스 요금 31,200원 (자동이체 완료)', storage_path: 'demo/gas.pdf', file_size_bytes: 150_000, page_count: 1, processing_status: 'succeeded', triage_status: 'auto_folded', original_expires_at: expiresFrom(kst(-26, 19)), created_at: kst(-26, 19) },
    { id: id('30', 15), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'scanner_doc', title: '기부금 영수증 - 정기후원', extracted_text: '기부금 영수증 (사)희망나눔 정기후원 1월~10월 합계 300,000원 기부자 데모 사용자', summary_text: '정기후원 기부금 300,000원 (1~10월)', storage_path: 'demo/donation.pdf', file_size_bytes: 210_000, page_count: 1, processing_status: 'succeeded', triage_status: 'archived', original_expires_at: expiresFrom(kst(-12, 21)), created_at: kst(-12, 21) },
    { id: id('30', 16), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'scanner_doc', title: '월세 이체 확인증', extracted_text: '이체 확인증 받는 분 홍길동 월세 500,000원 이체 완료', summary_text: '이번 달 월세 500,000원 이체 완료', storage_path: 'demo/rent.pdf', file_size_bytes: 95_000, page_count: 1, processing_status: 'succeeded', triage_status: 'archived', original_expires_at: expiresFrom(kst(-5, 9)), created_at: kst(-5, 9) },
    { id: id('30', 17), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'scanner_doc', title: '교복 구입 영수증', extracted_text: '○○교복 영수증 동복 상하의 블라우스 합계 289,000원', summary_text: '교복 구입 289,000원', storage_path: null, original_purged_at: kst(-60, 3), file_size_bytes: 0, page_count: 1, processing_status: 'succeeded', triage_status: 'archived', created_at: kst(-95, 15) },
    // Older than 30 days: found only as a count on the free plan (search paywall)
    { id: id('30', 12), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'scanner_doc', title: '약국 영수증 - 감기약', extracted_text: '온누리약국 의약품 영수증 8,400원', summary_text: '약국 의약품 영수증 8,400원 (연말정산 의료비)', storage_path: null, original_purged_at: kst(-15, 3), file_size_bytes: 0, page_count: 1, processing_status: 'succeeded', triage_status: 'archived', created_at: kst(-45, 13) },
    { id: id('30', 13), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'scanner_doc', title: '안경점 영수증', extracted_text: '밝은안경 안경 구입 영수증 180,000원 시력교정용', summary_text: '안경 구입 영수증 180,000원 (연말정산 의료비 공제 가능)', storage_path: null, original_purged_at: kst(-22, 3), file_size_bytes: 0, page_count: 1, processing_status: 'succeeded', triage_status: 'archived', created_at: kst(-52, 17) },
    { id: id('30', 14), workspace_id: W, owner_user_id: U, visibility: 'private', source_type: 'scanner_doc', title: '자동차 보험 증권', extracted_text: '자동차보험 증권 연간 보험료 684,000원 다이렉트 갱신 안내', summary_text: '자동차보험 증권, 연간 보험료 684,000원', storage_path: null, original_purged_at: kst(-40, 3), file_size_bytes: 0, page_count: 3, processing_status: 'succeeded', triage_status: 'triaged', created_at: kst(-70, 10) },
    { id: id('30', 8), workspace_id: T, owner_user_id: U, visibility: 'team', source_type: 'scanner_doc', title: '거래처 견적서 (주)한빛상사', extracted_text: '견적서 (주)한빛상사 품목 A-200 수량 500 단가 3,200원 합계 1,600,000원 유효기간 14일', summary_text: '한빛상사 A-200 500개 견적 160만원', storage_path: 'demo/quote.pdf', file_size_bytes: 300_000, page_count: 2, processing_status: 'succeeded', triage_status: 'unprocessed', created_at: kst(0, 9, 10) },
    { id: id('30', 9), workspace_id: T, owner_user_id: TEAMMATE_ID, visibility: 'team', source_type: 'quick_text', title: '캠페인 배너 시안 피드백 요청', raw_text: '배너 시안 2종 피드백 금요일까지', processing_status: 'ready', triage_status: 'unprocessed', created_at: kst(-1, 16) },
  ];

  const tags: Row[] = [
    { id: id('40', 1), workspace_id: W, label: '납부', kind: 'action_trigger', default_due_offset_days: 3, created_at: now },
    { id: id('40', 2), workspace_id: W, label: '회신 필요', kind: 'action_trigger', default_due_offset_days: 1, created_at: now },
    { id: id('40', 3), workspace_id: W, label: '보관', kind: 'status', default_due_offset_days: null, created_at: now },
    { id: id('40', 4), workspace_id: W, label: '중요', kind: 'status', default_due_offset_days: null, created_at: now },
    { id: id('40', 5), workspace_id: T, label: '검토 요청', kind: 'action_trigger', default_due_offset_days: 2, created_at: now },
    { id: id('40', 6), workspace_id: T, label: '계약', kind: 'status', default_due_offset_days: null, created_at: now },
  ];

  const entity_tags: Row[] = [
    { workspace_id: W, tag_id: id('40', 1), entity_type: 'inbox_item', entity_id: id('30', 1), created_by: U, created_at: now },
    { workspace_id: W, tag_id: id('40', 4), entity_type: 'inbox_item', entity_id: id('30', 6), created_by: U, created_at: now },
    { workspace_id: W, tag_id: id('40', 3), entity_type: 'inbox_item', entity_id: id('30', 6), created_by: U, created_at: now },
    { workspace_id: T, tag_id: id('40', 6), entity_type: 'inbox_item', entity_id: id('30', 8), created_by: U, created_at: now },
  ];

  const task = (n: number, ws: string, title: string, status: string, due: string | null, project: string | null, owner = U, vis = ws === T ? 'team' : 'private'): Row => ({
    id: id('50', n), workspace_id: ws, project_id: project, owner_user_id: owner, assignee_user_id: owner, visibility: vis, title, status, due_at: due, created_at: kst(-5, 9), updated_at: kst(-1, 9),
  });
  const tasks: Row[] = [
    task(1, W, '전기요금 납부', 'todo', kst(3, 18), null),
    task(2, W, '이사업체 견적 3곳 받기', 'in_progress', kst(2, 18), id('20', 1)),
    task(3, W, '전입신고 서류 확인', 'todo', kst(10, 18), id('20', 1)),
    task(4, W, '의료비 영수증 모으기', 'waiting', kst(7, 18), id('20', 2)),
    task(5, W, '기부금 영수증 다운로드', 'todo', null, id('20', 2)),
    task(6, W, '보험사 3곳 비교', 'done', kst(-2, 18), id('20', 3)),
    task(7, W, '세탁소 코트 찾기', 'todo', kst(0, 19), null),
    task(8, T, '한빛상사 견적 검토', 'todo', kst(1, 12), id('20', 4)),
    task(9, T, '계약서 법무 검토 요청', 'in_progress', kst(4, 18), id('20', 4)),
    task(10, T, '배너 시안 피드백', 'todo', kst(1, 17), id('20', 5), TEAMMATE_ID),
    task(11, W, '관리비 이체', 'todo', kst(-1, 18), null),
  ];

  const ev = (n: number, ws: string, title: string, s: string, e: string, opts: Partial<Row> = {}): Row => ({
    id: id('60', n), workspace_id: ws, project_id: null, owner_user_id: U, visibility: ws === T ? 'team' : 'private', title, is_all_day: false, timezone: 'Asia/Seoul', starts_at: s, ends_at: e, location: null, created_at: now, ...opts,
  });
  const events: Row[] = [
    ev(1, W, '치과 정기검진', kst(0, 10), kst(0, 11), { location: '서울치과' }),
    ev(2, W, '이사업체 방문 견적', kst(0, 15), kst(0, 16), { project_id: id('20', 1), location: '집' }),
    ev(3, W, '친구 저녁 약속', kst(1, 19), kst(1, 21), { location: '강남역' }),
    ev(4, W, '연말정산 간소화 오픈', kst(5, 0), kst(6, 0), { is_all_day: true, project_id: id('20', 2) }),
    ev(5, W, '헬스장 PT', kst(-1, 7), kst(-1, 8)),
    ev(6, W, '이사 예정일', kst(21, 0), kst(22, 0), { is_all_day: true, project_id: id('20', 1) }),
    ev(7, T, '주간 팀 미팅', kst(0, 13), kst(0, 14), { location: '회의실 A' }),
    ev(8, T, '한빛상사 미팅', kst(2, 14), kst(2, 15, 30), { project_id: id('20', 4), location: '한빛상사 본사' }),
  ];

  const records: Row[] = [
    { id: id('70', 1), workspace_id: W, author_user_id: U, visibility: 'private', content_markdown: '## 이사 체크리스트\n- 인터넷 이전 신청\n- 도시가스 해지/개통\n- 우편물 주소 변경', source_inbox_item_id: null, created_at: kst(-6, 9), updated_at: kst(-2, 9) },
    { id: id('70', 2), workspace_id: T, author_user_id: U, visibility: 'team', content_markdown: '한빛상사 담당자: 김과장 (010-0000-0000)\n단가 협상 여지 5% 내외', source_inbox_item_id: id('30', 8), created_at: kst(-1, 9), updated_at: kst(-1, 9) },
  ];

  const entity_links: Row[] = [
    { id: id('80', 1), workspace_id: W, from_type: 'project', from_id: id('20', 1), to_type: 'inbox_item', to_id: id('30', 6), created_by: U, created_at: now },
    { id: id('80', 2), workspace_id: W, from_type: 'project', from_id: id('20', 1), to_type: 'inbox_item', to_id: id('30', 4), created_by: U, created_at: now },
    { id: id('80', 3), workspace_id: W, from_type: 'project', from_id: id('20', 1), to_type: 'record', to_id: id('70', 1), created_by: U, created_at: now },
    { id: id('80', 4), workspace_id: W, from_type: 'project', from_id: id('20', 2), to_type: 'inbox_item', to_id: id('30', 3), created_by: U, created_at: now },
    { id: id('80', 5), workspace_id: T, from_type: 'project', from_id: id('20', 4), to_type: 'inbox_item', to_id: id('30', 8), created_by: U, created_at: now },
    { id: id('80', 6), workspace_id: T, from_type: 'project', from_id: id('20', 4), to_type: 'record', to_id: id('70', 2), created_by: U, created_at: now },
  ];

  const ym = day(0).iso.slice(0, 7); // KST month, like the app's quota period
  const quotas: Row[] = [
    { workspace_id: W, period_ym: ym, usage_type: 'doc_ocr_pages', limit_units: 30, reserved_units: 0, used_units: 12 },
    { workspace_id: W, period_ym: ym, usage_type: 'voice_stt_seconds', limit_units: 900, reserved_units: 0, used_units: 240 },
    { workspace_id: W, period_ym: ym, usage_type: 'text_classify', limit_units: 100, reserved_units: 0, used_units: 37 },
    { workspace_id: T, period_ym: ym, usage_type: 'doc_ocr_pages', limit_units: 1500, reserved_units: 0, used_units: 86 },
    { workspace_id: T, period_ym: ym, usage_type: 'voice_stt_seconds', limit_units: 54000, reserved_units: 0, used_units: 1260 },
    { workspace_id: T, period_ym: ym, usage_type: 'text_classify', limit_units: 5000, reserved_units: 0, used_units: 140 },
  ];

  return {
    workspaces: [
      { id: W, name: '내 워크스페이스', type: 'personal', plan: 'free', max_seats: 1, storage_used_bytes: 2_192_000, created_at: kst(-60, 9) },
      { id: T, name: '데모 팀', type: 'team', plan: 'team', max_seats: 10, storage_used_bytes: 300_000, created_at: kst(-30, 9) },
    ],
    workspace_members: [
      { workspace_id: W, user_id: U, role: 'owner', status: 'active', joined_at: kst(-60, 9) },
      { workspace_id: T, user_id: U, role: 'owner', status: 'active', joined_at: kst(-30, 9) },
      { workspace_id: T, user_id: TEAMMATE_ID, role: 'member', status: 'active', joined_at: kst(-20, 9) },
    ],
    projects,
    inbox_items: inbox,
    tags,
    entity_tags,
    tasks,
    events,
    records,
    entity_links,
    share_tokens: [],
    workspace_ai_quotas: quotas,
    ai_usage_ledger: [],
    user_push_tokens: [
      { id: id('90', 1), user_id: U, expo_push_token: 'ExponentPushToken[demo-iphone]', platform: 'ios', device_name: 'iPhone', last_seen_at: kst(-1, 9) },
    ],
  };
}
