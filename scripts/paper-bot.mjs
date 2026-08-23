import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const STATE_PATH = path.join(ROOT, "public", "paper-bot-state.json");
const BASE_URL = "https://api.odds-api.io/v3";
const STARTING_BANKROLL = 1000;
const BOT_PROFILE = "aggressive";
const MAX_DAILY_BETS = 5;
const MAX_RISK_PER_BET_PERCENT = 12;
const MAX_DAILY_RISK_PERCENT = 25;
const MAX_EVENTS_PER_SPORT = 4;
const MAX_TOTAL_EVENTS = 14;
const SPORTS = (process.env.ODDS_API_IO_SPORTS ?? "basketball,american-football,baseball,ice-hockey,football,tennis")
  .split(",")
  .map((sport) => sport.trim())
  .filter(Boolean);

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readEnv() {
  return readFile(path.join(ROOT, ".env.local"), "utf8")
    .then((content) => {
      content.split(/\r?\n/).forEach((line) => {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!match || process.env[match[1]]) return;
        process.env[match[1]] = match[2].trim();
      });
    })
    .catch(() => undefined);
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch {
    return {
      mode: "paper",
      startingBankroll: STARTING_BANKROLL,
      currentBankroll: STARTING_BANKROLL,
      startedAt: new Date().toISOString(),
      lastRunAt: null,
      dailyRuns: [],
      bets: [],
      notes: [
        "This bot only paper-trades. It does not place real sportsbook bets.",
        "Auto-settlement currently handles moneyline picks from final team scores.",
        "Aggressive profile: up to 12% risk per pick and 25% total daily exposure.",
      ],
    };
  }
}

