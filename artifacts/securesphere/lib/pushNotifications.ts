import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { routeForNotification } from "./notificationRoutes";

/**
 * Phone push notifications (Android/iOS). The web build uses
 * pushNotifications.web.ts, which has the same exports and does nothing.
 *
 * The server sends generic text only ("You received a new message"); `data`
 * carries opaque ids used for navigation, never content or keys.
 */

type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;

export type PushRegistration =
  | { status: "registered" | "unchanged" }
  | { status: "unsupported" | "denied" | "misconfigured" | "failed"; reason: string };

/** Must match ANDROID_CHANNELS in the API's lib/pushDelivery.ts. */
const CHANNELS = { messages: "messages", general: "default" } as const;

// Show banners while the app is open, too. Module scope: registered once.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;
let registering: Promise<PushRegistration> | null = null;

function easProjectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  const candidate = fromConfig ?? Constants.easConfig?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function unsupportedReason(): string | null {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return "Push notifications are only available on Android and iOS.";
  if (!Device.isDevice) return "Push notifications need a physical device.";
  // Expo Go dropped remote push on Android in SDK 53; a development build is required.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return "Push notifications need a development build, not Expo Go.";
  return null;
}

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  // On Android 13+, creating the first channel is what allows the permission prompt.
  await Notifications.setNotificationChannelAsync(CHANNELS.messages, {
    name: "Messages",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync(CHANNELS.general, {
    name: "General",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

async function register(request: ApiRequest, force: boolean): Promise<PushRegistration> {
  const unsupported = unsupportedReason();
  if (unsupported) return { status: "unsupported", reason: unsupported };

  await ensureAndroidChannels();
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return { status: "denied", reason: "Notification permission was not granted." };

  const projectId = easProjectId();
  if (!projectId) return { status: "misconfigured", reason: "No EAS projectId in app.json (extra.eas.projectId) or EXPO_PUBLIC_EAS_PROJECT_ID." };

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  if (!force && token === registeredToken) return { status: "unchanged" };

  const response = await request("/api/push/tokens", { method: "POST", body: JSON.stringify({ token, platform: Platform.OS }) });
  if (!response.ok) return { status: "failed", reason: `Server rejected the push token (HTTP ${response.status}).` };
  registeredToken = token;
  return { status: "registered" };
}

/** Register this installation for the signed-in user. Concurrent calls share one request. */
export function registerPushToken(request: ApiRequest, options: { force?: boolean } = {}): Promise<PushRegistration> {
  if (!registering) {
    registering = register(request, Boolean(options.force))
      .catch((error): PushRegistration => ({ status: "failed", reason: error instanceof Error ? error.message : "Unknown error" }))
      .finally(() => { registering = null; });
  }
  return registering;
}

/** Best effort, before sign-out, so this phone stops receiving the account's alerts. */
export async function unregisterPushToken(request: ApiRequest): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  try {
    await request("/api/push/tokens/unregister", { method: "POST", body: JSON.stringify({ token }) });
  } catch {
    // The server also moves the token on the next account's registration.
  }
}

/**
 * Mount once, inside the signed-in app. Registers after authentication,
 * keeps one set of listeners for the app's lifetime and removes them on
 * unmount, and opens the right screen when a notification is tapped -
 * including the tap that cold-started the app.
 */
export function usePushNotifications(options: { enabled: boolean; userId: string | undefined; request: ApiRequest; onReceived?: () => void }): void {
  const { enabled, userId } = options;
  const requestRef = useRef(options.request);
  const onReceivedRef = useRef(options.onReceived);
  const enabledRef = useRef(enabled);
  requestRef.current = options.request;
  onReceivedRef.current = options.onReceived;
  enabledRef.current = enabled;
  const pendingRoute = useRef<ReturnType<typeof routeForNotification> | null>(null);
  const handledIds = useRef(new Set<string>());

  // Registration: once per signed-in account, plus when Expo rotates the token.
  useEffect(() => {
    if (!enabled || !userId || unsupportedReason()) return;
    void registerPushToken(requestRef.current).then((result) => {
      if ("reason" in result) console.info("Push notifications not enabled:", result.reason);
    });
    const tokenSubscription = Notifications.addPushTokenListener(() => {
      void registerPushToken(requestRef.current, { force: true });
    });
    return () => tokenSubscription.remove();
  }, [enabled, userId]);

  // Listeners: mounted once for the app's lifetime.
  useEffect(() => {
    if (unsupportedReason()) return;
    const open = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handledIds.current.has(id)) return; // the cold-start tap is also delivered to the listener
      handledIds.current.add(id);
      const route = routeForNotification(response.notification.request.content.data ?? {});
      if (enabledRef.current) router.push(route);
      else pendingRoute.current = route; // opened before sign-in finished
    };
    const received = Notifications.addNotificationReceivedListener(() => onReceivedRef.current?.());
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      onReceivedRef.current?.();
      open(response);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => { if (response) open(response); });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, []);

  // Navigate for a tap that arrived before the session was ready.
  useEffect(() => {
    if (!enabled || !pendingRoute.current) return;
    const route = pendingRoute.current;
    pendingRoute.current = null;
    router.push(route);
  }, [enabled]);
}
