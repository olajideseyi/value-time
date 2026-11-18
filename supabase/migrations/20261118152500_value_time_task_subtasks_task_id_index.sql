-- Add a task_id-leading index so parent task deletes/updates can locate subtasks efficiently.
create index if not exists task_subtasks_task_id_idx on public.task_subtasks(task_id);
