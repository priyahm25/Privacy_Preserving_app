// Teammate invitation API. Kept free of React/Expo imports so the error
// handling can be unit tested under plain Node (scripts/src).

export interface CreatedInvitation {
  token: string | null;
  invitationLink: string;
  invitedEmail: string;
  expiresAt: string | null;
  emailSent: boolean;
  emailError: string | null;
}

export class InvitationError extends Error {
  status: number;
  /** Machine-readable reason from the API, e.g. "invitation_pending". */
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "InvitationError";
    this.status = status;
    this.code = code;
  }
}

type Request = (path: string, init?: RequestInit) => Promise<Response>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PENDING_INVITATION_MESSAGE = "An invitation is already pending for this email address.";

// Server messages from POST /api/teammates/invite, rewritten for the inviter.
const SERVER_MESSAGES: Record<string, string> = {
  "Invitation already pending for this email": PENDING_INVITATION_MESSAGE,
  "Already teammates with this user": "This person is already your teammate.",
  "Cannot invite yourself as a teammate": "You can't invite your own email address.",
  "Email is required": "Please enter an email address.",
};

export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
export const NETWORK_ERROR_MESSAGE = "Could not reach the server. Check your connection and try again.";

export function validateInviteEmail(email: string): string | null {
  const normalized = email.trim();
  if (!normalized) return "Please enter an email address.";
  if (!EMAIL_PATTERN.test(normalized)) return "Please enter a valid email address.";
  return null;
}

export function invitationErrorMessage(status: number, serverError: unknown): string {
  const message = typeof serverError === "string" ? serverError.trim() : "";
  if (SERVER_MESSAGES[message]) return SERVER_MESSAGES[message];
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  if (status >= 500) return "The server couldn't create the invitation. Please try again in a moment.";
  return message || `Could not create the invitation (error ${status}).`;
}

/** True when the API refused to create a duplicate of a still-pending invitation. */
export function isPendingInvitationError(error: unknown): boolean {
  return error instanceof InvitationError && (
    error.code === "invitation_pending" || error.message === PENDING_INVITATION_MESSAGE
  );
}

async function post(request: Request, path: string, body: object): Promise<{ response: Response; data: any }> {
  let response: Response;
  try {
    response = await request(path, { method: "POST", body: JSON.stringify(body) });
  } catch (cause) {
    // useAuthenticatedApi throws before fetching when the Clerk session is gone.
    const sessionGone = cause instanceof Error && /not signed in|session token/i.test(cause.message);
    throw new InvitationError(sessionGone ? SESSION_EXPIRED_MESSAGE : NETWORK_ERROR_MESSAGE, sessionGone ? 401 : 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new InvitationError(invitationErrorMessage(response.status, data?.error), response.status,
      typeof data?.code === "string" ? data.code : null);
  }
  if (typeof data?.invitationLink !== "string" || !data.invitationLink) {
    throw new InvitationError("The server did not return an invitation link. Please try again.", response.status);
  }
  return { response, data };
}

function toInvitation(data: any, fallbackEmail: string): CreatedInvitation {
  // Prefer the explicit delivery status; never report "sent" on a failed send.
  const delivery = data.emailDelivery;
  const emailSent = delivery?.status ? delivery.status === "sent" : Boolean(data.emailSent);
  return {
    token: typeof data.token === "string" ? data.token : null,
    invitationLink: data.invitationLink,
    invitedEmail: data.invitedEmail || fallbackEmail,
    expiresAt: data.expiresAt ?? null,
    emailSent,
    emailError: emailSent ? null : (delivery?.message ?? data.emailError ?? null),
  };
}

/**
 * What the screen shows after an invitation is created or re-sent. Success is
 * claimed only when the server says the mail provider accepted the message;
 * otherwise every manual fallback (copy, share, email app) stays visible.
 */
export function deliveryOutcome(
  invitation: Pick<CreatedInvitation, "emailSent" | "invitedEmail">,
  kind: "created" | "resent",
): { tone: "success" | "error"; text: string; showFallbacks: boolean } {
  if (invitation.emailSent) {
    return {
      tone: "success",
      text: kind === "resent"
        ? `Invitation email sent again to ${invitation.invitedEmail}.`
        : `We emailed the invitation link to ${invitation.invitedEmail}.`,
      showFallbacks: false,
    };
  }
  return {
    tone: "error",
    text: kind === "resent"
      ? "The invitation still exists, but the email could not be sent. Copy or share the link below instead."
      : "The invitation was created, but the email could not be sent. Share the link below instead.",
    showFallbacks: true,
  };
}

export async function createInvitation(request: Request, email: string): Promise<CreatedInvitation> {
  const invitedEmail = email.trim().toLowerCase();
  const { data } = await post(request, "/api/teammates/invite", { invitedEmail });
  return toInvitation(data, invitedEmail);
}

/**
 * Re-sends the caller's existing pending invitation for `email` (same link,
 * no new invitation). Resolves whenever the invitation is still valid; check
 * `emailSent` for the delivery outcome.
 */
export async function resendInvitation(request: Request, email: string): Promise<CreatedInvitation> {
  const invitedEmail = email.trim().toLowerCase();
  const { data } = await post(request, "/api/teammates/invite/resend", { invitedEmail });
  return toInvitation(data, invitedEmail);
}