async function saveState(state) {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

async function oddsFetch(pathname, params = {}) {
  const url = new URL(`${BASE_URL}${pathname}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = body?.error ?? text ?? response.statusText;
    throw new Error(`${response.status}: ${message}`);
  }

  return body;
}

function selectedBookmakers(selection) {
  return selection.selected?.bookmakers ?? selection.bookmakers ?? [];
}

function eventId(event) {
  return String(event.id ?? event.eventId);
}

function eventTime(event) {
  return event.date ?? event.startTime ?? event.commenceTime ?? null;
}

function eventDate(event) {
  const time = eventTime(event);
  if (!time) return null;
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return null;
  return localDate(date);
}

function label(value, fallback = "Sport") {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return value.name ?? value.title ?? value.slug ?? fallback;
}

function decimal(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 1.01 && number < 200 ? number : null;
}

function scoreWinner(event) {
  const homeScore = Number(event.scores?.home);
  const awayScore = Number(event.scores?.away);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  if (homeScore === awayScore) return "push";
  return homeScore > awayScore ? event.home : event.away;
}

function offersFromOdds(event) {
  const offers = [];
  const bookmakers = event.bookmakers ?? {};

  Object.entries(bookmakers).forEach(([book, markets]) => {
    const marketList = Array.isArray(markets) ? markets : Object.values(markets).flat();
    marketList
      .filter((market) => /^(ML|moneyline|h2h|head to head)$/i.test(String(market.name ?? market.key ?? market.market ?? "")))
      .forEach((market) => {
        const rows = Array.isArray(market.odds) ? market.odds : market.odds ? [market.odds] : [];
        rows.forEach((row) => {
          const homeOdds = decimal(row.home);
          if (homeOdds) {
            offers.push({
              eventId: eventId(event),
              sport: label(event.league, label(event.sport)),
              home: event.home,
              away: event.away,
              event: `${event.away} @ ${event.home}`,
              commenceTime: eventTime(event),
              market: "Moneyline",
              selection: event.home,
              book,
              decimal: homeOdds,
            });
          }

          const awayOdds = decimal(row.away);
          if (awayOdds) {
            offers.push({
              eventId: eventId(event),
              sport: label(event.league, label(event.sport)),
              home: event.home,
              away: event.away,
              event: `${event.away} @ ${event.home}`,
              commenceTime: eventTime(event),
              market: "Moneyline",
              selection: event.away,
              book,
              decimal: awayOdds,
            });
          }
        });
      });
  });

  return offers;
}

function buildPicks(offers) {
  const groups = new Map();
  offers.forEach((offer) => {
    const key = `${offer.eventId}:${offer.market}:${offer.selection}`.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  });

  return Array.from(groups.values())
    .map((group) => {
      const best = group.reduce((winner, offer) => (offer.decimal > winner.decimal ? offer : winner));
      const fairProbability = group.reduce((sum, offer) => sum + 1 / offer.decimal, 0) / group.length;
      const edge = fairProbability * best.decimal - 1;
      const confidence = Math.min(94, Math.max(45, 48 + group.length * 12 + Math.max(0, edge) * 180));

      return {
        ...best,
        id: `${best.eventId}:${best.market}:${best.selection}`.toLowerCase(),
        fairProbability,
        edge,
        confidence,
        exactBet: `${best.book}: ${best.selection} - ${best.market} (${best.event}) @ ${best.decimal.toFixed(2)}`,
      };
    })
    .filter((pick) => pick.edge > 0)
    .sort((a, b) => b.edge - a.edge || b.confidence - a.confidence);
}

function botRiskPercent(pick) {
  const edgePercent = pick.edge * 100;
  const trustBoost = Math.max(0, pick.confidence - 60) / 20;
  const oddsBoost = pick.decimal >= 2 ? 1.2 : 0;
  return Math.min(
    MAX_RISK_PER_BET_PERCENT,
    Math.max(2, 2.5 + edgePercent * 1.25 + trustBoost + oddsBoost),
  );
}

function stakeForPick(pick, bankroll, remainingDailyRisk) {
  const riskPercent = Math.min(botRiskPercent(pick), remainingDailyRisk);
  return {
    riskPercent,
    stake: Math.max(0, Math.round(bankroll * (riskPercent / 100) * 100) / 100),
  };
}

async function settleOpenBets(state, apiKey) {
  for (const bet of state.bets.filter((item) => item.status === "open")) {
    const event = await oddsFetch(`/events/${bet.eventId}`, { apiKey }).catch(() => null);
    if (!event || !/settled|completed|finished|final/i.test(String(event.status))) continue;

    const winner = scoreWinner(event);
    if (!winner) continue;

    bet.settledAt = new Date().toISOString();
    bet.finalScore = event.scores ?? null;

    if (winner === "push") {
      bet.status = "push";
      bet.profit = 0;
    } else if (winner === bet.selection) {
      bet.status = "won";
      bet.profit = Math.round(bet.stake * (bet.odds - 1) * 100) / 100;
      state.currentBankroll = Math.round((state.currentBankroll + bet.profit) * 100) / 100;
    } else {
      bet.status = "lost";
      bet.profit = -bet.stake;
      state.currentBankroll = Math.round((state.currentBankroll - bet.stake) * 100) / 100;
    }
  }
}

async function makeDailyBets(state, apiKey) {
  const today = localDate();
  if (state.dailyRuns.some((run) => run.date === today && run.picksAdded > 0)) return;

  const selection = await oddsFetch("/bookmakers/selected", { apiKey });
  const bookmakers = selectedBookmakers(selection);
  if (bookmakers.length === 0) {
    state.dailyRuns.push({ date: today, ranAt: new Date().toISOString(), picksAdded: 0, reason: "No selected bookmakers" });
    return;
  }

  const eventLists = await Promise.allSettled(
    SPORTS.map((sport) =>
      oddsFetch("/events", {
        apiKey,
        sport,
        status: "pending",
        limit: String(MAX_EVENTS_PER_SPORT),
      }),
    ),
  );
  const events = eventLists
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((event) => eventDate(event) === today)
    .slice(0, MAX_TOTAL_EVENTS);
  if (events.length === 0) {
    const failure = eventLists.find((result) => result.status === "rejected");
    throw new Error(
      failure?.status === "rejected"
        ? `No events returned. ${failure.reason?.message ?? ""}`.trim()
        : `No same-day events returned from odds-api.io for ${today}.`,
    );
  }

  const oddsEvents = await Promise.allSettled(
    events.map((event) =>
      oddsFetch("/odds", {
        apiKey,
        eventId: eventId(event),
        bookmakers: bookmakers.join(","),
      }),
    ),
  );
  const offers = oddsEvents.flatMap((result) => (result.status === "fulfilled" ? offersFromOdds(result.value) : []));
  if (offers.length === 0) {
    const failure = oddsEvents.find((result) => result.status === "rejected");
    throw new Error(
      failure?.status === "rejected"
        ? `No moneyline odds returned. ${failure.reason?.message ?? ""}`.trim()
        : "No moneyline odds returned from odds-api.io.",
    );
  }

  const alreadyOpenEvents = new Set(state.bets.filter((bet) => bet.status === "open").map((bet) => bet.eventId));
  const picks = [];

  for (const pick of buildPicks(offers)) {
    if (alreadyOpenEvents.has(pick.eventId) || picks.some((item) => item.eventId === pick.eventId)) continue;
    picks.push(pick);
    if (picks.length === MAX_DAILY_BETS) break;
  }

  let remainingDailyRisk = Math.min(
    MAX_DAILY_RISK_PERCENT,
    Math.max(10, 12 + (picks[0]?.edge ?? 0) * 240),
  );
  const startingDailyRisk = remainingDailyRisk;
  const added = [];

  picks.forEach((pick) => {
    const sized = stakeForPick(pick, state.currentBankroll, remainingDailyRisk);
    if (sized.stake <= 0) return;
    remainingDailyRisk -= sized.riskPercent;
    const bet = {
      id: `${pick.id}:${today}`,
      eventId: pick.eventId,
      placedAt: new Date().toISOString(),
      placedDate: today,
      sport: pick.sport,
      event: pick.event,
      home: pick.home,
      away: pick.away,
      commenceTime: pick.commenceTime,
      market: pick.market,
      selection: pick.selection,
      book: pick.book,
      odds: pick.decimal,
      stake: sized.stake,
      riskPercent: Math.round(sized.riskPercent * 100) / 100,
      edge: pick.edge,
      confidence: pick.confidence,
      exactBet: pick.exactBet,
      status: "open",
      profit: 0,
    };
    state.bets.push(bet);
    added.push(bet.id);
  });

  state.dailyRuns.push({
    date: today,
    ranAt: new Date().toISOString(),
    selectedBookmakers: bookmakers,
    picksAdded: added.length,
    betIds: added,
    botProfile: BOT_PROFILE,
    botMaxDailyRiskPercent: Math.round(startingDailyRisk * 100) / 100,
    botMaxRiskPerBetPercent: MAX_RISK_PER_BET_PERCENT,
  });
}

async function main() {
  await readEnv();
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("ODDS_API_KEY is missing in .env.local");

  const state = await loadState();
  await settleOpenBets(state, apiKey);
  await makeDailyBets(state, apiKey);
  state.lastRunAt = new Date().toISOString();
  delete state.lastError;
  state.botProfile = BOT_PROFILE;
  state.botMaxRiskPerBetPercent = MAX_RISK_PER_BET_PERCENT;
  state.botMaxDailyRiskPercent = MAX_DAILY_RISK_PERCENT;
  state.weekProfit = Math.round((state.currentBankroll - state.startingBankroll) * 100) / 100;
  state.openExposure = Math.round(state.bets.filter((bet) => bet.status === "open").reduce((sum, bet) => sum + bet.stake, 0) * 100) / 100;
  await saveState(state);

  console.log(`Paper bot complete. Bankroll: $${state.currentBankroll.toFixed(2)} | Open: ${state.bets.filter((bet) => bet.status === "open").length}`);
}

main().catch(async (error) => {
  const state = await loadState();
  state.lastRunAt = new Date().toISOString();
  state.lastError = error instanceof Error ? error.message : String(error);
  await saveState(state);
  console.error(state.lastError);
  process.exitCode = 1;
});
