"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// A subscribe that never fires: we only care about the server-vs-client
// snapshot distinction, not updates.
function subscribeNever() {
  return () => {};
}

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  // next-themes resolves `theme` synchronously on the client's very first
  // render (it reads localStorage), so a `theme === undefined` check does NOT
  // match the SSR placeholder during hydration — that mismatch was the source
  // of the production-wide hydration error #418 (full page re-render flash on
  // every load). useSyncExternalStore's server snapshot is what hydration
  // renders, making the placeholder deterministic on both sides.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );

  if (!mounted) {
    return <Button variant="ghost" size="icon" aria-hidden className="opacity-0" />;
  }

  const isDark = (theme === "system" ? resolvedTheme : theme) === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </Button>
  );
}
