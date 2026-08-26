import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { REJECTED_ORDER_STATUS } from "@/lib/suppliers/types";

const schema = z.object({ status: z.enum(["handling", "resolved"]) });

/** PATCH — staff acknowledge/resolve a factory rejection (反审). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const push = await prisma.supplierPush.findUnique({
    where: { id },
    include: { supplier: { select: { name: true, key: true } } },
  });
  if (!push) {
    return NextResponse.json({ error: "Push not found" }, { status: 404 });
  }
  if (push.orderStatus !== REJECTED_ORDER_STATUS && !push.rejectionStatus) {
    return NextResponse.json(
      { error: "This push has no active factory rejection" },
      { status: 400 }
    );
  }

  const handledBy = session.user?.name ?? session.user?.id ?? null;
  const updated = await prisma.supplierPush.update({
    where: { id },
    data: {
      rejectionStatus: parsed.data.status,
      rejectionHandledBy: handledBy,
      rejectionHandledAt: new Date(),
    },
  });

  await prisma.orderLog.create({
    data: {
      orderId: push.orderId,
      userId: session.user?.id,
      action: "blanks_rejection_status",
      toValue: parsed.data.status,
      message: `${push.supplier.name} ${push.platformOid}: rejection ${parsed.data.status === "handling" ? "being handled" : "resolved"} by ${handledBy ?? "staff"}`,
      metadata: { pushId: push.id, platformOid: push.platformOid, supplierKey: push.supplier.key },
    },
  });

  return NextResponse.json({ push: updated });
}
