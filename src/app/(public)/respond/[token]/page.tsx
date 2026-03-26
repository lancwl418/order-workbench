import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { ResponseForm } from "./response-form";

export default async function RespondPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const response = await prisma.exceptionResponse.findUnique({
    where: { token },
    include: {
      exception: {
        include: {
          order: {
            select: {
              shopifyOrderNumber: true,
              customerName: true,
            },
          },
        },
      },
    },
  });

  if (!response) {
    notFound();
  }

  return (
    <div className="w-full max-w-lg">
      <ResponseForm
        token={token}
        orderNumber={response.exception.order.shopifyOrderNumber || ""}
        customerName={response.exception.order.customerName || "Valued Customer"}
        exceptionType={response.exception.type}
        alreadyResponded={!!response.respondedAt}
        existingResponse={
          response.respondedAt
            ? {
                responseType: response.responseType!,
                needByDate: response.needByDate?.toISOString() || null,
                noRush: response.noRush,
                comments: response.comments,
              }
            : undefined
        }
      />
    </div>
  );
}
