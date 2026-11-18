-- The scheduled Worker reads, updates, and removes expired device subscriptions.
grant select, update, delete on public.push_subscriptions to service_role;
