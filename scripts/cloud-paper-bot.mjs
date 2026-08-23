import process from "node:process";

const ODDS_BASE_URL = "https://api.odds-api.io/v3";
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

const required = ["ODDS_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is missing`);
}

function localDate(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

async function oddsFetch(pathname, params = {}) {
  const url = new URL(`${ODDS_BASE_URL}${pathname}`);
  url.searchParams.set("apiKey", process.env.ODDS_API_KEY);
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

async function supabaseFetch(pathname, init = {}) {
  const url = new URL(`/rest/v1/${pathname}`, process.env.SUPABASE_URL);
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text || response.statusText}`);
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

function label(value, fallback = "Sport") {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return value.name ?? value.title ?? value.slug ?? fallback;
}

function decimal(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 1.01 && number < 200 ? number : null;
}

function scoreParts(event) {
  if (event.scores && !Array.isArray(event.scores)) {
    return {
      home: Number(event.scores.home),
      away: Number(event.scores.away),
    };
  }

  if (Array.isArray(event.scores)) {
    const home = event.scores.find((score) => score.name === event.home || score.team === event.home);
    const away = event.scores.find((score) => score.name === event.away || score.team === event.away);
    return {
      home: Number(home?.score ?? home?.points),
      away: Number(away?.score ?? away?.points),
    };
  }

  return { home: NaN, away: NaN };
}

function settleByScore(bet, event) {
  const scores = scoreParts(event);
  if (!Number.isFinite(scores.home) || !Number.isFinite(scores.away)) return null;

  const selectedIsHome = bet.selection === bet.home;
  const selectedScore = selectedIsHome ? scores.home : scores.away;
  const otherScore = selectedIsHome ? scores.away : scores.home;

  if (bet.market === "Moneyline") {
    if (selectedScore === otherScore) return { status: "push", profit: 0, finalScore: scores };
    const won = selectedScore > otherScore;
    return {
      status: won ? "won" : "lost",
      profit: won ? roundMoney(bet.stake * (bet.odds - 1)) : -Number(bet.stake),
      finalScore: scores,
    };
  }

  if (bet.market === "Spread" && Number.isFinite(Number(bet.line))) {
    const adjusted = selectedScore + Number(bet.line);
    if (adjusted === otherScore) return { status: "push", profit: 0, finalScore: scores };
    const won = adjusted > otherScore;
    return {
      status: won ? "won" : "lost",
      profit: won ? roundMoney(bet.stake * (bet.odds - 1)) : -Number(bet.stake),
      finalScore: scores,
    };
  }

  if (bet.market === "Total" && Number.isFinite(Number(bet.line)) && bet.side) {
    const total = scores.home + scores.away;
    if (total === Number(bet.line)) return { status: "push", profit: 0, finalScore: scores };
    const won = bet.side === "over" ? total > Number(bet.line) : total < Number(bet.line);
    return {
      status: won ? "won" : "lost",
      profit: won ? roundMoney(bet.stake * (bet.odds - 1)) : -Number(bet.stake),
      finalScore: scores,
    };
  }

  return null;
}

function offersFromOdds(event) {
  const offers = [];
  const bookmakers = event.bookmakers ?? {};

  Object.entries(bookmakers).forEach(([book, markets]) => {
    const marketList = Array.isArray(markets) ? markets : Object.values(markets).flat();

    marketList.forEach((market) => {
      const marketName = String(market.name ?? market.key ?? market.market ?? "");
      const rows = Array.isArray(market.odds) ? market.odds : market.odds ? [market.odds] : [];

      rows.forEach((row) => {
        if (/^(ML|moneyline|h2h|head to head)$/i.test(marketName)) {
          const homeOdds = decimal(row.home);
          if (homeOdds) {
            offers.push(baseOffer(event, book, "Moneyline", event.home, homeOdds));
          }

          const awayOdds = decimal(row.away);
          if (awayOdds) {
            offers.push(baseOffer(event, book, "Moneyline", event.away, awayOdds));
          }
        }

        if (/spread|handicap/i.test(marketName)) {
          const homeOdds = decimal(row.home);
          if (homeOdds && row.homeHdp !== undefined) {
            offers.push(baseOffer(event, book, "Spread", event.home, homeOdds, Number(row.homeHdp)));
          }

          const awayOdds = decimal(row.away);
          if (awayOdds && row.awayHdp !== undefined) {
            offers.push(baseOffer(event, book, "Spread", event.away, awayOdds, Number(row.awayHdp)));
          }
        }

        if (/total/i.test(marketName)) {
          const line = Number(row.hdp ?? row.line ?? row.total);
          const over = decimal(row.over);
          if (over && Number.isFinite(line)) {
            offers.push(baseOffer(event, book, "Total", `Over ${line}`, over, line, "over"));
          }

          const under = decimal(row.under);
          if (under && Number.isFinite(line)) {
            offers.push(baseOffer(event, book, "Total", `Under ${line}`, under, line, "under"));
          }
        }
      });
    });
  });

  return offers;
}

function baseOffer(event, book, market, selection, odds, line = null, side = null) {
  return {
    eventId: eventId(event),
    sport: label(event.league, label(event.sport)),
    home: event.home,
    away: event.away,
    event: `${event.away} @ ${event.home}`,
    commenceTime: eventTime(event),
    market,
    selection,
    book,
    decimal: odds,
    line,
    side,
  };
}

function buildPicks(offers) {
  const groups = new Map();
  offers.forEach((offer) => {
    const key = `${offer.eventId}:${offer.market}:${offer.selection}:${offer.line ?? ""}:${offer.side ?? ""}`.toLowerCase();
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
        id: `${best.eventId}:${best.market}:${best.selection}:${best.line ?? ""}:${best.side ?? ""}`.toLowerCase(),
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
    stake: Math.max(0, roundMoney(bankroll * (riskPercent / 100))),
  };
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function getBotState() {
  const rows = await supabaseFetch("bot_state?id=eq.main&select=*");
  if (rows.length > 0) return rows[0];

  const initial = {
    id: "main",
    current_bankroll: STARTING_BANKROLL,
    starting_bankroll: STARTING_BANKROLL,
    week_profit: 0,
    open_exposure: 0,
    bot_profile: BOT_PROFILE,
  };
  await upsertBotState(initial);
  return initial;
}

async function getBets() {
  return supabaseFetch("paper_bets?select=*&order=placed_at.asc");
}

async function upsertBotState(state) {
  await supabaseFetch("bot_state?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(state),
  });
}

async function insertBet(bet) {
  await supabaseFetch("paper_bets?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(bet),
  });
}

async function updateBet(id, patch) {
  await supabaseFetch(`paper_bets?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function settleOpenBets(state, bets) {
  let bankroll = Number(state.current_bankroll);
  const selected = await oddsFetch("/bookmakers/selected").catch(() => null);
  const fallbackBookmakers = selected ? selectedBookmakers(selected) : [];

  for (const bet of bets.filter((item) => item.status === "open")) {
    const event = await settlementEventForBet(bet, fallbackBookmakers);
    if (!event || !/settled|completed|finished|final/i.test(String(event.status))) continue;

    const settlement = settleByScore(bet, event);
    if (!settlement) continue;

    await updateBet(bet.id, {
      status: settlement.status,
      profit: settlement.profit,
      settled_at: new Date().toISOString(),
      final_score: settlement.finalScore,
    });

    bankroll = roundMoney(bankroll + settlement.profit);
  }

  return bankroll;
}

async function settlementEventForBet(bet, fallbackBookmakers) {
  const event = await oddsFetch(`/events/${bet.event_id}`).catch(() => null);
  if (event?.status && event?.scores) return event;

  const bookmakers = Array.from(new Set([bet.book, ...fallbackBookmakers].filter(Boolean)));
  if (bookmakers.length === 0) return event;

  return oddsFetch("/odds", {
    eventId: bet.event_id,
    bookmakers: bookmakers.join(","),
  }).catch(() => event);
}

async function makeDailyBets(state, bets) {
  const today = localDate();
  if (bets.some((bet) => bet.placed_date === today)) return [];

  const selection = await oddsFetch("/bookmakers/selected");
  const bookmakers = selectedBookmakers(selection);
  if (bookmakers.length === 0) return [];

  const eventLists = await Promise.allSettled(
    SPORTS.map((sport) =>
      oddsFetch("/events", {
        sport,
        status: "pending",
        limit: String(MAX_EVENTS_PER_SPORT),
      }),
    ),
  );
  const events = eventLists
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .slice(0, MAX_TOTAL_EVENTS);
  if (events.length === 0) throw new Error("No events returned from odds-api.io.");

  const oddsEvents = await Promise.allSettled(
    events.map((event) =>
      oddsFetch("/odds", {
        eventId: eventId(event),
        bookmakers: bookmakers.join(","),
      }),
    ),
  );
  const offers = oddsEvents.flatMap((result) => (result.status === "fulfilled" ? offersFromOdds(result.value) : []));
  if (offers.length === 0) throw new Error("No odds returned from odds-api.io.");

  const alreadyOpenEvents = new Set(bets.filter((bet) => bet.status === "open").map((bet) => bet.event_id));
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
  const added = [];

  for (const pick of picks) {
    const sized = stakeForPick(pick, Number(state.current_bankroll), remainingDailyRisk);
    if (sized.stake <= 0) continue;
    remainingDailyRisk -= sized.riskPercent;

    const bet = {
      id: `${pick.id}:${today}`,
      event_id: pick.eventId,
      placed_at: new Date().toISOString(),
      placed_date: today,
      sport: pick.sport,
      event: pick.event,
      home: pick.home,
      away: pick.away,
      commence_time: pick.commenceTime,
      market: pick.market,
      selection: pick.selection,
      book: pick.book,
      odds: pick.decimal,
      stake: sized.stake,
      risk_percent: Math.round(sized.riskPercent * 100) / 100,
      line: pick.line,
      side: pick.side,
      status: "open",
      profit: 0,
      exact_bet: pick.exactBet,
    };
    await insertBet(bet);
    added.push(bet);
  }

  return added;
}

async function refreshState(state) {
  const bets = await getBets();
  const currentBankroll = Number(state.current_bankroll);
  const openExposure = bets
    .filter((bet) => bet.status === "open")
    .reduce((sum, bet) => sum + Number(bet.stake), 0);

  const nextState = {
    id: "main",
    current_bankroll: roundMoney(currentBankroll),
    starting_bankroll: Number(state.starting_bankroll ?? STARTING_BANKROLL),
    week_profit: roundMoney(currentBankroll - Number(state.starting_bankroll ?? STARTING_BANKROLL)),
    open_exposure: roundMoney(openExposure),
    last_run_at: new Date().toISOString(),
    bot_profile: BOT_PROFILE,
  };

  await upsertBotState(nextState);
  return nextState;
}

async function main() {
  let state = await getBotState();
  let bets = await getBets();
  const bankrollAfterSettlement = await settleOpenBets(state, bets);

  if (bankrollAfterSettlement !== Number(state.current_bankroll)) {
    await upsertBotState({ id: "main", current_bankroll: bankrollAfterSettlement });
    state = { ...state, current_bankroll: bankrollAfterSettlement };
    bets = await getBets();
  }

  const added = await makeDailyBets(state, bets);
  const finalState = await refreshState(state);

  console.log(
    `Cloud paper bot complete. Added ${added.length} bets. Bankroll: $${Number(finalState.current_bankroll).toFixed(2)}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
