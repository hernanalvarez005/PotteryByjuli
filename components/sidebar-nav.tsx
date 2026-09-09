"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, CURRENT_PHASE } from "@/lib/nav";
import { Badge } from "@/components/ui/badge";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-6 px-3 py-4">
      {NAV_GROUPS.map((group, i) => (
        <div key={group.label || i} className="flex flex-col gap-1">
          {group.label && (
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const isReady = item.phase <= CURRENT_PHASE;
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;

            if (!isReady) {
              return (
                <div
                  key={item.href}
                  className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/50"
                  title={`Disponible en la Fase ${item.phase}`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="size-4" />
                    {item.label}
                  </span>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    Fase {item.phase}
                  </Badge>
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
                  isActive && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent"
                )}
              >
                {isActive && (
                  <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
                )}
                <Icon className={cn("size-4", isActive && "text-primary")} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
