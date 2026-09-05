-- Run after the PIN backend migrations, as the database owner. All test data
-- is isolated to one generated account and rolled back when the check ends.
begin;

do $$
declare
  test_account uuid := gen_random_uuid();
  attempt integer;
  outcome record;
  initial_lock timestamptz;
  current_lock timestamptz;
  current_attempts integer;
begin
  insert into public.watchlog_pin_accounts
    (id, email, display_name, pin_hash, pin_salt)
  values
    (test_account, test_account::text || '@lockout-test.invalid', 'Lockout test', 'test-hash', 'test-salt');

  for attempt in 1..4 loop
    select * into outcome from public.watchlog_record_pin_failure(test_account, 5, 15);
    assert not outcome.locked, 'Account locked before the fifth failed attempt';
    assert outcome.retry_after = 0, 'Unlocked account has a retry delay';
  end loop;

  select * into outcome from public.watchlog_record_pin_failure(test_account, 5, 15);
  assert outcome.locked, 'Fifth failed attempt did not lock the account';
  assert outcome.retry_after between 899 and 900, 'Initial lock does not last fifteen minutes';
  select locked_until into initial_lock from public.watchlog_pin_accounts where id = test_account;

  -- Requests that started before the fifth result may reach the RPC after it.
  -- They must neither clear nor prolong the active lock.
  for attempt in 1..12 loop
    select * into outcome from public.watchlog_record_pin_failure(test_account, 5, 15);
    assert outcome.locked, 'A later in-flight failed attempt cleared the active lock';
    select locked_until into current_lock from public.watchlog_pin_accounts where id = test_account;
    assert current_lock = initial_lock, 'A later failed attempt extended the active lock';
  end loop;

  update public.watchlog_pin_accounts
     set failed_attempts = 0, locked_until = null
   where id = test_account
     and pin_hash = 'test-hash' and pin_salt = 'test-salt'
     and (locked_until is null or locked_until <= clock_timestamp());
  assert not found, 'A successful request started earlier could clear a new lock';

  update public.watchlog_pin_accounts
     set locked_until = clock_timestamp() - interval '1 minute'
   where id = test_account;
  select * into outcome from public.watchlog_record_pin_failure(test_account, 5, 15);
  select failed_attempts into current_attempts from public.watchlog_pin_accounts where id = test_account;
  assert not outcome.locked, 'An expired lock did not allow the next attempt';
  assert current_attempts = 1, 'The counter did not restart after the lock expired';

  assert not has_function_privilege('anon', 'public.watchlog_record_pin_failure(uuid,integer,integer)', 'execute'),
    'Anonymous users can alter PIN failure counters';
  assert not has_function_privilege('authenticated', 'public.watchlog_record_pin_failure(uuid,integer,integer)', 'execute'),
    'Ordinary authenticated users can alter PIN failure counters';
  assert has_function_privilege('service_role', 'public.watchlog_record_pin_failure(uuid,integer,integer)', 'execute'),
    'The backend service role cannot record PIN failures';
end
$$;

rollback;
