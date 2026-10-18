"use client";

import { ReactNode, useEffect, useRef } from "react";

interface Props {
  label: string;
  textColor: string;
  bgColor: string;
  onClose: () => void;
  children: ReactNode;
}

// A small panel dropping down from the header, over the page. The page stays
// visible and live underneath (e.g. to preview font changes). Closes on Esc
// and on a press outside it.
export default function Popover({ label, textColor, bgColor, onClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Read while rendering, before an autoFocus input inside takes focus
  const openerRef = useRef(typeof document === "undefined" ? null : document.activeElement);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    const opener = openerRef.current instanceof HTMLElement ? openerRef.current : null;
    // The field marked data-autofocus, if any, unless focus is inside already
    if (panel && !panel.contains(document.activeElement)) {
      (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel).focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      // The header's buttons switch or toggle the overlay themselves
      if (!panel?.contains(target) && !panel?.closest("header")?.contains(target)) onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      // Back to the button that opened it, unless focus has moved on elsewhere
      const active = document.activeElement;
      if (!active || active === document.body || panel?.contains(active)) opener?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className="popover absolute right-0 top-full mt-2 z-40 w-[min(30rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-xl border shadow-xl p-4 outline-none"
      style={{ backgroundColor: bgColor, color: textColor, borderColor: textColor + "20" }}
    >
      {children}
    </div>
  );
}
