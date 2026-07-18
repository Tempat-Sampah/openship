"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  resolvedTheme: "light",
  setTheme: () => {},
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function resolveTheme(t: Theme): ResolvedTheme {
  if (t === "light" || t === "dark") return t;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.setAttribute("data-theme", resolved);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [resolvedTheme, setResolved] = useState<ResolvedTheme>("light");

  // Initialize from localStorage. An explicit stored choice always wins. With
  // no stored preference: the DESKTOP app follows the OS ("system"), while the
  // web product stays light-first. (The desktop window is a native app — users
  // expect it to respect their macOS/Windows appearance.)
  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    const isDesktop = !!(window as { desktop?: { isDesktop?: boolean } }).desktop?.isDesktop;
    const t: Theme =
      stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : isDesktop
          ? "system"
          : "light";
    const resolved = resolveTheme(t);
    setThemeState(t);
    setResolved(resolved);
    applyTheme(resolved);
  }, []);

  // Listen for OS preference changes when in system mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      const r = resolveTheme("system");
      setResolved(r);
      applyTheme(r);
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    const resolved = resolveTheme(t);
    setThemeState(t);
    setResolved(resolved);
    localStorage.setItem("theme", t);
    applyTheme(resolved);
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Inline script injected in <head> to set data-theme before hydration - prevents flash */
export function ThemeScript() {
  const script = `
    (function(){
      try {
        var t = localStorage.getItem('theme');
        // window.desktop is injected by the Electron preload before this runs.
        var isDesktop = !!(window.desktop && window.desktop.isDesktop);
        var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        var resolved;
        if (t === 'dark') resolved = 'dark';
        else if (t === 'light') resolved = 'light';
        else if (t === 'system') resolved = sysDark ? 'dark' : 'light';
        // No stored pref: desktop follows the OS, web stays light-first.
        else resolved = (isDesktop && sysDark) ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', resolved);
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    })();
  `;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
