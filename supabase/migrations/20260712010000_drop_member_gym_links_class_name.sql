-- Decision 11 residue: member_gym_links.class_name was the Engine Class-era
-- "which class did they join" label — the class product is removed and nothing
-- reads or writes the column (the cleanup migration dropped engine_intake but
-- missed this one). All affiliates are test users; destructive on test data only.
--
-- Idempotent + SQL-editor-ready. NOTIFY pgrst at the end.

begin;

alter table public.member_gym_links drop column if exists class_name;

notify pgrst, 'reload schema';

commit;
