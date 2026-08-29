type BookmakerSelection = {
  bookmakers?: string[];
  count?: number;
  selected?: {
    bookmakers?: string[];
    count?: number;
  };
};

type Sport = {
  name?: string;
  slug?: string;
  key?: string;
  title?: string;
};

type Event = {
  id?: string;
  eventId?: string;
  sport?: string | { name?: string; slug?: string; title?: string };
  league?: string | { name?: string; slug?: string; title?: string };
  name?: string;
  home?: string;
  away?: string;
  homeTeam?: string;
  awayTeam?: string;
  startTime?: string;
  commenceTime?: string;
  date?: string;
};

type OddsEvent = Event & {
  bookmakers?: Record<string, Market[] | Record<string, Market[]>>;
};

type Market = {
  name?: string;
  key?: string;
  market?: string;
  odds?: OddRow[] | Record<string, unknown>;
};

type OddRow = Record<string, unknown>;

type PickCandidate = {
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

type Offer = {
  eventId: string;
  sport: string;
  event: string;
  commenceTime: string | null;
  market: string;
  selection: string;
  book: string;
  decimal: number;
};

const ODDS_BASE_URL = "https://api.odds-api.io/v3";
const DEFAULT_SPORTS = [
  "basketball",
  "american-football",
  "baseball",
  "ice-hockey",
  "football",
  "tennis",
];
const MAX_EVENTS_PER_SPORT = 4;
const MAX_TOTAL_EVENTS = 14;
const MAX_PICKS = 5;

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function apiUrl(path: string, apiKey?: string) {
  const url = new URL(`${ODDS_BASE_URL}${path}`);
  if (apiKey) url.searchParams.set("apiKey", apiKey);
  return url;
}

async function oddsFetch<T>(path: string, apiKey?: string, params?: Record<string, string>) {
  const url = apiUrl(path, apiKey);
  Object.entries(params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  let body: unknown = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : text || response.statusText;
    throw new Error(`${response.status}: ${message}`);
  }

  return body as T;
}

function decimalFromAny(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 1.01 && number < 200 ? number : null;
}

function impliedProbability(decimal: number) {
  return 1 / decimal;
}

function niceMarket(value: string) {
  const cleaned = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Market";
  if (/^ml$/i.test(cleaned) || /money\s*line/i.test(cleaned)) return "Moneyline";
  if (/^h2h$/i.test(cleaned) || /head\s*to\s*head/i.test(cleaned)) return "Moneyline";
  return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventId(event: Event) {
  return String(event.id ?? event.eventId ?? `${event.sport}-${event.home}-${event.away}-${event.startTime}`);
}

function labelFromUnknown(value: Event["sport"] | Event["league"]) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.name ?? value.title ?? value.slug ?? null;
}

function sportName(event: Event, fallback: string) {
  const league = labelFromUnknown(event.league);
  if (league) return league;
  const sport = labelFromUnknown(event.sport);
  if (sport) return sport;
  return fallback;
}

function eventName(event: Event) {
  if (event.name) return event.name;
  const away = event.away ?? event.awayTeam;
  const home = event.home ?? event.homeTeam;
  if (away && home) return `${away} @ ${home}`;
  return "Unknown event";
}

function eventTime(event: Event) {
  return event.startTime ?? event.commenceTime ?? event.date ?? null;
}

function selectedBookmakers(selection: BookmakerSelection) {
  return selection.selected?.bookmakers ?? selection.bookmakers ?? [];
}

function isFutureEvent(event: Event) {
  const time = eventTime(event);
  if (!time) return true;
  return new Date(time).getTime() >= Date.now() - 3 * 60 * 60 * 1000;
}

function selectionLabel(selection: string, hdp?: unknown) {
  const line = hdp === undefined || hdp === null || hdp === "" ? "" : ` ${formatLineValue(hdp)}`;
  return `${selection}${line}`.replace(/\s+/g, " ").trim();
}

function formatLineValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (number > 0) return `+${number}`;
  return String(number);
}

