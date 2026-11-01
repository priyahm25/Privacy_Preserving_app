import assert from "node:assert/strict";
import test from "node:test";
import { makeNotificationEvent } from "../../artifacts/api-server/src/lib/notificationEvents.ts";
import {
  buildPushMessages, checkReceipts, deliverPush, isExpoPushToken,
  EXPO_PUSH_RECEIPTS_URL, EXPO_PUSH_SEND_URL, type PushDeps,
} from "../../artifacts/api-server/src/lib/pushDelivery.ts";

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";
const CONVERSATION = "8f14e45f-ceea-467a-9575-1d2fbd7a9a0c";
const chatEvent = { notificationId: "n-1", type: "chat_message" as const, resourceType: "conversation", resourceId: CONVERSATION };

// Values that must never leave the server in a push.
const SECRETS = ["Meet me at the lab at 5", "q29udGVudC1jaXBoZXJ0ZXh0", "wrapped-key-material", "-----BEGIN PRIVATE KEY-----", "salary-2026.xlsx"];

type Call = { url: string; body: unknown };
function fakeDeps(responses: Array<{ ok?: boolean; status?: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  const disabled: Array<{ ids: string[]; reason: string }> = [];
  const scheduled: Array<{ task: () => void; delayMs: number }> = [];
  const deps: PushDeps = {
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const next = responses.shift();
      if (!next) throw new Error("unexpected extra request");
      if (next instanceof Error) throw next;
      return { ok: next.ok ?? true, status: next.status ?? 200, json: async () => next.body };
    },
    disableTokens: async (ids, reason) => { disabled.push({ ids, reason }); },
    schedule: (task, delayMs) => { scheduled.push({ task, delayMs }); },
  };
  return { deps, calls, disabled, scheduled };
}

test("chat messages create a recipient notification without message content", () => {
  const event = makeNotificationEvent({ recipientUserId: "bob", actorUserId: "alice", actorName: "Alice",
    type: "chat_message", resourceType: "conversation", resourceId: CONVERSATION });
  assert.equal(event?.recipientUserId, "bob");
  assert.equal(event?.message, "Alice sent you a new message.");
  assert.equal(event?.dedupeKey, `chat_message:${CONVERSATION}`, "one notification per conversation");
  for (const secret of SECRETS) assert.ok(!JSON.stringify(event).includes(secret));
});

test("the sender is never notified about their own message", () => {
  assert.equal(makeNotificationEvent({ recipientUserId: "alice", actorUserId: "alice", actorName: "Alice",
    type: "chat_message", resourceType: "conversation", resourceId: CONVERSATION }), null);
});

test("push payloads are generic and carry only allow-listed opaque ids", () => {
  const [message] = buildPushMessages([{ id: "t1", token: TOKEN_A }], chatEvent);
  assert.equal(message.body, "You received a new message");
  assert.equal(message.title, "SecureSphere");
  assert.equal(message.channelId, "messages");
  assert.deepEqual(Object.keys(message.data).sort(), ["notificationId", "resourceId", "resourceType", "type"]);
  const serialized = JSON.stringify(message);
  for (const secret of [...SECRETS, "Alice"]) assert.ok(!serialized.includes(secret), `payload leaked ${secret}`);
});

