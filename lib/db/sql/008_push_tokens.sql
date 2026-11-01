-- Additive: Expo push tokens for Android/iOS phone notifications.
--
-- Creates one new table. Nothing here drops, alters, deletes from or updates
-- any existing table or row; the only existing table referenced is
-- public.users (foreign key, briefly locked while the constraint is created).
-- Safe to re-run: every statement is IF NOT EXISTS or idempotent.
--
-- Until this is applied the API keeps working: in-app notifications are
-- unaffected and phone push delivery is skipped with a log warning.

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.users(clerk_id) ON DELETE CASCADE,
  -- "ExponentPushToken[...]" issued by Expo for one app installation.
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  -- Set when the user signs out or Expo reports DeviceNotRegistered.
  disabled_at timestamp,
  disabled_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_unique_idx ON public.push_tokens(token);
CREATE INDEX IF NOT EXISTS push_tokens_user_active_idx ON public.push_tokens(user_id) WHERE disabled_at IS NULL;

-- Same posture as the other app tables: only the API's privileged role can
-- read or write; Supabase anon/authenticated roles get nothing.
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_tokens FROM anon, authenticated;

COMMIT;
