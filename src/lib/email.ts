import { Resend } from "resend";

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    resend = new Resend(key);
  }
  return resend;
}

export async function sendCustomerEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; error?: string }> {
  const from = process.env.EMAIL_FROM || "noreply@example.com";
  try {
    const { error } = await getResend().emails.send({
      from,
      to,
      subject,
      html,
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to send email",
    };
  }
}
