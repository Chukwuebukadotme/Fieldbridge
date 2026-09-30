"use client";

import { AlertTriangle, Ban, BadgeCheck, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { Fragment, useId, type ButtonHTMLAttributes, type ReactNode } from "react";

import type { MappingStatus } from "@/lib/models";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// --- Button --------------------------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-blue-600 text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-600",
  secondary: "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 active:bg-slate-100",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "border border-red-200 bg-white text-red-700 shadow-sm hover:bg-red-50",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-[13px]",
  md: "h-9 gap-2 px-3.5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

// --- Status badge (icon + text: never colour alone) ---------------------------------------------

const STATUS_STYLE: Record<MappingStatus, { className: string; Icon: typeof CheckCircle2 }> = {
  Ready: { className: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", Icon: CheckCircle2 },
  "Review required": { className: "bg-amber-50 text-amber-800 ring-amber-600/25", Icon: AlertTriangle },
  Missing: { className: "bg-red-50 text-red-700 ring-red-600/20", Icon: CircleDashed },
  Blocked: { className: "bg-red-50 text-red-700 ring-red-600/20", Icon: Ban },
  Approved: { className: "bg-emerald-600 text-white ring-emerald-600", Icon: BadgeCheck },
};

export function StatusBadge({ status, className }: { status: MappingStatus; className?: string }) {
  const { className: tone, Icon } = STATUS_STYLE[status];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      {status}
    </span>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600", className)}>
      {children}
    </span>
  );
}

// --- Layout pieces ---------------------------------------------------------------------------------

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}>{children}</div>;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4", className)}>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-slate-300 bg-white px-1 font-sans text-[11px] font-medium text-slate-500 shadow-[0_1px_0_rgba(15,23,42,0.08)]">
      {children}
    </kbd>
  );
}

/** A snake_case identifier in mono type that wraps between words instead of mid-word. */
export function FieldName({ name, className }: { name: string; className?: string }) {
  const parts = name.split("_");
  return (
    <code className={cx("font-mono text-[12.5px] text-slate-800", className)}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              _<wbr />
            </>
          )}
        </Fragment>
      ))}
    </code>
  );
}

export function Callout({ tone, title, children, icon }: { tone: "info" | "warning" | "danger" | "success"; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
  return (
    <div className={cx("flex gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-5", tones[tone])}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  );
}

// --- Tabs -----------------------------------------------------------------------------------------------

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void; label: string }) {
  const base = useId();
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 border-b border-slate-200"
      onKeyDown={(e) => {
        const index = tabs.findIndex((t) => t.id === value);
        const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        const next = tabs[(index + delta + tabs.length) % tabs.length];
        onChange(next.id);
        document.getElementById(`${base}-${next.id}`)?.focus();
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            id={`${base}-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cx(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-2.5 pt-1 text-[13px] font-medium transition-colors",
              active ? "border-blue-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// --- Form controls ---------------------------------------------------------------------------------------

export function Select({ label, value, onChange, children, hint }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
      >
        {children}
      </select>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export const inputClass =
  "h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none";
