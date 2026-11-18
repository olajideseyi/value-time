-- Generate the next occurrence after a recurring task is completed.
alter table public.tasks add column if not exists recurrence_parent_id uuid references public.tasks(id) on delete cascade;
alter table public.tasks add column if not exists recurrence_generated_at timestamptz;
create index if not exists tasks_recurring_completed_idx on public.tasks(completed_at) where is_recurring=true and status='completed';
create unique index if not exists tasks_recurring_occurrence_unique on public.tasks(recurrence_parent_id,due_at) where recurrence_parent_id is not null and due_at is not null;
