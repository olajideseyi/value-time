
create table if not exists public.examinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null,
  description text,
  exam_type text not null default 'examination' check (exam_type in ('examination','test','quiz','presentation','assessment','other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','rescheduled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint examinations_end_after_start check (ends_at is null or ends_at > starts_at)
);
create index if not exists examinations_user_starts_idx on public.examinations(user_id, starts_at);
create index if not exists schedule_entries_user_starts_idx on public.schedule_entries(user_id, starts_at);
create index if not exists assignments_user_due_idx on public.assignments(user_id, due_at);
alter table public.examinations enable row level security;
create policy "Users can view their own examinations" on public.examinations for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their own examinations" on public.examinations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own examinations" on public.examinations for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own examinations" on public.examinations for delete to authenticated using ((select auth.uid()) = user_id);
