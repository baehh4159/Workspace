/**
 * apps/web/src/app/legal/terms/page.tsx
 * 이용약관 (draft).
 */
import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { COMPANY, companyField } from '@/lib/company';
import { FREE_TEAM_MAX_SEATS, PLANS } from '@/lib/plans';
import { Article, Bullets, Items, LegalDoc, Todo } from '@/components/legal/legal-doc';

export const metadata: Metadata = { title: `이용약관 — ${BRAND.name}` };

export default function TermsPage() {
  const company = companyField(COMPANY.legalName, '상호');
  const free = PLANS.free.limits;

  return (
    <LegalDoc title="이용약관">
      <Article no={1} title="목적">
        <p>
          이 약관은 {company}(이하 &ldquo;회사&rdquo;)가 제공하는 {BRAND.name} 서비스(이하 &ldquo;서비스&rdquo;)의 이용 조건과
          절차, 회사와 회원의 권리·의무를 정합니다.
        </p>
      </Article>

      <Article no={2} title="정의">
        <Items>
          <li>&ldquo;회원&rdquo;은 이 약관에 동의하고 소셜 로그인으로 가입한 사람을 말합니다.</li>
          <li>&ldquo;워크스페이스&rdquo;는 회원의 자료가 모이는 공간으로, 개인 워크스페이스와 여러 회원이 함께 쓰는 팀 워크스페이스가 있습니다.</li>
          <li>&ldquo;콘텐츠&rdquo;는 회원이 올리거나 만든 서류·사진·음성·메모·할 일·일정·기록과 AI가 만든 본문·요약을 말합니다.</li>
        </Items>
      </Article>

      <Article no={3} title="약관의 게시와 변경">
        <p>
          회사는 이 약관을 서비스 화면에 게시합니다. 약관을 바꿀 때는 시행일 7일 전(회원에게 불리한 변경은 30일 전)부터 서비스 안에
          알립니다. 바뀐 약관에 동의하지 않는 회원은 탈퇴할 수 있습니다.
        </p>
      </Article>

      <Article no={4} title="회원가입">
        <p>
          만 14세 이상인 사람은 구글 또는 카카오 계정으로 가입할 수 있습니다. 가입하면 개인 워크스페이스가 하나 만들어집니다. 다른
          사람의 계정을 쓰거나 거짓 정보로 가입하면 이용이 제한될 수 있습니다.
        </p>
      </Article>

      <Article no={5} title="서비스 내용">
        <Bullets>
          <li>입력함: 서류·사진 업로드, 한 줄 메모, 음성 메모</li>
          <li>AI 읽기: 서류 글자 인식과 요약, 음성 받아쓰기, 마감일·금액 찾기</li>
          <li>할 일·일정·프로젝트 관리, 본문 검색, 연말정산 서류함</li>
          <li>공유 링크와 팀 워크스페이스, 마감 알림</li>
        </Bullets>
      </Article>

      <Article no={6} title="요금과 결제">
        <Items>
          <li>
            무료 플랜과 유료 플랜(프로·팀)의 가격과 제공 범위는{' '}
            <Link href="/pricing" className="text-blue-700 underline">
              요금제 페이지
            </Link>
            에 게시한 내용을 따릅니다.
          </li>
          <li>유료 플랜은 회원이 해지하기 전까지 선택한 주기(월간·연간)마다 자동으로 결제됩니다.</li>
          <li>회사가 가격을 올릴 때는 적용 30일 전까지 알리며, 이미 결제한 기간에는 적용하지 않습니다.</li>
          <li>
            팀 플랜 요금은 팀 워크스페이스에 참여한 인원 수에 따라 정해집니다. <Todo>인원 변동 시 정산 방식 결정 필요</Todo>
          </li>
        </Items>
      </Article>

      <Article no={7} title="무료 플랜의 제한">
        <Bullets>
          <li>원본 파일(PDF·사진·음성)은 올린 날부터 {free.originalRetentionDays}일 뒤 삭제됩니다. AI가 읽은 본문·요약과 할 일은 남습니다.</li>
          <li>저장 용량 {Math.round((free.storageBytes ?? 0) / (1024 * 1024))}MB, 본문 검색은 최근 {free.searchHistoryDays}일 자료까지입니다.</li>
          <li>
            AI 처리는 매달 문서 {free.aiOcrPages}쪽, 음성 {Math.round(free.aiSttSeconds / 60)}분까지이며 매달 1일(한국 시간)에 다시
            채워집니다.
          </li>
          <li>무료 팀 워크스페이스는 {FREE_TEAM_MAX_SEATS}명까지 함께 쓸 수 있습니다.</li>
        </Bullets>
      </Article>

      <Article no={8} title="청약철회와 환불">
        <p>
          청약철회와 환불은{' '}
          <Link href="/legal/refund" className="text-blue-700 underline">
            환불정책
          </Link>
          과 「전자상거래 등에서의 소비자보호에 관한 법률」 등 관련 법령을 따릅니다.
        </p>
      </Article>

      <Article no={9} title="회원의 콘텐츠">
        <Items>
          <li>콘텐츠의 권리는 회원에게 있습니다. 회사는 서비스를 제공하는 데 필요한 범위(저장, AI 처리, 검색, 알림)에서만 콘텐츠를 다룹니다.</li>
          <li>모든 기록은 기본적으로 &ldquo;나만 보기&rdquo;로 저장되며, 팀 공유나 공유 링크로 공개하는 범위는 회원이 정합니다.</li>
          <li>공유 링크를 가진 사람은 로그인 없이 공유된 항목을 볼 수 있으므로, 링크를 전달할 때 주의해야 합니다.</li>
        </Items>
      </Article>

      <Article no={10} title="회원의 의무">
        <Bullets>
          <li>다른 사람의 개인정보가 담긴 서류는 정당한 권한이 있을 때만 올려야 합니다.</li>
          <li>법령에 어긋나는 자료를 올리거나, 서비스를 부정한 방법으로 쓰거나, 시스템에 무리를 주는 행위를 해서는 안 됩니다.</li>
        </Bullets>
      </Article>

      <Article no={11} title="AI 결과에 관한 책임">
        <p>
          AI가 만든 본문·요약과 서비스가 찾은 마감일·금액·연말정산 분류는 참고용이며, 틀릴 수 있습니다. 납부·제출·세금 신고 같은
          중요한 결정은 회원이 원본을 확인한 뒤 해야 합니다. 회사는 고의 또는 중대한 과실이 없는 한 AI 결과의 오류로 생긴 손해에
          책임을 지지 않습니다. <Todo>책임 제한 범위 법률 검토 필요</Todo>
        </p>
      </Article>

      <Article no={12} title="서비스의 변경과 중단">
        <p>
          회사는 점검, 설비 장애, 천재지변 등 부득이한 경우 서비스를 일시 중단할 수 있으며, 미리 알릴 수 없었던 경우에는 사후에
          알립니다. 서비스를 종료할 때는 30일 전에 알리고, 회원이 자료를 내려받을 수 있는 기간을 둡니다.
        </p>
      </Article>

      <Article no={13} title="탈퇴와 이용 제한">
        <p>
          회원은 언제든지 탈퇴할 수 있으며, 탈퇴하면 개인 워크스페이스의 콘텐츠는 삭제됩니다. 팀 워크스페이스에 공유한 자료의 처리는{' '}
          <Todo>팀 소유자 이전·삭제 정책 결정 필요</Todo>를 따릅니다. 회사는 회원이 이 약관을 어기면 이용을 제한할 수 있습니다.
        </p>
      </Article>

      <Article no={14} title="분쟁 해결">
        <p>
          서비스 이용과 관련한 분쟁은 대한민국 법을 따르며, 소송은 「민사소송법」에 따른 관할 법원에 제기합니다. 회원은
          한국소비자원 등 분쟁조정기관에 조정을 신청할 수 있습니다.
        </p>
      </Article>

      <Article title="부칙">
        <p>이 약관은 {companyField(COMPANY.effectiveDate, '시행일')}부터 시행합니다.</p>
      </Article>
    </LegalDoc>
  );
}
