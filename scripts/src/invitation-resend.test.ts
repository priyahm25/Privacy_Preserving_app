import assert from "node:assert/strict";
import test from "node:test";
import { checkResendable, singleFlight } from "../../artifacts/api-server/src/lib/invitationResend.ts";
import { deliverEmail } from "../../artifacts/api-server/src/lib/emailDelivery.ts";
import {
  createInvitation,
  deliveryOutcome,
  InvitationError,
  isPendingInvitationError,
  PENDING_INVITATION_MESSAGE,
  resendInvitation,
} from "../../artifacts/securesphere/lib/invitationsApi.ts";

const now = new Date("2026-11-01T12:00:00Z");
const future = new Date("2026-11-05T12:00:00Z");
const LINK = "https://app.example/accept-invitation/existing-token";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const pending = { inviterId: "owner", status: "pending" as const, expiresAt: future };

async function rejection(promise: Promise<unknown>) {
  try { await promise; } catch (error) { assert.ok(error instanceof InvitationError); return error; }
  assert.fail("expected a rejection");
}

// --- Backend lifecycle rules (POST /invite/resend) -------------------------

test("a valid pending invitation owned by the caller can be resent", () => {
  assert.deepEqual(checkResendable(pending, "owner", now), { ok: true });
});

test("expired invitations are refused and marked expired, not reused", () => {
  const result = checkResendable({ ...pending, expiresAt: new Date("2026-10-31T00:00:00Z") }, "owner", now);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.httpStatus, 410);
  assert.equal(!result.ok && result.code, "invitation_expired");
  assert.equal(!result.ok && result.markExpired, true);
});

test("revoked, accepted and declined invitations cannot be resent", () => {
  for (const status of ["revoked", "accepted", "declined"] as const) {
    const result = checkResendable({ ...pending, status }, "owner", now);
    assert.equal(!result.ok && result.httpStatus, 409, status);
    assert.equal(!result.ok && result.code, `invitation_${status}`);
  }
});

test("another user's invitation is indistinguishable from a missing one", () => {
  const foreign = checkResendable(pending, "intruder", now);
  const missing = checkResendable(undefined, "intruder", now);
  assert.deepEqual(foreign, missing);
  assert.equal(!foreign.ok && foreign.httpStatus, 404);
});

test("concurrent resends of one invitation send a single email and share its result", async () => {
  const flight = singleFlight<Awaited<ReturnType<typeof deliverEmail>>>();
  let sends = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const send = () => deliverEmail(async () => { sends += 1; await gate; });
  const both = Promise.all([flight("inv-1", send), flight("inv-1", send)]);
  const other = flight("inv-2", send); // a different invitation is not blocked
  release();
  const [a, b] = await both;
  await other;
  assert.equal(sends, 2); // inv-1 once + inv-2 once
  assert.equal(a, b);
  assert.equal(a.status, "sent");
  await flight("inv-1", send); // the slot is released afterwards
  assert.equal(sends, 3);
});

test("a failed send releases the slot so the user can retry", async () => {
  const flight = singleFlight<Awaited<ReturnType<typeof deliverEmail>>>();
  const failed = await flight("inv", () => deliverEmail(async () => { throw Object.assign(new Error("x"), { code: "EAUTH", responseCode: 535 }); }));
  assert.equal(failed.status, "failed");
  assert.equal((await flight("inv", () => deliverEmail(async () => undefined))).status, "sent");
});

// --- Client API ---------------------------------------------------------------

test("creating a new invitation still works", async () => {
  const inv = await createInvitation(async () => json(200, { invitationCreated: true, invitationLink: LINK,
    invitedEmail: "a@b.co", emailDelivery: { status: "sent", message: null } }), "a@b.co");
  assert.equal(inv.invitationLink, LINK);
  assert.equal(inv.emailSent, true);
});

test("an existing pending invitation is detected by its API code", async () => {
  const error = await rejection(createInvitation(async () => json(400, {
    error: "Invitation already pending for this email", code: "invitation_pending" }), "a@b.co"));
  assert.equal(error.message, PENDING_INVITATION_MESSAGE);
  assert.equal(error.code, "invitation_pending");
  assert.ok(isPendingInvitationError(error));
  assert.ok(!isPendingInvitationError(new InvitationError("This person is already your teammate.", 400)));
});

test("resend posts only the email to the resend endpoint and reuses the existing link", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const inv = await resendInvitation(async (path, init) => {
    calls.push({ path, body: JSON.parse(String(init?.body)) });
    return json(200, { invitationValid: true, invitationLink: LINK, invitedEmail: "a@b.co",
      emailDelivery: { status: "sent", message: null }, emailSent: true });
  }, " A@B.co ");
  // Never calls POST /invite, so no new invitation row or token can be created.
  assert.deepEqual(calls, [{ path: "/api/teammates/invite/resend", body: { invitedEmail: "a@b.co" } }]);
  assert.equal(inv.invitationLink, LINK);
  assert.equal(inv.emailSent, true);
});

test("resend with failed delivery keeps the invitation and never reports success", async () => {
  const inv = await resendInvitation(async () => json(200, { invitationValid: true, invitationLink: LINK,
    invitedEmail: "a@b.co", emailDelivery: { status: "failed", message: "The server's email account rejected its login." }, emailSent: true }), "a@b.co");
  assert.equal(inv.emailSent, false);
  assert.equal(inv.invitationLink, LINK);
  assert.match(inv.emailError ?? "", /rejected its login/);
});

test("resend surfaces expired, revoked, unauthorized and session errors", async () => {
  const expired = await rejection(resendInvitation(async () => json(410, { error: "This invitation has expired. Generate a new invitation to send a fresh link.", code: "invitation_expired" }), "a@b.co"));
  assert.equal(expired.code, "invitation_expired");
  assert.match(expired.message, /expired/);
  const revoked = await rejection(resendInvitation(async () => json(409, { error: "This invitation was already revoked. Generate a new invitation instead.", code: "invitation_revoked" }), "a@b.co"));
  assert.match(revoked.message, /revoked/);
  const notOwned = await rejection(resendInvitation(async () => json(404, { error: "Invitation not found", code: "invitation_not_found" }), "a@b.co"));
  assert.equal(notOwned.status, 404);
  const session = await rejection(resendInvitation(async () => json(401, { error: "Unauthorized - invalid Clerk session" }), "a@b.co"));
  assert.match(session.message, /session has expired/);
});

// --- Screen states --------------------------------------------------------------

test("success is shown only when the provider accepted the email; fallbacks otherwise", () => {
  const sent = deliveryOutcome({ emailSent: true, invitedEmail: "a@b.co" }, "resent");
  assert.equal(sent.tone, "success");
  assert.equal(sent.showFallbacks, false);
  assert.match(sent.text, /sent again to a@b\.co/);
  const failed = deliveryOutcome({ emailSent: false, invitedEmail: "a@b.co" }, "resent");
  assert.equal(failed.tone, "error");
  assert.equal(failed.showFallbacks, true);
  assert.match(failed.text, /still exists, but the email could not be sent/);
  assert.equal(deliveryOutcome({ emailSent: false, invitedEmail: "a@b.co" }, "created").showFallbacks, true);
});
