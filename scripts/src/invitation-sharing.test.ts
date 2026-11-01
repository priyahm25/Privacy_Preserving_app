import assert from "node:assert/strict";
import test from "node:test";
import { copyText, invitationMailto, nativeShare, webShare } from "../../artifacts/securesphere/lib/invitationSharing.ts";
import { deliverEmail, describeSendError, NOT_CONFIGURED_MESSAGE } from "../../artifacts/api-server/src/lib/emailDelivery.ts";
import { createInvitation } from "../../artifacts/securesphere/lib/invitationsApi.ts";

const LINK = "https://securesphere.example/accept-invitation/abc123?ref=a&x=1";
const domError = (name: string) => Object.assign(new Error(name), { name });

// --- Copy -----------------------------------------------------------------

test("copy success uses the async clipboard API with the exact link", async () => {
  let copied = "";
  const result = await copyText(LINK, { writeText: async (t) => { copied = t; }, legacyCopy: () => assert.fail("no fallback") });
  assert.deepEqual(result, { ok: true });
  assert.equal(copied, LINK);
});

test("clipboard permission failure falls back, then asks for a manual copy", async () => {
  const denied = { writeText: async () => { throw domError("NotAllowedError"); } };
  assert.deepEqual(await copyText(LINK, { ...denied, legacyCopy: () => true }), { ok: true });
  const result = await copyText(LINK, { ...denied, legacyCopy: () => false });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "denied");
  assert.match(!result.ok ? result.message : "", /blocked.*copy it manually/i);
});

test("unsupported clipboard API reports unsupported, and a throwing fallback is not swallowed", async () => {
  const none = await copyText(LINK, {});
  assert.equal(!none.ok && none.reason, "unsupported");
  const broken = await copyText(LINK, { legacyCopy: () => { throw new Error("execCommand gone"); } });
  assert.equal(!broken.ok && broken.reason, "failed");
});

// --- Share ----------------------------------------------------------------

test("native/web share success passes the link unchanged", async () => {
  let shared: { url?: string } = {};
  assert.deepEqual(await webShare(LINK, { share: async (d) => { shared = d; } }), { outcome: "shared" });
  assert.equal(shared.url, LINK);
  let message = "";
  assert.deepEqual(await nativeShare(LINK, async (c) => { message = c.message; return { action: "sharedAction" }; }), { outcome: "shared" });
  assert.equal(message, LINK);
});

test("share unsupported: no navigator.share, or canShare rejects the URL", async () => {
  assert.deepEqual(await webShare(LINK, undefined), { outcome: "unsupported" });
  assert.deepEqual(await webShare(LINK, {}), { outcome: "unsupported" });
  assert.deepEqual(await webShare(LINK, { share: async () => assert.fail("not called"), canShare: () => false }), { outcome: "unsupported" });
});

test("user cancelling share is distinct from a share failure", async () => {
  assert.deepEqual(await webShare(LINK, { share: async () => { throw domError("AbortError"); } }), { outcome: "cancelled" });
  assert.equal((await webShare(LINK, { share: async () => { throw domError("NotAllowedError"); } })).outcome, "failed");
  assert.deepEqual(await nativeShare(LINK, async () => ({ action: "dismissedAction" })), { outcome: "cancelled" });
  assert.equal((await nativeShare(LINK, async () => { throw new Error("no activity"); })).outcome, "failed");
});

test("email-client fallback preserves the invitation URL exactly", () => {
  const url = new URL(invitationMailto(LINK, "teammate+x@example.com", "Priya"));
  assert.equal(url.protocol, "mailto:");
  assert.equal(decodeURIComponent(url.pathname), "teammate+x@example.com");
  assert.ok(url.searchParams.get("body")?.split("\n").includes(LINK));
  assert.equal(url.searchParams.get("subject"), "Priya invited you to SecureSphere");
});

// --- Email delivery -------------------------------------------------------

test("email delivery success reports sent", async () => {
  assert.deepEqual(await deliverEmail(async () => ({ messageId: "1" })), { sent: true, status: "sent" });
});

test("SMTP authentication failure (Gmail 535) is reported as failed with a safe message", async () => {
  const smtpError = Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"),
    { code: "EAUTH", responseCode: 535, response: "535-5.7.8 Username and Password not accepted", command: "AUTH PLAIN" });
  const result = await deliverEmail(async () => { throw smtpError; });
  assert.equal(result.sent, false);
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /rejected its login/);
  assert.doesNotMatch(result.error ?? "", /535|AUTH|Password not accepted/);
  assert.deepEqual(result.diagnostic, { code: "EAUTH", responseCode: 535 });
  assert.equal(describeSendError({ code: "ETIMEDOUT" }).status, "failed");
  assert.deepEqual(await deliverEmail(null), { sent: false, status: "not_configured", error: NOT_CONFIGURED_MESSAGE });
});

test("invitation creation succeeds and keeps the link when email delivery fails", async () => {
  const invitation = await createInvitation(async () => new Response(JSON.stringify({
    success: true, invitationCreated: true, token: "t", invitationLink: LINK, invitedEmail: "a@b.co",
    // emailSent deliberately contradicts the status: the explicit status wins.
    emailDelivery: { status: "failed", message: "The server's email account rejected its login." }, emailSent: true,
  }), { status: 200 }), "a@b.co");
  assert.equal(invitation.invitationLink, LINK);
  assert.equal(invitation.emailSent, false);
  assert.match(invitation.emailError ?? "", /rejected its login/);
});
