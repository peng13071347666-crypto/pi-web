"use client";

import { useCallback, useSyncExternalStore } from "react";

export type AppearanceStyle = "original" | "claude" | "codex" | "gemini";
export type AccentColor = "auto" | "blue" | "coral" | "orange" | "green" | "violet" | "sky";

const STYLE_KEY = "pi-appearance-style";
const ACCENT_KEY = "pi-accent-color";

const APPEARANCE_STYLES: AppearanceStyle[] = ["original", "claude", "codex", "gemini"];
const ACCENT_COLORS: AccentColor[] = ["auto", "blue", "coral", "orange", "green", "violet", "sky"];
const DEFAULT_STYLE: AppearanceStyle = "original";
const DEFAULT_ACCENT: AccentColor = "auto";

type Snapshot = `${AppearanceStyle}|${AccentColor}`;

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function normalizeStyle(value: string | null | undefined): AppearanceStyle {
  return APPEARANCE_STYLES.includes(value as AppearanceStyle)
    ? value as AppearanceStyle
    : DEFAULT_STYLE;
}

function normalizeAccent(value: string | null | undefined): AccentColor {
  return ACCENT_COLORS.includes(value as AccentColor)
    ? value as AccentColor
    : DEFAULT_ACCENT;
}

function applyToDocument(style: AppearanceStyle, accent: AccentColor) {
  const root = document.documentElement;
  root.dataset.piStyle = style;
  root.dataset.piAccent = accent;
}

function readSnapshot(): Snapshot {
  if (typeof document === "undefined") return `${DEFAULT_STYLE}|${DEFAULT_ACCENT}`;
  const root = document.documentElement;
  const storedStyle = root.dataset.piStyle || safeLocalStorageGet(STYLE_KEY);
  const storedAccent = root.dataset.piAccent || safeLocalStorageGet(ACCENT_KEY);
  const style = normalizeStyle(storedStyle);
  const accent = normalizeAccent(storedAccent);
  if (root.dataset.piStyle !== style || root.dataset.piAccent !== accent) {
    applyToDocument(style, accent);
  }
  return `${style}|${accent}`;
}

function getServerSnapshot(): Snapshot {
  return `${DEFAULT_STYLE}|${DEFAULT_ACCENT}`;
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

function parseSnapshot(snapshot: Snapshot): { style: AppearanceStyle; accent: AccentColor } {
  const [style, accent] = snapshot.split("|");
  return {
    style: normalizeStyle(style),
    accent: normalizeAccent(accent),
  };
}

export function useAppearance() {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);
  const { style, accent } = parseSnapshot(snapshot);

  const setAppearance = useCallback((next: Partial<{ style: AppearanceStyle; accent: AccentColor }>) => {
    const current = parseSnapshot(readSnapshot());
    const nextStyle = normalizeStyle(next.style ?? current.style);
    const nextAccent = normalizeAccent(next.accent ?? current.accent);
    applyToDocument(nextStyle, nextAccent);
    safeLocalStorageSet(STYLE_KEY, nextStyle);
    safeLocalStorageSet(ACCENT_KEY, nextAccent);
    listeners.forEach((cb) => cb());
  }, []);

  return {
    style,
    accent,
    setAppearance,
    styles: APPEARANCE_STYLES,
    accents: ACCENT_COLORS,
  };
}
