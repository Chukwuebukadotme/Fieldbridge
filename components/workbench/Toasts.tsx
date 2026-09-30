"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { cx } from "../ui";

type Tone = "success" | "info" | "warning" | "error";

interface Toast {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

type ToastInput = Omit<Toast, "id">;

const ToastContext = createContext<(toast: ToastInput) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const ICONS: Record<Tone, ReactNode> = {
  success: <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />,
  info: <Info className="size-4 text-blue-600" aria-hidden />,
  warning: <AlertTriangle className="size-4 text-amber-600" aria-hidden />,
  error: <XCircle className="size-4 text-red-600" aria-hidden />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-2), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.action ? 7000 : toast.tone === "warning" || toast.tone === "error" ? 6000 : 3500);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg shadow-slate-900/10"
          >
            <div className="mt-0.5">{ICONS[toast.tone]}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900">{toast.title}</div>
              {toast.description && <div className="mt-0.5 text-[13px] text-slate-500">{toast.description}</div>}
            </div>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action!.onClick();
                  dismiss(toast.id);
                }}
                className={cx("rounded-md px-2 py-1 text-[13px] font-semibold text-blue-700 hover:bg-blue-50")}
              >
                {toast.action.label}
              </button>
            )}
            <button type="button" onClick={() => dismiss(toast.id)} className="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Dismiss notification">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
