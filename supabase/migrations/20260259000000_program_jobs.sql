-- Background job tracking for program generation
create table program_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'complete', 'failed')),
  program_id uuid references programs(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: users can only read their own jobs
alter table program_jobs enable row level security;

create policy "Users can view own jobs"
  on program_jobs for select
  using (auth.uid() = user_id);

-- Index for polling queries
create index idx_program_jobs_user_status on program_jobs (user_id, status);
