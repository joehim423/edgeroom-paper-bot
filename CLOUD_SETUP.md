# EdgeRoom Free Cloud Paper Bot

This setup uses only free tiers:

- GitHub Actions runs the bot on a schedule.
- Supabase stores bankroll, bets, and P/L.
- odds-api.io provides odds and final scores.

The bot paper-trades only. It does not place real sportsbook bets.

## GitHub Secrets

Add these in `Settings -> Secrets and variables -> Actions`:

```text
ODDS_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Use the Supabase Project URL for `SUPABASE_URL`.
Use the Supabase `service_role secret` key for `SUPABASE_SERVICE_ROLE_KEY`.

## Supabase SQL

Run this in Supabase SQL Editor:

```sql
create table if not exists bot_state (
  id text primary key,
  current_bankroll numeric not null default 1000,
  starting_bankroll numeric not null default 1000,
  week_profit numeric not null default 0,
  open_exposure numeric not null default 0,
  last_run_at timestamptz,
  bot_profile text default 'aggressive'
);

create table if not exists paper_bets (
  id text primary key,
  event_id text not null,
  placed_at timestamptz not null,
  placed_date date not null,
  sport text,
  event text,
  home text,
  away text,
  commence_time timestamptz,
  market text not null,
  selection text not null,
  book text not null,
  odds numeric not null,
  stake numeric not null,
  risk_percent numeric not null,
  line numeric,
  side text,
  status text not null default 'open',
  profit numeric not null default 0,
  exact_bet text,
  settled_at timestamptz,
  final_score jsonb
);

insert into bot_state (id, current_bankroll, starting_bankroll)
values ('main', 1000, 1000)
on conflict (id) do nothing;
```

## Schedule

The workflow runs at:

- `14:00 UTC` for daily paper picks.
- `04:30 UTC` for settlement checks.

You can also run it manually from the GitHub Actions tab with `Run workflow`.
