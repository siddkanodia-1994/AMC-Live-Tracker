import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export function Header() {
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          AMC Live AUM Tracker
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="/admin"
            className="text-sm text-muted-foreground hover:text-foreground px-2 py-1"
          >
            Admin
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
