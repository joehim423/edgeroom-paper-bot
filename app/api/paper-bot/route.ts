type BotStateRow = {
  id: string;
  current_bankroll: number | string;
  starting_bankroll: number | string;
  week_profit: number | string;
  open_exposure: number | string;
  last_run_at: string | null;
  bot_profile: string | null;
};

type BetRow = {
  id: string;
  placed_at: string;
  sport: string | null;
  event: string | null;
  market: string;
  selection: string;
  book: string;
  odds: number | string;
  stake: number | string;
  risk_percent: number | string;
  exact_bet: string | null;
  status: "open" | "won" | "lost" | "push";
  profit: number | string;
};

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function supabaseFetch<T>(path: string) {
  const url = new URL(`/rest/v1/${path}`, process.env.SUPABASE_URL);
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text || response.statusText}`);
  }

  return (text ? JSON.parse(text) : null) as T;
}

function numberValue(value: number | string | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export async function GET() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({
      status: "needs_supabase_env",
      message:
        "Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local so the dashboard can read the cloud bot state.",
      state: null,
    });
  }

  try {
    const [states, bets] = await Promise.all([
      supabaseFetch<BotStateRow[]>("bot_state?id=eq.main&select=*"),
      supabaseFetch<BetRow[]>("paper_bets?select=*&order=placed_at.desc&limit=25"),
    ]);
    const state = states[0];

    if (!state) {
      return jsonResponse({
        status: "empty",
        message: "Supabase is connected, but bot_state has no main row yet.",
        state: null,
      });
    }

    return jsonResponse({
      status: "ok",
      state: {
        botProfile: state.bot_profile ?? "paper",
        botMaxRiskPerBetPercent: 12,
        botMaxDailyRiskPercent: 25,
        startingBankroll: numberValue(state.starting_bankroll),
        currentBankroll: numberValue(state.current_bankroll),
        startedAt: state.last_run_at ?? new Date().toISOString(),
        lastRunAt: state.last_run_at,
        weekProfit: numberValue(state.week_profit),
        openExposure: numberValue(state.open_exposure),
        dailyRuns: [],
        bets: bets.map((bet) => ({
          id: bet.id,
          placedAt: bet.placed_at,
          sport: bet.sport ?? "Sport",
          event: bet.event ?? "Event",
          market: bet.market,
          selection: bet.selection,
          book: bet.book,
          odds: numberValue(bet.odds),
          stake: numberValue(bet.stake),
          riskPercent: numberValue(bet.risk_percent),
          exactBet: bet.exact_bet ?? "",
          status: bet.status,
          profit: numberValue(bet.profit),
        })),
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load paper bot state.",
        state: null,
      },
      500,
    );
  }
}
