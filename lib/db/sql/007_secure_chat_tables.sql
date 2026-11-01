-- Additive encrypted one-to-one chat schema under non-conflicting names.
--
-- Supersedes 006_encrypted_chat.sql. The shared database already contains
-- `conversations`, `chat_messages` and `chat_keys` tables with a different
-- shape (written by the chat implementation on origin/main, commit f8dba63,
-- and holding existing rows), so 006's CREATE TABLE IF NOT EXISTS skipped
-- them and its first CREATE INDEX fails. Those tables are left untouched.
-- Nothing here drops, alters, deletes from or updates any existing table.
-- The new foreign keys only reference public.users and public.user_device_keys
-- (briefly locking them against writes while the constraints are created).
-- Safe to re-run: every statement is IF NOT EXISTS or idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.secure_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a_id text NOT NULL REFERENCES public.users(clerk_id) ON DELETE CASCADE,
  participant_b_id text NOT NULL REFERENCES public.users(clerk_id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT secure_conversations_distinct_participants CHECK (participant_a_id <> participant_b_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS secure_conversations_pair_unique_idx ON public.secure_conversations(participant_a_id, participant_b_id);
CREATE INDEX IF NOT EXISTS secure_conversations_participant_a_idx ON public.secure_conversations(participant_a_id);
CREATE INDEX IF NOT EXISTS secure_conversations_participant_b_idx ON public.secure_conversations(participant_b_id);

CREATE TABLE IF NOT EXISTS public.secure_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.secure_conversations(id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES public.users(clerk_id) ON DELETE CASCADE,
  sender_device_key_id uuid NOT NULL REFERENCES public.user_device_keys(id),
  ciphertext text NOT NULL,
  iv text NOT NULL,
  reply_to_message_id uuid REFERENCES public.secure_chat_messages(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  delivered_at timestamp,
  read_at timestamp
);
CREATE INDEX IF NOT EXISTS secure_chat_messages_conversation_created_idx ON public.secure_chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS secure_chat_messages_sender_idx ON public.secure_chat_messages(sender_id);

CREATE TABLE IF NOT EXISTS public.secure_chat_message_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.secure_chat_messages(id) ON DELETE CASCADE,
  device_key_id uuid NOT NULL REFERENCES public.user_device_keys(id),
  wrapped_key text NOT NULL,
  wrapping_iv text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS secure_chat_message_keys_message_device_unique_idx ON public.secure_chat_message_keys(message_id, device_key_id);
CREATE INDEX IF NOT EXISTS secure_chat_message_keys_device_idx ON public.secure_chat_message_keys(device_key_id);

-- Same posture as the other app tables: RLS on with no policies, so only the
-- API server's privileged role can read or write; Supabase anon/auth roles get nothing.
ALTER TABLE public.secure_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secure_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secure_chat_message_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.secure_conversations, public.secure_chat_messages, public.secure_chat_message_keys FROM anon, authenticated;

COMMIT;