function rowOffers(row: OddRow, context: Omit<Offer, "selection" | "decimal">) {
  const offers: Offer[] = [];
  const label = typeof row.label === "string" ? row.label : "";
  const hdp = row.hdp ?? row.handicap ?? row.point ?? row.line;
  const homeName = context.event.split(" @ ").at(1) ?? "Home";
  const awayName = context.event.split(" @ ").at(0) ?? "Away";
  const isSpread = /spread|handicap/i.test(context.market);
  const homeHdp = row.homeHdp ?? row.homeHandicap ?? row.homePoint ?? row.homeLine ?? hdp;
  const awayHdp = row.awayHdp ?? row.awayHandicap ?? row.awayPoint ?? row.awayLine ?? hdp;

  const home = decimalFromAny(row.home);
  if (home) {
    offers.push({
      ...context,
      selection: isSpread ? selectionLabel(homeName, homeHdp) : homeName,
      decimal: home,
    });
  }

  const away = decimalFromAny(row.away);
  if (away) {
    offers.push({
      ...context,
      selection: isSpread ? selectionLabel(awayName, awayHdp) : awayName,
      decimal: away,
    });
  }

  const draw = decimalFromAny(row.draw);
  if (draw) offers.push({ ...context, selection: "Draw", decimal: draw });

  const over = decimalFromAny(row.over);
  if (over) offers.push({ ...context, selection: selectionLabel(`${label || "Total"} Over`, hdp), decimal: over });

  const under = decimalFromAny(row.under);
  if (under) offers.push({ ...context, selection: selectionLabel(`${label || "Total"} Under`, hdp), decimal: under });

  const price = decimalFromAny(row.price ?? row.odds ?? row.decimal);
  const name = row.name ?? row.selection ?? row.team ?? row.player ?? row.label;
  if (price && typeof name === "string") {
    offers.push({ ...context, selection: selectionLabel(name, hdp), decimal: price });
  }

  return offers;
}

function flattenOddsEvent(event: OddsEvent, fallbackSport: string) {
  const bookmakers = event.bookmakers ?? {};

  return Object.entries(bookmakers).flatMap(([book, bookMarkets]) => {
    const marketList = Array.isArray(bookMarkets)
      ? bookMarkets
      : Object.values(bookMarkets).flatMap((value) => (Array.isArray(value) ? value : []));

    return marketList.flatMap((market) => {
      const marketName = niceMarket(String(market.name ?? market.key ?? market.market ?? "Market"));
      const rows = Array.isArray(market.odds)
        ? market.odds
        : market.odds && typeof market.odds === "object"
          ? [market.odds as OddRow]
          : [];
      const context = {
        eventId: eventId(event),
        sport: sportName(event, fallbackSport),
        event: eventName(event),
        commenceTime: eventTime(event),
        market: marketName,
        book,
      };

      return rows.flatMap((row) => rowOffers(row, context));
    });
  });
}

function buildPicks(offers: Offer[]) {
  const groups = new Map<string, Offer[]>();
  offers.forEach((offer) => {
    const key = `${offer.eventId}:${offer.market}:${offer.selection}`.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), offer]);
  });

  return Array.from(groups.values())
    .map((group) => {
      const best = group.reduce((winner, offer) =>
        offer.decimal > winner.decimal ? offer : winner,
      );
      const fairProbability =
        group.reduce((total, offer) => total + impliedProbability(offer.decimal), 0) /
        group.length;
      const edge = fairProbability * best.decimal - 1;
      const confidence = Math.min(
        94,
        Math.max(42, 44 + group.length * 14 + Math.max(0, edge) * 180),
      );

      return {
        id: `${best.eventId}:${best.market}:${best.selection}`.toLowerCase(),
        sport: best.sport,
        event: best.event,
        commenceTime: best.commenceTime,
        market: best.market,
        selection: best.selection,
        exactBet: `${best.book}: ${best.selection} - ${best.market} (${best.event}) @ ${best.decimal.toFixed(2)}`,
        bestBook: best.book,
        bestOdds: best.decimal,
        fairProbability,
        edge,
        confidence,
        booksChecked: group.length,
        explanation:
          group.length > 1
            ? `${best.book} has the best available price compared with the selected books. Verify the line before betting.`
            : `Only one selected bookmaker has this line, so treat it as a lower-confidence watchlist pick.`,
      } satisfies PickCandidate;
    })
    .sort((a, b) => b.edge - a.edge || b.confidence - a.confidence)
    .slice(0, MAX_PICKS);
}

