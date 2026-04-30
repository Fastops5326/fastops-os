-- FastOps city schema, v1
-- Three tables: sessions (agent work runs), work_items (marketplace), events (append-only log)
-- Wave 1 Model A output — 2026-04-10

-- ============================================================
-- sessions: one row per agent work session
-- Replaces local .fastops/.sessions/*.json files
-- ============================================================
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  task text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  ended_at timestamptz,
  outcome jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sessions_model_status_idx on sessions (model, status);
create index if not exists sessions_created_at_idx on sessions (created_at desc);

-- ============================================================
-- work_items: pull-based marketplace
-- Replaces local .fastops/city-marketplace.json
-- Row-level locking via "claimed_by" + unique constraint gives deterministic claims
-- ============================================================
create table if not exists work_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  status text not null default 'open'
    check (status in ('open', 'claimed', 'in_progress', 'completed', 'failed')),
  claimed_by text,
  claimed_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_items_status_idx on work_items (status);
create index if not exists work_items_claimed_by_idx on work_items (claimed_by);

-- auto-update updated_at on row change
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists work_items_updated_at on work_items;
create trigger work_items_updated_at
  before update on work_items
  for each row execute function set_updated_at();

-- ============================================================
-- events: append-only event log
-- Replaces .fastops/city-ledger.jsonl
-- Never UPDATE or DELETE — insert-only
-- ============================================================
create table if not exists events (
  id bigserial primary key,
  session_id uuid references sessions(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_session_id_idx on events (session_id);
create index if not exists events_event_type_idx on events (event_type);
create index if not exists events_created_at_idx on events (created_at desc);

-- ============================================================
-- Notes
-- ============================================================
-- RLS is intentionally OFF for v1. Service role key only.
-- Enable RLS when anon/browser access is needed (warriorpath, dashboards).
-- Migrations are additive — never drop or alter existing columns here.
-- New changes go in 002_*.sql, 003_*.sql, etc.
