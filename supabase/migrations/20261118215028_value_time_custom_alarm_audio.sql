alter table public.user_preferences
  add column if not exists custom_alarm_path text,
  add column if not exists custom_alarm_name text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'alarm-audio',
  'alarm-audio',
  false,
  5242880,
  array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/aac','audio/webm']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Users can read their own alarm audio') then
    create policy "Users can read their own alarm audio"
      on storage.objects for select to authenticated
      using (bucket_id = 'alarm-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Users can upload their own alarm audio') then
    create policy "Users can upload their own alarm audio"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'alarm-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Users can delete their own alarm audio') then
    create policy "Users can delete their own alarm audio"
      on storage.objects for delete to authenticated
      using (bucket_id = 'alarm-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
end $$;