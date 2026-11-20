/**
 * apps/web/src/app/api/demo-upload/route.ts
 * DEMO MODE ONLY: stands in for Supabase Storage signed upload/download URLs.
 *  - PUT stores the uploaded bytes in server memory (see lib/demo/mock-supabase.ts)
 *  - GET serves them back (or a placeholder preview for the sample documents)
 * Returns 404 whenever a real Supabase project is configured.
 */
import { NextResponse } from 'next/server';
import { ALLOWED_UPLOAD_MIME_TYPES } from '@workspace/core/schemas';
import { DEMO_MODE, getDemoObject, putDemoObject } from '@/lib/demo/mock-supabase';

const SAFE_TYPES = new Set<string>(ALLOWED_UPLOAD_MIME_TYPES);
const PATH_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
<rect width="600" height="800" fill="#f8fafc"/><rect x="60" y="80" width="480" height="640" rx="16" fill="#fff" stroke="#e2e8f0" stroke-width="2"/>
<rect x="110" y="150" width="260" height="22" rx="6" fill="#cbd5e1"/><rect x="110" y="200" width="380" height="14" rx="5" fill="#e2e8f0"/>
<rect x="110" y="230" width="340" height="14" rx="5" fill="#e2e8f0"/><rect x="110" y="260" width="360" height="14" rx="5" fill="#e2e8f0"/>
<text x="300" y="440" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#64748b">데모 샘플 문서</text>
<text x="300" y="480" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#94a3b8">직접 올린 파일은 원본이 그대로 열립니다</text>
</svg>`;

function getPath(req: Request): string | null {
  const path = new URL(req.url).searchParams.get('path');
  return path && PATH_PATTERN.test(path) ? path : null;
}

export async function PUT(req: Request) {
  if (!DEMO_MODE) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const path = getPath(req);
  if (!path) return NextResponse.json({ error: 'INVALID_PATH' }, { status: 400 });

  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) return NextResponse.json({ error: 'EMPTY_BODY' }, { status: 400 });

  const stored = putDemoObject(path, bytes, SAFE_TYPES.has(contentType) ? contentType : 'application/octet-stream');
  if (stored === 'too_large') return NextResponse.json({ error: 'DEMO_FILE_TOO_LARGE' }, { status: 413 });
  return NextResponse.json({ Key: path }, { status: 200 });
}

export async function GET(req: Request) {
  if (!DEMO_MODE) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const rawPath = new URL(req.url).searchParams.get('path') ?? '';
  const obj = PATH_PATTERN.test(rawPath) ? getDemoObject(rawPath) : null;

  const securityHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'",
  };

  if (!obj) {
    return new Response(PLACEHOLDER_SVG, {
      status: 200,
      headers: { ...securityHeaders, 'Content-Type': 'image/svg+xml; charset=utf-8' },
    });
  }
  return new Response(obj.bytes as BodyInit, {
    status: 200,
    headers: { ...securityHeaders, 'Content-Type': obj.contentType, 'Content-Disposition': 'inline' },
  });
}
