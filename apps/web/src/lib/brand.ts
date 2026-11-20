/**
 * apps/web/src/lib/brand.ts
 * Single place to change the product name and positioning copy.
 * (Landing page, pricing page, app header, login page and <title> all read from here.)
 */
export const BRAND = {
  name: 'Workspace',
  /** One-line promise used in hero sections and the browser title. */
  tagline: '종이 서류를 5초 만에 할 일로',
  /** Short description for <meta name="description"> and social previews. */
  description:
    '고지서·영수증·계약서를 찍으면 AI가 읽고, 마감일을 찾아 할 일로 만들어 줍니다. 개인과 10명 이하 팀을 위한 서류·할 일·일정 워크스페이스.',
} as const;
