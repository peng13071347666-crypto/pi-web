"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppearance, type AccentColor, type AppearanceStyle } from "@/hooks/useAppearance";

const STYLE_LABELS: Record<AppearanceStyle, string> = {
  original: "Original",
  claude: "Claude",
  codex: "GPT",
  gemini: "Gemini",
};

const STYLE_DESCRIPTIONS: Record<AppearanceStyle, string> = {
  original: "Workbench",
  claude: "Warm paper",
  codex: "Clean white",
  gemini: "Open sky",
};

const ACCENT_LABELS: Record<AccentColor, string> = {
  auto: "Auto",
  blue: "Blue",
  coral: "Coral",
  orange: "Orange",
  green: "Green",
  violet: "Violet",
  sky: "Sky",
};

const ACCENT_SWATCHES: Record<AccentColor, string> = {
  auto: "linear-gradient(135deg, #2563eb 0%, #d97757 36%, #f97316 68%, #1a73e8 100%)",
  blue: "#2563eb",
  coral: "#d97757",
  orange: "#f97316",
  green: "#16a34a",
  violet: "#7c3aed",
  sky: "#0ea5e9",
};

export function AppearanceMenu() {
  const { style, accent, styles, accents, setAppearance } = useAppearance();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const menu = open && menuPos ? (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: menuPos.top,
        left: menuPos.left,
        zIndex: 2000,
        width: 292,
        padding: 10,
        border: "1px solid var(--border)",
        borderRadius: "var(--popover-radius)",
        background: "var(--popover-bg)",
        color: "var(--text)",
        boxShadow: "var(--popover-shadow)",
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ padding: "2px 2px 8px", fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase" }}>
          Style
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {styles.map((item) => {
            const active = item === style;
            return (
              <button
                key={item}
                type="button"
                aria-label={`Style ${STYLE_LABELS[item]}`}
                aria-pressed={active}
                onClick={() => setAppearance({ style: item })}
                style={{
                  minHeight: 62,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: 10,
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "var(--control-radius)",
                  background: active ? "color-mix(in srgb, var(--accent) 10%, var(--bg))" : "var(--bg-panel)",
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                  boxShadow: active ? "0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent)" : "none",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13, fontWeight: 700 }}>
                  {STYLE_LABELS[item]}
                  {active && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <span style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.25 }}>{STYLE_DESCRIPTIONS[item]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ padding: "2px 2px 8px", fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase" }}>
          Accent
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 7 }}>
          {accents.map((item) => {
            const active = item === accent;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setAppearance({ accent: item })}
                title={ACCENT_LABELS[item]}
                aria-label={`Accent ${ACCENT_LABELS[item]}`}
                aria-pressed={active}
                style={{
                  width: 30,
                  height: 30,
                  display: "grid",
                  placeItems: "center",
                  padding: 0,
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "999px",
                  background: active ? "color-mix(in srgb, var(--accent) 10%, var(--bg))" : "transparent",
                  cursor: "pointer",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "999px",
                    background: ACCENT_SWATCHES[item],
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) {
            setMenuPos({
              top: rect.bottom + 8,
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 308)),
            });
          }
          setOpen((v) => !v);
        }}
        title="Appearance"
        aria-label="Appearance"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          padding: 0,
          background: open ? "var(--bg-selected)" : "none",
          border: "none",
          borderRight: "1px solid var(--border)",
          color: open ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer",
          transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.color = "var(--text)";
          event.currentTarget.style.background = open ? "var(--bg-selected)" : "var(--bg-hover)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = open ? "var(--text)" : "var(--text-muted)";
          event.currentTarget.style.background = open ? "var(--bg-selected)" : "none";
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="13.5" cy="6.5" r="2.5" />
          <circle cx="7" cy="12" r="2.5" />
          <circle cx="16" cy="16" r="2.5" />
          <path d="M12 3a9 9 0 1 0 7.5 13.95c.55-.84-.17-1.95-1.17-1.95h-1.2" />
        </svg>
      </button>
    </div>
    {typeof document !== "undefined" && menu ? createPortal(menu, document.body) : null}
    </>
  );
}
