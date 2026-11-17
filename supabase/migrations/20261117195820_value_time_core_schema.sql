-- Value Time multi-user core schema. Applied to Supabase project emcspruiboxkixcyokka.
create extension if not exists pgcrypto;
create or replace function public.set_updated_at() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end; $$;
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,display_name text,avatar_url text,timezone text not null default 'Africa/Lagos',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.user_preferences(user_id uuid primary key references auth.users(id) on delete cascade,timezone text not null default 'Africa/Lagos',week_starts_on smallint not null default 1 check(week_starts_on between 0 and 6),default_reminder_minutes integer[] not null default array[30,10],sound_enabled boolean not null default true,push_enabled boolean not null default true,daily_summary_enabled boolean not null default true,daily_summary_time time not null default '07:00',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.courses(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,name text not null,code text,instructor text,color text not null default '#2563eb',notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.schedule_entries(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,course_id uuid references public.courses(id) on delete set null,title text not null,description text,activity_type text not null default 'class' check(activity_type in ('class','meeting','work','personal','other')),starts_at timestamptz not null,ends_at timestamptz not null,timezone text not null default 'Africa/Lagos',location text,meeting_url text,recurrence_type text not null default 'none' check(recurrence_type in ('none','weekly')),recurrence_days smallint[] not null default '{}',recurrence_until date,is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(ends_at>starts_at),check(recurrence_days <@ array[0,1,2,3,4,5,6]::smallint[]));
create table public.assignments(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,course_id uuid references public.courses(id) on delete set null,title text not null,description text,priority text not null default 'medium' check(priority in ('low','medium','high','urgent')),status text not null default 'not_started' check(status in ('not_started','in_progress','submitted','completed')),due_at timestamptz,attachment_path text,submitted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.tasks(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,title text not null,description text,priority text not null default 'medium' check(priority in ('low','medium','high','urgent')),status text not null default 'pending' check(status in ('pending','in_progress','completed','cancelled')),due_at timestamptz,is_recurring boolean not null default false,recurrence_rule text,completed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.attendance(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,schedule_entry_id uuid not null references public.schedule_entries(id) on delete cascade,occurrence_starts_at timestamptz not null,status text not null check(status in ('joined','missed','cancelled','rescheduled')),note text,marked_at timestamptz not null default now(),created_at timestamptz not null default now(),unique(user_id,schedule_entry_id,occurrence_starts_at));
create table public.telegram_connections(user_id uuid primary key references auth.users(id) on delete cascade,telegram_chat_id text unique,telegram_username text,link_code_hash text,link_code_expires_at timestamptz,connected_at timestamptz,notifications_enabled boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.reminders(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,target_type text not null check(target_type in ('schedule','assignment','task','custom')),target_id uuid,title text not null,message text,channel text not null default 'telegram' check(channel in ('telegram','push','in_app')),due_at timestamptz not null,status text not null default 'pending' check(status in ('pending','processing','sent','failed','cancelled')),sent_at timestamptz,attempts integer not null default 0,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.notification_logs(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,reminder_id uuid references public.reminders(id) on delete set null,channel text not null,status text not null check(status in ('sent','failed')),provider_message_id text,error_message text,created_at timestamptz not null default now());
create index courses_user_idx on public.courses(user_id);
create index schedule_user_start_idx on public.schedule_entries(user_id,starts_at);
create index assignments_user_due_idx on public.assignments(user_id,due_at);
create index tasks_user_due_idx on public.tasks(user_id,due_at);
create index attendance_user_date_idx on public.attendance(user_id,occurrence_starts_at desc);
create index reminders_due_idx on public.reminders(due_at) where status='pending';
create index reminders_user_idx on public.reminders(user_id,due_at);
create index notification_logs_user_date_idx on public.notification_logs(user_id,created_at desc);
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name',split_part(new.email,'@',1)));
 insert into public.user_preferences(user_id) values(new.id);
 insert into public.telegram_connections(user_id) values(new.id);
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using(id=auth.uid());
create policy profiles_insert_own on public.profiles for insert to authenticated with check(id=auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
do $$ declare t text; begin
 foreach t in array array['user_preferences','courses','schedule_entries','assignments','tasks','attendance','telegram_connections','reminders','notification_logs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for select to authenticated using(user_id=auth.uid())',t||'_select_own',t);
  execute format('create policy %I on public.%I for insert to authenticated with check(user_id=auth.uid())',t||'_insert_own',t);
  execute format('create policy %I on public.%I for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid())',t||'_update_own',t);
  execute format('create policy %I on public.%I for delete to authenticated using(user_id=auth.uid())',t||'_delete_own',t);
 end loop;
end $$;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger preferences_updated_at before update on public.user_preferences for each row execute function public.set_updated_at();
create trigger courses_updated_at before update on public.courses for each row execute function public.set_updated_at();
create trigger schedule_updated_at before update on public.schedule_entries for each row execute function public.set_updated_at();
create trigger assignments_updated_at before update on public.assignments for each row execute function public.set_updated_at();
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger telegram_updated_at before update on public.telegram_connections for each row execute function public.set_updated_at();
create trigger reminders_updated_at before update on public.reminders for each row execute function public.set_updated_at();
grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
