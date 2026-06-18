-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  phone text,
  plan text not null default 'trial',
  credits_remaining int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  engine text,
  status text,
  credits_used int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  plan text not null,
  amount int not null,
  razorpay_order_id text,
  razorpay_payment_id text,
  status text not null default 'created',
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table generations enable row level security;
alter table payments enable row level security;

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles for select using (auth.uid() = id);

drop policy if exists "own generations" on generations;
create policy "own generations" on generations for select using (auth.uid() = user_id);

drop policy if exists "own payments" on payments;
create policy "own payments" on payments for select using (auth.uid() = user_id);

-- Note: the app's server-side API routes use the service_role key, which
-- bypasses these policies for writes (credit deduction, payment activation).
-- The policies above only govern direct client-side reads.
