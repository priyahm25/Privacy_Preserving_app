import type { NotificationType } from "@workspace/db";

/**
 * Expo Push Service delivery, kept free of database and network imports so it
 * can be unit tested with injected dependencies (see pushNotifications.ts for
 * the wiring).
 *
 * Privacy: a push travels through Expo and Google/Apple and is shown on the
 * lock screen, so its text is fixed, generic copy. It never carries message
 * plaintext, ciphertext, keys, file names or the actor's name - only opaque
 * ids the app needs to open the right screen.
 */

export const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
/** Expo accepts at most 100 messages per send request and 1000 ids per receipt request. */
const SEND_CHUNK = 100;
const RECEIPT_CHUNK = 1000;
/** Expo recommends waiting before reading receipts; checked once, never retried. */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

/** Android channel ids; the app creates the same channels before asking for a token. */
export const ANDROID_CHANNELS = { messages: "messages", general: "default" } as const;

const PUSH_COPY: Record<NotificationType, { title: string; body: string }> = {
  chat_message: { title: "SecureSphere", body: "You received a new message" },
  collaboration_invite: { title: "SecureSphere", body: "You have a new teammate invitation" },
  collaboration_accepted: { title: "SecureSphere", body: "Your teammate invitation was accepted" },
  file_shared: { title: "SecureSphere", body: "A file was shared with you" },
};

const EXPO_TOKEN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;
export function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && EXPO_TOKEN.test(value);
}

export interface PushEvent {
  notificationId: string;
  type: NotificationType;
  resourceType: string | null;
  resourceId: string | null;
}

export interface PushTokenRow {
  id: string;
  token: string;
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: { notificationId: string; type: NotificationType; resourceType: string | null; resourceId: string | null };
  sound: "default";
  priority: "high";
  channelId: string;
}

