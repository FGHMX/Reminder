// ============================================================
// Cron Job — Daily Earnings Check after Market Close
// ============================================================

const cron = require("node-cron");
const { format, subDays } = require("date-fns");

const db = require("./database");
const fmp = require("./fmpService");
const email = require("./emailService");

let cronTask = null;

// ── Main Check Function ───────────────────────────────────────

async function runEarningsCheck(dateOverride = null) {
  const checkDate = dateOverride || format(new Date(), "yyyy-MM-dd");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[Cron] Starting earnings check for ${checkDate}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    // 1. Get all unique tickers from all analysts
    const allTickers = db.getAllUniqueTickers();

    if (allTickers.length === 0) {
      console.log("[Cron] No tickers registered. Skipping check.");
      db.logCheckHistory(checkDate, 0, 0, 0, { message: "No tickers registered" });
      return { tickersChecked: 0, earningsFound: 0, emailsSent: 0 };
    }

    console.log(`[Cron] Checking ${allTickers.length} unique tickers...`);

    // 2. Check earnings events via FMP
    const earningsResults = await fmp.checkEarningsForDate(allTickers, checkDate);

    console.log(`[Cron] Found ${earningsResults.length} earnings events`);

    if (earningsResults.length === 0) {
      console.log("[Cron] No earnings found for any tracked tickers today.");
      db.logCheckHistory(checkDate, allTickers.length, 0, 0, {
        message: "No earnings found",
      });
      return { tickersChecked: allTickers.length, earningsFound: 0, emailsSent: 0 };
    }

    // 3. Group results by analyst
    const analystEarnings = new Map(); // analystId → items[]

    for (const result of earningsResults) {
      const analysts = db.getAnalystsForTicker(result.ticker);

      for (const analyst of analysts) {
        // Check if already notified today for this specific document
        const alreadySent = db.wasAlreadyNotified(
          analyst.id,
          result.ticker,
          result.documentType,
          checkDate
        );

        if (alreadySent) {
          console.log(
            `[Cron] Already notified ${analyst.name} about ${result.ticker} (${result.documentType}). Skipping.`
          );
          continue;
        }

        if (!analystEarnings.has(analyst.id)) {
          analystEarnings.set(analyst.id, {
            analyst,
            items: [],
          });
        }

        analystEarnings.get(analyst.id).items.push({
          ...result,
          sector: analyst.sector,
          subsector: analyst.subsector,
        });
      }
    }

    // 4. Send emails
    let emailsSent = 0;

    for (const [analystId, { analyst, items }] of analystEarnings.entries()) {
      if (items.length === 0) continue;

      console.log(
        `[Cron] Sending email to ${analyst.name} (${analyst.email}) — ${items.length} earnings events`
      );

      const sent = await email.sendEarningsEmail(
        analyst.email,
        analyst.name,
        checkDate,
        items
      );

      if (sent) {
        emailsSent++;

        // Log each notification
        for (const item of items) {
          db.logNotification(
            analystId,
            item.ticker,
            item.companyName,
            item.documentType,
            item.title,
            item.url
          );
        }
      }
    }

    // 5. Log check history
    const summary = {
      tickersChecked: allTickers.length,
      earningsFound: earningsResults.length,
      emailsSent,
      earningsTickers: [...new Set(earningsResults.map((r) => r.ticker))],
    };

    db.logCheckHistory(
      checkDate,
      summary.tickersChecked,
      summary.earningsFound,
      summary.emailsSent,
      summary
    );

    console.log(`\n[Cron] Check complete:`);
    console.log(`  ✓ Tickers checked: ${summary.tickersChecked}`);
    console.log(`  ✓ Earnings found:  ${summary.earningsFound}`);
    console.log(`  ✓ Emails sent:     ${summary.emailsSent}`);
    console.log(`${"=".repeat(60)}\n`);
    


    return summary;
  } catch (err) {
    console.error("[Cron] Error during earnings check:", err);
    db.logCheckHistory(checkDate, 0, 0, 0, {
      error: err.message,
    });
    throw err;
  }
}

// ── Weekly Recap ────────────────────────────────────────────────

