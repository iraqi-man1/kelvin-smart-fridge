-- Kelvin database schema (PostgreSQL / Supabase).
-- The server creates these tables by itself on first start; this file is for reference,
-- or to create them by hand in the Supabase SQL editor.
create table if not exists kelvin_users (
  id uuid primary key,
  email text not null unique,
  password text not null,
  created_at bigint not null,
  name text not null default '',
  student_id text not null default '',
  university text not null default '',
  faculty text not null default '',
  phone text not null default '',
  bio text not null default '',
  lock_code text,
  avatar_type text,
  avatar_version bigint
);
create table if not exists kelvin_sessions (
  hash text primary key,
  user_id uuid not null references kelvin_users(id) on delete cascade,
  expires bigint not null,
  locked boolean not null default false
);
create index if not exists kelvin_sessions_user_idx on kelvin_sessions (user_id);
create table if not exists kelvin_avatars (
  user_id uuid primary key references kelvin_users(id) on delete cascade,
  type text not null,
  data bytea not null
);
create table if not exists kelvin_readings (
  id uuid primary key,
  ts bigint not null,
  temperature double precision not null,
  humidity double precision not null,
  eco2 integer not null,
  tvoc integer not null,
  device_id text not null,
  rssi integer,
  uptime bigint
);
create index if not exists kelvin_readings_ts_idx on kelvin_readings (ts desc);
create table if not exists kelvin_settings (
  key text primary key,
  value jsonb not null,
  updated_at bigint not null
);
alter table kelvin_users enable row level security;
alter table kelvin_sessions enable row level security;
alter table kelvin_avatars enable row level security;
alter table kelvin_readings enable row level security;
alter table kelvin_settings enable row level security;
