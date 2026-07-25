"use client";

import { useTheme } from "next-themes";

/**
 * Hook to manage dark/light mode state.
 *
 * Thin wrapper over next-themes (see ThemeProvider in the root layout), which
 * owns the `dark` class on <html> and persists the preference. Kept as a
 * separate hook so existing callers keep the same `isDark` / `toggleTheme` API.
 */
export function useThemeMode() {
  const { resolvedTheme, setTheme } = useTheme();

  // resolvedTheme collapses "system" to the actual light/dark value. It is
  // undefined until mounted, which reads as light — matching SSR output.
  const isDark = resolvedTheme === "dark";

  const setIsDark = (dark: boolean) => setTheme(dark ? "dark" : "light");
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  return { isDark, setIsDark, toggleTheme };
}
