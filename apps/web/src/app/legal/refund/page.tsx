/**
 * apps/web/src/app/legal/refund/page.tsx
 * 환불정책 (draft). Payment providers check this page during merchant review.
 */
import React from 'react';
import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';
import { COMPANY, companyField } from '@/lib/company';
import { PLANS } from '@/lib/plans';
import { Article, Bullets, Items, LegalDoc, Todo } from '@/components/legal/legal-doc';

export const metadata: Metadata = { title: `환불정책 — ${BRAND.name}` };

export default function RefundPage() {
  return (
    <LegalDoc title="환불정책">
      <p>
        {BRAND.name}의 유료 플랜(프로·팀)은 디지털 구독 서비스입니다. 무료 플랜으로 충분히 써 본 뒤 결제하실 수 있도록 무료
        플랜을 기간 제한 없이 제공합니다.
      </p>

      <Article no={1} title="결제 후 7일 이내 청약철회">
        <p>
          결제일로부터 7일 이내에 유료 플랜의 기능(원본 영구 보관, 30일 이전 자료 검색, 무료 한도를 넘는 AI 처리 등)을 쓰지 않았다면
          전액 환불해 드립니다.
        </p>
      </Article>

      <Article no={2} title="이용 중 해지">
        <Items>
          <li>
            월간 결제: 해지하면 다음 결제일부터 청구되지 않으며, 남은 기간 동안 유료 기능을 계속 쓸 수 있습니다.{' '}
            <Todo>이미 결제한 달의 잔여 기간 환불 여부 결정 필요</Todo>
          </li>
          <li>
            연간 결제: 해지를 요청하면 이용한 개월 수를 월간 요금({`프로 월 ${PLANS.pro.priceMonthly.toLocaleString('ko-KR')}원`} 등)으로
            계산해 뺀 금액을 환불합니다. <Todo>공제 방식·위약금 여부 법률 검토 필요</Todo>
          </li>
        </Items>
      </Article>

      <Article no={3} title="회사 사정으로 이용하지 못한 경우">
        <p>
          회사의 책임으로 서비스를 연속 4시간 이상 이용하지 못한 경우, 이용하지 못한 기간에 해당하는 금액을 환불하거나 이용 기간을
          연장해 드립니다. <Todo>보상 기준 확정 필요</Todo>
        </p>
      </Article>

      <Article no={4} title="무료 플랜으로 바뀔 때의 자료">
        <Bullets>
          <li>해지나 환불로 무료 플랜이 되어도 이미 올린 원본 파일과 기록은 지우지 않습니다.</li>
          <li>이후 새로 올리는 원본부터 무료 플랜의 보관 기간(30일)과 저장 용량 한도가 적용됩니다.</li>
          <li>30일보다 오래된 자료는 검색 결과에서 건수로만 표시됩니다.</li>
        </Bullets>
      </Article>

      <Article no={5} title="환불 신청과 처리">
        <p>
          아래 연락처로 결제 계정 이메일과 함께 요청해 주세요. 환불은 요청을 확인한 날부터 3영업일 이내에 결제한 수단으로 처리하며,
          카드사 사정에 따라 실제 반영까지 시간이 더 걸릴 수 있습니다.
        </p>
        <Bullets>
          <li>이메일: {companyField(COMPANY.email, '이메일')}</li>
          <li>전화: {companyField(COMPANY.phone, '전화번호')}</li>
        </Bullets>
      </Article>

      <Article title="부칙">
        <p>이 정책은 {companyField(COMPANY.effectiveDate, '시행일')}부터 시행합니다.</p>
      </Article>
    </LegalDoc>
  );
}
