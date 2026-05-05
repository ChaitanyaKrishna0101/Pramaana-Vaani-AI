import React from "react";
import { Link, useLocation } from "wouter";
import { Activity, BarChart2, History, ShieldAlert } from "lucide-react";

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Command Center", icon: ShieldAlert },
    { href: "/analytics", label: "Analytics", icon: BarChart2 },
    { href: "/history", label: "Call History", icon: History },
  ];

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground dark">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <span className="font-bold tracking-wider text-primary">VAANI</span>
          <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground uppercase">1092 Dispatch</span>
        </div>
        <nav className="flex gap-1">
          {links.map((link) => {
            const isActive = location === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
