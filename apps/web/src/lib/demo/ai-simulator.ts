/**
 * apps/web/src/lib/demo/ai-simulator.ts
 * DEMO MODE ONLY: stands in for packages/ai/worker.ts so "AI로 읽기" can be tried without an AI provider.
 * Sample documents get realistic sample results; files you upload yourself get a clearly labelled
 * placeholder (the demo never invents facts about your own documents).
 */
import type { AiProcessJobInput, AiProcessResult } from '@workspace/ai/worker';

function kstDatePlus(days: number): { iso: string; m: number; d: number } {
  const k = new Date(Date.now() + 9 * 3_600_000 + days * 86_400_000);
  const y = k.getUTCFullYear();
  const m = k.getUTCMonth() + 1;
  const d = k.getUTCDate();
  return { iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, m, d };
}

export async function simulateAiProcessing(
  job: AiProcessJobInput & { title: string | null }
): Promise<AiProcessResult> {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const title = job.title ?? '';

  if (title.includes('건강검진')) {
    const due = kstDatePlus(12);
    return {
      extractedText: `국민건강보험공단 일반건강검진 결과 통보서 / 판정: 정상B(경계) / 공복혈당 108mg/dL — 2차 확인 검사 대상 / 2차 검진 기한 ${due.iso}까지 / 본인부담 없음`,
      summaryText: `건강검진 결과 공복혈당 경계 수치. 2차 확인 검사 ${due.m}월 ${due.d}일까지 받아야 함 (본인부담 없음)`,
      estimatedCostUsd: 0,
      actualUnits: Math.max(1, job.pageCount ?? 1),
    };
  }

  if (job.sourceType === 'quick_voice') {
    return {
      extractedText: '[데모] 실제 서비스에서는 녹음한 말이 글자로 바뀌어 이곳에 저장되고 검색됩니다.',
      summaryText: '[데모] 음성 받아쓰기 결과가 여기에 표시됩니다.',
      estimatedCostUsd: 0,
      actualUnits: Math.max(1, job.audioSeconds ?? 1),
    };
  }

  if (job.sourceType === 'scanner_doc') {
    return {
      extractedText: `[데모] "${title || '올린 문서'}"의 본문 전체가 여기에 저장되고, 본문 검색에 쓰입니다.`,
      summaryText: `[데모] 실제 서비스에서는 "${title || '올린 문서'}"의 요약과 마감일·금액이 여기에 표시됩니다.`,
      estimatedCostUsd: 0,
      actualUnits: Math.max(1, job.pageCount ?? 1),
    };
  }

  return {
    extractedText: job.rawText ?? '',
    summaryText: job.rawText ?? '',
    estimatedCostUsd: 0,
    actualUnits: 1,
  };
}
