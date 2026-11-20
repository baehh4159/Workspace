'use client';

/**
 * apps/web/src/components/dialog-provider.tsx
 * In-app replacement for window.confirm / window.prompt (which look unfinished and are
 * blocked in some in-app browsers such as KakaoTalk's).
 *
 *   const dialog = useDialog();
 *   if (!(await dialog.confirm({ title: '삭제할까요?', tone: 'danger', confirmLabel: '삭제' }))) return;
 *   const values = await dialog.form({ title: '일정 수정', fields: [{ name: 'title', label: '제목', required: true }] });
 *
 * Accessible: role="dialog" + aria-modal, focus moves in and is restored, Tab stays inside,
 * Esc cancels, Enter submits single-line forms.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export interface DialogField {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  maxLength?: number;
}

interface BaseOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

export interface ConfirmOptions extends BaseOptions {}

export interface FormOptions extends BaseOptions {
  fields: DialogField[];
}

type Request =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'form'; options: FormOptions; resolve: (values: Record<string, string> | null) => void };

interface DialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  form: (options: FormOptions) => Promise<Record<string, string> | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef<Request | null>(null);
  requestRef.current = request;

  const close = useCallback((result: 'ok' | 'cancel', formValues?: Record<string, string>) => {
    const current = requestRef.current;
    if (!current) return;
    if (current.kind === 'confirm') current.resolve(result === 'ok');
    else current.resolve(result === 'ok' ? (formValues ?? {}) : null);
    setRequest(null);
    setTouched(false);
    const toRestore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (toRestore && typeof toRestore.focus === 'function') setTimeout(() => toRestore.focus(), 0);
  }, []);

  const open = useCallback((next: Request) => {
    // Only one dialog at a time: a new request cancels the previous one.
    const previous = requestRef.current;
    if (previous) {
      if (previous.kind === 'confirm') previous.resolve(false);
      else previous.resolve(null);
    }
    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    if (next.kind === 'form') {
      setValues(Object.fromEntries(next.options.fields.map((f) => [f.name, f.defaultValue ?? ''])));
    }
    setTouched(false);
    setRequest(next);
  }, []);

  const api: DialogApi = React.useMemo(
    () => ({
      confirm: (options) => new Promise<boolean>((resolve) => open({ kind: 'confirm', options, resolve })),
      form: (options) =>
        new Promise<Record<string, string> | null>((resolve) => open({ kind: 'form', options, resolve })),
    }),
    [open]
  );

  // Initial focus + scroll lock while open
  useEffect(() => {
    if (!request) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => {
      const root = dialogRef.current;
      const target =
        root?.querySelector<HTMLElement>('input, textarea') ??
        root?.querySelector<HTMLElement>('[data-dialog-confirm]');
      target?.focus();
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.select();
    }, 0);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
  }, [request]);

  const missingRequired =
    request?.kind === 'form' &&
    request.options.fields.some((f) => f.required && !(values[f.name] ?? '').trim());

  const submit = () => {
    if (!request) return;
    if (request.kind === 'form') {
      setTouched(true);
      if (missingRequired) return;
      const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
      close('ok', trimmed);
    } else {
      close('ok');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Keep page-level shortcuts (inbox T/P/E etc.) from seeing keys typed in the dialog
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close('cancel');
      return;
    }
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Tab') {
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const options = request?.options;
  const danger = options?.tone === 'danger';

  return (
    <DialogContext.Provider value={api}>
      {children}
      {request && options && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="absolute inset-0" aria-hidden="true" onClick={() => close('cancel')} />
          <div
            ref={dialogRef}
            role={danger ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            aria-describedby={options.description ? 'app-dialog-desc' : undefined}
            onKeyDown={onKeyDown}
            className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          >
            <h2 id="app-dialog-title" className="text-base font-bold text-slate-900">
              {options.title}
            </h2>
            {options.description && (
              <p id="app-dialog-desc" className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {options.description}
              </p>
            )}

            {request.kind === 'form' && (
              <div className="mt-4 space-y-3">
                {request.options.fields.map((field) => {
                  const invalid = touched && field.required && !(values[field.name] ?? '').trim();
                  const common = {
                    id: `app-dialog-field-${field.name}`,
                    value: values[field.name] ?? '',
                    placeholder: field.placeholder,
                    maxLength: field.maxLength,
                    'aria-invalid': invalid || undefined,
                    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                      setValues((cur) => ({ ...cur, [field.name]: e.target.value })),
                    className: `w-full rounded-lg border bg-[#F7F8FA] px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none ${
                      invalid ? 'border-red-400 focus:border-red-500' : 'border-slate-200 focus:border-blue-600'
                    }`,
                  };
                  return (
                    <div key={field.name}>
                      <label htmlFor={common.id} className="mb-1 block text-xs font-semibold text-slate-700">
                        {field.label}
                      </label>
                      {field.multiline ? <textarea rows={5} {...common} /> : <input type="text" {...common} />}
                      {invalid && <p className="mt-1 text-xs text-red-600">{field.label}을(를) 입력해 주세요.</p>}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close('cancel')}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {options.cancelLabel ?? '취소'}
              </button>
              <button
                type="button"
                data-dialog-confirm
                onClick={submit}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                  danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-700 hover:bg-blue-800'
                }`}
              >
                {options.confirmLabel ?? '확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
