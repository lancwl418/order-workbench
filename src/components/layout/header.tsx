"use client";

import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut, Menu } from "lucide-react";
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

const navItems = [
  { label: "Orders", href: "/orders", icon: ClipboardList },
  { label: "Print Queue", href: "/print-queue", icon: Printer },
  { label: "Shipping", href: "/shipping", icon: Truck },
  { label: "Labels", href: "/labels", icon: Tag },
  { label: "Exceptions", href: "/exceptions", icon: AlertTriangle },
  { label: "CS Queue", href: "/cs-queue", icon: Headphones },
];

export function Header() {
  const { data: session } = useSession();
  const pathname = usePathname();

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
            DTF Workbench
          </SheetTitle>
          <nav className="py-4 px-2 space-y-1">
            {navItems.map((item) => {
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
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
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
