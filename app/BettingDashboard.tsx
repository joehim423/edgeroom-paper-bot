"use client";

import { useCallback, useEffect, useState } from "react";

type ApiPick = {
  id: string;
  sport: string;
  event: string;
  commenceTime: string | null;
  market: string;
  selection: string;
  exactBet: string;
  bestBook: string;
  bestOdds: number;
  fairProbability: number;
  edge: number;
  confidence: number;
  booksChecked: number;
  explanation: string;
};

type OddsResponse = {
  status: "ok" | "needs_key" | "needs_bookmakers" | "error";
  message?: string;
  generatedAt?: string;
  selectedBookmakers?: string[];
  sportsScanned?: number;
  eventsScanned?: number;
  offersScanned?: number;
  picks: ApiPick[];
};

type PickResult = {
  id: string;
  status: "open" | "won" | "lost" | "push";
  stake: number;
  settledDate: string;
};

type PaperBotBet = {
  id: string;
  placedAt: string;
  settledAt?: string | null;
  sport: string;
  event: string;
  market: string;
  selection: string;
  book: string;
  odds: number;
  stake: number;
  riskPercent: number;
  exactBet: string;
  status: "open" | "won" | "lost" | "push";
  profit: number;
};

type PaperBotState = {
  botProfile?: string;
  botMaxRiskPerBetPercent?: number;
  botMaxDailyRiskPercent?: number;
  startingBankroll: number;
  currentBankroll: number;
  startedAt: string;
  lastRunAt: string | null;
  weekProfit: number;
  openExposure: number;
  lastError?: string;
  dailyRuns: { date: string; picksAdded: number; botMaxDailyRiskPercent?: number }[];
  bets: PaperBotBet[];
};

type PaperBotResponse = {
  status: "ok" | "needs_supabase_env" | "empty" | "error";
  message?: string;
  state: PaperBotState | null;
};

