/**
 * Web build: phone push notifications are not available in the browser.
 * Same exports as pushNotifications.ts so callers need no platform checks.
 * In-app notifications keep working through the API as usual.
 */

type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;

export type PushRegistration =
  | { status: "registered" | "unchanged" }
  | { status: "unsupported" | "denied" | "misconfigured" | "failed"; reason: string };

export async function registerPushToken(_request: ApiRequest, _options: { force?: boolean } = {}): Promise<PushRegistration> {
  return { status: "unsupported", reason: "Push notifications are only available on Android and iOS." };
}

export async function unregisterPushToken(_request: ApiRequest): Promise<void> {}

export function usePushNotifications(_options: { enabled: boolean; userId: string | undefined; request: ApiRequest; onReceived?: () => void }): void {}
