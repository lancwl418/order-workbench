import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listProducts } from "@/lib/eccangtms/client";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const products = await listProducts();
    return NextResponse.json(products);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch products";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
