insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('assignment-submissions','assignment-submissions',false,20971520,array[
'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
'image/jpeg','image/png'
])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "Users can read their assignment submissions" on storage.objects for select to authenticated
using (bucket_id='assignment-submissions' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Users can upload their assignment submissions" on storage.objects for insert to authenticated
with check (bucket_id='assignment-submissions' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Users can update their assignment submissions" on storage.objects for update to authenticated
using (bucket_id='assignment-submissions' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check (bucket_id='assignment-submissions' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Users can delete their assignment submissions" on storage.objects for delete to authenticated
using (bucket_id='assignment-submissions' and (storage.foldername(name))[1]=(select auth.uid())::text);