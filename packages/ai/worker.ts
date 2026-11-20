/**
 * packages/ai/worker.ts
 * Provider-agnostic AI processing pipeline for inbox_items:
 *  - Guards empty rawText on quick_text / quick_tag before external API calls
 *  - Captures provider-reported actualUnits (actual pages / audio seconds) for metering reconciliation
 */

export type AiUsageType = 'doc_ocr_pages' | 'voice_stt_seconds' | 'text_classify';

export interface AiProcessJobInput {
  itemId: string;
  sourceType: 'scanner_doc' | 'quick_voice' | 'quick_text' | 'quick_tag';
  signedFileUrl: string | null;
  rawText: string | null;
  pageCount: number | null;
  audioSeconds: number | null;
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

export async function processInboxItemWithAi(job: AiProcessJobInput): Promise<AiProcessResult> {
  const endpoint = process.env.AI_PROVIDER_ENDPOINT;
  const apiKey = process.env.AI_PROVIDER_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error('AI_PROVIDER_NOT_CONFIGURED');
  }

  if ((job.sourceType === 'scanner_doc' || job.sourceType === 'quick_voice') && !job.signedFileUrl) {
    throw new Error('MISSING_SOURCE_FILE_URL');
  }

  if ((job.sourceType === 'quick_text' || job.sourceType === 'quick_tag') && !job.rawText?.trim()) {
    throw new Error('EMPTY_TEXT_INPUT');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Data-Retention': 'zero',
      },
      body: JSON.stringify({
        task: job.sourceType,
        fileUrl: job.signedFileUrl,
        rawText: job.rawText,
        languageHint: 'ko',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`AI_PROVIDER_HTTP_${res.status}`);
    }

    const data = (await res.json()) as {
      extractedText?: string;
      summaryText?: string;
      estimatedCostUsd?: number;
      actualUnits?: number;
    };

    if (typeof data.extractedText !== 'string' || typeof data.summaryText !== 'string') {
      throw new Error('AI_PROVIDER_INVALID_RESPONSE');
    }

    const fallbackUnits = resolveAiMetering(job).units;
    const actualUnits =
      typeof data.actualUnits === 'number' && data.actualUnits > 0
        ? data.actualUnits
        : fallbackUnits;

    return {
      extractedText: data.extractedText,
      summaryText: data.summaryText,
      estimatedCostUsd: typeof data.estimatedCostUsd === 'number' ? data.estimatedCostUsd : 0,
      actualUnits,
    };
  } finally {
    clearTimeout(timeout);
  }
}
