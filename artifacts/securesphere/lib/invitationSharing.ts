// Copy / share helpers for invitation links. No React Native imports: the
// screen passes in the platform APIs, so every outcome can be unit tested.

export type CopyResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "denied" | "failed"; message: string };

export interface ClipboardApis {
  /** navigator.clipboard.writeText on web, the native clipboard on Android/iOS. */
  writeText?: (text: string) => Promise<void>;
  /** Legacy web fallback (document.execCommand("copy")); returns whether it copied. */
  legacyCopy?: (text: string) => boolean;
}

export const MANUAL_COPY_HINT =
  "Select the link below and copy it manually (Ctrl+C, or long-press and choose Copy).";

const errorName = (error: unknown) =>
  error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";

export async function copyText(text: string, apis: ClipboardApis): Promise<CopyResult> {
  let denied = false;
  if (apis.writeText) {
    try {
      await apis.writeText(text);
      return { ok: true };
    } catch (error) {
      // NotAllowedError: permission refused, page not focused, or not a secure context.
      denied = errorName(error) === "NotAllowedError" || errorName(error) === "SecurityError";
    }
  }
  if (apis.legacyCopy) {
    try {
      if (apis.legacyCopy(text)) return { ok: true };
    } catch {
      // Fall through to the manual-copy message.
    }
  }
  if (denied) return { ok: false, reason: "denied", message: `Clipboard access was blocked. ${MANUAL_COPY_HINT}` };
  if (!apis.writeText && !apis.legacyCopy) {
    return { ok: false, reason: "unsupported", message: `This browser can't copy automatically. ${MANUAL_COPY_HINT}` };
  }
  return { ok: false, reason: "failed", message: `Couldn't copy the link. ${MANUAL_COPY_HINT}` };
}

export type ShareResult =
  | { outcome: "shared" }
  | { outcome: "cancelled" }
  | { outcome: "unsupported" }
  | { outcome: "failed"; message: string };

export interface WebShareApi {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  canShare?: (data: { url?: string }) => boolean;
}

export async function webShare(link: string, nav: WebShareApi | undefined): Promise<ShareResult> {
  if (!nav || typeof nav.share !== "function") return { outcome: "unsupported" };
  const data = { title: "SecureSphere invitation", text: "Join my SecureSphere workspace.", url: link };
  if (typeof nav.canShare === "function" && !nav.canShare({ url: link })) return { outcome: "unsupported" };
  try {
    await nav.share(data);
    return { outcome: "shared" };
  } catch (error) {
    if (errorName(error) === "AbortError") return { outcome: "cancelled" };
    return { outcome: "failed", message: "Your browser couldn't open the share sheet. Use one of the options below." };
  }
}

/** Native Share.share resolves with an action; "dismissedAction" (iOS) means the user cancelled. */
export async function nativeShare(
  link: string,
  share: (content: { message: string; url?: string; title?: string }) => Promise<{ action: string }>,
): Promise<ShareResult> {
  try {
    const result = await share({ message: link, url: link, title: "SecureSphere invitation" });
    return result.action === "dismissedAction" ? { outcome: "cancelled" } : { outcome: "shared" };
  } catch {
    return { outcome: "failed", message: "Couldn't open the share sheet. Use one of the options below." };
  }
}

export function invitationMailto(link: string, to: string | null, inviterName?: string | null): string {
  const subject = `${inviterName || "A teammate"} invited you to SecureSphere`;
  const body = [
    `${inviterName || "I"} invited you to collaborate on SecureSphere.`,
    "",
    "Accept the invitation:",
    link,
    "",
    "The link expires in 7 days and only works for this email address.",
  ].join("\n");
  return `mailto:${to ? encodeURIComponent(to) : ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
