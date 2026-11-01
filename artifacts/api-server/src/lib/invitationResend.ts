// Rules for re-sending an existing invitation. Pure (no imports) so the
// lifecycle checks and the concurrency guard can be unit tested.

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked" | "declined";

export interface ResendableInvitation {
  inviterId: string;
  status: InvitationStatus;
  expiresAt: Date;
}

export type ResendCheck =
  | { ok: true }
  | { ok: false; httpStatus: number; code: string; error: string; markExpired?: boolean };

/**
 * Only the inviter may resend, only while the invitation is pending and
 * unexpired. Someone else's invitation is reported exactly like a missing one,
 * so the endpoint can't be used to probe which addresses were invited.
 */
export function checkResendable(
  invitation: ResendableInvitation | undefined,
  callerId: string,
  now: Date = new Date(),
): ResendCheck {
  if (!invitation || invitation.inviterId !== callerId) {
    return { ok: false, httpStatus: 404, code: "invitation_not_found", error: "Invitation not found" };
  }
  if (invitation.status !== "pending") {
    return {
      ok: false,
      httpStatus: 409,
      code: `invitation_${invitation.status}`,
      error: `This invitation was already ${invitation.status}. Generate a new invitation instead.`,
    };
  }
  if (invitation.expiresAt <= now) {
    return {
      ok: false,
      httpStatus: 410,
      code: "invitation_expired",
      error: "This invitation has expired. Generate a new invitation to send a fresh link.",
      markExpired: true,
    };
  }
  return { ok: true };
}

/**
 * Concurrent calls with the same key share one in-flight run, so two resend
 * clicks (or tabs) for one invitation send a single email and get the same
 * result. Scope: one API process - enough for this single-instance server.
 */
export function singleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();
  return (key: string, run: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = run().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}
