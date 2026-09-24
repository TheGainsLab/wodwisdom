-- scheme_format: the block's workout format as TYPED data (jsonb SchemeFormat:
-- format enum + minutes/rounds/work_seconds/rest_seconds/rounds_pattern/
-- stations/...). The model emits these fields; compose-block-scheme.ts renders
-- the human block_scheme header from them plus the movement rows at save and
-- at coach-edit apply — so the header and the rows share one source and
-- cannot disagree (the one-copy rule as data, replacing the prose-regex
-- audit layer). block_scheme stays the rendered display string; legacy and
-- ingested blocks keep their model-written text with scheme_format null.
ALTER TABLE public.program_blocks_v2
  ADD COLUMN IF NOT EXISTS scheme_format jsonb;
