import { useUser } from "@clerk/expo";
import { useApp } from "@/context/AppContext";
import { useAuthenticatedApi } from "@/lib/authenticatedApi";
import { usePushNotifications } from "@/lib/pushNotifications";

/**
 * Renders nothing. Mounted once under AppProvider so push registration waits
 * for Clerk sign-in and the server profile sync, and listeners live for the
 * app's whole lifetime instead of per screen.
 */
export function PushNotificationsBridge() {
  const { isAuthenticated, isProfileSynced, refreshNotificationCount } = useApp();
  const { user } = useUser();
  const { request } = useAuthenticatedApi();
  usePushNotifications({ enabled: isAuthenticated && isProfileSynced, userId: user?.id, request, onReceived: refreshNotificationCount });
  return null;
}
