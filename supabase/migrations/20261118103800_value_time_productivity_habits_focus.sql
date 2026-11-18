-- Stage 3: private focus sessions, habits and habit check-ins.
create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  title text not null,
  planned_minutes integer not null default 25 check (planned_minutes between 1 and 240),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists focus_sessions_user_started_idx on public.focus_sessions(user_id, started_at desc);
alter table public.focus_sessions enable row level security;
create policy "Users can view own focus sessions" on public.focus_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own focus sessions" on public.focus_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own focus sessions" on public.focus_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own focus sessions" on public.focus_sessions for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 100),
  description text,
  frequency text not null default 'daily' check (frequency in ('daily','weekly')),
  target_days smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  color text not null default 'blue',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists habits_user_active_idx on public.habits(user_id, is_active);
alter table public.habits enable row level security;
create policy "Users can view own habits" on public.habits for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own habits" on public.habits for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own habits" on public.habits for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own habits" on public.habits for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.habit_entries (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  completed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (habit_id, user_id, entry_date),
  foreign key (habit_id, user_id) references public.habits(id, user_id) on delete cascade
);
create index if not exists habit_entries_user_date_idx on public.habit_entries(user_id, entry_date desc);
alter table public.habit_entries enable row level security;
create policy "Users can view own habit entries" on public.habit_entries for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own habit entries" on public.habit_entries for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own habit entries" on public.habit_entries for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own habit entries" on public.habit_entries for delete to authenticated using ((select auth.uid()) = user_id);
