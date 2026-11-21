/**
 * apps/web/src/lib/company.ts
 * Business details shown in the footer and the legal pages (/legal/*).
 *
 * Korean e-commerce rules expect the footer to show 상호·대표자·주소·전화·이메일·사업자등록번호·
 * 통신판매업 신고번호, and payment providers check these (plus terms, privacy policy and refund policy)
 * during merchant review. Fill everything in, have the legal pages reviewed, then set legalReviewed.
 */
export const COMPANY = {
  /** 상호 */
  legalName: '',
  /** 대표자 */
  representative: '',
  /** 사업자등록번호, e.g. 000-00-00000 */
  businessNumber: '',
  /** 통신판매업 신고번호, e.g. 제0000-서울강남-00000호 */
  mailOrderNumber: '',
  address: '',
  email: '',
  phone: '',
  /** 개인정보 보호책임자 (이름 / 직책) */
  privacyOfficer: '',
  /** 호스팅 서비스 제공자 */
  hostingProvider: 'Vercel Inc.',
  /** Date the current legal documents take effect (YYYY-MM-DD). */
  effectiveDate: '',
  /** Set to true after the /legal pages have been reviewed by a legal expert. */
  legalReviewed: false,
} as const;

/** Value or a visible placeholder like "[상호 입력 필요]". */
export function companyField(value: string, label: string): string {
  return value.trim() || `[${label} 입력 필요]`;
}

export function hasBusinessInfo(): boolean {
  return Boolean(COMPANY.legalName.trim() && COMPANY.businessNumber.trim());
}
