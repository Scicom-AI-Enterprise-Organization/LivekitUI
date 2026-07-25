"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Applies the `dark` class to <html> before first paint (no flash of light
 * theme) and persists the choice to localStorage under "theme".
 *
 * Single source of truth for dark mode — useThemeMode() and ThemeToggle both
 * read through it, and BrandProvider re-applies brand tokens when the class
 * changes.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
