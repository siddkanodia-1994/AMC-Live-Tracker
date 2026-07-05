import Link from "next/link";
import { LiveClockBadge } from "./live-clock-badge";
import { ThemeToggle } from "./theme-toggle";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          AMC Live AUM Tracker
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="/cash-holdings"
            className="text-sm text-muted-foreground hover:text-foreground px-2 py-1"
          >
            Cash Holdings
          </Link>
          <Link
            href="/admin"
            className="text-sm text-muted-foreground hover:text-foreground px-2 py-1"
          >
            Admin
          </Link>
          <LiveClockBadge />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
