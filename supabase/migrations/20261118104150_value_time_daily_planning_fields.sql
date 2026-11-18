-- Add task planning fields without changing existing due dates.
alter table public.tasks add column if not exists planned_for timestamptz;
alter table public.tasks add column if not exists estimated_minutes integer not null default 45 check (estimated_minutes between 5 and 480);
create index if not exists tasks_user_planned_for_idx on public.tasks(user_id, planned_for) where planned_for is not null;
