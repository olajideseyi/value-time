alter table public.schedule_entries
  add column if not exists lecturer_name text,
  add column if not exists reminder_minutes integer[] not null default array[30,10];
alter table public.user_preferences
  add column if not exists alarm_sound text not null default 'classic',
  add column if not exists alarm_volume numeric(3,2) not null default 0.75 check (alarm_volume between 0 and 1),
  add column if not exists alarm_repeat boolean not null default true,
  add column if not exists email_notifications_enabled boolean not null default true,
  add column if not exists summary_email_enabled boolean not null default false,
  add column if not exists summary_include_timetable boolean not null default true,
  add column if not exists summary_include_tasks boolean not null default true,
  add column if not exists summary_include_assignments boolean not null default true;
alter table public.reminders drop constraint if exists reminders_channel_check;
alter table public.reminders add constraint reminders_channel_check
  check (channel in ('telegram','push','in_app','email'));
create index if not exists reminders_email_due_idx
  on public.reminders(due_at) where status='pending' and channel='email';
