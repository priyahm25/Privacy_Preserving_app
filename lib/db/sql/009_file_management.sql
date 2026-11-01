-- Additive: file management (rename / delete) for shared files.
--
-- Creates TWO new tables and nothing else. Nothing here drops, alters,
-- deletes from or updates any existing table or row; the only existing tables
-- referenced are public.files and public.users (foreign keys, briefly locked
-- while each constraint is created). Safe to re-run: every statement is
-- IF NOT EXISTS.
--
--   file_display_names  per-recipient personal rename of a shared file
--   file_hidden         owner "Delete for Me" (hide from own Shared-by-Me list)
--
-- Until this is applied the API keeps working: rename/hide endpoints return a
-- clear error (the tables are missing), and all existing sharing, download,
-- search and delete behaviour is unaffected.

BEGIN;

-- A recipient's own display name for a file shared with them. Does not change
-- the owner's filename or any other recipient's view.
CREATE TABLE IF NOT EXISTS public.file_display_names (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL,
  user_id text NOT NULL,
  display_name text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT file_display_names_file_id_files_id_fk
    FOREIGN KEY (file_id) REFERENCES public.files(id) ON DELETE CASCADE,
  CONSTRAINT file_display_names_user_id_users_clerk_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(clerk_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS file_display_names_unique_idx
  ON public.file_display_names(file_id, user_id);
CREATE INDEX IF NOT EXISTS file_display_names_user_idx
  ON public.file_display_names(user_id);

-- Owner-side soft hide for the Shared-by-Me listing. One row = that user hid
-- that file from their own shared view. The file, its shares and storage are
-- untouched.
CREATE TABLE IF NOT EXISTS public.file_hidden (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL,
  user_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT file_hidden_file_id_files_id_fk
    FOREIGN KEY (file_id) REFERENCES public.files(id) ON DELETE CASCADE,
  CONSTRAINT file_hidden_user_id_users_clerk_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(clerk_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS file_hidden_unique_idx
  ON public.file_hidden(file_id, user_id);

-- Same posture as the other app tables: only the API's privileged role can
-- read or write; Supabase anon/authenticated roles get nothing.
ALTER TABLE public.file_display_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_hidden ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.file_display_names FROM anon, authenticated;
REVOKE ALL ON public.file_hidden FROM anon, authenticated;

COMMIT;
