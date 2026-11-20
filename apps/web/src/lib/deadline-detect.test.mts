/**
 * Run: pnpm --filter web test
 * (node --test with built-in TypeScript stripping; no extra dependencies)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAmount, detectDeadline, relativeDueLabel } from './deadline-detect.ts';

// Saturday 2026-11-21 10:00 KST
const NOW = new Date('2026-11-21T01:00:00Z');

const DEADLINE_CASES: Array<[string, string | null]> = [
  ['11월 전기요금 48,320원, 11/30까지 납부', '11/30'],
  ['한국전력공사 전기요금 청구서 납부기한 2026-11-30 청구금액 48,320원', '11/30'],
  ['서울치과의원 진료비 영수증 본인부담금 120,000원 2026-11-12', null],
  ['주택임대차계약서 계약기간 2025-01-15 ~ 2027-01-14 보증금', '27/1/14'],
  ['현 거주지 임대차 계약서, 2027-01-14 만료', '27/1/14'],
  ['배너 시안 2종 피드백 금요일까지', '11/27'],
  ['이사업체 세 군데 견적 받아보기. 12월 둘째 주 토요일 기준.', null],
  ['집주인에게 계약 만료일 확인 문자 보내기', null],
  ['내일까지 회신', '11/22'],
  ['다음 주 월요일까지 제출', '11/23'],
  ['이번 주 금요일 마감', '11/20'],
  ['1월 10일까지 갱신', '27/1/10'],
  ['2026년 12월 31일까지 2차 검진', '12/31'],
  ['오늘 회의 내용 정리', null],
  ['견적서 단가 3,200원 합계 1,600,000원 유효기간 14일', null],
  ['전화 010-1234-5678 로 연락', null],
];

for (const [text, expected] of DEADLINE_CASES) {
  test(`detectDeadline: ${text}`, () => {
    assert.equal(detectDeadline(text, NOW)?.shortLabel ?? null, expected);
  });
}

test('detectDeadline returns 18:00 KST and relative days', () => {
  const r = detectDeadline('11/30까지 납부', NOW);
  assert.ok(r);
  assert.equal(r.dueAt, '2026-11-30T09:00:00.000Z');
  assert.equal(r.label, '11월 30일 (월)');
  assert.equal(r.daysFromToday, 9);
  assert.equal(relativeDueLabel(r.daysFromToday), 'D-9');
});

test('relativeDueLabel', () => {
  assert.equal(relativeDueLabel(0), '오늘');
  assert.equal(relativeDueLabel(1), '내일');
  assert.equal(relativeDueLabel(-3), '3일 지남');
});

const AMOUNT_CASES: Array<[string, number | null]> = [
  ['납부기한 2026-11-30 청구금액 48,320원', 48320],
  ['견적서 단가 3,200원 합계 1,600,000원', 1600000],
  ['보증금 5,000만원 월세 50만원', 50000000],
  ['11월 전기요금 48,320원, 11/30까지 납부', 48320],
  ['메모 없음', null],
];

for (const [text, expected] of AMOUNT_CASES) {
  test(`detectAmount: ${text}`, () => {
    assert.equal(detectAmount(text)?.value ?? null, expected);
  });
}
