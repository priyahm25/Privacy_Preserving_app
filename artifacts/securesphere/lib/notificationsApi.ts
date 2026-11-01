import { useAuthenticatedApi } from "./authenticatedApi";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const API_ORIGIN = (() => {
  try { return new URL(API_BASE_URL).origin; }
  catch { return "configured API endpoint"; }
})();

function safeError(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240) || null;
}

async function responseError(response: Response, operation: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
  const message = safeError(body?.error) ?? "The server returned an unreadable error response.";
  const code = safeError(body?.code);
  return new Error(`${operation} failed (HTTP ${response.status}${code ? `, ${code}` : ""}): ${message}`);
}

async function perform<T>(operation: string, request: () => Promise<Response>, read: (response: Response) => Promise<T>): Promise<T> {
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    if (error instanceof Error && (error.message === "User is not signed in." || error.message === "Clerk session token is unavailable.")) {
      throw new Error(error.message);
    }
    const reason = error instanceof TypeError ? safeError(error.message) : null;
    throw new Error(`Could not reach the API at ${API_ORIGIN} (${reason || "request setup or network/CORS failure"}). Check that the API is running and EXPO_PUBLIC_API_URL is reachable from this device.`);
  }
  if (!response.ok) throw await responseError(response, operation);
  return read(response);
}

export interface AppNotification {
  id: string;
  type: "file_shared" | "collaboration_invite" | "collaboration_accepted" | "chat_message";
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
  actorName: string | null;
}

export function useNotificationsApi() {
  const { request } = useAuthenticatedApi();
  const getNotifications = async (offset = 0): Promise<AppNotification[]> => {
    return perform("Loading notifications", () => request(`/api/notifications?limit=50&offset=${offset}`), async (response) => (await response.json()).notifications ?? []);
  };
  const getUnreadCount = async (): Promise<number> => {
    return perform("Loading unread count", () => request("/api/notifications/unread-count"), async (response) => (await response.json()).count ?? 0);
  };
  const markRead = async (id: string) => {
    return perform("Updating notification", () => request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" }), async () => undefined);
  };
  const markAllRead = async () => {
    return perform("Updating notifications", () => request("/api/notifications/read-all", { method: "PATCH" }), async () => undefined);
  };
  return { getNotifications, getUnreadCount, markRead, markAllRead };
}