test("every notification type has fixed generic copy", () => {
  for (const type of ["file_shared", "collaboration_invite", "collaboration_accepted", "chat_message"] as const) {
    const [m] = buildPushMessages([{ id: "t", token: TOKEN_A }], { ...chatEvent, type });
    assert.ok(m.body.length > 0 && !/\$\{|undefined/.test(m.body));
    assert.equal(m.channelId, type === "chat_message" ? "messages" : "default");
  }
});

test("token validation accepts Expo tokens only", () => {
  assert.ok(isExpoPushToken(TOKEN_A));
  assert.ok(isExpoPushToken("ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]"));
  for (const bad of ["", "abc", "ExponentPushToken[]", "ExponentPushToken[x y]", "fcm:token", "ExponentPushToken[a]", 42, null])
    assert.equal(isExpoPushToken(bad), false, String(bad));
});

test("duplicate and invalid tokens are dropped before sending", () => {
  const messages = buildPushMessages([{ id: "1", token: TOKEN_A }, { id: "2", token: TOKEN_A }, { id: "3", token: "junk" }], chatEvent);
  assert.deepEqual(messages.map((m) => m.to), [TOKEN_A]);
});

test("successful tickets schedule one receipt check and disable nothing", async () => {
  const { deps, calls, disabled, scheduled } = fakeDeps([{ body: { data: [{ status: "ok", id: "r1" }, { status: "ok", id: "r2" }] } }]);
  const result = await deliverPush(deps, [{ id: "t1", token: TOKEN_A }, { id: "t2", token: TOKEN_B }], chatEvent);
  assert.deepEqual(result, { attempted: 2, accepted: 2, disabled: 0, failed: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, EXPO_PUSH_SEND_URL);
  assert.equal(disabled.length, 0);
  assert.equal(scheduled.length, 1, "exactly one receipt check, no loop");
});

test("DeviceNotRegistered tickets disable only that token", async () => {
  const { deps, disabled } = fakeDeps([{ body: { data: [
    { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
    { status: "ok", id: "r2" },
  ] } }]);
  const result = await deliverPush(deps, [{ id: "dead", token: TOKEN_A }, { id: "live", token: TOKEN_B }], chatEvent);
  assert.equal(result.disabled, 1);
  assert.deepEqual(disabled, [{ ids: ["dead"], reason: "DeviceNotRegistered" }]);
});

test("transient ticket errors do not disable tokens", async () => {
  const { deps, disabled } = fakeDeps([{ body: { data: [{ status: "error", details: { error: "MessageRateExceeded" } }] } }]);
  const result = await deliverPush(deps, [{ id: "t1", token: TOKEN_A }], chatEvent);
  assert.equal(result.failed, 1);
  assert.equal(disabled.length, 0);
});

test("network failures and rejected requests never throw and are not retried", async () => {
  for (const response of [new Error("ECONNRESET"), { ok: false, status: 500, body: { errors: [{ code: "INTERNAL" }] } }]) {
    const { deps, calls, disabled, scheduled } = fakeDeps([response]);
    const result = await deliverPush(deps, [{ id: "t1", token: TOKEN_A }], chatEvent);
    assert.equal(result.failed, 1);
    assert.equal(calls.length, 1, "single attempt");
    assert.equal(disabled.length + scheduled.length, 0);
  }
});

test("receipts reporting DeviceNotRegistered disable the matching token", async () => {
  const { deps, calls, disabled } = fakeDeps([{ body: { data: {
    r1: { status: "ok" },
    r2: { status: "error", details: { error: "DeviceNotRegistered" } },
  } } }]);
  const count = await checkReceipts(deps, new Map([["r1", "t1"], ["r2", "t2"]]));
  assert.equal(count, 1);
  assert.equal(calls[0].url, EXPO_PUSH_RECEIPTS_URL);
  assert.deepEqual(disabled, [{ ids: ["t2"], reason: "DeviceNotRegistered" }]);
});

test("sends are split into Expo's 100-message batches", async () => {
  const tokens = Array.from({ length: 150 }, (_, i) => ({ id: `t${i}`, token: `ExponentPushToken[${"x".repeat(20)}${String(i).padStart(3, "0")}]` }));
  const ok = (n: number) => ({ body: { data: Array.from({ length: n }, (_, i) => ({ status: "ok", id: `r${n}-${i}` })) } });
  const { deps, calls } = fakeDeps([ok(100), ok(50)]);
  const result = await deliverPush(deps, tokens, chatEvent);
  assert.deepEqual(calls.map((c) => (c.body as unknown[]).length), [100, 50]);
  assert.equal(result.accepted, 150);
});

test("no tokens means no network request", async () => {
  const { deps, calls } = fakeDeps([]);
  assert.equal((await deliverPush(deps, [], chatEvent)).attempted, 0);
  assert.equal(calls.length, 0);
});
