import assert from "node:assert/strict";
import test from "node:test";
import {
  createInvitation,
  InvitationError,
  invitationErrorMessage,
  NETWORK_ERROR_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  validateInviteEmail,
} from "../../artifacts/securesphere/lib/invitationsApi.ts";

const respond = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function failure(request: Parameters<typeof createInvitation>[0], email = "teammate@example.com") {
  try {
    await createInvitation(request, email);
  } catch (error) {
    assert.ok(error instanceof InvitationError);
    return error;
  }
  assert.fail("createInvitation should have rejected");
}

test("successful invitation returns the link and posts the normalised email", async () => {
  let sent: { path: string; body: unknown } | undefined;
  const invitation = await createInvitation(async (path, init) => {
    sent = { path, body: JSON.parse(String(init?.body)) };
    return respond(200, { success: true, token: "t", invitationLink: "https://app/invite/t",
      invitedEmail: "teammate@example.com", expiresAt: "2026-11-08T00:00:00.000Z", emailSent: false, emailError: "SMTP off" })();
  }, "  Teammate@Example.com ");
  assert.deepEqual(sent, { path: "/api/teammates/invite", body: { invitedEmail: "teammate@example.com" } });
  assert.equal(invitation.invitationLink, "https://app/invite/t");
  assert.equal(invitation.emailSent, false);
  assert.equal(invitation.emailError, "SMTP off");
});

test("pending invitation 400 is shown with the friendly message", async () => {
  const error = await failure(respond(400, { error: "Invitation already pending for this email" }));
  assert.equal(error.status, 400);
  assert.equal(error.message, "An invitation is already pending for this email address.");
});

test("existing teammate and self-invite errors are surfaced", async () => {
  assert.equal((await failure(respond(400, { error: "Already teammates with this user" }))).message,
    "This person is already your teammate.");
  assert.equal((await failure(respond(400, { error: "Cannot invite yourself as a teammate" }))).message,
    "You can't invite your own email address.");
});

test("expired session (401 or missing token) asks the user to sign in again", async () => {
  assert.equal((await failure(respond(401, { error: "Unauthorized - invalid Clerk session" }))).message, SESSION_EXPIRED_MESSAGE);
  const missing = await failure(async () => { throw new Error("Clerk session token is unavailable."); });
  assert.equal(missing.message, SESSION_EXPIRED_MESSAGE);
  assert.equal(missing.status, 401);
});

test("server errors, non-JSON bodies and network failures are not swallowed", async () => {
  assert.match((await failure(respond(500, { error: "Failed to create invitation" }))).message, /server couldn't create/);
  const html = await failure(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
  assert.match(html.message, /server couldn't create/);
  assert.equal((await failure(async () => { throw new TypeError("Network request failed"); })).message, NETWORK_ERROR_MESSAGE);
  // Unknown 4xx messages pass through rather than becoming a generic error.
  assert.equal(invitationErrorMessage(404, "Your profile has not been synced"), "Your profile has not been synced");
  assert.equal(invitationErrorMessage(422, undefined), "Could not create the invitation (error 422).");
});

test("a 200 without an invitation link is treated as a failure", async () => {
  assert.match((await failure(respond(200, { success: true }))).message, /did not return an invitation link/);
});

test("client-side email validation", () => {
  assert.equal(validateInviteEmail("   "), "Please enter an email address.");
  assert.equal(validateInviteEmail("not-an-email"), "Please enter a valid email address.");
  assert.equal(validateInviteEmail(" a@b.co "), null);
});
