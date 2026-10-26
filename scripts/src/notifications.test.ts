import assert from "node:assert/strict";
import test from "node:test";
import { makeNotificationEvent, wasNewlyPersisted } from "../../artifacts/api-server/src/lib/notificationEvents.ts";

test("notification text contains only the actor and event, never file metadata", () => {
  const event = makeNotificationEvent({ recipientUserId: "recipient", actorUserId: "actor", actorName: "Priya",
    type: "file_shared", resourceType: "file", resourceId: "file-secret-id" });
  assert.equal(event?.message, "Priya shared a file with you.");
  assert.equal(event?.resourceId, "file-secret-id");
  assert.doesNotMatch(event?.message ?? "", /secret|\.pdf|contents/i);
});

test("self notifications and missing recipients are rejected", () => {
  assert.equal(makeNotificationEvent({ recipientUserId: "same", actorUserId: "same", actorName: "Priya",
    type: "collaboration_invite", resourceType: "invitation", resourceId: "invite-id" }), null);
  assert.equal(makeNotificationEvent({ recipientUserId: "", actorUserId: "actor", actorName: "Priya",
    type: "file_shared", resourceType: "file", resourceId: "file-id" }), null);
});

test("duplicate event inserts do not pass the new-event gate", () => {
  assert.equal(wasNewlyPersisted(undefined), false);
  assert.equal(wasNewlyPersisted({ id: "new-share" }), true);
});

test("actor names are bounded and control characters are stripped", () => {
  const event = makeNotificationEvent({ recipientUserId: "recipient", actorUserId: "actor", actorName: "Priya\n" + "x".repeat(100),
    type: "collaboration_accepted", resourceType: "invitation", resourceId: "invite-id" });
  assert.equal(event?.message.length, " accepted your collaboration invitation.".length + 80);
  assert.ok(!event?.message.includes("\n"));
});