async function oddsForEvents(events: Event[], apiKey: string, bookmakers: string[]) {
  const eventIds = events.map(eventId);
  if (eventIds.length === 0) return [];

  try {
    const response = await oddsFetch<OddsEvent[]>("/odds/multi", apiKey, {
      eventIds: eventIds.join(","),
      bookmakers: bookmakers.join(","),
    });
    return Array.isArray(response) ? response : [];
  } catch {
    const settled = await Promise.allSettled(
      events.map((event) =>
        oddsFetch<OddsEvent>("/odds", apiKey, {
          eventId: eventId(event),
          bookmakers: bookmakers.join(","),
        }),
      ),
    );
    return settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
  }
}

export async function GET() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return jsonResponse({
      status: "needs_key",
      message: "Add ODDS_API_KEY to .env.local. The key stays server-side and is never exposed to the browser.",
      picks: [],
    });
  }

  try {
    const selected = await oddsFetch<BookmakerSelection>("/bookmakers/selected", apiKey);
    const bookmakers = selectedBookmakers(selected);

    if (bookmakers.length === 0) {
      return jsonResponse({
        status: "needs_bookmakers",
        message:
          "Your odds-api.io key works, but no bookmakers are selected yet. Pick 2 free recreational books in the odds-api.io dashboard, for example FanDuel and DraftKings.",
        selectedBookmakers: [],
        picks: [],
      });
    }

    const availableSports = await oddsFetch<Sport[]>("/sports");
    const configuredSports = (process.env.ODDS_API_IO_SPORTS ?? DEFAULT_SPORTS.join(","))
      .split(",")
      .map((sport) => sport.trim())
      .filter(Boolean);
    const sportSlugs = new Set(
      availableSports.map((sport) => sport.slug ?? sport.key).filter(Boolean),
    );
    const sports = configuredSports.filter((sport) => sportSlugs.size === 0 || sportSlugs.has(sport));

    const eventResults = await Promise.allSettled(
      sports.map((sport) =>
        oddsFetch<Event[]>("/events", apiKey, {
          sport,
          status: "pending",
          limit: String(MAX_EVENTS_PER_SPORT),
        }).then((events) => events.map((event) => ({ ...event, sport }))),
      ),
    );
    const events = eventResults
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .filter(isFutureEvent)
      .slice(0, MAX_TOTAL_EVENTS);
    const sportByEventId = new Map(events.map((event) => [eventId(event), sportName(event, "Sport")]));
    const oddsEvents = await oddsForEvents(events, apiKey, bookmakers);
    const offers = oddsEvents.flatMap((event) =>
      flattenOddsEvent(event, sportByEventId.get(eventId(event)) ?? "Sport"),
    );
    const picks = buildPicks(offers);

    return jsonResponse({
      status: "ok",
      generatedAt: new Date().toISOString(),
      selectedBookmakers: bookmakers,
      sportsScanned: sports.length,
      eventsScanned: events.length,
      offersScanned: offers.length,
      picks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load odds.";
    return jsonResponse(
      {
        status: "error",
        message,
        picks: [],
      },
      /401|403/.test(message) ? 200 : 500,
    );
  }
}
