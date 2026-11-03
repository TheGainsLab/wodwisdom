-- RLS for the signature reference tables (Supabase linter catch, applied
-- alongside the athlete-layer migration on 2026-11-02). The four athlete
-- tables already carry RLS + select-own policies; these two are reference
-- data and follow the repo convention (workout_signatures: RLS on, reads
-- through the service role) — with one read policy on the axes, which are
-- harmless reference content the UI will want directly.

alter table public.signature_axes enable row level security;

drop policy if exists signature_axes_read_authenticated on public.signature_axes;
create policy signature_axes_read_authenticated on public.signature_axes
  for select to authenticated using (true);

-- model params: service-role-only (edge functions read with the service
-- key; no client has any business reading fitted covariance matrices).
alter table public.signature_model_params enable row level security;
