-- Keep the deployed files table aligned with the Drizzle schema. The column
-- is optional and allows existing and new rows to remain compatible.
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS folder text;
