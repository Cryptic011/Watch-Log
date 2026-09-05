-- Optimistic concurrency prevents one device from silently replacing changes
-- made on another device from an older copy of the library.
alter table public.watchlog_pin_library
  add column if not exists revision bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.watchlog_pin_library'::regclass
      and conname = 'watchlog_pin_library_revision_nonnegative'
  ) then
    alter table public.watchlog_pin_library
      add constraint watchlog_pin_library_revision_nonnegative check (revision >= 0);
  end if;
end
$$;

-- Increment the failed-PIN counter and lock decision in one statement so
-- simultaneous guesses cannot overwrite each other's increments.
create or replace function public.watchlog_record_pin_failure(
  p_account_id uuid,
  p_max_attempts integer,
  p_lock_minutes integer
)
returns table (locked boolean, retry_after integer)
language sql
volatile
security invoker
set search_path = ''
as $$
  with updated as (
    update public.watchlog_pin_accounts
       set failed_attempts = case
             when locked_until > statement_timestamp() then failed_attempts
             when failed_attempts + 1 >= greatest(1, p_max_attempts) then 0
             else failed_attempts + 1
           end,
           locked_until = case
             -- Another in-flight guess may have locked this row since the
             -- Edge Function read it. Keep that lock, without extending it.
             when locked_until > statement_timestamp() then locked_until
             when failed_attempts + 1 >= greatest(1, p_max_attempts)
               then statement_timestamp() + make_interval(mins => greatest(1, p_lock_minutes))
             else null
           end,
           updated_at = clock_timestamp()
     where id = p_account_id
     returning locked_until
  )
  select
    updated.locked_until is not null and updated.locked_until > statement_timestamp(),
    greatest(0, ceil(extract(epoch from (updated.locked_until - statement_timestamp())))::integer)
  from updated;
$$;

revoke all on function public.watchlog_record_pin_failure(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.watchlog_record_pin_failure(uuid, integer, integer) to service_role;
