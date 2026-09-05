-- Reproducible schema for Watched Logger's custom PIN account backend.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.watchlog_pin_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null default 'User',
  pin_hash text not null,
  pin_salt text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.watchlog_pin_library (
  account_id uuid primary key references public.watchlog_pin_accounts(id) on delete cascade,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.watchlog_pin_sessions (
  token_hash text primary key,
  account_id uuid not null references public.watchlog_pin_accounts(id) on delete cascade,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now()
);

create index if not exists watchlog_pin_sessions_account_idx
  on public.watchlog_pin_sessions (account_id);
create index if not exists watchlog_pin_sessions_expiry_idx
  on public.watchlog_pin_sessions (expires_at);

alter table public.watchlog_pin_accounts enable row level security;
alter table public.watchlog_pin_library enable row level security;
alter table public.watchlog_pin_sessions enable row level security;

revoke all on table public.watchlog_pin_accounts from public, anon, authenticated;
revoke all on table public.watchlog_pin_library from public, anon, authenticated;
revoke all on table public.watchlog_pin_sessions from public, anon, authenticated;
grant all on table public.watchlog_pin_accounts to service_role;
grant all on table public.watchlog_pin_library to service_role;
grant all on table public.watchlog_pin_sessions to service_role;
