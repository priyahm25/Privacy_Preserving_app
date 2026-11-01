import type { NotificationType } from "@workspace/db";

const templates: Record<NotificationType, (actor: string) => string> = {
  file_shared: (actor) => `${actor} shared a file with you.`,
  collaboration_invite: (actor) => `${actor} invited you to collaborate.`,
  collaboration_accepted: (actor) => `${actor} accepted your collaboration invitation.`,
  // Never the message itself: chat content is end-to-end encrypted.
  chat_message: (actor) => `${actor} sent you a new message.`,
};
const titles: Record<NotificationType, string> = {
  file_shared: "File Shared",
  collaboration_invite: "Collaboration Invite",
  collaboration_accepted: "Invitation Accepted",
  chat_message: "New Message",
};

/** Construct only minimal, server-authored notification text and metadata. */
export function makeNotificationEvent(input: {
  recipientUserId: string;
  actorUserId: string;
  actorName: string;
  type: NotificationType;
  resourceType: "file" | "invitation" | "conversation";
  resourceId: string;
}) {
  if (!input.recipientUserId || !input.actorUserId || input.recipientUserId === input.actorUserId || !input.resourceId) return null;
  const displayName = input.actorName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || "A teammate";
  return {
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    type: input.type,
    title: titles[input.type],
    message: templates[input.type](displayName),
    read: false,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    dedupeKey: `${input.type}:${input.resourceId}`,
  };
}

/** A DB insert returning no row means this was a retry or duplicate event. */
export function wasNewlyPersisted<T>(inserted: T | undefined): inserted is T {
  return inserted !== undefined;
}
