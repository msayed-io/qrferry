"use client";

import { Button, SegmentedControl, TabBar } from "glisse";
import { useLayoutEffect, useMemo, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useI18n } from "./lang-provider";

/** Real Glisse Button; legacy material classes are removed, never layered on its own glass. */
export function LiquidButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = new Set(className.split(/\s+/));
  const filled = classes.has("tinted");
  const circle = classes.has("circle");
  const large = classes.has("lg");
  for (const name of ["glass", "cap", "circle", "tinted", "lg"]) classes.delete(name);
  return <Button
    variant={filled ? "filled" : "glass"}
    className={`qf-liquid-button ${circle ? "qf-circle" : "qf-capsule"} ${large ? "qf-large" : ""} ${[...classes].join(" ")}`}
    {...props}
  >{children}</Button>;
}

export interface LiquidChoice {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  controlId?: string;
  controls?: string;
}

interface LiquidChoicesProps {
  kind: "navigation" | "content";
  items: LiquidChoice[];
  value: string | null;
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
}

/**
 * Glisse computes lens positions from physical left-to-right slots.
 * Reverse the items for Arabic, not the engine's coordinate system. Labels
 * retain their own language direction. No fork, fake lens, or rewritten springs.
 */
export function LiquidChoices({ kind, items, value, onValueChange, label, className = "" }: LiquidChoicesProps) {
  const { lang } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const physicalItems = useMemo(() => lang === "ar" ? [...items].reverse() : items, [items, lang]);
  const glisseItems = physicalItems.map(item => ({
    value: item.value,
    label: <span dir={lang === "ar" ? "rtl" : "ltr"}>{item.label}</span>,
    icon: item.icon,
  }));

  // WebView 91 has no container-query units. One measured slot shared by
  // all three native rows and the selection, not flex labels over a stale lens.
  useLayoutEffect(() => {
    if (kind !== "content" || !host.current) return;
    const container = host.current;
    const control = container.querySelector<HTMLElement>(".qf-segmented");
    if (!control) return;
    const update = () => control.style.setProperty("--lg-tab-width", `${container.clientWidth / physicalItems.length}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [kind, physicalItems.length]);

  // The public item API has no per-button id/aria-controls. Add only these
  // non-owned attributes; selection, pointer capture and motion remain Glisse's.
  useLayoutEffect(() => {
    const buttons = host.current?.querySelectorAll<HTMLElement>(".lg-tab-labels:not(.lg-tab-lensed) > .lg-tab");
    buttons?.forEach((button, index) => {
      const item = physicalItems[index];
      if (item.controlId) button.id = item.controlId;
      if (item.controls) button.setAttribute("aria-controls", item.controls);
    });
  }, [physicalItems]);

  const Component = kind === "navigation" ? TabBar : SegmentedControl;
  return <div ref={host} className={`qf-liquid-choices ${className}`}>
    <Component
      dir="ltr"
      className={kind === "navigation" ? "qf-tab-bar" : "qf-segmented"}
      aria-label={label}
      data-qf-tap={kind === "navigation" ? "settle" : undefined}
      items={glisseItems}
      value={value}
      onValueChange={onValueChange}
      onKeyDownCapture={event => {
        // Preserve logical Home/End (first/last action) in Arabic. Native
        // ArrowLeft/Right already follow the physical slots correctly.
        if (lang !== "ar" || !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const item = event.key === "Home" ? items[0] : items.at(-1);
        if (!item) return;
        onValueChange(item.value);
        const index = physicalItems.findIndex(candidate => candidate.value === item.value);
        host.current?.querySelectorAll<HTMLElement>(".lg-tab-labels:not(.lg-tab-lensed) > .lg-tab")[index]?.focus();
      }}
    />
  </div>;
}
