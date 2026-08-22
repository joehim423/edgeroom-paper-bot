"use client";

import { useEffect, useMemo, useState } from "react";

type Pick = {
  id: string;
  matchup: string;
  market: string;
  selection: string;
  stakeOdds: number;
  shuffleOdds: number;
  modelChance: number;
  confidence: number;
  status: "open" | "won" | "lost" | "push";
  stake: number;
};

const startingPicks: Pick[] = [
  {
    id: "1",
    matchup: "Boston vs New York",
    market: "Moneyline",
    selection: "Boston",
    stakeOdds: -118,
    shuffleOdds: -110,
    modelChance: 56,
    confidence: 63,
    status: "open",
    stake: 42,
  },
  {
    id: "2",
    matchup: "Dallas vs Phoenix",
    market: "Player points over 24.5",
    selection: "Lead scorer over",
    stakeOdds: 104,
    shuffleOdds: 112,
    modelChance: 52,
    confidence: 58,
    status: "open",
    stake: 28,
  },
  {
    id: "3",
    matchup: "Seattle vs LA",
    market: "Total under 8.5",
    selection: "Under",
    stakeOdds: -102,
    shuffleOdds: -108,
    modelChance: 53,
    confidence: 55,
    status: "lost",
    stake: 25,
  },
];

function decimalFromAmerican(odds: number) {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}

