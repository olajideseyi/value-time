drop index if exists public.schedule_entries_user_starts_idx;
create index if not exists assignments_course_id_idx on public.assignments(course_id);
create index if not exists attendance_schedule_entry_id_idx on public.attendance(schedule_entry_id);
create index if not exists examinations_course_id_idx on public.examinations(course_id);
create index if not exists notification_logs_reminder_id_idx on public.notification_logs(reminder_id);