"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Languages } from "lucide-react";

function toggleLocale() {
  const current = document.cookie
    .split("; ")
    .find((c) => c.startsWith("NEXT_LOCALE="))
    ?.split("=")[1] || "en";
  const next = current === "en" ? "zh" : "en";
  document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000`;
  window.location.reload();
}

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError(t("error"));
      setLoading(false);
    } else {
      router.push("/orders");
      router.refresh();
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-destructive text-center bg-destructive/10 rounded-md p-2">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="username">{t("username")}</Label>
            <Input
              id="username"
              name="username"
              type="text"
              required
              autoComplete="username"
              placeholder={t("usernamePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder={t("passwordPlaceholder")}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("signingIn") : t("signIn")}
          </Button>
          <div className="text-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleLocale}
              className="text-xs gap-1 text-muted-foreground"
            >
              <Languages className="h-3.5 w-3.5" />
              EN / 中
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
