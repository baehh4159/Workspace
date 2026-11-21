/**
 * apps/web/src/components/legal/legal-doc.tsx
 * Small building blocks for the /legal pages (headings, numbered articles, tables).
 */
import React from 'react';

export function LegalDoc({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
      <div className="mt-6 space-y-7 text-sm leading-relaxed text-slate-700">{children}</div>
    </article>
  );
}

export function Article({ no, title, children }: { no?: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-bold text-slate-900">
        {no !== undefined ? `제${no}조 (${title})` : title}
      </h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

export function Items({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>;
}

export function Bullets({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top text-slate-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Highlights a sentence that still needs a decision or legal review. */
export function Todo({ children }: { children: React.ReactNode }) {
  return <mark className="rounded bg-amber-100 px-1 text-amber-900">{children}</mark>;
}