function impliedProbability(odds: number) {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function profitFor(pick: Pick) {
  if (pick.status === "push" || pick.status === "open") return 0;
  if (pick.status === "lost") return -pick.stake;
  return pick.stake * (decimalFromAmerican(bestOdds(pick).odds) - 1);
}

function bestOdds(pick: Pick) {
  const stakeDecimal = decimalFromAmerican(pick.stakeOdds);
  const shuffleDecimal = decimalFromAmerican(pick.shuffleOdds);
  return stakeDecimal >= shuffleDecimal
    ? { book: "Stake", odds: pick.stakeOdds, decimal: stakeDecimal }
    : { book: "Shuffle", odds: pick.shuffleOdds, decimal: shuffleDecimal };
}

function recommendedStake(pick: Pick, bankroll: number, maxRisk: number) {
  const best = bestOdds(pick);
  const chance = pick.modelChance / 100;
  const edge = chance * best.decimal - 1;
  const b = best.decimal - 1;
  const kelly = b > 0 ? (chance * best.decimal - 1) / b : 0;
  const confidenceScale = Math.max(0.2, Math.min(1, pick.confidence / 100));
  const cappedFraction = Math.min(Math.max(kelly * 0.35 * confidenceScale, 0), maxRisk / 100);
  return {
    edge,
    stake: edge > 0 ? bankroll * cappedFraction : 0,
    risk: cappedFraction,
  };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function BettingDashboard() {
  const [bankroll, setBankroll] = useState(1200);
  const [maxRisk, setMaxRisk] = useState(3);
  const [picks, setPicks] = useState<Pick[]>(startingPicks);

  useEffect(() => {
    const saved = window.localStorage.getItem("edgeroom-state");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as {
        bankroll?: number;
        maxRisk?: number;
        picks?: Pick[];
      };
      if (parsed.bankroll) setBankroll(parsed.bankroll);
      if (parsed.maxRisk) setMaxRisk(parsed.maxRisk);
      if (parsed.picks?.length) setPicks(parsed.picks);
    } catch {
      window.localStorage.removeItem("edgeroom-state");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "edgeroom-state",
      JSON.stringify({ bankroll, maxRisk, picks }),
    );
  }, [bankroll, maxRisk, picks]);

  const settledProfit = useMemo(
    () => picks.reduce((total, pick) => total + profitFor(pick), 0),
    [picks],
  );

  const openExposure = picks
    .filter((pick) => pick.status === "open")
    .reduce((total, pick) => total + pick.stake, 0);

  const rankedPicks = [...picks].sort(
    (a, b) =>
      recommendedStake(b, bankroll, maxRisk).edge -
      recommendedStake(a, bankroll, maxRisk).edge,
  );

  function updatePick(id: string, patch: Partial<Pick>) {
    setPicks((current) =>
      current.map((pick) => (pick.id === id ? { ...pick, ...patch } : pick)),
    );
  }

  function addPick() {
    setPicks((current) => [
      {
        id: crypto.randomUUID(),
        matchup: "New matchup",
        market: "Market",
        selection: "Selection",
        stakeOdds: -110,
        shuffleOdds: -105,
        modelChance: 53,
        confidence: 55,
        status: "open",
        stake: 20,
      },
      ...current,
    ]);
  }

  return (
    <main className="min-h-screen bg-[#f4f2ec] text-[#121511]">
      <section className="border-b border-[#d8d2c3] bg-[#101711] text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 md:grid-cols-[1.2fr_0.8fr] md:px-8 lg:py-10">
          <div className="flex flex-col justify-between gap-8">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#85e0a3]">
                EdgeRoom Analyst
              </p>
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight md:text-6xl">
                Smart betting picks, risk-sized before you place them.
              </h1>
            </div>
            <div className="grid gap-3 text-sm text-[#d9e2d5] sm:grid-cols-3">
              <div className="border-l border-[#85e0a3] pl-4">
                Compares Shuffle and Stake odds from your entries.
              </div>
              <div className="border-l border-[#85e0a3] pl-4">
                Flags positive expected value and no-bet spots.
              </div>
              <div className="border-l border-[#85e0a3] pl-4">
                Tracks settled profit, exposure, and bankroll drift.
              </div>
            </div>
          </div>
          <div className="grid content-between gap-4 rounded-lg border border-[#384536] bg-[#182219] p-5">
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm text-[#d9e2d5]">
                Bankroll
                <input
                  className="h-11 rounded-md border border-[#3d4b3a] bg-[#101711] px-3 text-white outline-none focus:border-[#85e0a3]"
                  min="1"
                  type="number"
                  value={bankroll}
                  onChange={(event) => setBankroll(Number(event.target.value))}
                />
              </label>
              <label className="grid gap-2 text-sm text-[#d9e2d5]">
                Max risk %
                <input
                  className="h-11 rounded-md border border-[#3d4b3a] bg-[#101711] px-3 text-white outline-none focus:border-[#85e0a3]"
                  max="10"
                  min="0.25"
                  step="0.25"
                  type="number"
                  value={maxRisk}
                  onChange={(event) => setMaxRisk(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Settled P/L" value={formatMoney(settledProfit)} tone={settledProfit >= 0 ? "good" : "bad"} />
              <Metric label="Open risk" value={formatMoney(openExposure)} />
              <Metric label="Net bankroll" value={formatMoney(bankroll + settledProfit)} />
            </div>
            <p className="text-xs leading-5 text-[#bac7b6]">
              No sportsbook or model can guarantee profit. This tool is built to
              avoid reckless bets, size positions, and make every decision auditable.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-6 md:px-8 lg:grid-cols-[1fr_380px]">
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">Bet Board</h2>
              <p className="text-sm text-[#5d6258]">
                Enter odds from Stake and Shuffle, then set your model chance.
              </p>
            </div>
            <button
              className="h-10 rounded-md bg-[#101711] px-4 text-sm font-semibold text-white hover:bg-[#263322]"
              onClick={addPick}
            >
              + Add bet
            </button>
          </div>

          <div className="grid gap-3">
            {rankedPicks.map((pick) => {
              const best = bestOdds(pick);
              const rec = recommendedStake(pick, bankroll, maxRisk);
              const edgePercent = rec.edge * 100;
              const action = edgePercent > 2 ? "Bet" : edgePercent > 0 ? "Small lean" : "No bet";

              return (
                <article
                  className="rounded-lg border border-[#d8d2c3] bg-white p-4 shadow-sm"
                  key={pick.id}
                >
                  <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="grid gap-3">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <TextInput label="Matchup" value={pick.matchup} onChange={(value) => updatePick(pick.id, { matchup: value })} />
                        <TextInput label="Market" value={pick.market} onChange={(value) => updatePick(pick.id, { market: value })} />
                        <TextInput label="Selection" value={pick.selection} onChange={(value) => updatePick(pick.id, { selection: value })} />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-5">
                        <NumberInput label="Stake odds" value={pick.stakeOdds} onChange={(value) => updatePick(pick.id, { stakeOdds: value })} />
                        <NumberInput label="Shuffle odds" value={pick.shuffleOdds} onChange={(value) => updatePick(pick.id, { shuffleOdds: value })} />
                        <NumberInput label="Model %" value={pick.modelChance} onChange={(value) => updatePick(pick.id, { modelChance: value })} />
                        <NumberInput label="Trust %" value={pick.confidence} onChange={(value) => updatePick(pick.id, { confidence: value })} />
                        <NumberInput label="Stake $" value={pick.stake} onChange={(value) => updatePick(pick.id, { stake: value })} />
                      </div>
                    </div>
                    <div className="grid gap-3 rounded-md bg-[#f7f6f1] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#697062]">
                            Recommendation
                          </p>
                          <p className="text-2xl font-semibold">{action}</p>
                        </div>
                        <span className={edgePercent > 0 ? "badge-good" : "badge-bad"}>
                          {edgePercent.toFixed(1)}% EV
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <p className="text-[#697062]">Best book</p>
                          <p className="font-semibold">{best.book}</p>
                        </div>
                        <div>
                          <p className="text-[#697062]">Best odds</p>
                          <p className="font-semibold">{best.odds > 0 ? `+${best.odds}` : best.odds}</p>
                        </div>
                        <div>
                          <p className="text-[#697062]">Fair chance</p>
                          <p className="font-semibold">{(impliedProbability(best.odds) * 100).toFixed(1)}%</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t border-[#ded8ca] pt-3">
                        <div>
                          <p className="text-sm text-[#697062]">Suggested amount</p>
                          <p className="text-xl font-semibold">{formatMoney(rec.stake)}</p>
                        </div>
                        <select
                          className="h-10 rounded-md border border-[#d8d2c3] bg-white px-3 text-sm"
                          value={pick.status}
                          onChange={(event) =>
                            updatePick(pick.id, { status: event.target.value as Pick["status"] })
                          }
                        >
                          <option value="open">Open</option>
                          <option value="won">Won</option>
                          <option value="lost">Lost</option>
                          <option value="push">Push</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-[#d8d2c3] bg-white p-4">
            <h2 className="mb-3 text-xl font-semibold">AI Rules Engine</h2>
            <div className="grid gap-3 text-sm text-[#3c4238]">
              <Rule title="Only bet positive EV" body="A bet needs your model probability to beat the sportsbook's implied probability after odds shopping." />
              <Rule title="Cap position size" body="The stake uses fractional Kelly logic and never exceeds your max-risk setting." />
              <Rule title="Prefer the best price" body="The same pick can be good at one book and bad at another. Price matters." />
              <Rule title="Track every result" body="Settled wins, losses, and pushes update P/L so the bot can stay honest." />
            </div>
          </section>

          <section className="rounded-lg border border-[#d8d2c3] bg-[#101711] p-4 text-white">
            <h2 className="mb-3 text-xl font-semibold">Session Summary</h2>
            <div className="grid gap-3 text-sm">
              <SummaryRow label="Open bets" value={String(picks.filter((pick) => pick.status === "open").length)} />
              <SummaryRow label="Settled bets" value={String(picks.filter((pick) => pick.status !== "open").length)} />
              <SummaryRow label="Strongest edge" value={`${Math.max(...picks.map((pick) => recommendedStake(pick, bankroll, maxRisk).edge * 100)).toFixed(1)}%`} />
              <SummaryRow label="Worst open risk" value={formatMoney(Math.max(0, ...picks.filter((pick) => pick.status === "open").map((pick) => pick.stake)))} />
            </div>
          </section>
        </aside>
      </section>
    </main>
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

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-[#5d6258]">
      {label}
      <input
        className="h-10 rounded-md border border-[#d8d2c3] bg-white px-3 text-sm font-normal text-[#121511] outline-none focus:border-[#4b7f52]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
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
    <label className="grid gap-1 text-xs font-semibold text-[#5d6258]">
      {label}
      <input
        className="h-10 rounded-md border border-[#d8d2c3] bg-white px-3 text-sm font-normal text-[#121511] outline-none focus:border-[#4b7f52]"
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Rule({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-l-2 border-[#4b7f52] pl-3">
      <p className="font-semibold text-[#121511]">{title}</p>
      <p>{body}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[#2d382c] pb-2 last:border-b-0 last:pb-0">
      <span className="text-[#bac7b6]">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