async function runWeeklyRecap() {
  const endDate = format(new Date(), "yyyy-MM-dd");
  const startDate = format(subDays(new Date(), 6), "yyyy-MM-dd"); // Past 7 days (including today)

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[Cron] Starting weekly recap for range: ${startDate} to ${endDate}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    const allTickers = db.getAllUniqueTickers();

    if (allTickers.length === 0) {
      console.log("[Cron] No tickers registered. Skipping weekly recap.");
      return { tickersChecked: 0, earningsFound: 0, emailsSent: 0 };
    }

    console.log(`[Cron] Weekly recap checking ${allTickers.length} unique tickers...`);

    const earningsResults = await fmp.checkEarningsForDateRange(allTickers, startDate, endDate);

    console.log(`[Cron] Found ${earningsResults.length} earnings events for the week`);

    if (earningsResults.length === 0) {
      console.log("[Cron] No earnings found for the weekly recap.");
      return { tickersChecked: allTickers.length, earningsFound: 0, emailsSent: 0 };
    }

    const analystEarnings = new Map(); // analystId → items[]

    for (const result of earningsResults) {
      const analysts = db.getAnalystsForTicker(result.ticker);
      for (const analyst of analysts) {
        if (!analystEarnings.has(analyst.id)) {
          analystEarnings.set(analyst.id, {
            analyst,
            items: [],
          });
        }
        analystEarnings.get(analyst.id).items.push({
          ...result,
          sector: analyst.sector,
          subsector: analyst.subsector,
        });
      }
    }

    let emailsSent = 0;

    for (const [analystId, { analyst, items }] of analystEarnings.entries()) {
      if (items.length === 0) continue;

      console.log(`[Cron] Sending Weekly Recap email to ${analyst.name} (${analyst.email}) — ${items.length} events`);
      const sent = await email.sendWeeklyRecapEmail(analyst.email, analyst.name, startDate, endDate, items);
      if (sent) emailsSent++;
    }

    const summary = {
      tickersChecked: allTickers.length,
      earningsFound: earningsResults.length,
      emailsSent,
      earningsTickers: [...new Set(earningsResults.map((r) => r.ticker))],
    };

    console.log(`\n[Cron] Weekly recap complete:`);
    console.log(`  ✓ Tickers checked: ${summary.tickersChecked}`);
    console.log(`  ✓ Earnings found:  ${summary.earningsFound}`);
    console.log(`  ✓ Emails sent:     ${summary.emailsSent}`);
    console.log(`${"=".repeat(60)}\n`);
    
    // --- IPO CALENDAR CHECK (FORWARD 7 DAYS) ---
    const ipoStartDate = endDate; // Today (Sunday)
    const ipoEndDate = format(new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000), "yyyy-MM-dd"); // Next Sunday
    
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[Cron] Starting weekly IPO check for range: ${ipoStartDate} to ${ipoEndDate}`);
    console.log(`${"=".repeat(60)}\n`);
    
    const upcomingIPOs = await fmp.checkUpcomingIPOsForWeek(ipoStartDate, ipoEndDate);
    
    if (upcomingIPOs.length > 0) {
      const analysts = db.getAnalysts();
      
      for (const analyst of analysts) {
        if (!analyst.sectors || analyst.sectors.length === 0) continue;
        
        // Filter IPOs for this analyst based on their sectors
        const matchingIPOs = upcomingIPOs.filter(ipo => analyst.sectors.includes(ipo.sector));
        
        if (matchingIPOs.length > 0) {
          console.log(`[Cron] Sending IPO Calendar email to ${analyst.name} for ${matchingIPOs.length} IPOs`);
          await email.sendIPOEmail(analyst.email, analyst.name, `${ipoStartDate} - ${ipoEndDate}`, matchingIPOs);
        }
      }
    } else {
      console.log(`[Cron] No upcoming IPOs found in the next 7 days.`);
    }

    // --- GLOBAL TICKER REFRESH ---
    // Instead of instantly adding IPOs, we run a full sync of the analyst sectors 
    // to periodically update the DB with any finalized IPOs or market cap changes.
    await refreshAnalystTickers();

    return summary;
  } catch (err) {
    console.error("[Cron] Error during weekly recap:", err);
    throw err;
  }
}

// ── Weekly Ticker Refresh ─────────────────────────────────────

async function refreshAnalystTickers() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[Cron] Starting weekly ticker refresh for all analysts`);
  console.log(`${"=".repeat(60)}\n`);
  
  try {
    const analysts = db.getAnalysts();
    for (const analyst of analysts) {
      if (analyst.sectors && analyst.sectors.length > 0) {
        const tickersData = await fmp.getTickersBySectors(analyst.sectors);
        if (tickersData.length > 0) {
          db.deleteTickersByAnalyst(analyst.id);
          db.addTickers(analyst.id, tickersData);
          console.log(`[Cron] Refreshed ${analyst.name}'s watchlist: ${tickersData.length} tickers`);
        }
      }
    }
  } catch (err) {
    console.error("[Cron] Error during weekly ticker refresh:", err);
  }
}

// ── Schedule Cron ─────────────────────────────────────────────

function startCron() {
  const schedule = process.env.CRON_SCHEDULE || "30 16 * * 1-5";
  const timezone = process.env.CRON_TIMEZONE || "America/New_York";

  if (cronTask) {
    cronTask.stop();
  }

  if (!cron.validate(schedule)) {
    console.error(`[Cron] Invalid schedule: ${schedule}`);
    return;
  }

  cronTask = cron.schedule(
    schedule,
    async () => {
      console.log("[Cron] Triggered by schedule");
      try {
        await runEarningsCheck();
      } catch (err) {
        console.error("[Cron] Scheduled check failed:", err.message);
      }
    },
    {
      timezone,
    }
  );
  
  // Weekly refresh on Sunday at 2 AM
  cron.schedule("0 2 * * 0", async () => {
    await refreshAnalystTickers();
  }, { timezone });

  // Weekly Recap on Sunday at 10 AM
  cron.schedule("0 10 * * 0", async () => {
    await runWeeklyRecap();
  }, { timezone });

  console.log(
    `[Cron] Scheduled earnings check: "${schedule}" (${timezone})`
  );
  console.log(`[Cron] Scheduled weekly ticker refresh: "0 2 * * 0" (${timezone})`);
  console.log(`[Cron] Scheduled weekly recap: "0 10 * * 0" (${timezone})`);
}

function stopCron() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[Cron] Stopped");
  }
}

module.exports = {
  runEarningsCheck,
  runWeeklyRecap,
  refreshAnalystTickers,
  startCron,
  stopCron,
};
