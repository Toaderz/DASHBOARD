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
  benchmark text,
  manager text,
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
-- PK is surrogate; unique constraint uses NULLS NOT DISTINCT so:
--   • user lists (category IS NULL): same ticker blocked (NULL = NULL)
--   • team seed lists (category set): same ticker in different categories allowed
create table if not exists watchlist_assets (
  id           bigserial,
  watchlist_id uuid not null references watchlists(id) on delete cascade,
  asset_ticker text not null references assets_metadata(ticker) on delete cascade,
  category     text,
  sort_order   integer,
  added_at     timestamptz default now(),
  primary key (id),
  constraint watchlist_assets_unique unique nulls not distinct (watchlist_id, asset_ticker, category)
);

-- 5. PRICE CACHE (shared across users, TTL enforced in app layer)
create table if not exists price_cache (
  ticker                 text primary key,
  price                  numeric,
  change_percent         numeric,
  volume                 bigint,
  high_52w               numeric,
  low_52w                numeric,
  last_updated           timestamptz default now(),
  -- fundamentals (populated by fetchFundamentals via yahoo-finance2)
  market_cap             numeric,
  pe                     numeric,
  dividend_yield         numeric,
  expense_ratio          numeric,
  aum                    numeric,
  beta                   numeric,
  profit_margins         numeric,
  nav                    numeric,
  sector                 text,
  industry               text,
  fund_family            text,
  alpha                  numeric,
  r_squared              numeric,
  std_dev                numeric,
  sharpe                 numeric,
  treynor                numeric,
  sector_weightings      jsonb,
  top_holdings           jsonb,
  fundamentals_fetched_at timestamptz
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

-- ============================================================
-- DEFAULT WATCHLISTS: First Trust
-- ============================================================

create or replace function seed_first_trust_watchlist(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watchlist_id uuid;
begin
  if exists (select 1 from watchlists where user_id = p_user_id and name = 'First Trust') then
    return;
  end if;

  insert into watchlists (user_id, name, description, selected_metrics)
  values (
    p_user_id,
    'First Trust',
    'First Trust ETF lineup',
    '["1D","1W","1M","YTD","1Y","3Y","5Y","MAX","dividendYield","marketCap"]'::jsonb
  )
  returning id into v_watchlist_id;

  insert into assets_metadata (ticker, name, type, sector, region) values
    -- Factores
    ('DDIV','First Trust Dorsey Wright Momentum & Dividend ETF','etf','Equity','US'),
    ('TDIV','First Trust NASDAQ Technology Dividend Index Fund','etf','Technology','US'),
    ('FYC','First Trust Small Cap Growth AlphaDEX Fund','etf','Equity','US'),
    ('FAD','First Trust Multi Cap Growth AlphaDEX Fund','etf','Equity','US'),
    ('FTC','First Trust Large Cap Growth AlphaDEX Fund','etf','Equity','US'),
    ('SHRY','First Trust Bloomberg Shareholder Yield ETF','etf','Equity','US'),
    ('FDL','First Trust Morningstar Dividend Leaders Index Fund','etf','Equity','US'),
    ('FNY','First Trust Mid Cap Growth AlphaDEX Fund','etf','Equity','US'),
    ('RDVY','First Trust Rising Dividend Achievers ETF','etf','Equity','US'),
    ('KNGZ','First Trust S&P 500 Diversified Dividend Aristocrats ETF','etf','Equity','US'),
    ('FEX','First Trust Large Cap Core AlphaDEX Fund','etf','Equity','US'),
    ('FVD','First Trust Value Line Dividend Index Fund','etf','Equity','US'),
    ('FTDS','First Trust Dividend Strength ETF','etf','Equity','US'),
    ('SDVY','First Trust SMID Cap Rising Dividend Achievers ETF','etf','Equity','US'),
    ('FNX','First Trust Mid Cap Core AlphaDEX Fund','etf','Equity','US'),
    ('FTA','First Trust Large Cap Value AlphaDEX Fund','etf','Equity','US'),
    ('FYX','First Trust Small Cap Core AlphaDEX Fund','etf','Equity','US'),
    ('FCFY','First Trust S&P 500 Diversified Free Cash Flow ETF','etf','Equity','US'),
    ('FGD','First Trust Dow Jones Global Select Dividend Index Fund','etf','Equity','Global'),
    ('FID','First Trust S&P International Dividend Aristocrats ETF','etf','Equity','International'),
    ('FAB','First Trust Multi Cap Value AlphaDEX Fund','etf','Equity','US'),
    ('FNK','First Trust Mid Cap Value AlphaDEX Fund','etf','Equity','US'),
    ('FDD','First Trust STOXX European Select Dividend Index Fund','etf','Equity','Europe'),
    ('FYT','First Trust Small Cap Value AlphaDEX Fund','etf','Equity','US'),
    -- Temáticos
    ('FDNI','First Trust Dow Jones International Internet ETF','etf','Technology','International'),
    ('FDN','First Trust Dow Jones Internet Index Fund','etf','Technology','US'),
    ('LEGR','First Trust Indxx Innovative Transaction & Process ETF','etf','Technology','Global'),
    ('CIBR','First Trust Nasdaq Cybersecurity ETF','etf','Technology','US'),
    ('FTXL','First Trust Nasdaq Semiconductor ETF','etf','Technology','US'),
    ('AIRR','First Trust RBA American Industrial Renaissance ETF','etf','Industrials','US'),
    ('ISHP','First Trust S-Network E-Commerce ETF','etf','Consumer Discretionary','Global'),
    ('SKYY','First Trust Cloud Computing ETF','etf','Technology','US'),
    ('RBLD','First Trust Alerian U.S. NextGen Infrastructure ETF','etf','Utilities','US'),
    ('GRID','First Trust NASDAQ Clean Edge Smart Grid Infrastructure Index Fund','etf','Utilities','US'),
    ('FIW','First Trust Water ETF','etf','Utilities','US'),
    ('NXTG','First Trust Indxx NextG ETF','etf','Technology','Global'),
    ('FBT','First Trust NYSE Arca Biotechnology Index Fund','etf','Healthcare','US'),
    ('BNGE','First Trust S-Network Streaming & Gaming ETF','etf','Communication Services','Global'),
    ('ARVR','First Trust Indxx Metaverse ETF','etf','Technology','Global'),
    ('FTXH','First Trust Nasdaq Pharmaceuticals ETF','etf','Healthcare','US'),
    ('MDEV','First Trust Indxx Medical Devices ETF','etf','Healthcare','Global'),
    ('EKG','First Trust Nasdaq Lux Digital Health Solutions ETF','etf','Healthcare','US'),
    ('FTRI','First Trust Indxx Global Natural Resources Income ETF','etf','Materials','Global'),
    ('FAN','First Trust Global Wind Energy ETF','etf','Utilities','Global'),
    ('CARZ','First Trust S-Network Future Vehicles & Technology ETF','etf','Consumer Discretionary','Global'),
    ('FTAG','First Trust Indxx Global Agriculture ETF','etf','Materials','Global'),
    ('ROBT','First Trust Nasdaq Artificial Intelligence and Robotics ETF','etf','Technology','Global'),
    ('DTRE','First Trust Alerian Disruptive Technology Real Estate ETF','etf','Real Estate','US'),
    ('QCLN','First Trust NASDAQ Clean Edge Green Energy Index Fund','etf','Utilities','US'),
    -- Sector Industry Funds
    ('FTXG','First Trust Nasdaq Food & Beverage ETF','etf','Consumer Staples','US'),
    ('FCG','First Trust Natural Gas ETF','etf','Energy','US'),
    ('FTXN','First Trust Nasdaq Oil & Gas ETF','etf','Energy','US'),
    ('QABA','First Trust NASDAQ ABA Community Bank Index Fund','etf','Financials','US'),
    ('FTXO','First Trust Nasdaq Bank ETF','etf','Financials','US'),
    ('FTXR','First Trust Nasdaq Transportation ETF','etf','Industrials','US'),
    ('FRI','First Trust S&P REIT Index Fund','etf','Real Estate','US'),
    ('QTEC','First Trust NASDAQ-100-Technology Sector Index Fund','etf','Technology','US'),
    ('MISL','First Trust Indxx Aerospace & Defense ETF','etf','Industrials','US'),
    -- AlphaDex Global International
    ('FDT','First Trust Developed Markets ex-US AlphaDEX Fund','etf','Equity','International'),
    ('FDTS','First Trust Developed Markets ex-US Small Cap AlphaDEX Fund','etf','Equity','International'),
    ('FEM','First Trust Emerging Markets AlphaDEX Fund','etf','Equity','Emerging Markets'),
    ('FEMS','First Trust Emerging Markets Small Cap AlphaDEX Fund','etf','Equity','Emerging Markets'),
    ('FPA','First Trust Asia Pacific ex-Japan AlphaDEX Fund','etf','Equity','Asia Pacific'),
    ('FEP','First Trust Europe AlphaDEX Fund','etf','Equity','Europe'),
    ('FEUZ','First Trust Eurozone AlphaDEX ETF','etf','Equity','Europe'),
    ('FCA','First Trust China AlphaDEX Fund','etf','Equity','China'),
    ('FGM','First Trust Germany AlphaDEX Fund','etf','Equity','Europe'),
    ('FJP','First Trust Japan AlphaDEX Fund','etf','Equity','Japan'),
    -- Global International
    ('RNEM','First Trust Emerging Markets Eq Sel ETF','etf','Equity','Emerging Markets'),
    ('IFV','First Trust Dorsey Wright Intl Focus 5','etf','Equity','International'),
    ('NFTY','First Trust India NIFTY 50 Equal Weighted ETF','etf','Equity','India'),
    ('FICS','First Trust Intl Developed Cap Strength ETF','etf','Equity','International'),
    ('FPXI','First Trust International Equity Opportunities ETF','etf','Equity','International'),
    ('FPXE','First Trust IPOX Europe Equity Opportunities ETF','etf','Equity','Europe'),
    ('EMDM','First Trust Bloomberg Emerging Market Democratic ETF','etf','Equity','Emerging Markets'),
    ('FTHF','First Trust EM Human Flourishing ETF','etf','Equity','Emerging Markets')
  on conflict (ticker) do nothing;

  insert into watchlist_assets (watchlist_id, asset_ticker, category, sort_order) values
    -- Factores
    (v_watchlist_id,'DDIV','Factores',100),
    (v_watchlist_id,'TDIV','Factores',101),
    (v_watchlist_id,'FYC','Factores',102),
    (v_watchlist_id,'FAD','Factores',103),
    (v_watchlist_id,'FTC','Factores',104),
    (v_watchlist_id,'SHRY','Factores',105),
    (v_watchlist_id,'FDL','Factores',106),
    (v_watchlist_id,'FNY','Factores',107),
    (v_watchlist_id,'RDVY','Factores',108),
    (v_watchlist_id,'KNGZ','Factores',109),
    (v_watchlist_id,'FEX','Factores',110),
    (v_watchlist_id,'FVD','Factores',111),
    (v_watchlist_id,'FTDS','Factores',112),
    (v_watchlist_id,'SDVY','Factores',113),
    (v_watchlist_id,'FNX','Factores',114),
    (v_watchlist_id,'FTA','Factores',115),
    (v_watchlist_id,'FYX','Factores',116),
    (v_watchlist_id,'FCFY','Factores',117),
    (v_watchlist_id,'FGD','Factores',118),
    (v_watchlist_id,'FID','Factores',119),
    (v_watchlist_id,'FAB','Factores',120),
    (v_watchlist_id,'FNK','Factores',121),
    (v_watchlist_id,'FDD','Factores',122),
    (v_watchlist_id,'FYT','Factores',123),
    -- Temáticos
    (v_watchlist_id,'FDNI','Temáticos',200),
    (v_watchlist_id,'FDN','Temáticos',201),
    (v_watchlist_id,'LEGR','Temáticos',202),
    (v_watchlist_id,'CIBR','Temáticos',203),
    (v_watchlist_id,'FTXL','Temáticos',204),
    (v_watchlist_id,'AIRR','Temáticos',205),
    (v_watchlist_id,'ISHP','Temáticos',206),
    (v_watchlist_id,'SKYY','Temáticos',207),
    (v_watchlist_id,'RBLD','Temáticos',208),
    (v_watchlist_id,'GRID','Temáticos',209),
    (v_watchlist_id,'FIW','Temáticos',210),
    (v_watchlist_id,'NXTG','Temáticos',211),
    (v_watchlist_id,'FBT','Temáticos',212),
    (v_watchlist_id,'BNGE','Temáticos',213),
    (v_watchlist_id,'ARVR','Temáticos',214),
    (v_watchlist_id,'FTXH','Temáticos',215),
    (v_watchlist_id,'MDEV','Temáticos',216),
    (v_watchlist_id,'EKG','Temáticos',217),
    (v_watchlist_id,'FTRI','Temáticos',218),
    (v_watchlist_id,'FAN','Temáticos',219),
    (v_watchlist_id,'CARZ','Temáticos',220),
    (v_watchlist_id,'FTAG','Temáticos',221),
    (v_watchlist_id,'ROBT','Temáticos',222),
    (v_watchlist_id,'DTRE','Temáticos',223),
    (v_watchlist_id,'QCLN','Temáticos',224),
    -- Sector Industry Funds
    (v_watchlist_id,'FTXG','Sector Industry Funds',300),
    (v_watchlist_id,'FCG','Sector Industry Funds',301),
    (v_watchlist_id,'FTXN','Sector Industry Funds',302),
    (v_watchlist_id,'QABA','Sector Industry Funds',303),
    (v_watchlist_id,'FTXO','Sector Industry Funds',304),
    (v_watchlist_id,'FTXR','Sector Industry Funds',305),
    (v_watchlist_id,'FRI','Sector Industry Funds',306),
    (v_watchlist_id,'QTEC','Sector Industry Funds',307),
    (v_watchlist_id,'MISL','Sector Industry Funds',308),
    -- AlphaDex Global International
    (v_watchlist_id,'FDT','AlphaDex Global International',400),
    (v_watchlist_id,'FDTS','AlphaDex Global International',401),
    (v_watchlist_id,'FEM','AlphaDex Global International',402),
    (v_watchlist_id,'FEMS','AlphaDex Global International',403),
    (v_watchlist_id,'FPA','AlphaDex Global International',404),
    (v_watchlist_id,'FEP','AlphaDex Global International',405),
    (v_watchlist_id,'FEUZ','AlphaDex Global International',406),
    (v_watchlist_id,'FCA','AlphaDex Global International',407),
    (v_watchlist_id,'FGM','AlphaDex Global International',408),
    (v_watchlist_id,'FJP','AlphaDex Global International',409),
    -- Global International
    (v_watchlist_id,'RNEM','Global International',500),
    (v_watchlist_id,'IFV','Global International',501),
    (v_watchlist_id,'NFTY','Global International',502),
    (v_watchlist_id,'FICS','Global International',503),
    (v_watchlist_id,'FPXI','Global International',504),
    (v_watchlist_id,'FPXE','Global International',505),
    (v_watchlist_id,'EMDM','Global International',506),
    (v_watchlist_id,'FTHF','Global International',507)
  on conflict on constraint watchlist_assets_unique do nothing;
end;
$$;

-- ============================================================
-- DEFAULT WATCHLISTS: Evolve Universe
-- ============================================================
-- CT funds added with Yahoo Finance tickers:
--   0P0000NCAC     = CT (Lux) Global Tech DU             (LU0444973449)
--   0P00000R12.L   = CT Japan Institutional Acc          (GB0001448678)
--   0P00000R0U.L   = CT European Select Ins Acc GBP      (GB0001445229)
--   0P0001CZXM.L   = CT Global Focus Q Ins Grs Acc GBP   (GB00BF0Q8L92)
--   0P00000XBQ.L   = CT North American Systematic Eq 2 Acc
-- Replaced non-working indices with ETF equivalents:
--   ^SML → IJR, ^TOPX → EWJ
-- Duplicate tickers across categories are intentional (allowed by
--   watchlist_assets_unique constraint that includes category).

create or replace function seed_evolve_universe_watchlist(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $seed_eu$
declare
  v_watchlist_id uuid;
begin
  if exists (select 1 from watchlists where user_id = p_user_id and name = 'Evolve Universe') then
    return;
  end if;

  insert into watchlists (user_id, name, description, selected_metrics)
  values (
    p_user_id,
    'Evolve Universe',
    'Benchmarks and funds across global categories',
    '["1D","1W","1M","YTD","1Y","3Y","5Y","MAX","dividendYield","expenseRatio","aum"]'::jsonb
  )
  returning id into v_watchlist_id;

  insert into assets_metadata (ticker, name, type, sector, region) values
    ('PSH',   'Pershing Square Holdings Ord',                        'stock', 'Financials',       'UK'),
    ('HHH',   'Howard Hughes Holdings Inc',                          'stock', 'Real Estate',      'US'),
    ('IJR',         'iShares Core S&P Small-Cap ETF',                      'etf',  'Equity',     'US'),
    ('RECS',        'Columbia Research Enhanced Core ETF',                 'etf',  'Equity',     'US'),
    ('0P0000NCAC',  'CT (Lux) Global Tech DU',                            'fund', 'Technology', 'Luxembourg'),
    ('0P00000R12.L',   'CT Japan Institutional Acc',                      'fund', 'Equity',     'Japan'),
    ('0P00000R0U.L',   'CT European Select Ins Acc GBP',                  'fund', 'Equity',     'Europe'),
    ('0P00000XBQ.L',   'CT North American Systematic Eq 2 Acc',           'fund', 'Equity',     'US'),
    ('0P0001CZXM.L',  'CT Global Focus Q Ins Grs Acc GBP',               'fund', 'Equity',     'Global'),
    ('FAI',   'First Trust Bloomberg Artificial Intelligence ETF',   'etf',   'Technology',       'US'),
    ('ACWI',  'iShares MSCI ACWI ETF',                               'etf',   'Equity',           'Global'),
    ('EWJ',   'iShares MSCI Japan ETF',                              'etf',   'Equity',           'Japan'),
    ('DXJ',   'WisdomTree Japan Equity ETF USD Hedged',              'etf',   'Equity',           'Japan'),
    ('IEUR',  'iShares Core MSCI Europe ETF',                        'etf',   'Equity',           'Europe'),
    ('VGK',   'Vanguard FTSE Europe ETF',                            'etf',   'Equity',           'Europe'),
    ('XCEM',  'Columbia EM Core ex-China ETF',                       'etf',   'Equity',           'Emerging Markets'),
    ('EMXC',  'iShares MSCI Emerging Mkts ex China ETF',             'etf',   'Equity',           'Emerging Markets'),
    ('MCHI',  'iShares MSCI China ETF',                              'etf',   'Equity',           'China')
  on conflict (ticker) do nothing;

  insert into watchlist_assets (watchlist_id, asset_ticker, category, sort_order) values
    -- US
    (v_watchlist_id, 'PSH',   'US',                         100),
    (v_watchlist_id, 'HHH',   'US',                         101),
    (v_watchlist_id, '^GSPC', 'US',                         102),
    (v_watchlist_id, 'RECS',  'US',                         103),
    (v_watchlist_id, 'RDVY',  'US',                         104),
    (v_watchlist_id, '0P00000XBQ.L', 'US',                105),
    -- US SMALL CAPS
    (v_watchlist_id, 'SDVY',  'US SMALL CAPS',              200),
    (v_watchlist_id, '^RUT',  'US SMALL CAPS',              201),
    (v_watchlist_id, 'IJR',   'US SMALL CAPS',              202),
    -- TECH
    (v_watchlist_id, 'CIBR',         'TECH',                300),
    (v_watchlist_id, '^IXIC',        'TECH',                301),
    (v_watchlist_id, 'FAI',          'TECH',                302),
    (v_watchlist_id, '0P0000NCAC',   'TECH',                303),
    -- THEMATICS (^GSPC, CIBR, FAI, 0P0000NCAC intentionally repeated from other categories)
    (v_watchlist_id, '^GSPC',        'THEMATICS',           400),
    (v_watchlist_id, 'CIBR',         'THEMATICS',           401),
    (v_watchlist_id, 'GRID',         'THEMATICS',           402),
    (v_watchlist_id, 'FAI',          'THEMATICS',           403),
    (v_watchlist_id, 'ACWI',         'THEMATICS',           404),
    (v_watchlist_id, '0P0000NCAC',   'THEMATICS',           405),
    (v_watchlist_id, '0P0001CZXM.L', 'THEMATICS',           406),
    -- JAPAN
    (v_watchlist_id, 'FJP',              'JAPAN',           500),
    (v_watchlist_id, 'EWJ',              'JAPAN',           501),
    (v_watchlist_id, 'DXJ',              'JAPAN',           502),
    (v_watchlist_id, '0P00000R12.L',      'JAPAN',           503),
    -- EUROPA
    (v_watchlist_id, 'FEP',              'EUROPA',          600),
    (v_watchlist_id, 'IEUR',             'EUROPA',          601),
    (v_watchlist_id, 'VGK',              'EUROPA',          602),
    (v_watchlist_id, '0P00000R0U.L',      'EUROPA',          603),
    -- EMERGING MARKETS EX CHINA
    (v_watchlist_id, 'XCEM',  'EMERGING MARKETS EX CHINA',  700),
    (v_watchlist_id, 'EMXC',  'EMERGING MARKETS EX CHINA',  701),
    -- CHINA
    (v_watchlist_id, 'MCHI',  'CHINA',                      800)
  on conflict on constraint watchlist_assets_unique do nothing;
end;
$seed_eu$;

-- Trigger: seed default watchlists for every new user
create or replace function handle_new_user_default_watchlists()
returns trigger
language plpgsql
security definer
set search_path = public
as $trigger_seed$
begin
  perform seed_first_trust_watchlist(new.id);
  perform seed_evolve_universe_watchlist(new.id);
  return new;
end;
$trigger_seed$;

drop trigger if exists on_profile_created_seed_watchlists on profiles;
create trigger on_profile_created_seed_watchlists
  after insert on profiles
  for each row execute function handle_new_user_default_watchlists();

-- ============================================================
-- MIGRATION + BACKFILL (run in Supabase SQL Editor in this order)
-- ============================================================
-- Step 1 — Schema migration (once per DB):
--   ALTER TABLE watchlist_assets DROP CONSTRAINT watchlist_assets_pkey;
--   ALTER TABLE watchlist_assets ADD COLUMN IF NOT EXISTS id bigserial;
--   ALTER TABLE watchlist_assets ADD PRIMARY KEY (id);
--   ALTER TABLE watchlist_assets DROP CONSTRAINT IF EXISTS watchlist_assets_unique;
--   ALTER TABLE watchlist_assets ADD CONSTRAINT watchlist_assets_unique
--     UNIQUE NULLS NOT DISTINCT (watchlist_id, asset_ticker, category);
--
-- Step 2 — Deploy updated seed function (paste $seed_eu$ block above).
--
-- Step 3 — Backfill existing users (drops old list, re-seeds corrected one):
--   DELETE FROM watchlists WHERE name = 'Evolve Universe';
--   SELECT seed_evolve_universe_watchlist(id) FROM profiles;
--
-- Step 4 — Currency column (run once):
--   ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS currency text;
-- ============================================================
