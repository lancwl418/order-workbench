import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exceptionUpdateSchema } from "@/lib/validators";

/**
 * PATCH /api/exceptions/:id
 *
 * Update exception status, owner, or note.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const exception = await prisma.orderException.findUnique({
    where: { id },
  });

  if (!exception) {
    return NextResponse.json({ error: "Exception not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = exceptionUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const updates = parsed.data;
  const data: Record<string, unknown> = {};
  const logs: Array<{ action: string; fromValue?: string; toValue?: string; message: string }> = [];

  if (updates.status) {
    data.status = updates.status;
    if (updates.status === "RESOLVED") {
      data.resolvedAt = new Date();
      data.resolvedBy = session.user?.id || "unknown";
    }
    logs.push({
      action: "exception_status_change",
      fromValue: exception.status,
      toValue: updates.status,
      message: `Exception ${exception.type} status changed to ${updates.status}`,
    });
  }

  if (updates.owner !== undefined) {
    data.owner = updates.owner;
    logs.push({
      action: "exception_assigned",
      toValue: updates.owner || "unassigned",
      message: updates.owner
        ? `Exception ${exception.type} assigned to ${updates.owner}`
        : `Exception ${exception.type} unassigned`,
    });
  }

  if (updates.note !== undefined) {
    data.note = updates.note;
    logs.push({
      action: "exception_note_added",
      message: `Note added to exception ${exception.type}`,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.orderException.update({
      where: { id },
      data,
      include: {
        order: {
          select: {
            id: true,
            shopifyOrderNumber: true,
            customerName: true,
            internalStatus: true,
            trackingNumber: true,
          },
        },
        shipment: {
          select: {
            id: true,
            trackingNumber: true,
            carrier: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    for (const log of logs) {
      await tx.orderLog.create({
        data: {
          orderId: exception.orderId,
          userId: session.user?.id,
          ...log,
          metadata: { exceptionId: id, type: exception.type },
        },
      });
    }

    return result;
  });

  return NextResponse.json(updated);
}
