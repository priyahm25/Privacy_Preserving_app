// Invitation email delivery outcome. Pure (no imports) so the status mapping
// can be unit tested without nodemailer or a live SMTP server.

export type EmailDeliveryStatus = "sent" | "failed" | "not_configured";

export interface SendResult {
  sent: boolean;
  status: EmailDeliveryStatus;
  /** Safe to show the inviter; never contains SMTP responses or credentials. */
  error?: string;
  /** For server logs only: nodemailer error code and SMTP response code. */
  diagnostic?: { code?: string; responseCode?: number };
}

export const NOT_CONFIGURED_MESSAGE =
  "Email delivery is not configured on the server. Share the invitation link instead.";

export function describeSendError(error: unknown): SendResult {
  const err = (error ?? {}) as { code?: unknown; responseCode?: unknown };
  const code = typeof err.code === "string" ? err.code : undefined;
  const responseCode = typeof err.responseCode === "number" ? err.responseCode : undefined;
  let message = "The invitation email could not be sent. Share the invitation link instead.";
  if (code === "EAUTH" || responseCode === 535) {
    message = "The server's email account rejected its login, so the email was not sent. Share the invitation link instead.";
  } else if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "EDNS") {
    message = "The server could not reach its email provider, so the email was not sent. Share the invitation link instead.";
  } else if (code === "EENVELOPE" || (responseCode !== undefined && responseCode >= 550)) {
    message = "The email provider refused this recipient address, so the email was not sent.";
  }
  return { sent: false, status: "failed", error: message, diagnostic: { code, responseCode } };
}

/** Runs `send` and reports the outcome; a send that throws is never reported as sent. */
export async function deliverEmail(send: (() => Promise<unknown>) | null): Promise<SendResult> {
  if (!send) return { sent: false, status: "not_configured", error: NOT_CONFIGURED_MESSAGE };
  try {
    await send();
    return { sent: true, status: "sent" };
  } catch (error) {
    return describeSendError(error);
  }
}
