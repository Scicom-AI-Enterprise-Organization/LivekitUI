"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// false while server-rendering and hydrating, true afterwards. The theme is
// only knowable in the browser, so anything derived from it has to wait.
const NOOP_SUBSCRIBE = () => () => {};
const useMounted = () =>
  useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => true,
    () => false
  );

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

interface ThemeToggleProps {
  className?: string;
  /** Button size — matches the Button component's icon sizes. */
  size?: "icon-xs" | "icon-sm" | "icon";
  /** Menu alignment relative to the trigger. */
  align?: "start" | "center" | "end";
}

/**
 * Light / Dark / System picker. Renders a neutral icon until mounted so the
 * server and client markup agree (the theme is only known in the browser).
 */
export function ThemeToggle({
  className,
  size = "icon-sm",
  align = "end",
}: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  const Icon = mounted && resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          className={cn("text-muted-foreground hover:text-foreground", className)}
          aria-label="Toggle theme"
        >
          <Icon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-32">
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setTheme(option.value)}
            className={cn(
              "gap-2 text-sm",
              mounted && theme === option.value && "text-foreground font-medium"
            )}
          >
            <option.icon className="size-3.5" />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