/** Build one message per distinct token. `data` is an explicit allow-list. */
export function buildPushMessages(tokens: PushTokenRow[], event: PushEvent): ExpoPushMessage[] {
  const copy = PUSH_COPY[event.type];
  if (!copy) return [];
  const unique = [...new Set(tokens.map((t) => t.token))].filter(isExpoPushToken);
  return unique.map((to) => ({
    to,
    title: copy.title,
    body: copy.body,
    data: {
      notificationId: event.notificationId,
      type: event.type,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
    },
    sound: "default",
    priority: "high",
    channelId: event.type === "chat_message" ? ANDROID_CHANNELS.messages : ANDROID_CHANNELS.general,
  }));
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface PushDeps {
  fetch: FetchLike;
  /** Mark these push_tokens rows unusable. Must not throw for unknown ids. */
  disableTokens: (tokenIds: string[], reason: string) => Promise<void>;
  /** Run `task` once after `delayMs`. Defaults to an unref'd setTimeout. */
  schedule?: (task: () => void, delayMs: number) => void;
  /** Optional EXPO_ACCESS_TOKEN, for projects with enhanced push security enabled. */
  accessToken?: string;
  log?: (level: "info" | "warn" | "error", fields: Record<string, unknown>, message: string) => void;
}

export interface DeliveryResult {
  attempted: number;
  accepted: number;
  disabled: number;
  failed: number;
}

function headers(accessToken?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (accessToken) h.Authorization = `Bearer ${accessToken}`;
  return h;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Expo error codes that mean the token will never work again. */
const DEAD_TOKEN_ERRORS = new Set(["DeviceNotRegistered"]);

function errorCode(ticket: unknown): string | undefined {
  const details = (ticket as { details?: { error?: unknown } } | null)?.details;
  return typeof details?.error === "string" ? details.error : undefined;
}

/**
 * Send one event to a user's tokens. Never throws and never retries: a failed
 * push is logged (counts and Expo error codes only, never tokens or content)
 * and the in-app notification, already committed, remains the source of truth.
 */
export async function deliverPush(deps: PushDeps, tokens: PushTokenRow[], event: PushEvent): Promise<DeliveryResult> {
  const log = deps.log ?? (() => undefined);
  const messages = buildPushMessages(tokens, event);
  const result: DeliveryResult = { attempted: messages.length, accepted: 0, disabled: 0, failed: 0 };
  if (!messages.length) return result;

  const tokenIdByValue = new Map(tokens.map((t) => [t.token, t.id]));
  const dead = new Set<string>();
  const receiptTokens = new Map<string, string>(); // ticket id -> push_tokens.id

  for (const batch of chunk(messages, SEND_CHUNK)) {
    try {
      const response = await deps.fetch(EXPO_PUSH_SEND_URL, {
        method: "POST",
        headers: headers(deps.accessToken),
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as { data?: unknown; errors?: { code?: unknown }[] } | null;
      if (!response.ok || !Array.isArray(body?.data)) {
        result.failed += batch.length;
        log("warn", { status: response.status, codes: body?.errors?.map((e) => e?.code).filter(Boolean) }, "Expo push request rejected");
        continue;
      }
      body.data.forEach((ticket, index) => {
        const tokenId = tokenIdByValue.get(batch[index]?.to ?? "");
        const status = (ticket as { status?: unknown })?.status;
        const id = (ticket as { id?: unknown })?.id;
        if (status === "ok") {
          result.accepted += 1;
          if (typeof id === "string" && tokenId) receiptTokens.set(id, tokenId);
          return;
        }
        result.failed += 1;
        const code = errorCode(ticket);
        if (code && DEAD_TOKEN_ERRORS.has(code) && tokenId) dead.add(tokenId);
        else log("warn", { code: code ?? "unknown" }, "Expo push ticket error");
      });
    } catch (error) {
      result.failed += batch.length;
      log("warn", { reason: error instanceof Error ? error.name : "unknown" }, "Expo push request failed");
    }
  }

  if (dead.size) {
    await deps.disableTokens([...dead], "DeviceNotRegistered").catch(() => log("error", {}, "Could not disable dead push tokens"));
    result.disabled = dead.size;
  }

  if (receiptTokens.size) {
    const schedule = deps.schedule ?? ((task, delayMs) => { setTimeout(task, delayMs).unref?.(); });
    schedule(() => { void checkReceipts(deps, receiptTokens); }, RECEIPT_DELAY_MS);
  }
  return result;
}

/** One receipt check per send; DeviceNotRegistered here also disables the token. */
export async function checkReceipts(deps: PushDeps, receiptTokens: Map<string, string>): Promise<number> {
  const log = deps.log ?? (() => undefined);
  const dead = new Set<string>();
  for (const ids of chunk([...receiptTokens.keys()], RECEIPT_CHUNK)) {
    try {
      const response = await deps.fetch(EXPO_PUSH_RECEIPTS_URL, {
        method: "POST",
        headers: headers(deps.accessToken),
        body: JSON.stringify({ ids }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
      if (!response.ok || !body?.data || typeof body.data !== "object") {
        log("warn", { status: response.status }, "Expo receipt request rejected");
        continue;
      }
      for (const [ticketId, receipt] of Object.entries(body.data)) {
        if ((receipt as { status?: unknown })?.status !== "error") continue;
        const code = errorCode(receipt);
        const tokenId = receiptTokens.get(ticketId);
        if (code && DEAD_TOKEN_ERRORS.has(code) && tokenId) dead.add(tokenId);
        else log("warn", { code: code ?? "unknown" }, "Expo push receipt error");
      }
    } catch (error) {
      log("warn", { reason: error instanceof Error ? error.name : "unknown" }, "Expo receipt request failed");
    }
  }
  if (dead.size) await deps.disableTokens([...dead], "DeviceNotRegistered").catch(() => log("error", {}, "Could not disable dead push tokens"));
  return dead.size;
}
