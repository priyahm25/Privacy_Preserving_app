-- Blind-index tokens only: no plaintext terms, document content, or keys.
CREATE TABLE IF NOT EXISTS public.file_search_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(clerk_id) ON DELETE CASCADE,
  token text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS file_search_tokens_user_idx ON public.file_search_tokens(user_id);
CREATE INDEX IF NOT EXISTS file_search_tokens_token_idx ON public.file_search_tokens(token);
CREATE INDEX IF NOT EXISTS file_search_tokens_user_token_file_idx ON public.file_search_tokens(user_id, token, file_id);
CREATE UNIQUE INDEX IF NOT EXISTS file_search_tokens_unique_idx
  ON public.file_search_tokens(file_id, user_id, token);

ALTER TABLE public.file_search_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.file_search_tokens FROM anon, authenticated;
