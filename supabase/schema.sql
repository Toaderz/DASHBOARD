-- ============================================================
-- Evolve Dashboard — Supabase Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. PROFILES
-- Auto-populated via trigger when a user signs up
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz default now()
);

-- 2. ASSETS METADATA (global catalog, no RLS user restriction)
create table if not exists assets_metadata (
  ticker text primary key,
  name text not null,
  type text not null check (type in ('stock', 'etf', 'index', 'fund', 'crypto')),
  sector text,
  region text,
  industry text,
  updated_at timestamptz default now()
);

-- 3. WATCHLISTS
create table if not exists watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text,
  selected_metrics jsonb not null default '["1D","1W","1M","YTD","marketCap"]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4. WATCHLIST ASSETS (join table)
create table if not exists watchlist_assets (
  watchlist_id uuid not null references watchlists(id) on delete cascade,
  asset_ticker text not null references assets_metadata(ticker) on delete cascade,
  added_at timestamptz default now(),
  primary key (watchlist_id, asset_ticker)
);

-- 5. PRICE CACHE (shared across users, TTL enforced in app layer)
create table if not exists price_cache (
  ticker text primary key,
  price numeric,
  change_percent numeric,
  volume bigint,
  high_52w numeric,
  low_52w numeric,
  last_updated timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles enable row level security;
alter table watchlists enable row level security;
alter table watchlist_assets enable row level security;
alter table assets_metadata enable row level security;
alter table price_cache enable row level security;

-- profiles: users can only read/write their own profile
create policy "own profile select" on profiles
  for select using (auth.uid() = id);

create policy "own profile insert" on profiles
  for insert with check (auth.uid() = id);

create policy "own profile update" on profiles
  for update using (auth.uid() = id);

-- watchlists: users can only access their own
create policy "own watchlists" on watchlists
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- watchlist_assets: access via watchlists ownership
create policy "own watchlist assets" on watchlist_assets
  for all using (
    exists (
      select 1 from watchlists w
      where w.id = watchlist_id and w.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from watchlists w
      where w.id = watchlist_id and w.user_id = auth.uid()
    )
  );

-- assets_metadata: public read, authenticated users can insert new tickers
create policy "public read assets" on assets_metadata
  for select using (true);

create policy "auth users insert assets" on assets_metadata
  for insert with check (auth.uid() is not null);

-- price_cache: public read, writes only via service role
create policy "public read cache" on price_cache
  for select using (true);

-- ============================================================
-- TRIGGER: auto-create profile on signup
-- ============================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- SEED: sample assets for testing
-- ============================================================

insert into assets_metadata (ticker, name, type, sector, region, industry) values
  ('AAPL', 'Apple Inc.', 'stock', 'Technology', 'US', 'Consumer Electronics'),
  ('MSFT', 'Microsoft Corporation', 'stock', 'Technology', 'US', 'Software'),
  ('GOOGL', 'Alphabet Inc.', 'stock', 'Technology', 'US', 'Internet Services'),
  ('AMZN', 'Amazon.com Inc.', 'stock', 'Consumer Discretionary', 'US', 'E-Commerce'),
  ('NVDA', 'NVIDIA Corporation', 'stock', 'Technology', 'US', 'Semiconductors'),
  ('TSLA', 'Tesla Inc.', 'stock', 'Consumer Discretionary', 'US', 'Electric Vehicles'),
  ('META', 'Meta Platforms Inc.', 'stock', 'Technology', 'US', 'Social Media'),
  ('SPY', 'SPDR S&P 500 ETF Trust', 'etf', 'Diversified', 'US', 'Large Cap Blend'),
  ('QQQ', 'Invesco QQQ Trust', 'etf', 'Technology', 'US', 'Large Cap Growth'),
  ('VTI', 'Vanguard Total Stock Market ETF', 'etf', 'Diversified', 'US', 'Total Market'),
  ('^GSPC', 'S&P 500', 'index', 'Diversified', 'US', 'Market Index'),
  ('^DJI', 'Dow Jones Industrial Average', 'index', 'Diversified', 'US', 'Market Index'),
  ('^IXIC', 'NASDAQ Composite', 'index', 'Technology', 'US', 'Market Index'),
  ('BRK-B', 'Berkshire Hathaway Inc.', 'stock', 'Financials', 'US', 'Insurance & Holding'),
  ('JNJ', 'Johnson & Johnson', 'stock', 'Healthcare', 'US', 'Pharmaceuticals'),
  ('JPM', 'JPMorgan Chase & Co.', 'stock', 'Financials', 'US', 'Banking')
on conflict (ticker) do nothing;
