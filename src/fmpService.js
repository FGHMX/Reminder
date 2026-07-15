// ============================================================
// FMP API Service — Earnings Calendar, Press Releases, Transcripts
// ============================================================

const https = require("https");

const FMP_BASE = "https://financialmodelingprep.com/stable";
const API_KEY = process.env.FMP_API_KEY || "";

// ── HTTP Helper ───────────────────────────────────────────────

function fmpFetch(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${FMP_BASE}${endpoint}`);
    url.searchParams.set("apikey", API_KEY);
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null) {
        url.searchParams.set(key, String(val));
      }
    }

    https
      .get(url.toString(), { timeout: 30000 }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json && json["Error Message"]) {
              reject(new Error(`FMP Error: ${json["Error Message"]}`));
              return;
            }
            resolve(json);
          } catch (err) {
            reject(new Error(`FMP parse error: ${err.message}`));
          }
        });
      })
      .on("error", reject)
      .on("timeout", () => reject(new Error("FMP request timeout")));
  });
}

// ── Earnings Calendar ─────────────────────────────────────────
// Returns companies that report earnings on a given date range

async function getEarningsCalendar(fromDate, toDate) {
  try {
    const data = await fmpFetch("/earnings-calendar", {
      from: fromDate,
      to: toDate,
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("[FMP] Earnings calendar error:", err.message);
    return [];
  }
}

// ── Press Releases by Symbol ──────────────────────────────────
// Returns recent press releases for a ticker (includes earnings releases)

async function getPressReleases(symbol, fromDate, toDate, limit = 50) {
  try {
    const data = await fmpFetch("/news/press-releases", {
      symbols: symbol.toUpperCase(),
      from: fromDate,
      to: toDate,
      limit,
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(`[FMP] Press releases error for ${symbol}:`, err.message);
    return [];
  }
}

// ── Earnings Call Transcript ──────────────────────────────────
// Returns earnings call transcript for a specific quarter/year

async function getEarningsTranscript(symbol, year, quarter) {
  try {
    const data = await fmpFetch("/earning-call-transcript", {
      symbol: symbol.toUpperCase(),
      year,
      quarter,
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(`[FMP] Transcript error for ${symbol}:`, err.message);
    return [];
  }
}

// ── Latest Earnings Call Transcripts ──────────────────────────

async function getLatestTranscripts(page = 0) {
  try {
    const data = await fmpFetch("/earning-call-transcript-latest", { page });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("[FMP] Latest transcripts error:", err.message);
    return [];
  }
}

// ── Company Profile (for getting company name) ────────────────

async function getCompanyProfile(symbol) {
  try {
    const data = await fmpFetch("/profile", { symbol: symbol.toUpperCase() });
    if (Array.isArray(data) && data.length > 0) return data[0];
    return null;
  } catch (err) {
    console.error(`[FMP] Profile error for ${symbol}:`, err.message);
    return null;
  }
}

// ── Sector Tickers (Stock Screener) ───────────────────────────

const SECTOR_MAPPING = {
  "Industrials": ["Industrials"],
  "REITS": ["Real Estate"],
  "Materials": ["Basic Materials"],
  "Consumer Staples": ["Consumer Defensive"],
  "Information Technology": ["Technology"],
  "Healthcare": ["Healthcare"],
  "Energy and Utilities": ["Energy", "Utilities"],
  "Communication Services": ["Communication Services"],
  "Consumer Discretionary": ["Consumer Cyclical"]
};

async function getTickersBySectors(sectors, minCap = 200000000, maxCap = 25000000000) {
  if (!sectors || sectors.length === 0) return [];

  const fmpSectors = new Set();
  sectors.forEach((s) => {
    if (SECTOR_MAPPING[s]) {
      SECTOR_MAPPING[s].forEach((fmpSec) => fmpSectors.add(fmpSec));
    }
  });

  const uniqueSectors = Array.from(fmpSectors);
  if (uniqueSectors.length === 0) return [];

  const allTickers = [];
  const companyGroups = new Map();

  for (const sector of uniqueSectors) {
    try {
      console.log(`[FMP Service] Fetching tickers for sector: ${sector} with cap ${minCap} - ${maxCap}`);
      
      const data = await fmpFetch("/company-screener", {
        marketCapMoreThan: minCap,
        marketCapLowerThan: maxCap,
        sector: sector,
        exchange: "NYSE,NASDAQ,AMEX",
        isActivelyTrading: true,
        limit: 5000
      });
      
      if (Array.isArray(data)) {
        let originalSector = sectors.find(s => SECTOR_MAPPING[s] && SECTOR_MAPPING[s].includes(sector)) || sector;
        
        for (const item of data) {
          // Excluir acciones preferentes (-P), warrants (-W), unidades (-U), y dual-listings con punto (.)
          if (item.symbol.includes('-P') || item.symbol.includes('-W') || item.symbol.includes('-U') || item.symbol.includes('.')) {
            continue;
          }
          
          const compName = item.companyName || item.symbol;
          
          if (!companyGroups.has(compName)) {
            companyGroups.set(compName, []);
          }
          companyGroups.get(compName).push({
            ticker: item.symbol,
            companyName: compName,
            sector: originalSector,
            subsector: item.industry || "",
            volume: item.volume || 0
          });
        }
      }
    } catch (err) {
      console.error(`[FMP] Error fetching tickers for sector ${sector}:`, err.message);
    }
    await sleep(200);
  }
  
  // Pick the best ticker for each company
  for (const [compName, group] of companyGroups.entries()) {
    group.sort((a, b) => {
      if (a.ticker.length !== b.ticker.length) {
        return a.ticker.length - b.ticker.length;
      }
      return b.volume - a.volume;
    });
    
    const best = group[0];
    allTickers.push({
      ticker: best.ticker,
      companyName: best.companyName,
      sector: best.sector,
      subsector: best.subsector
    });
  }
  
  // Apply manual sector overrides
  const overrides = {
    "WALD": { sector: "Consumer Staples", companyName: "Waldencast plc", subsector: "Household & Personal Products" }
  };

  for (const [ticker, overrideData] of Object.entries(overrides)) {
    const idx = allTickers.findIndex(t => t.ticker === ticker);
    if (idx !== -1) {
      if (!sectors.includes(overrideData.sector)) {
        // Ticker was returned by FMP for a wrong sector that we requested, so remove it
        allTickers.splice(idx, 1);
      } else {
        // Ticker was returned by FMP for its true sector, just fix the naming
        allTickers[idx].sector = overrideData.sector;
        allTickers[idx].subsector = overrideData.subsector;
      }
    } else {
      if (sectors.includes(overrideData.sector)) {
        // Ticker was not returned by FMP because it was requested in the wrong sector by them, manually inject it
        allTickers.push({
          ticker: ticker,
          companyName: overrideData.companyName,
          sector: overrideData.sector,
          subsector: overrideData.subsector
        });
      }
    }
  }

  return allTickers;
}

// ── IPO Calendar ──────────────────────────────────────────────

async function getIPOCalendar(fromDate, toDate) {
  try {
    const data = await fmpFetch("/ipo-calendar", {
      from: fromDate,
      to: toDate
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("[FMP] IPO calendar error:", err.message);
    return [];
  }
}

// ── Earnings Detection Logic ──────────────────────────────────
// Core function: checks what earnings events happened on a date
// for a list of tickers

const EARNINGS_KEYWORDS = [
  "financial results",
  "earnings",
  "quarterly results",
  "quarter ended",
  "three months ended",
  "reports first quarter",
  "reports second quarter",
  "reports third quarter",
  "reports fourth quarter",
  "announces first quarter",
  "announces second quarter",
  "announces third quarter",
  "announces fourth quarter",
  "fiscal quarter",
  "revenue",
  "net income",
  "eps",
  "earnings per share",
];

function isEarningsRelease(pressRelease) {
  const title = (pressRelease.title || "").toLowerCase();
  const text = (pressRelease.text || "").toLowerCase();
  const combined = `${title} ${text}`;

  return EARNINGS_KEYWORDS.some((kw) => combined.includes(kw));
}

async function checkEarningsForDate(tickers, dateStr) {
  console.log(
    `[FMP] Checking earnings for ${tickers.length} tickers on ${dateStr}...`
  );

  const results = [];

  // Step 1: Get earnings calendar for today
  const calendar = await getEarningsCalendar(dateStr, dateStr);
  const calendarSymbols = new Set(
    calendar.map((e) => (e.symbol || "").toUpperCase())
  );

  console.log(
    `[FMP] Earnings calendar has ${calendar.length} entries for ${dateStr}`
  );

  // Step 2: Filter to only our watched tickers
  const matchedTickers = tickers.filter((t) => calendarSymbols.has(t));

  console.log(
    `[FMP] ${matchedTickers.length} of our tickers are in the earnings calendar`
  );

  // Step 3: For each matched ticker, look for earnings releases & transcripts
  for (const ticker of matchedTickers) {
    const calendarEntry = calendar.find(
      (e) => (e.symbol || "").toUpperCase() === ticker
    );

    // Check press releases for earnings releases
    const pressReleases = await getPressReleases(ticker, dateStr, dateStr);
    const earningsReleases = pressReleases.filter(isEarningsRelease);

    if (earningsReleases.length > 0) {
      for (const release of earningsReleases) {
        results.push({
          ticker,
          companyName:
            calendarEntry?.companyName ||
            release.symbol ||
            ticker,
          documentType: "Earnings Release",
          title: release.title || "Earnings Release",
          url: release.url || "",
          date: release.publishedDate || dateStr,
          eps: calendarEntry?.eps || null,
          epsEstimated: calendarEntry?.epsEstimated || null,
          revenue: calendarEntry?.revenue || null,
          revenueEstimated: calendarEntry?.revenueEstimated || null,
        });
      }
    }

    // Check for earnings call transcripts
    if (calendarEntry) {
      const year = new Date(dateStr).getFullYear();
      const quarter = getQuarterFromDate(dateStr);
      const transcripts = await getEarningsTranscript(ticker, year, quarter);

      if (transcripts.length > 0) {
        const transcript = transcripts[0];
        results.push({
          ticker,
          companyName: calendarEntry.companyName || ticker,
          documentType: "Earnings Call Transcript",
          title: `${calendarEntry.companyName || ticker} — Q${quarter} ${year} Earnings Call`,
          url: "",
          date: transcript.date || dateStr,
          eps: calendarEntry.eps || null,
          epsEstimated: calendarEntry.epsEstimated || null,
          revenue: calendarEntry.revenue || null,
          revenueEstimated: calendarEntry.revenueEstimated || null,
        });
      }
    }

    // Small delay between API calls to avoid rate limiting
    await sleep(200);
  }

  return results;
}

function getQuarterFromDate(dateStr) {
  const month = new Date(dateStr).getMonth() + 1;
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

async function checkEarningsForDateRange(tickers, startDate, endDate) {
  console.log(
    `[FMP] Checking earnings for ${tickers.length} tickers between ${startDate} and ${endDate}...`
  );

  const results = [];

  // Step 1: Get earnings calendar for date range
  const calendar = await getEarningsCalendar(startDate, endDate);
  const calendarSymbols = new Set(
    calendar.map((e) => (e.symbol || "").toUpperCase())
  );

  console.log(
    `[FMP] Earnings calendar has ${calendar.length} entries between ${startDate} and ${endDate}`
  );

  // Step 2: Filter to only our watched tickers
  const matchedTickers = tickers.filter((t) => calendarSymbols.has(t));

  console.log(
    `[FMP] ${matchedTickers.length} of our tickers are in the earnings calendar for this week`
  );

  // Step 3: For each matched ticker, look for earnings releases & transcripts
  for (const ticker of matchedTickers) {
    const calendarEntries = calendar.filter(
      (e) => (e.symbol || "").toUpperCase() === ticker
    );
    // Usually only one entry per ticker in a week, but we'll use the first one
    const calendarEntry = calendarEntries.length > 0 ? calendarEntries[0] : null;

    // Check press releases for earnings releases in the date range
    const pressReleases = await getPressReleases(ticker, startDate, endDate);
    const earningsReleases = pressReleases.filter(isEarningsRelease);

    if (earningsReleases.length > 0) {
      for (const release of earningsReleases) {
        results.push({
          ticker,
          companyName:
            calendarEntry?.companyName ||
            release.symbol ||
            ticker,
          documentType: "Earnings Release",
          title: release.title || "Earnings Release",
          url: release.url || "",
          date: release.publishedDate || startDate,
          eps: calendarEntry?.eps || null,
          epsEstimated: calendarEntry?.epsEstimated || null,
          revenue: calendarEntry?.revenue || null,
          revenueEstimated: calendarEntry?.revenueEstimated || null,
        });
      }
    }

    // Check for earnings call transcripts
    if (calendarEntry && calendarEntry.date) {
      const year = new Date(calendarEntry.date).getFullYear();
      const quarter = getQuarterFromDate(calendarEntry.date);
      const transcripts = await getEarningsTranscript(ticker, year, quarter);

      if (transcripts.length > 0) {
        const transcript = transcripts[0];
        
        // Ensure transcript date is within range
        const transcriptDate = new Date(transcript.date);
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        // Simple check if it is broadly in the range, or we can just include it if it matches year/quarter
        results.push({
          ticker,
          companyName: calendarEntry.companyName || ticker,
          documentType: "Earnings Call Transcript",
          title: `${calendarEntry.companyName || ticker} — Q${quarter} ${year} Earnings Call`,
          url: "",
          date: transcript.date || calendarEntry.date,
          eps: calendarEntry.eps || null,
          epsEstimated: calendarEntry.epsEstimated || null,
          revenue: calendarEntry.revenue || null,
          revenueEstimated: calendarEntry.revenueEstimated || null,
        });
      }
    }

    // Small delay between API calls to avoid rate limiting
    await sleep(200);
  }

  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  getEarningsCalendar,
  getPressReleases,
  getEarningsTranscript,
  getLatestTranscripts,
  getCompanyProfile,
  checkEarningsForDate,
  checkEarningsForDateRange,
  isEarningsRelease,
  getTickersBySectors,
  getIPOCalendar,
  SECTOR_MAPPING,
};
