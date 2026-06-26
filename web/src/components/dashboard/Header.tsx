import { Code2, ShieldHalf } from "lucide-react";
import Link from "next/link";

export function Header({ active = "live" }: { active?: "live" | "model" }) {
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldHalf className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Sentinel</h1>
          <p className="text-xs text-muted-foreground">
            Real-time account-takeover risk engine
          </p>
        </div>
      </div>
      <nav className="flex items-center gap-1 text-sm">
        <Link
          href="/"
          className={`rounded-md px-3 py-1.5 ${active === "live" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
        >
          Live
        </Link>
        <Link
          href="/model"
          className={`rounded-md px-3 py-1.5 ${active === "model" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
        >
          Model
        </Link>
        <a
          href="https://github.com/BenjaminHolderbein/sentinel-risk-engine"
          target="_blank"
          rel="noreferrer"
          className="ml-1 rounded-md p-2 text-muted-foreground hover:text-foreground"
          title="Source on GitHub"
        >
          <Code2 className="size-4" />
        </a>
      </nav>
    </header>
  );
}