const STORAGE_KEY = "edgeroom-api-results-v1";
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekDays = ["M", "T", "W", "T", "F", "S", "S"];

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatShortMoney(value: number) {
  if (value === 0) return "$0";
  const prefix = value > 0 ? "+" : "-";
  return `${prefix}$${Math.abs(value).toFixed(2)}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "Time TBA";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayIsoLocal() {
  const today = new Date();
  return isoDate(today.getFullYear(), today.getMonth(), today.getDate());
}

function currentMonthStart() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

function monthStartFromIso(date: string) {
  const [year, month] = date.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function localIsoDateFromTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return isoDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function totalPayout(stake: number, decimal: number) {
  return stake * decimal;
}

function profitPayout(stake: number, decimal: number) {
  return totalPayout(stake, decimal) - stake;
}

function profitFor(pick: ApiPick, result: PickResult) {
  if (result.status === "push" || result.status === "open") return 0;
  if (result.status === "lost") return -result.stake;
  return profitPayout(result.stake, pick.bestOdds);
}

function uniqueBetsById(bets: PaperBotBet[]) {
  return Array.from(new Map(bets.map((bet) => [bet.id, bet])).values());
}

function recommendedStake(pick: ApiPick, bankroll: number, maxRisk: number) {
  const b = pick.bestOdds - 1;
  const kelly = b > 0 ? pick.edge / b : 0;
  const confidenceScale = Math.max(0.25, Math.min(1, pick.confidence / 100));
  const cappedFraction = Math.min(Math.max(kelly * 0.3 * confidenceScale, 0), maxRisk / 100);

  return {
    risk: cappedFraction,
    stake: pick.edge > 0 ? bankroll * cappedFraction : 0,
  };
}

export function BettingDashboard() {
  const [todayIso] = useState(() => todayIsoLocal());
  const [bankroll, setBankroll] = useState(1200);
  const [maxRisk, setMaxRisk] = useState(3);
  const [calendarMonth, setCalendarMonth] = useState(() => currentMonthStart());
  const [data, setData] = useState<OddsResponse>({
    status: "ok",
    picks: [],
  });
  const [paperBot, setPaperBot] = useState<PaperBotState | null>(null);
  const [paperBotMessage, setPaperBotMessage] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, PickResult>>({});
  const [loading, setLoading] = useState(true);

  const loadOdds = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/odds", { cache: "no-store" });
      const nextData = (await response.json()) as OddsResponse;
      setData(nextData);
    } catch (error) {
      setData({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load odds.",
        picks: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOdds();
  }, [loadOdds]);

  useEffect(() => {
    fetch(`/api/paper-bot?ts=${Date.now()}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((response: PaperBotResponse | null) => {
        setPaperBot(response?.state ?? null);
        setPaperBotMessage(response?.message ?? null);
      })
      .catch(() => {
        setPaperBot(null);
        setPaperBotMessage("Unable to load the cloud paper bot state.");
      });
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      setResults(JSON.parse(saved) as Record<string, PickResult>);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  }, [results]);

  const picks = data.picks.slice(0, 5);
  const settledProfit = picks.reduce((total, pick) => {
    const result = results[pick.id];
    return result ? total + profitFor(pick, result) : total;
  }, 0);
  const openExposure = picks.reduce((total, pick) => {
    const result = results[pick.id];
    return result?.status === "open" ? total + result.stake : total;
  }, 0);
  const bestEdge = Math.max(0, ...picks.map((pick) => pick.edge * 100));
  const avgConfidence =
    picks.length === 0
      ? 0
      : picks.reduce((total, pick) => total + pick.confidence, 0) / picks.length;

  function resultFor(pick: ApiPick) {
    return (
      results[pick.id] ?? {
        id: pick.id,
        status: "open",
        stake: Number(recommendedStake(pick, bankroll, maxRisk).stake.toFixed(2)),
        settledDate: todayIso,
      }
    );
  }

  function updateResult(id: string, patch: Partial<PickResult>) {
    setResults((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? { id, status: "open", stake: 0, settledDate: todayIso }),
        ...patch,
      },
    }));
  }

  return (
    <main className="min-h-screen bg-[#080b0a] text-[#eef5ef]">
      <section className="border-b border-[#223027] bg-[#0d1410]">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 md:grid-cols-[1fr_440px] md:px-8">
          <div className="grid content-between gap-6">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#85e0a3]">
                EdgeRoom Live Odds
              </p>
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight md:text-6xl">
                Top 5 API-ranked bets.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[#aab9ad]">
                This compares selected sportsbook prices and sizes stakes from bankroll risk. There is no guaranteed profit, so confirm every line before placing a bet.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <BoardStat label="Best edge" value={`${bestEdge.toFixed(1)}%`} tone={bestEdge > 0 ? "good" : "neutral"} />
              <BoardStat label="Avg trust" value={`${avgConfidence.toFixed(0)}%`} />
              <BoardStat label="Showing" value={`${picks.length}/5`} />
            </div>
          </div>
          <div className="grid gap-4 rounded-lg border border-[#2b3a30] bg-[#121b15] p-5 shadow-2xl shadow-black/30">
            <div className="grid grid-cols-2 gap-3">
              <NumberPanel label="Bankroll" value={bankroll} onChange={setBankroll} />
              <NumberPanel label="Max risk %" value={maxRisk} onChange={setMaxRisk} step={0.25} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Settled P/L" value={formatMoney(settledProfit)} tone={settledProfit >= 0 ? "good" : "bad"} />
              <Metric label="Open risk" value={formatMoney(openExposure)} />
              <Metric label="Net bankroll" value={formatMoney(bankroll + settledProfit)} />
            </div>
            <button
              className="h-11 rounded-md bg-[#46d982] px-4 text-sm font-semibold text-[#07100a] hover:bg-[#79eea6] disabled:cursor-wait disabled:opacity-60"
              disabled={loading}
              onClick={loadOdds}
            >
              {loading ? "Refreshing..." : "Refresh live odds"}
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-6 md:px-8 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-4">
          <PnlCalendar
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            paperBets={paperBot?.bets ?? []}
            picks={picks}
            results={results}
            todayIso={todayIso}
          />

          {data.status === "needs_bookmakers" ? (
            <SetupState
              title="Pick your 2 free sportsbooks"
              body={data.message ?? "Select two bookmakers in odds-api.io before scanning odds."}
            />
          ) : null}

          {data.status === "needs_key" || data.status === "error" ? (
            <SetupState
              title={data.status === "needs_key" ? "API key needed" : "Odds feed unavailable"}
              body={data.message ?? "The odds feed could not be loaded."}
            />
          ) : null}

          {data.status === "ok" && !loading && picks.length === 0 ? (
            <SetupState
              title="No API picks found"
              body="The feed connected, but no comparable lines were returned for the selected sports and bookmakers yet."
            />
          ) : null}

          <div className="grid gap-3">
            {picks.map((pick, index) => {
              const rec = recommendedStake(pick, bankroll, maxRisk);
              const edgePercent = pick.edge * 100;
              const result = resultFor(pick);
              const stake = result.stake || rec.stake;

              return (
                <article
                  className="overflow-hidden rounded-lg border border-[#243129] bg-[#101611] shadow-xl shadow-black/20"
                  key={pick.id}
                >
                  <div className="grid gap-4 border-b border-[#223027] bg-[#121a14] p-4 lg:grid-cols-[1fr_auto]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={edgePercent > 0 ? "badge-good" : "badge-bad"}>
                          #{index + 1} {edgePercent > 0 ? "Best price" : "Watch"}
                        </span>
                        <span className="rounded-full border border-[#2b3038] px-2.5 py-1 text-xs font-semibold text-[#96a49b]">
                          {pick.bestBook}
                        </span>
                        <span className="rounded-full border border-[#2b3038] px-2.5 py-1 text-xs font-semibold text-[#96a49b]">
                          {pick.sport}
                        </span>
                      </div>
                      <h3 className="mt-3 text-2xl font-semibold text-white">
                        {pick.selection}
                      </h3>
                      <p className="mt-1 text-sm text-[#94a298]">
                        {pick.market} · {pick.event} · {formatDateTime(pick.commenceTime)}
                      </p>
                    </div>
                    <div className="grid min-w-48 content-center gap-1 text-right">
                      <p className={edgePercent > 0 ? "text-3xl font-semibold text-[#25f0aa]" : "text-3xl font-semibold text-[#ff2f87]"}>
                        {edgePercent.toFixed(1)}%
                      </p>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7d897f]">
                        Price edge
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 p-4 xl:grid-cols-[1fr_280px]">
                    <div className="grid gap-3">
                      <div className="rounded-md border border-[#46d982] bg-[#102a21] p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8df0b4]">
                          Exact bet
                        </p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {pick.exactBet}
                        </p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-4">
                        <InfoPill label="Best book" value={pick.bestBook} />
                        <InfoPill label="Best odds" value={pick.bestOdds.toFixed(2)} />
                        <InfoPill label="Implied" value={`${(1 / pick.bestOdds * 100).toFixed(1)}%`} />
                        <InfoPill label="Trust" value={`${pick.confidence.toFixed(0)}%`} />
                      </div>
                      <p className="rounded-md border border-[#26352c] bg-[#0c110d] p-3 text-sm leading-6 text-[#abb9af]">
                        {pick.explanation}
                      </p>
                    </div>

                    <div className="grid gap-3 rounded-md border border-[#26352c] bg-[#151f18] p-3">
                      <div className="grid grid-cols-3 gap-2">
                        <InfoPill label="Stake" value={formatMoney(stake)} />
                        <InfoPill label="Profit" value={formatMoney(profitPayout(stake, pick.bestOdds))} />
                        <InfoPill label="Payout" value={formatMoney(totalPayout(stake, pick.bestOdds))} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8fa096]">Suggested stake</p>
                        <p className="text-2xl font-semibold text-white">{formatMoney(rec.stake)}</p>
                        <p className="text-xs text-[#8fa096]">{(rec.risk * 100).toFixed(2)}% bankroll risk</p>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <NumberInput
                          label="Tracked stake $"
                          value={result.stake}
                          onChange={(value) => updateResult(pick.id, { stake: value })}
                        />
                        <button
                          className="self-end rounded-md border border-[#46d982] px-3 text-xs font-semibold text-[#46d982] hover:bg-[#102a21]"
                          onClick={() => updateResult(pick.id, { stake: Number(rec.stake.toFixed(2)) })}
                        >
                          Apply
                        </button>
                      </div>
                      <select
                        className="h-10 rounded-md border border-[#334238] bg-[#080b0a] px-3 text-sm text-white outline-none focus:border-[#46d982]"
                        value={result.status}
                        onChange={(event) =>
                          updateResult(pick.id, { status: event.target.value as PickResult["status"] })
                        }
                      >
                        <option value="open">Open</option>
                        <option value="won">Won</option>
                        <option value="lost">Lost</option>
                        <option value="push">Push</option>
                      </select>
                      <input
                        className="h-10 rounded-md border border-[#334238] bg-[#080b0a] px-3 text-sm font-normal text-[#eef5ef] outline-none focus:border-[#46d982]"
                        type="date"
                        value={result.settledDate}
                        onChange={(event) => updateResult(pick.id, { settledDate: event.target.value })}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-[#243129] bg-[#101611] p-4 shadow-xl shadow-black/20">
            <h2 className="mb-3 text-xl font-semibold">Feed Status</h2>
            <div className="grid gap-3 text-sm">
              <SummaryRow label="Status" value={loading ? "Loading" : data.status} />
              <SummaryRow label="Books" value={(data.selectedBookmakers ?? []).join(", ") || "None selected"} />
              <SummaryRow label="Sports" value={String(data.sportsScanned ?? 0)} />
              <SummaryRow label="Events" value={String(data.eventsScanned ?? 0)} />
              <SummaryRow label="Lines read" value={String(data.offersScanned ?? 0)} />
              <SummaryRow label="Updated" value={data.generatedAt ? formatDateTime(data.generatedAt) : "Not yet"} />
            </div>
          </section>

          <section className="rounded-lg border border-[#243129] bg-[#0d1410] p-4 text-white shadow-xl shadow-black/20">
            <h2 className="mb-3 text-xl font-semibold">Free API Notes</h2>
            <div className="grid gap-3 text-sm text-[#abb9af]">
              <Rule title="Two books" body="odds-api.io free accounts need exactly two recreational books selected before odds endpoints work." />
              <Rule title="Server-side key" body="The API key stays inside .env.local and only the local API route talks to odds-api.io." />
              <Rule title="Risk control" body="Suggested stake uses a capped fractional Kelly style calculation, not a promise of profit." />
            </div>
          </section>

          <PaperBotPanel message={paperBotMessage} state={paperBot} />
        </aside>
      </section>
    </main>
  );
}

function PaperBotPanel({
  message,
  state,
}: {
  message: string | null;
  state: PaperBotState | null;
}) {
  const bets = state ? uniqueBetsById(state.bets).slice().reverse().slice(0, 5) : [];

  return (
    <section className="rounded-lg border border-[#243129] bg-[#101611] p-4 shadow-xl shadow-black/20">
      <h2 className="mb-3 text-xl font-semibold">7-Day Paper Bot</h2>
      {state ? (
        <div className="grid gap-3 text-sm">
          <SummaryRow label="Bankroll" value={formatMoney(state.currentBankroll)} />
          <SummaryRow label="Week P/L" value={formatMoney(state.weekProfit ?? state.currentBankroll - state.startingBankroll)} />
          <SummaryRow label="Open risk" value={formatMoney(state.openExposure ?? 0)} />
          <SummaryRow label="Profile" value={state.botProfile ?? "paper"} />
          <SummaryRow
            label="Risk caps"
            value={`${state.botMaxRiskPerBetPercent ?? 12}% pick / ${state.botMaxDailyRiskPercent ?? 25}% day`}
          />
          <SummaryRow label="Last run" value={state.lastRunAt ? formatDateTime(state.lastRunAt) : "Not yet"} />
          {state.lastError ? (
            <p className="rounded-md border border-[#543141] bg-[#351b29] p-3 text-[#ff8dbb]">
              {state.lastError}
            </p>
          ) : null}
          <div className="grid gap-2">
            {bets.length === 0 ? (
              <p className="rounded-md border border-[#26352c] bg-[#0c110d] p-3 text-[#94a298]">
                No paper bets logged yet. The scheduled bot will add picks on its next run.
              </p>
            ) : (
              bets.map((bet) => (
                <div className="rounded-md border border-[#26352c] bg-[#0c110d] p-3" key={bet.id}>
                  <div className="flex items-center justify-between gap-3">
                    <span className={bet.status === "won" ? "text-[#25f0aa]" : bet.status === "lost" ? "text-[#ff2f87]" : "text-white"}>
                      {bet.status.toUpperCase()}
                    </span>
                    <span className="text-[#94a298]">{formatMoney(bet.stake)}</span>
                  </div>
                  <p className="mt-2 font-semibold text-white">{bet.selection}</p>
                  <p className="mt-1 text-xs leading-5 text-[#94a298]">
                    {bet.market} · {bet.event} · {bet.book} @ {bet.odds.toFixed(2)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <p className="rounded-md border border-[#26352c] bg-[#0c110d] p-3 text-sm leading-6 text-[#94a298]">
          {message ?? "The cloud bot state has not been created yet. Run the GitHub workflow once or wait for the scheduled task."}
        </p>
      )}
    </section>
  );
}

function PnlCalendar({
  month,
  onMonthChange,
  paperBets,
  picks,
  results,
  todayIso,
}: {
  month: Date;
  onMonthChange: (date: Date) => void;
  paperBets: PaperBotBet[];
  picks: ApiPick[];
  results: Record<string, PickResult>;
  todayIso: string;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(todayIso);
  const uniquePaperBets = uniqueBetsById(paperBets);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstDayOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const dailyPnl = new Map<string, number>();
  const paperBetsByDate = new Map<string, PaperBotBet[]>();

  picks.forEach((pick) => {
    const result = results[pick.id];
    if (!result || result.status === "open" || !result.settledDate) return;
    dailyPnl.set(result.settledDate, (dailyPnl.get(result.settledDate) ?? 0) + profitFor(pick, result));
  });

  uniquePaperBets.forEach((bet) => {
    if (bet.status === "open") return;
    const date = localIsoDateFromTimestamp(bet.settledAt ?? bet.placedAt);
    dailyPnl.set(date, (dailyPnl.get(date) ?? 0) + bet.profit);
  });

  uniquePaperBets.forEach((bet) => {
    const date = localIsoDateFromTimestamp(bet.settledAt ?? bet.placedAt);
    paperBetsByDate.set(date, [...(paperBetsByDate.get(date) ?? []), bet]);
  });

  const monthValues = Array.from({ length: daysInMonth }, (_, index) => {
    const date = isoDate(year, monthIndex, index + 1);
    return dailyPnl.get(date) ?? 0;
  });
  const selectedBets = selectedDate ? (paperBetsByDate.get(selectedDate) ?? []) : [];
  const monthTotal = monthValues.reduce((total, value) => total + value, 0);
  const positiveDays = monthValues.filter((value) => value > 0).length;
  const negativeDays = monthValues.filter((value) => value < 0).length;
  const bestPositiveStreak = monthValues.reduce(
    (state, value) => {
      const current = value > 0 ? state.current + 1 : 0;
      return { current, best: Math.max(state.best, current) };
    },
    { current: 0, best: 0 },
  ).best;

  return (
    <section className="overflow-hidden rounded-lg border border-[#2b3038] bg-[#141517] shadow-2xl shadow-black/30">
      <div className="flex items-center justify-between gap-3 border-b border-[#252932] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-white">PNL Calendar</h2>
          <p className={monthTotal >= 0 ? "mt-3 text-sm font-semibold text-[#25f0aa]" : "mt-3 text-sm font-semibold text-[#ff2f87]"}>
            {formatShortMoney(monthTotal)}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <button
            aria-label="Previous month"
            className="grid h-8 w-8 place-items-center rounded-md text-[#8b93a3] hover:bg-[#1c2028] hover:text-white"
            onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}
          >
            &lt;
          </button>
          <span className="min-w-24 text-center font-semibold text-[#d7dbe4]">
            {monthNames[monthIndex]} {year}
          </span>
          <button
            aria-label="Next month"
            className="grid h-8 w-8 place-items-center rounded-md text-[#8b93a3] hover:bg-[#1c2028] hover:text-white"
            onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}
          >
            &gt;
          </button>
          <button
            className="hidden rounded-md border border-[#2b3038] px-2.5 py-1 text-xs font-semibold text-[#8b93a3] hover:bg-[#1c2028] hover:text-white sm:inline"
            onClick={() => onMonthChange(monthStartFromIso(todayIso))}
          >
            Today
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-[#252932] px-5 py-3 text-center text-xs font-semibold text-[#747b8b]">
        {weekDays.map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 px-4 py-4">
        {Array.from({ length: firstDayOffset }).map((_, index) => (
          <div className="min-h-20" key={`blank-${index}`} />
        ))}
        {monthValues.map((value, index) => {
          const day = index + 1;
          const date = isoDate(year, monthIndex, day);
          const isWin = value > 0;
          const isLoss = value < 0;
          const isToday = date === todayIso;
          const dayBets = paperBetsByDate.get(date) ?? [];
          const isSelected = selectedDate === date;
          return (
            <button
              className={
                isWin
                  ? `calendar-day cursor-pointer bg-[#102a21] text-left text-[#25f0aa] transition hover:border-[#46d982] hover:bg-[#123425] ${isToday || isSelected ? "ring-1 ring-[#46d982]" : ""}`
                  : isLoss
                    ? `calendar-day cursor-pointer bg-[#351b29] text-left text-[#ff2f87] transition hover:border-[#ff2f87] hover:bg-[#421f31] ${isToday || isSelected ? "ring-1 ring-[#46d982]" : ""}`
                    : `calendar-day cursor-pointer text-left text-[#858b9b] transition hover:border-[#46d982] hover:bg-[#182019] ${isToday || isSelected ? "ring-1 ring-[#46d982]" : ""}`
              }
              key={day}
              onClick={() => setSelectedDate(date)}
              type="button"
            >
              <span className={isWin || isLoss ? "text-[#d6dae3]" : "text-[#565d6d]"}>
                {day}
              </span>
              <strong>{formatShortMoney(value)}</strong>
              {dayBets.length > 0 ? (
                <em className="mt-1 not-italic text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9fb7a7]">
                  {dayBets.length} paper {dayBets.length === 1 ? "bet" : "bets"}
                </em>
              ) : null}
            </button>
          );
        })}
      </div>
      {selectedDate ? (
        <div className="mx-5 mb-4 rounded-lg border border-[#26352c] bg-[#0c110d] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7fa58c]">Paper bets settled</p>
              <h3 className="mt-1 text-base font-semibold text-white">{formatCalendarDate(selectedDate)}</h3>
            </div>
            <button
              className="rounded-md border border-[#2b3038] px-2.5 py-1 text-xs font-semibold text-[#8b93a3] hover:bg-[#1c2028] hover:text-white"
              onClick={() => setSelectedDate(null)}
              type="button"
            >
              Close
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {selectedBets.length > 0 ? (
              selectedBets.map((bet) => {
                const placedDate = localIsoDateFromTimestamp(bet.placedAt);
                const settledDate = bet.settledAt ? localIsoDateFromTimestamp(bet.settledAt) : null;
                return (
                  <div className="rounded-md border border-[#26352c] bg-[#08100b] p-3" key={`${selectedDate}-${bet.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="max-w-full text-sm text-white">{bet.selection}</strong>
                      <span
                        className={
                          bet.status === "won"
                            ? "rounded-full bg-[#123425] px-2 py-0.5 text-xs font-semibold text-[#25f0aa]"
                            : bet.status === "lost"
                              ? "rounded-full bg-[#351b29] px-2 py-0.5 text-xs font-semibold text-[#ff2f87]"
                              : "rounded-full bg-[#181a1e] px-2 py-0.5 text-xs font-semibold text-[#aab1c0]"
                        }
                      >
                        {bet.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#aab1c0]">{bet.exactBet}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <span className="rounded-md border border-[#26352c] p-2 text-[#94a298]">
                        Stake <strong className="block text-white">{formatMoney(bet.stake)}</strong>
                      </span>
                      <span className="rounded-md border border-[#26352c] p-2 text-[#94a298]">
                        P/L{" "}
                        <strong className={bet.profit >= 0 ? "block text-[#25f0aa]" : "block text-[#ff2f87]"}>
                          {formatShortMoney(bet.profit)}
                        </strong>
                      </span>
                      <span className="rounded-md border border-[#26352c] p-2 text-[#94a298]">
                        Odds <strong className="block text-white">{bet.odds.toFixed(2)}</strong>
                      </span>
                      <span className="rounded-md border border-[#26352c] p-2 text-[#94a298]">
                        Book <strong className="block text-white">{bet.book}</strong>
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[#7f8b83]">
                      {bet.market} · {bet.event}
                      {settledDate && settledDate !== placedDate ? ` · settled ${formatCalendarDate(settledDate)}` : ""}
                    </p>
                  </div>
                );
              })
            ) : (
              <p className="rounded-md border border-[#26352c] bg-[#08100b] p-3 text-sm text-[#94a298]">
                No paper bets settled on this day.
              </p>
            )}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 text-xs text-[#8b93a3]">
        <span className="rounded-full border border-[#2b3038] bg-[#181a1e] px-3 py-1">
          Best Positive Streak in {monthNames[monthIndex]}:{" "}
          <strong className="text-[#d7dbe4]">{bestPositiveStreak} days</strong>
        </span>
        <span>
          <strong className="text-[#25f0aa]">{positiveDays}</strong> /{" "}
          <strong className="text-[#ff2f87]">{negativeDays}</strong> active days
        </span>
      </div>
    </section>
  );
}

function SetupState({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-lg border border-[#243129] bg-[#101611] p-6 shadow-xl shadow-black/20">
      <h2 className="text-2xl font-semibold text-white">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[#abb9af]">{body}</p>
      <a
        className="mt-4 inline-flex h-10 items-center rounded-md border border-[#46d982] px-4 text-sm font-semibold text-[#46d982] hover:bg-[#102a21]"
        href="https://odds-api.io/dashboard"
        rel="noreferrer"
        target="_blank"
      >
        Open odds-api.io dashboard
      </a>
    </section>
  );
}

function NumberPanel({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="grid gap-2 text-sm text-[#c7d4ca]">
      {label}
      <input
        className="h-11 rounded-md border border-[#334238] bg-[#080b0a] px-3 text-white outline-none focus:border-[#46d982]"
        min="0"
        step={step}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-md border border-[#384536] bg-[#101711] p-3">
      <p className="text-xs text-[#bac7b6]">{label}</p>
      <p className={tone === "good" ? "metric-good" : tone === "bad" ? "metric-bad" : "text-lg font-semibold text-white"}>
        {value}
      </p>
    </div>
  );
}

function BoardStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "neutral";
}) {
  return (
    <div className="rounded-lg border border-[#243129] bg-[#101611] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7d897f]">
        {label}
      </p>
      <p className={tone === "good" ? "mt-1 text-xl font-semibold text-[#25f0aa]" : "mt-1 text-xl font-semibold text-white"}>
        {value}
      </p>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#26352c] bg-[#0c110d] p-2">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#758279]">
        {label}
      </p>
      <p className="mt-1 font-semibold text-[#eef5ef]">{value}</p>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-[#8fa096]">
      {label}
      <input
        className="h-10 rounded-md border border-[#334238] bg-[#080b0a] px-3 text-sm font-normal text-[#eef5ef] outline-none focus:border-[#46d982]"
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Rule({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-l-2 border-[#46d982] pl-3">
      <p className="font-semibold text-[#eef5ef]">{title}</p>
      <p>{body}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#2d382c] pb-2 last:border-b-0 last:pb-0">
      <span className="text-[#bac7b6]">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}
