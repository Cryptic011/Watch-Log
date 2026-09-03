create table public.watchlog_app_config (
  singleton boolean primary key default true check (singleton),
  maintenance_enabled boolean not null default false,
  maintenance_message text not null default 'Watched Logger is currently under maintenance. Please try again shortly.'
    check (char_length(maintenance_message) between 8 and 240),
  updated_at timestamp with time zone not null default now()
);

alter table public.watchlog_app_config enable row level security;

revoke all on table public.watchlog_app_config from public, anon, authenticated;
grant all on table public.watchlog_app_config to service_role;

insert into public.watchlog_app_config (singleton)
values (true);
