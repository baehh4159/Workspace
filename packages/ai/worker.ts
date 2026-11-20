/**
 * packages/ai/worker.ts
 * AI processing for inbox_items against any OpenAI-compatible API
 * (OpenAI, Azure OpenAI, Upstage, vLLM, … — set AI_PROVIDER_ENDPOINT to the provider's /v1 base URL).
 *
 *  - scanner_doc (JPG/PNG/WEBP): chat completion with the image   → OCR text + Korean summary
 *  - scanner_doc (PDF):          chat completion with a file part → OCR text + Korean summary
 *  - quick_voice:                /audio/transcriptions, then a chat summary of the transcript
 *  - quick_text / quick_tag:     chat summary of the memo
 *
 * Summaries are asked to state deadlines as "YYYY-MM-DD까지" and amounts as "N원" so that
 * apps/web/src/lib/deadline-detect.ts can turn them into due dates without another AI call.
 *
 * Environment:
 *   AI_PROVIDER_ENDPOINT   base URL, e.g. https://api.openai.com/v1            (required)
 *   AI_PROVIDER_API_KEY    API key sent as "Authorization: Bearer …"          (required)
 *   AI_TEXT_MODEL          vision/text model        (default: gpt-4o-mini)
 *   AI_TRANSCRIBE_MODEL    speech-to-text model     (default: whisper-1)
 *   AI_TIMEOUT_MS          per-request timeout      (default: 60000)
 *   AI_PRICE_INPUT_PER_MTOK / AI_PRICE_OUTPUT_PER_MTOK / AI_PRICE_TRANSCRIBE_PER_MIN
 *                          USD prices used only for the cost estimate stored in ai_usage_ledger (default 0)
 */

export type AiUsageType = 'doc_ocr_pages' | 'voice_stt_seconds' | 'text_classify';

export interface AiProcessJobInput {
  itemId: string;
  sourceType: 'scanner_doc' | 'quick_voice' | 'quick_text' | 'quick_tag';
  signedFileUrl: string | null;
  rawText: string | null;
  pageCount: number | null;
  audioSeconds: number | null;
  /** MIME type of the original file (from the storage path extension). */
  mimeType?: string | null;
  /** Item title, used as a hint for the summary. */
  title?: string | null;
}

export interface AiProcessResult {
  extractedText: string;
  summaryText: string;
  estimatedCostUsd: number;
  /** Provider-verified units (e.g. actual OCR pages or STT seconds) for anti-spoofing audit */
  actualUnits: number;
}

export function resolveAiMetering(
  input: Pick<AiProcessJobInput, 'sourceType' | 'pageCount' | 'audioSeconds'>
): { usageType: AiUsageType; units: number } {
  if (input.sourceType === 'scanner_doc') {
    return { usageType: 'doc_ocr_pages', units: Math.max(1, input.pageCount ?? 1) };
  }
  if (input.sourceType === 'quick_voice') {
    return { usageType: 'voice_stt_seconds', units: Math.max(1, input.audioSeconds ?? 60) };
  }
  return { usageType: 'text_classify', units: 1 };
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AUDIO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};
/** Files above this size are not sent to the AI provider (request size limits). */
export const MAX_AI_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 60_000;
const MAX_SUMMARY_CHARS = 600;

const SYSTEM_PROMPT =
  '너는 한국어 서류와 메모를 정리하는 비서다. 문서에 없는 내용은 절대 지어내지 않는다. 반드시 JSON 객체 하나만 출력한다.';

function summaryRules(today: string): string {
  return [
    '"summary"는 한두 문장의 한국어 요약이다. 아래 규칙을 지킨다.',
    '- 무엇에 관한 서류인지 먼저 말한다 (예: "11월 전기요금 고지서").',
    '- 금액이 있으면 "48,320원"처럼 숫자와 "원"으로 적는다.',
    `- 납부·마감·제출·만료 기한이 있으면 "YYYY-MM-DD까지" 형식으로 반드시 포함한다. 연도가 없으면 오늘(${today}) 기준으로 가장 가까운 미래 날짜로 판단한다.`,
    '- 기한이 없으면 날짜를 지어내지 않는다.',
  ].join('\n');
}

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  textModel: string;
  transcribeModel: string;
  timeoutMs: number;
  priceInputPerMTok: number;
  priceOutputPerMTok: number;
  priceTranscribePerMin: number;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readConfig(): ProviderConfig {
  const endpoint = process.env.AI_PROVIDER_ENDPOINT?.trim();
  const apiKey = process.env.AI_PROVIDER_API_KEY?.trim();
  if (!endpoint || !apiKey) {
    throw new Error('AI_PROVIDER_NOT_CONFIGURED');
  }
  return {
    baseUrl: endpoint.replace(/\/+$/, ''),
    apiKey,
    textModel: process.env.AI_TEXT_MODEL?.trim() || 'gpt-4o-mini',
    transcribeModel: process.env.AI_TRANSCRIBE_MODEL?.trim() || 'whisper-1',
    timeoutMs: numberEnv('AI_TIMEOUT_MS', 60_000),
    priceInputPerMTok: numberEnv('AI_PRICE_INPUT_PER_MTOK', 0),
    priceOutputPerMTok: numberEnv('AI_PRICE_OUTPUT_PER_MTOK', 0),
    priceTranscribePerMin: numberEnv('AI_PRICE_TRANSCRIBE_PER_MIN', 0),
  };
}

function kstToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('AI_PROVIDER_TIMEOUT');
    throw new Error('AI_PROVIDER_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
}

function providerHttpError(status: number): Error {
  if (status === 401 || status === 403) return new Error('AI_PROVIDER_AUTH_FAILED');
  if (status === 429) return new Error('AI_PROVIDER_RATE_LIMITED');
  return new Error(`AI_PROVIDER_HTTP_${status}`);
}

/** Downloads the original file from its short-lived signed URL. */
async function downloadOriginal(url: string, timeoutMs: number): Promise<Uint8Array> {
  const res = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
  if (!res.ok) throw new Error('SOURCE_FILE_DOWNLOAD_FAILED');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('SOURCE_FILE_EMPTY');
  if (bytes.byteLength > MAX_AI_FILE_BYTES) throw new Error('FILE_TOO_LARGE_FOR_AI');
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Best-effort page count for a PDF (counts /Type /Page objects).
 * Used only to audit the page count the client declared; returns null when unsure.
 */
export function countPdfPages(bytes: Uint8Array): number | null {
  const text = Buffer.from(bytes).toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches && matches.length > 0 ? matches.length : null;
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

async function chatJson(
  cfg: ProviderConfig,
  content: string | ChatContentPart[]
): Promise<{ data: Record<string, unknown>; usage: ChatUsage }> {
  const res = await fetchWithTimeout(
    `${cfg.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.textModel,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
    },
    cfg.timeoutMs
  );
  if (!res.ok) throw providerHttpError(res.status);

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: ChatUsage;
  };
  const raw = body.choices?.[0]?.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('AI_PROVIDER_INVALID_RESPONSE');

  let data: unknown;
  try {
    // Some compatible providers wrap JSON in ``` fences even in JSON mode.
    data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    throw new Error('AI_PROVIDER_INVALID_RESPONSE');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('AI_PROVIDER_INVALID_RESPONSE');
  return { data: data as Record<string, unknown>, usage: body.usage ?? {} };
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' ? value.trim() : null;
}

function chatCost(cfg: ProviderConfig, usage: ChatUsage): number {
  const input = (usage.prompt_tokens ?? 0) * cfg.priceInputPerMTok;
  const output = (usage.completion_tokens ?? 0) * cfg.priceOutputPerMTok;
  return (input + output) / 1_000_000;
}

function finish(extracted: string, summary: string): { extractedText: string; summaryText: string } {
  return {
    extractedText: extracted.slice(0, MAX_EXTRACTED_CHARS),
    summaryText: summary.slice(0, MAX_SUMMARY_CHARS),
  };
}

async function processDocument(cfg: ProviderConfig, job: AiProcessJobInput): Promise<AiProcessResult> {
  const mimeType = (job.mimeType ?? '').toLowerCase();
  const isPdf = mimeType === 'application/pdf';
  if (!isPdf && !IMAGE_TYPES.has(mimeType)) {
    throw new Error('AI_UNSUPPORTED_FILE_TYPE');
  }

  const bytes = await downloadOriginal(job.signedFileUrl as string, cfg.timeoutMs);
  const dataUrl = `data:${mimeType};base64,${toBase64(bytes)}`;
  const instructions = [
    '첨부한 서류를 읽고 다음 형식의 JSON을 출력하라: {"extracted_text": string, "summary": string}',
    '"extracted_text"는 서류의 글자를 빠짐없이 옮겨 적은 것이다. 표는 한 행을 한 줄로 적는다.',
    summaryRules(kstToday()),
    job.title ? `참고: 사용자가 붙인 제목은 "${job.title}"이다.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const filePart: ChatContentPart = isPdf
    ? { type: 'file', file: { filename: 'document.pdf', file_data: dataUrl } }
    : { type: 'image_url', image_url: { url: dataUrl } };

  const { data, usage } = await chatJson(cfg, [{ type: 'text', text: instructions }, filePart]);
  const extracted = readString(data, 'extracted_text');
  const summary = readString(data, 'summary');
  if (extracted === null || summary === null) throw new Error('AI_PROVIDER_INVALID_RESPONSE');

  const declaredPages = resolveAiMetering(job).units;
  const countedPages = isPdf ? countPdfPages(bytes) : 1;
  return {
    ...finish(extracted, summary),
    estimatedCostUsd: chatCost(cfg, usage),
    actualUnits: Math.max(declaredPages, countedPages ?? declaredPages),
  };
}

async function processVoice(cfg: ProviderConfig, job: AiProcessJobInput): Promise<AiProcessResult> {
  const mimeType = (job.mimeType ?? 'audio/webm').toLowerCase();
  const ext = AUDIO_EXT[mimeType];
  if (!ext) throw new Error('AI_UNSUPPORTED_FILE_TYPE');

  const bytes = await downloadOriginal(job.signedFileUrl as string, cfg.timeoutMs);
  const form = new FormData();
  form.append('file', new Blob([bytes as BlobPart], { type: mimeType }), `voice.${ext}`);
  form.append('model', cfg.transcribeModel);
  form.append('language', 'ko');
  form.append('response_format', 'json');

  const res = await fetchWithTimeout(
    `${cfg.baseUrl}/audio/transcriptions`,
    { method: 'POST', headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: form },
    cfg.timeoutMs
  );
  if (!res.ok) throw providerHttpError(res.status);
  const body = (await res.json()) as { text?: string; duration?: number };
  const transcript = typeof body.text === 'string' ? body.text.trim() : '';
  if (!transcript) throw new Error('AI_EMPTY_TRANSCRIPT');

  const declaredSeconds = resolveAiMetering(job).units;
  const seconds =
    typeof body.duration === 'number' && body.duration > 0 ? Math.ceil(body.duration) : declaredSeconds;
  const transcribeCost = (seconds / 60) * cfg.priceTranscribePerMin;

  const { data, usage } = await chatJson(
    cfg,
    [
      '다음은 사용자가 녹음한 음성 메모를 받아쓴 글이다. {"summary": string} 형식의 JSON을 출력하라.',
      summaryRules(kstToday()),
      '',
      transcript,
    ].join('\n')
  );
  const summary = readString(data, 'summary') ?? transcript.slice(0, MAX_SUMMARY_CHARS);
  return {
    ...finish(transcript, summary),
    estimatedCostUsd: transcribeCost + chatCost(cfg, usage),
    actualUnits: Math.max(declaredSeconds, seconds),
  };
}

async function processText(cfg: ProviderConfig, job: AiProcessJobInput): Promise<AiProcessResult> {
  const rawText = (job.rawText ?? '').trim();
  const { data, usage } = await chatJson(
    cfg,
    [
      '다음은 사용자가 남긴 짧은 메모다. {"summary": string} 형식의 JSON을 출력하라.',
      summaryRules(kstToday()),
      '',
      rawText,
    ].join('\n')
  );
  const summary = readString(data, 'summary') ?? rawText;
  return { ...finish(rawText, summary), estimatedCostUsd: chatCost(cfg, usage), actualUnits: 1 };
}

export async function processInboxItemWithAi(job: AiProcessJobInput): Promise<AiProcessResult> {
  const cfg = readConfig();

  if ((job.sourceType === 'scanner_doc' || job.sourceType === 'quick_voice') && !job.signedFileUrl) {
    throw new Error('MISSING_SOURCE_FILE_URL');
  }
  if ((job.sourceType === 'quick_text' || job.sourceType === 'quick_tag') && !job.rawText?.trim()) {
    throw new Error('EMPTY_TEXT_INPUT');
  }

  if (job.sourceType === 'scanner_doc') return processDocument(cfg, job);
  if (job.sourceType === 'quick_voice') return processVoice(cfg, job);
  return processText(cfg, job);
}

/** MIME type for a storage path created by /api/inbox/upload-url (`…/<uuid>.<ext>`). */
export function mimeTypeFromStoragePath(path: string | null | undefined): string | null {
  const ext = path?.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'webm':
      return 'audio/webm';
    case 'm4a':
      return 'audio/mp4';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    default:
      return null;
  }
}
