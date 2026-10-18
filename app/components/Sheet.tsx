"use client";

import { ReactNode, useEffect, useId, useRef } from "react";
import { CloseIcon } from "./Icons";

interface Props {
  side: "left" | "right";
  title: string;
  closeLabel: string;
  textColor: string;
  bgColor: string;
  onClose: () => void;
  // Shown under the title, outside the scrolling area (e.g. tabs)
  header?: ReactNode;
  children: ReactNode;
}

// A panel over the page, which stays where it was: a side drawer on wider
// screens, a bottom sheet on phones. Closes on Esc and on the backdrop.
export default function Sheet({ side, title, closeLabel, textColor, bgColor, onClose, header, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Read while rendering, before focus moves into the sheet
  const openerRef = useRef(typeof document === "undefined" ? null : document.activeElement);
  const titleId = useId();
  // The parent passes a new function every render; the effect below must not re-run for it
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = openerRef.current instanceof HTMLElement ? openerRef.current : null;
    const panel = panelRef.current;
    panel?.focus({ preventScroll: true });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "Tab" && panel) keepFocusInside(panel, e);
    };
    document.addEventListener("keydown", onKeyDown);
    // Keep the chapter underneath from scrolling along
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      root.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, []);

  const sideClass =
    side === "left"
      ? "sheet-left sm:left-0 sm:right-auto sm:border-r"
      : "sheet-right sm:right-0 sm:left-auto sm:border-l";

  return (
    <div className="fixed inset-0 z-50">
      <div className="backdrop absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={
          "sheet absolute inset-x-0 bottom-0 flex flex-col max-h-[85dvh] rounded-t-2xl shadow-2xl outline-none " +
          "sm:inset-y-0 sm:max-h-none sm:w-[420px] sm:rounded-none " +
          sideClass
        }
        style={{ backgroundColor: bgColor, color: textColor, borderColor: textColor + "20" }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full sm:hidden" style={{ backgroundColor: textColor + "30" }} />
        <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-2 sm:pt-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg cursor-pointer opacity-70 hover:opacity-100"
            aria-label={closeLabel}
          >
            <CloseIcon />
          </button>
        </div>
        {header}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">{children}</div>
      </div>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Tab and Shift+Tab cycle through the sheet instead of reaching the page behind it
function keepFocusInside(panel: HTMLElement, e: KeyboardEvent) {
  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (!first) {
    e.preventDefault();
    panel.focus();
  } else if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

interface TabsProps<T extends string> {
  // Ids: `${idPrefix}-tab-${tab.id}` for the tabs, `${idPrefix}-panel` for the panel they control
  idPrefix: string;
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  textColor: string;
}

// Arrow keys, Home and End move between tabs; Tab moves on to the panel
export function Tabs<T extends string>({ idPrefix, tabs, active, onChange, textColor }: TabsProps<T>) {
  const select = (index: number, target: HTMLElement) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    onChange(tab.id);
    target.parentElement?.querySelector<HTMLElement>(`#${idPrefix}-tab-${tab.id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      className="flex gap-1 px-4 border-b"
      style={{ borderColor: textColor + "15" }}
      onKeyDown={(e) => {
        const index = tabs.findIndex((tab) => tab.id === active);
        const target = e.target as HTMLElement;
        if (e.key === "ArrowRight") select(index + 1, target);
        else if (e.key === "ArrowLeft") select(index - 1, target);
        else if (e.key === "Home") select(0, target);
        else if (e.key === "End") select(tabs.length - 1, target);
        else return;
        e.preventDefault();
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            id={`${idPrefix}-tab-${tab.id}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className="px-3 py-2 -mb-px text-sm font-medium border-b-2 cursor-pointer transition-colors"
            style={{
              borderColor: selected ? "#3b82f6" : "transparent",
              color: selected ? "#3b82f6" : textColor + "99",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// The content of the selected tab
export function TabPanel({ idPrefix, active, children }: { idPrefix: string; active: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${active}`}>
      {children}
    </div>
  );
}
