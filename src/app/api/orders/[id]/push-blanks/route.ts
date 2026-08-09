import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { pushBlanksForOrder } from "@/lib/suppliers/push-service";

const itemSchema = z.object({
  orderItemId: z.string(),
  factorySku: z.string().min(1, "Factory SKU required"),
  sizeCode: z.string().optional(),
  sizeName: z.string().optional(),
  colorCode: z.string().optional(),
  colorName: z.string().optional(),
  styleCode: z.string().optional(),
  styleName: z.string().optional(),
  craftType: z.union([z.literal(1), z.literal(2)]).optional(),
  shouldPrint: z.boolean().default(false),
  printPosition: z.enum(["1", "2", "1,2"]).optional(),
  imageUrls: z.array(z.string().url()).optional(),
  effectImageUrls: z.array(z.string().url()).optional(),
});

const pushSchema = z.object({
  mode: z.enum(["place", "place_and_push"]).default("place_and_push"),
  sellerRemark: z.string().optional(),
  replace: z.boolean().default(false),
  items: z.array(itemSchema).min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const parsed = pushSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { results, error, status } = await pushBlanksForOrder({
    orderId,
    mode: parsed.data.mode,
    items: parsed.data.items,
    sellerRemark: parsed.data.sellerRemark,
    replace: parsed.data.replace,
    userId: session.user?.id,
  });

  if (error) {
    return NextResponse.json({ error }, { status: status ?? 400 });
  }

  // Partial success is a 200 — each group carries its own status so the UI
  // can re-push only the failed ones.
  const anyFailed = results.some((r) => r.status === "failed");
  const allFailed = results.length > 0 && results.every((r) => r.status === "failed");
  return NextResponse.json(
    { results, partial: anyFailed && !allFailed },
    { status: allFailed ? 502 : 200 }
  );
}
