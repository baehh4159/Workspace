/**
 * Run: pnpm --filter @workspace/ai test
 * Stubs globalThis.fetch, so no network access or API key is needed.
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countPdfPages,
  mimeTypeFromStoragePath,
  processInboxItemWithAi,
  type AiProcessJobInput,
} from './worker.ts';

interface Call {
  url: string;
  init: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let handler: (url: string, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function chatReply(content: string, usage = { prompt_tokens: 1000, completion_tokens: 200 }): Response {
  return json({ choices: [{ message: { content } }], usage });
}

const TWO_PAGE_PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n2 0 obj<</Type /Pages /Kids [3 0 R 4 0 R] /Count 2>>endobj\n' +
    '3 0 obj<</Type /Page /Parent 2 0 R>>endobj\n4 0 obj<</Type/Page /Parent 2 0 R>>endobj\n%%EOF'
);

function job(overrides: Partial<AiProcessJobInput>): AiProcessJobInput {
  return {
    itemId: '00000000-0000-4000-8000-000000000001',
    sourceType: 'scanner_doc',
    signedFileUrl: 'https://storage.example.com/signed/file',
    rawText: null,
    pageCount: 1,
    audioSeconds: null,
    mimeType: 'image/jpeg',
    title: '전기요금 고지서',
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  process.env.AI_PROVIDER_ENDPOINT = 'https://api.example.com/v1/';
  process.env.AI_PROVIDER_API_KEY = 'test-key';
  process.env.AI_TEXT_MODEL = 'test-vision-model';
  process.env.AI_TRANSCRIBE_MODEL = 'test-stt-model';
  process.env.AI_PRICE_INPUT_PER_MTOK = '1';
  process.env.AI_PRICE_OUTPUT_PER_MTOK = '5';
  process.env.AI_PRICE_TRANSCRIBE_PER_MIN = '0.006';
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('image document: sends the image as a data URL and parses the JSON reply', async () => {
  handler = (url) => {
    if (url.startsWith('https://storage.example.com')) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    return chatReply(JSON.stringify({ extracted_text: '청구금액 48,320원', summary: '11월 전기요금 48,320원, 2026-11-30까지 납부' }));
  };

  const result = await processInboxItemWithAi(job({}));

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://api.example.com/v1/chat/completions');
  const headers = calls[1].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(String(calls[1].init.body));
  assert.equal(body.model, 'test-vision-model');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  const parts = body.messages[1].content;
  assert.equal(parts[1].type, 'image_url');
  assert.match(parts[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.match(parts[0].text, /YYYY-MM-DD까지/);

  assert.equal(result.extractedText, '청구금액 48,320원');
  assert.equal(result.summaryText, '11월 전기요금 48,320원, 2026-11-30까지 납부');
  assert.equal(result.actualUnits, 1);
  // 1000 input tokens * $1/M + 200 output tokens * $5/M
  assert.ok(Math.abs(result.estimatedCostUsd - 0.002) < 1e-9);
});

test('PDF document: sends a file part and audits the page count', async () => {
  handler = (url) =>
    url.startsWith('https://storage.example.com')
      ? new Response(TWO_PAGE_PDF)
      : chatReply('```json\n{"extracted_text":"계약서 본문","summary":"임대차 계약서, 2027-01-14까지 만료"}\n```');

  const result = await processInboxItemWithAi(job({ mimeType: 'application/pdf', pageCount: 1 }));

  const parts = JSON.parse(String(calls[1].init.body)).messages[1].content;
  assert.equal(parts[1].type, 'file');
  assert.equal(parts[1].file.filename, 'document.pdf');
  assert.match(parts[1].file.file_data, /^data:application\/pdf;base64,/);
  assert.equal(result.summaryText, '임대차 계약서, 2027-01-14까지 만료');
  assert.equal(result.actualUnits, 2, 'declared 1 page but the PDF has 2');
});

test('voice memo: transcribes, then summarizes the transcript', async () => {
  handler = (url) => {
    if (url.startsWith('https://storage.example.com')) return new Response(new Uint8Array([1, 2, 3]));
    if (url.endsWith('/audio/transcriptions')) return json({ text: '내일까지 집주인에게 문자 보내기', duration: 4.2 });
    return chatReply(JSON.stringify({ summary: '집주인에게 문자 보내기, 2026-11-22까지' }));
  };

  const result = await processInboxItemWithAi(
    job({ sourceType: 'quick_voice', mimeType: 'audio/webm', audioSeconds: 4, pageCount: null })
  );

  assert.equal(calls[1].url, 'https://api.example.com/v1/audio/transcriptions');
  const form = calls[1].init.body as FormData;
  assert.equal(form.get('model'), 'test-stt-model');
  assert.equal(form.get('language'), 'ko');
  assert.equal((form.get('file') as File).name, 'voice.webm');
  assert.equal(calls[2].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(result.extractedText, '내일까지 집주인에게 문자 보내기');
  assert.equal(result.summaryText, '집주인에게 문자 보내기, 2026-11-22까지');
  assert.equal(result.actualUnits, 5, 'provider duration 4.2s rounds up to 5');
});

test('text memo: one chat call, raw text kept as extracted text', async () => {
  handler = () => chatReply(JSON.stringify({ summary: '배너 시안 피드백, 2026-11-27까지' }));
  const result = await processInboxItemWithAi(
    job({ sourceType: 'quick_text', signedFileUrl: null, rawText: '배너 시안 피드백 금요일까지', mimeType: null })
  );
  assert.equal(calls.length, 1);
  assert.equal(result.extractedText, '배너 시안 피드백 금요일까지');
  assert.equal(result.actualUnits, 1);
});

test('missing configuration is reported before any request', async () => {
  delete process.env.AI_PROVIDER_API_KEY;
  handler = () => chatReply('{}');
  await assert.rejects(processInboxItemWithAi(job({})), /AI_PROVIDER_NOT_CONFIGURED/);
  assert.equal(calls.length, 0);
});

test('HEIC is rejected without calling the provider', async () => {
  handler = () => chatReply('{}');
  await assert.rejects(processInboxItemWithAi(job({ mimeType: 'image/heic' })), /AI_UNSUPPORTED_FILE_TYPE/);
  assert.equal(calls.length, 0);
});

test('provider errors are mapped to stable codes', async () => {
  handler = (url) => (url.startsWith('https://storage.example.com') ? new Response(new Uint8Array([1])) : json({}, 401));
  await assert.rejects(processInboxItemWithAi(job({})), /AI_PROVIDER_AUTH_FAILED/);

  handler = (url) => (url.startsWith('https://storage.example.com') ? new Response(new Uint8Array([1])) : json({}, 429));
  await assert.rejects(processInboxItemWithAi(job({})), /AI_PROVIDER_RATE_LIMITED/);
});

test('a reply that is not the expected JSON is rejected', async () => {
  handler = (url) =>
    url.startsWith('https://storage.example.com') ? new Response(new Uint8Array([1])) : chatReply('죄송하지만 읽을 수 없습니다');
  await assert.rejects(processInboxItemWithAi(job({})), /AI_PROVIDER_INVALID_RESPONSE/);
});

test('countPdfPages and mimeTypeFromStoragePath', () => {
  assert.equal(countPdfPages(TWO_PAGE_PDF), 2);
  assert.equal(countPdfPages(new TextEncoder().encode('not a pdf')), null);
  assert.equal(mimeTypeFromStoragePath('ws/user/abc.pdf'), 'application/pdf');
  assert.equal(mimeTypeFromStoragePath('ws/user/abc.m4a'), 'audio/mp4');
  assert.equal(mimeTypeFromStoragePath(null), null);
});
