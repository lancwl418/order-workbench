"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  ClipboardList,
  Printer,
  AlertTriangle,
} from "lucide-react";

const navKeys = [
  { key: "orders", href: "/orders", icon: ClipboardList },
  { key: "printQueue", href: "/print-queue", icon: Printer },
  { key: "exceptions", href: "/exceptions", icon: AlertTriangle },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r bg-background">
      <div className="flex items-center h-14 px-4 border-b">
        <Link href="/orders" className="flex items-center gap-2 font-semibold">
          <ClipboardList className="h-5 w-5" />
          <span>{t("title")}</span>
        </Link>
      </div>
      <nav className="flex-1 py-4 px-2 space-y-1">
        {navKeys.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {t(item.key)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
