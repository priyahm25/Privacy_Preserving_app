import type { Href } from "expo-router";

/** Where a notification (in-app row or phone push `data`) should take the user. */
export function routeForNotification(target: { resourceType?: unknown; resourceId?: unknown }): Href {
  const id = typeof target.resourceId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(target.resourceId) ? target.resourceId : null;
  switch (target.resourceType) {
    case "conversation":
      return id ? { pathname: "/chat", params: { conversationId: id } } : "/chat";
    case "file":
      return id ? { pathname: "/file-details/[id]", params: { id } } : "/notifications";
    case "invitation":
      return "/members";
    default:
      return "/notifications";
  }
}
