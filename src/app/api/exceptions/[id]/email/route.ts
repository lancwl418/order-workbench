import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendCustomerEmail } from "@/lib/email";
import { appendResponseButtons } from "@/lib/email-templates";

/**
 * POST /api/exceptions/[id]/email
 *
 * Send an email to the customer about this exception.
 * Body: { subject: string, body: string }
 */
export async function POST(
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
    include: {
      order: {
        select: {
          id: true,
          shopifyOrderNumber: true,
          customerEmail: true,
        },
      },
      response: { select: { token: true, respondedAt: true } },
    },
  });

  if (!exception) {
    return NextResponse.json({ error: "Exception not found" }, { status: 404 });
  }

  const email = exception.order.customerEmail;
  if (!email) {
    return NextResponse.json(
      { error: "No customer email on this order" },
      { status: 400 }
    );
  }

  const { subject, body } = await req.json();
  if (!subject || !body) {
    return NextResponse.json(
      { error: "subject and body are required" },
      { status: 400 }
    );
  }

  // Create or reuse response token
  let token: string;
  if (exception.response && !exception.response.respondedAt) {
    // Reuse existing token if customer hasn't responded yet
    token = exception.response.token;
  } else {
    // Delete old response if exists (already responded), create new
    if (exception.response) {
      await prisma.exceptionResponse.delete({
        where: { exceptionId: id },
      });
    }
    token = crypto.randomUUID();
    await prisma.exceptionResponse.create({
      data: { exceptionId: id, token },
    });
  }

  // Append response buttons to email body
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const responseUrl = `${appUrl}/respond/${token}`;
  const htmlWithButtons = appendResponseButtons(body, responseUrl);

  const result = await sendCustomerEmail(email, subject, htmlWithButtons);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Failed to send email" },
      { status: 500 }
    );
  }

  const userId = (session.user as unknown as { id: string }).id;

  await prisma.$transaction([
    prisma.orderException.update({
      where: { id },
      data: {
        customerEmailed: true,
        customerEmailedAt: new Date(),
      },
    }),
    prisma.orderLog.create({
      data: {
        orderId: exception.order.id,
        userId,
        action: "customer_emailed",
        message: `Email sent to ${email} re: ${exception.type}`,
        metadata: JSON.parse(
          JSON.stringify({
            exceptionId: id,
            exceptionType: exception.type,
            emailSubject: subject,
            recipientEmail: email,
          })
        ),
      },
    }),
  ]);

  return NextResponse.json({ success: true });
}
