-- Use a non-partial unique index so PostgREST can infer the ON CONFLICT target.
drop index if exists public.tasks_recurring_occurrence_unique;
create unique index tasks_recurring_occurrence_unique on public.tasks(recurrence_parent_id,due_at);
