import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
    },
    orderBy: { displayName: "asc" },
  });

  return NextResponse.json(users);
}
