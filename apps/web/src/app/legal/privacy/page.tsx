/**
 * apps/web/src/app/legal/privacy/page.tsx
 * 개인정보처리방침 (draft). Written from what the app actually collects and where it sends data.
 */
import React from 'react';
import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';
import { COMPANY, companyField } from '@/lib/company';
import { PLANS } from '@/lib/plans';
import { Article, Bullets, Items, LegalDoc, Table, Todo } from '@/components/legal/legal-doc';

export const metadata: Metadata = { title: `개인정보처리방침 — ${BRAND.name}` };

export default function PrivacyPage() {
  const company = companyField(COMPANY.legalName, '상호');
  const retentionDays = PLANS.free.limits.originalRetentionDays;

  return (
    <LegalDoc title="개인정보처리방침">
      <p>
        {company}(이하 &ldquo;회사&rdquo;)는 {BRAND.name} 서비스(이하 &ldquo;서비스&rdquo;)를 제공하면서 이용자의 개인정보를
        「개인정보 보호법」 등 관련 법령에 따라 처리합니다.
      </p>

      <Article no={1} title="처리하는 개인정보 항목">
        <Table
          head={['구분', '항목', '수집 방법']}
          rows={[
            ['회원 가입·로그인', '이메일, 이름(닉네임), 프로필 사진, 소셜 로그인 식별자(구글·카카오)', '소셜 로그인 시 해당 사업자로부터 제공'],
            ['서비스 이용', '이용자가 올린 문서·사진·음성 파일, 메모, 할 일, 일정, 프로젝트 기록과 이를 AI가 읽은 본문·요약', '이용자가 직접 입력·업로드'],
            ['알림', '푸시 알림 토큰, 기기 이름, 운영체제 종류', '모바일 앱에서 알림을 허용할 때'],
            ['자동 생성 정보', '접속 기록, 쿠키(로그인 유지·선택한 워크스페이스), 서비스 이용 기록', '서비스 이용 과정에서 자동 생성'],
            ['결제(유료 플랜)', '결제 승인 정보, 결제 수단 일부 정보', <Todo key="pay">결제사 연동 후 확정</Todo>],
          ]}
        />
        <p>
          이용자가 올리는 서류에는 건강검진 결과, 진료비 영수증, 계약서처럼 민감한 정보가 들어 있을 수 있습니다. 회사는 이용자가
          올린 범위에서만 이를 처리하며, 다른 목적으로 쓰지 않습니다.{' '}
          <Todo>건강정보 등 민감정보 처리에 별도 동의가 필요한지 법률 검토 필요</Todo>
        </p>
      </Article>

      <Article no={2} title="개인정보의 처리 목적">
        <Bullets>
          <li>회원 식별, 로그인 유지, 개인·팀 워크스페이스 운영</li>
          <li>올린 서류의 글자 인식(OCR)·요약·음성 받아쓰기, 마감일·금액 찾기, 검색, 연말정산 분류</li>
          <li>마감 알림, 원본 파일 만료 안내 등 서비스 알림 발송</li>
          <li>유료 플랜 결제와 환불, 고객 문의 응대, 부정 이용 방지</li>
        </Bullets>
      </Article>

      <Article no={3} title="보유 및 이용 기간">
        <Items>
          <li>회원 탈퇴 시 개인정보와 이용자가 올린 자료를 지체 없이 파기합니다.</li>
          <li>
            무료 플랜에서 올린 원본 파일(PDF·사진·음성)은 올린 날부터 {retentionDays}일이 지나면 자동으로 삭제합니다. AI가 읽은
            본문·요약과 이용자가 만든 할 일은 이용자가 지우거나 탈퇴할 때까지 보관합니다.
          </li>
          <li>
            관계 법령에 따라 보관이 필요한 정보는 해당 기간 동안 보관합니다: 계약·청약철회 및 대금 결제 기록 5년, 소비자 불만·분쟁
            처리 기록 3년(「전자상거래 등에서의 소비자보호에 관한 법률」), 접속 기록 3개월(「통신비밀보호법」).
          </li>
        </Items>
      </Article>

      <Article no={4} title="처리 위탁">
        <p>회사는 서비스 제공을 위해 아래와 같이 개인정보 처리를 위탁합니다.</p>
        <Table
          head={['수탁자', '위탁 업무']}
          rows={[
            ['Supabase Inc.', '회원 인증, 데이터베이스와 파일 저장'],
            [COMPANY.hostingProvider, '웹 서비스 호스팅'],
            ['AI 처리 업체 (설정한 업체)', '올린 서류의 글자 인식·요약, 음성 받아쓰기'],
            ['Expo (650 Industries, Inc.)', '모바일 푸시 알림 발송'],
            ['결제대행사', '유료 플랜 결제 처리 (연동 후 기재)'],
          ]}
        />
      </Article>

      <Article no={5} title="개인정보의 국외 이전">
        <p>
          위 수탁자 중 일부는 국외에서 개인정보를 처리합니다. 서비스 이용(계약 이행)에 필요한 범위에서 아래와 같이 이전하며,
          이전을 원하지 않으면 회원 탈퇴로 이전을 중단할 수 있습니다. 다만 이 경우 서비스를 이용할 수 없습니다.
        </p>
        <Table
          head={['이전받는 자 (연락처)', '이전 국가', '이전 항목', '이전 시기·방법', '목적·보유 기간']}
          rows={[
            ['Supabase Inc. (privacy@supabase.io)', '[저장 지역 입력]', '회원 정보, 올린 자료 전체', '이용 시 네트워크로 전송', '저장·인증 / 탈퇴 시까지'],
            ['AI 처리 업체 ([연락처])', '[국가 입력]', '처리를 요청한 서류·음성과 그 본문', 'AI 읽기 실행 시 전송', '글자 인식·요약 / 처리 직후 삭제 조건 확인'],
            ['650 Industries, Inc. (Expo)', '미국', '푸시 토큰, 알림 내용(할 일 제목 등)', '알림 발송 시 전송', '알림 발송 / 발송 후 삭제'],
            [`${COMPANY.hostingProvider}`, '[지역 입력]', '접속 기록', '이용 시 전송', '호스팅 / 업체 정책에 따름'],
          ]}
        />
        <p>
          <Todo>
            실제로 쓰는 업체·저장 지역·연락처와, AI 업체가 이용자 자료를 모델 학습에 쓰지 않는지·얼마 동안 보관하는지 계약 조건을
            확인해 표를 확정하세요.
          </Todo>
        </p>
      </Article>

      <Article no={6} title="AI 처리에 관한 안내">
        <Bullets>
          <li>AI 읽기는 이용자가 올린 서류에 대해서만 실행되며, 결과(본문·요약)는 이용자의 워크스페이스에만 저장됩니다.</li>
          <li>AI가 찾은 마감일·금액·연말정산 분류는 참고용이며, 틀릴 수 있습니다.</li>
          <li>
            회사는 이용자 자료를 AI 모델 학습에 쓰지 않습니다. <Todo>AI 업체도 학습에 쓰지 않는 조건인지 계약 확인 필요</Todo>
          </li>
        </Bullets>
      </Article>

      <Article no={7} title="개인정보의 제3자 제공">
        <p>
          회사는 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다. 이용자가 직접 만든 공유 링크로 공개한 항목(제목, 팀 공유로
          표시한 할 일, 요약, 원본 파일)은 링크를 가진 사람이 볼 수 있으며, &ldquo;나만 보기&rdquo; 기록은 공유되지 않습니다. 공유
          링크는 만료일이 지나거나 회수하면 열리지 않습니다.
        </p>
      </Article>

      <Article no={8} title="파기 절차와 방법">
        <p>
          보유 기간이 끝나거나 처리 목적을 이룬 개인정보는 지체 없이 파기합니다. 전자 파일은 복구할 수 없는 방법으로 삭제하고, 백업에
          남은 정보는 백업 보관 주기가 지나면 삭제됩니다. <Todo>백업 보관 기간 확인 필요</Todo>
        </p>
      </Article>

      <Article no={9} title="이용자의 권리와 행사 방법">
        <p>
          이용자는 언제든지 자신의 개인정보 열람, 정정, 삭제, 처리 정지를 요구할 수 있고, 서비스 안에서 직접 수정·삭제하거나 회원
          탈퇴할 수 있습니다. 아래 연락처로 요청하면 지체 없이 처리합니다. 만 14세 미만 아동은 서비스에 가입할 수 없습니다.
        </p>
      </Article>

      <Article no={10} title="쿠키">
        <p>
          서비스는 로그인 유지와 마지막으로 선택한 워크스페이스를 기억하기 위해 쿠키를 씁니다. 광고 목적의 쿠키는 쓰지 않습니다.
          브라우저 설정에서 쿠키를 거부할 수 있으나, 이 경우 로그인이 유지되지 않습니다.
        </p>
      </Article>

      <Article no={11} title="안전성 확보 조치">
        <Bullets>
          <li>워크스페이스 단위 접근 권한 관리(활성 멤버만 열람), 개인 기록과 팀 공유 기록의 분리</li>
          <li>원본 파일은 비공개 저장소에 보관하고, 열람 시 짧은 시간만 유효한 주소를 발급</li>
          <li>전송 구간 암호화(HTTPS), 공유 링크 토큰은 해시로만 저장</li>
        </Bullets>
      </Article>

      <Article no={12} title="개인정보 보호책임자">
        <Bullets>
          <li>개인정보 보호책임자: {companyField(COMPANY.privacyOfficer, '이름/직책')}</li>
          <li>이메일: {companyField(COMPANY.email, '이메일')}</li>
          <li>전화: {companyField(COMPANY.phone, '전화번호')}</li>
        </Bullets>
        <p className="text-xs text-slate-500">
          개인정보 침해 신고·상담: 개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118), 개인정보분쟁조정위원회(kopico.go.kr,
          1833-6972)
        </p>
      </Article>

      <Article title="부칙">
        <p>이 방침은 {companyField(COMPANY.effectiveDate, '시행일')}부터 시행합니다.</p>
      </Article>
    </LegalDoc>
  );
}
