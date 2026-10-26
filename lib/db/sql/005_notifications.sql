-- Notifications existed in an earlier schema with user_id/read/related_entity_*
-- columns. Keep those established names and preserve all existing rows.
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.users(clerk_id) ON DELETE CASCADE,
  actor_user_id text REFERENCES public.users(clerk_id) ON DELETE SET NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  related_entity_type text,
  related_entity_id text,
  deduplication_key text,
  read_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Add only the fields the legacy table did not have. These are safe for old rows.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_user_id text REFERENCES public.users(clerk_id) ON DELETE SET NULL;
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS read_at timestamp;

-- Preserve the existing boolean read state for notifications already stored.
UPDATE public.notifications
  SET read_at = created_at
  WHERE read = true AND read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON public.notifications (user_id, created_at);
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications (user_id, read_at);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedup_idx
  ON public.notifications (user_id, deduplication_key)
  WHERE deduplication_key IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;
