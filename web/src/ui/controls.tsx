import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { openHighlight, stepIndex } from "./listbox.ts";

export interface Option<T extends string> { value: T; label: string; hint?: string; }

export function Segmented<T extends string>({
  value, options, onChange, label, size = "md",
}: { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-border bg-bg/60 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`whitespace-nowrap rounded-md transition-colors ${size === "sm" ? "px-2 py-0.5 text-[12px]" : "px-2.5 py-1 text-[13px]"} ${
              on ? "bg-accent-soft text-text shadow-[inset_0_0_0_1px_rgb(129_140_248/0.45)]" : "text-text-muted hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Accessible single-select listbox. Arrow keys, Home/End, Enter, Escape. */
export function Select<T extends string>({
  value, options, onChange, label, align = "left",
}: { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const activeRef = useRef(0);
  const openRef = useRef(false);
  activeRef.current = active;
  openRef.current = open;
  const current = options.find((o) => o.value === value) ?? options[0];
  const isAll = value === ("all" as T);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));

  const openAt = (index: number) => {
    activeRef.current = index;
    openRef.current = true;
    setActive(index);
    setOpen(true);
  };
  const closeMenu = () => {
    openRef.current = false;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const row = document.getElementById(`${id}-${activeRef.current}`);
    row?.scrollIntoView({ block: "nearest" });
    const onDoc = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) {
        openRef.current = false;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, id]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const choose = (i: number) => {
    const option = options[i];
    if (!option) return;
    onChange(option.value);
    closeMenu();
    btn.current?.focus();
  };

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => (openRef.current ? closeMenu() : openAt(selectedIndex))}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (openRef.current) {
            const next = stepIndex(activeRef.current, e.key, options.length);
            if (next === null) return;
            e.preventDefault();
            activeRef.current = next;
            setActive(next);
            return;
          }
          const index = openHighlight(selectedIndex, e.key, options.length);
          if (index === null) return;
          e.preventDefault();
          openAt(index);
        }}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[13px] transition-colors ${
          isAll ? "border-border text-text-2 hover:border-border-strong hover:text-text" : "border-accent/50 bg-accent-soft text-text"
        }`}
      >
        {!isAll && <span className="text-text-muted">{label}</span>}
        <span>{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="text-text-muted"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={(e) => {
            const next = stepIndex(activeRef.current, e.key, options.length);
            if (next !== null) { e.preventDefault(); activeRef.current = next; setActive(next); return; }
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(activeRef.current); }
            else if (e.key === "Escape" || e.key === "Tab") { closeMenu(); if (e.key === "Escape") btn.current?.focus(); }
          }}
          className={`scroll-thin absolute top-full z-50 mt-1.5 max-h-80 min-w-48 overflow-auto rounded-lg border border-border bg-bg-elevated p-1 shadow-[var(--shadow-panel)] outline-none ${align === "right" ? "right-0" : "left-0"}`}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active ? "true" : "false"}
              onMouseMove={(e) => {
                if (e.movementX === 0 && e.movementY === 0) return;
                if (activeRef.current !== i) setActive(i);
              }}
              onClick={() => choose(i)}
              className={`flex cursor-pointer items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-[13px] ${
                i === active ? "bg-bg-hover text-text" : "text-text-2"
              }`}
            >
              <span>{o.label}</span>
              {o.hint && <span className="num text-[11px] text-text-muted">{o.hint}</span>}
              {o.value === value && !o.hint && <span className="text-accent" aria-hidden>&#10003;</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IconButton({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg border transition-colors ${
        pressed ? "border-accent/50 bg-accent-soft text-text" : "border-border text-text-2 hover:border-border-strong hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

export function OriginBadge({ origin }: { origin: string }) {
  const synthetic = origin === "synthetic_demo";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11.5px] ${
        synthetic ? "border-dashed border-border-strong text-text-2" : "border-border text-text-2"
      }`}
      title={synthetic ? "Invented demo text. Not real evidence." : undefined}
    >
      {synthetic ? "Synthetic" : origin.replace(/_/g, " ")}
    </span>
  );
}

export function PolarityChip({ value }: { value: number }) {
  const color = value > 0 ? "var(--color-cyan)" : value < 0 ? "var(--color-magenta)" : "var(--color-muted)";
  const text = value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "0";
  return (
    <span className="num inline-flex items-center gap-1.5 text-[12.5px]" style={{ color }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      {text}
    </span>
  );
}
