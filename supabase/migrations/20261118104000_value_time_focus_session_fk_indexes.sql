-- Cover optional focus-session relationships for efficient joins and deletes.
create index if not exists focus_sessions_course_id_idx on public.focus_sessions(course_id) where course_id is not null;
create index if not exists focus_sessions_task_id_idx on public.focus_sessions(task_id) where task_id is not null;
