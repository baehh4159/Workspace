import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaxCsv, classifyTaxReceipt, defaultTaxYear, isTaxDocument, kstYearRange, receiptAmount } from './tax-receipts.ts';
import { detectAmount } from './deadline-detect.ts';

const CASES: Array<[string, string | null]> = [
  ['서울치과의원 진료비 영수증 본인부담금 120,000원', 'medical'],
  ['온누리약국 의약품 영수증 8,400원', 'medical'],
  ['밝은안경 안경 구입 영수증 180,000원 시력교정용', 'medical'],
  ['교복 구입 영수증 289,000원', 'education'],
  ['월드비전 정기후원 기부금 영수증 360,000원', 'donation'],
  ['11월 월세 500,000원 이체 확인증', 'rent'],
  ['자동차보험 증권 연간 보험료 684,000원', null],
  ['한국전력공사 전기요금 청구서 48,320원', null],
  ['', null],
];

for (const [text, expected] of CASES) {
  test(`classifyTaxReceipt: ${text || '(empty)'}`, () => {
    assert.equal(classifyTaxReceipt(text), expected);
  });
}

test('defaultTaxYear: Jan–Feb means last year', () => {
  assert.equal(defaultTaxYear(new Date('2027-01-20T03:00:00Z')), 2026);
  assert.equal(defaultTaxYear(new Date('2027-02-28T03:00:00Z')), 2026);
  assert.equal(defaultTaxYear(new Date('2026-11-21T03:00:00Z')), 2026);
  // 2026-12-31 20:00 UTC is already 2027-01-01 in Korea
  assert.equal(defaultTaxYear(new Date('2026-12-31T20:00:00Z')), 2026);
});

test('kstYearRange covers the Korean calendar year', () => {
  assert.deepEqual(kstYearRange(2026), {
    startIso: '2025-12-31T15:00:00.000Z',
    endIso: '2026-12-31T15:00:00.000Z',
  });
});

test('buildTaxCsv: BOM, quoting and formula neutralization', () => {
  const csv = buildTaxCsv([
    { date: '2026-11-12', category: '의료비', title: '치과 "스케일링"', amount: 120000, originalStatus: '보관 중' },
    { date: '2026-10-01', category: '기부금', title: '=HYPERLINK("x")', amount: null, originalStatus: '만료' },
  ]);
  assert.ok(csv.startsWith('﻿"날짜","분류","내용","금액(원)","원본"\r\n'));
  assert.ok(csv.includes('"치과 ""스케일링"""'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"120000"'));
});

test('receiptAmount: rent counts transfers, not the lease deposit', () => {
  const lease = '주택임대차계약서 보증금 5,000만원 월세 50만원 계약기간 2025-01-15 ~ 2027-01-14';
  assert.equal(receiptAmount(lease, 'rent', detectAmount), null, 'a lease is proof, not a payment');
  assert.equal(
    receiptAmount('월세 이체 확인증\n이번 달 월세 500,000원 이체 완료', 'rent', detectAmount),
    500000,
    'amount after a later 월세 mention'
  );
  assert.equal(receiptAmount('치과 진료비 본인부담금 120,000원', 'medical', detectAmount), 120000);
});

test('isTaxDocument: needs an amount, the word 영수증, or a lease for rent', () => {
  assert.equal(isTaxDocument('건강검진 결과 통보서 2차 검진 필요', 'medical', null), false);
  assert.equal(isTaxDocument('기부금 영수증', 'donation', null), true);
  assert.equal(isTaxDocument('주택임대차계약서 월세', 'rent', null), true);
  assert.equal(isTaxDocument('약국', 'medical', 8400), true);
});
