// ============================================================
// Cron Job — Daily Earnings Check after Market Close
// ============================================================

const cron = require("node-cron");
const { format } = require("date-fns");

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

  console.log(
    `[Cron] Scheduled earnings check: "${schedule}" (${timezone})`
  );
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
  startCron,
  stopCron,
};
