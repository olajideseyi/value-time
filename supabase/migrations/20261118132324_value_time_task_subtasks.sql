-- Per-user task subtasks with parent-task ownership enforced.
create table if not exists public.task_subtasks (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 task_id uuid not null references public.tasks(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 180),
 status text not null default 'pending' check(status in ('pending','in_progress','completed')),
 sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists task_subtasks_user_task_idx on public.task_subtasks(user_id,task_id,sort_order);
alter table public.task_subtasks enable row level security;
revoke all on public.task_subtasks from anon,public;
grant select,insert,update,delete on public.task_subtasks to authenticated;
drop policy if exists "Users can read their task subtasks" on public.task_subtasks;
create policy "Users can read their task subtasks" on public.task_subtasks for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Users can create their task subtasks" on public.task_subtasks;
create policy "Users can create their task subtasks" on public.task_subtasks for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "Users can update their task subtasks" on public.task_subtasks;
create policy "Users can update their task subtasks" on public.task_subtasks for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists "Users can delete their task subtasks" on public.task_subtasks;
create policy "Users can delete their task subtasks" on public.task_subtasks for delete to authenticated using ((select auth.uid())=user_id);
drop trigger if exists task_subtasks_set_updated_at on public.task_subtasks;
create trigger task_subtasks_set_updated_at before update on public.task_subtasks for each row execute function public.set_updated_at();
create or replace function public.validate_task_subtask_ownership()
returns trigger language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from public.tasks t where t.id=new.task_id and t.user_id=new.user_id) then
  raise exception 'The selected task does not belong to this account.' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function public.validate_task_subtask_ownership() from public,anon;
grant execute on function public.validate_task_subtask_ownership() to authenticated,service_role;
drop trigger if exists validate_task_subtask_ownership on public.task_subtasks;
create trigger validate_task_subtask_ownership before insert or update of task_id,user_id on public.task_subtasks for each row execute function public.validate_task_subtask_ownership();
