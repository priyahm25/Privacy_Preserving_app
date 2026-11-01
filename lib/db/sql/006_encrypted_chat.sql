-- SUPERSEDED by 007_secure_chat_tables.sql: do not run. In the shared DB the
-- table names below already exist with a different shape, so this file fails.
-- Additive encrypted one-to-one chat schema. Existing chat-related tables,
-- if present in an environment, are left intact; no DROP/RESET is performed.
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a_id text NOT NULL REFERENCES public.users(clerk_id) ON DELETE CASCADE,
  participant_b_id text NOT NULL REFERENCES public.users(clerk_id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT conversations_distinct_participants CHECK (participant_a_id <> participant_b_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_pair_unique_idx ON public.conversations(participant_a_id, participant_b_id);
CREATE INDEX IF NOT EXISTS conversations_participant_a_idx ON public.conversations(participant_a_id);
CREATE INDEX IF NOT EXISTS conversations_participant_b_idx ON public.conversations(participant_b_id);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES public.users(clerk_id) ON DELETE CASCADE,
  sender_device_key_id uuid NOT NULL REFERENCES public.user_device_keys(id),
  ciphertext text NOT NULL,
  iv text NOT NULL,
  reply_to_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  delivered_at timestamp,
  read_at timestamp
);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx ON public.chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS chat_messages_sender_idx ON public.chat_messages(sender_id);

CREATE TABLE IF NOT EXISTS public.chat_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  device_key_id uuid NOT NULL REFERENCES public.user_device_keys(id),
  wrapped_key text NOT NULL,
  wrapping_iv text NOT NULL,
  CONSTRAINT chat_keys_message_device_unique UNIQUE(message_id, device_key_id)
);
CREATE INDEX IF NOT EXISTS chat_keys_device_idx ON public.chat_keys(device_key_id);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversations, public.chat_messages, public.chat_keys FROM anon, authenticated;
