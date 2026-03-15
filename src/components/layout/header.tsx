"use client";

import { useSession, signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LogOut, Menu, Languages } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ClipboardList,
  Printer,
  Truck,
  Tag,
  AlertTriangle,
  Headphones,
} from "lucide-react";

const navKeys = [
  { key: "orders", href: "/orders", icon: ClipboardList },
  { key: "printQueue", href: "/print-queue", icon: Printer },
  { key: "shipping", href: "/shipping", icon: Truck },
  { key: "labels", href: "/labels", icon: Tag },
  { key: "exceptions", href: "/exceptions", icon: AlertTriangle },
  { key: "csQueue", href: "/cs-queue", icon: Headphones },
] as const;

function toggleLocale() {
  const current = document.cookie
    .split("; ")
    .find((c) => c.startsWith("NEXT_LOCALE="))
    ?.split("=")[1] || "en";
  const next = current === "en" ? "zh" : "en";
  document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000`;
  window.location.reload();
}

export function Header() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 md:px-6">
      <Sheet>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" className="md:hidden" />
          }
        >
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-60 p-0">
          <SheetTitle className="flex items-center h-14 px-4 border-b font-semibold">
            {t("title")}
          </SheetTitle>
          <nav className="py-4 px-2 space-y-1">
            {navKeys.map((item) => {
              const isActive =
                pathname === item.href ||
                pathname.startsWith(item.href + "/");
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
        </SheetContent>
      </Sheet>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLocale}
          className="text-xs gap-1 text-muted-foreground"
          title="Switch language"
        >
          <Languages className="h-3.5 w-3.5" />
          EN / 中
        </Button>
        {session?.user && (
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {session.user.name}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
