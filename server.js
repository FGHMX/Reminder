// ============================================================
// Laguna Capital — Earnings Reminder Server
// ============================================================

require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const db = require("./src/database");
const cronJob = require("./src/cronJob");
const emailService = require("./src/emailService");
const fmpService = require("./src/fmpService");

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// ── Middleware ─────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ── API Routes ────────────────────────────────────────────────

const multer = require("multer");
const upload = multer();
const { parse } = require("csv-parse/sync");

// Register analyst with sectors and/or CSV
app.post("/api/analyst", upload.single("csvFile"), async (req, res) => {
  try {
    const { name, email, minMarketCap, maxMarketCap } = req.body;
    let sectors = req.body.sectors || [];
    
    // If only one sector is selected, FormData sends it as a string instead of an array
    if (typeof sectors === "string") {
      sectors = [sectors];
    }

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    const minCap = minMarketCap ? parseInt(minMarketCap, 10) * 1000000 : 200000000;
    const maxCap = maxMarketCap ? parseInt(maxMarketCap, 10) * 1000000 : 25000000000;

    let tickersData = [];

    // Fetch from FMP if sectors were provided
    if (sectors.length > 0) {
      tickersData = await fmpService.getTickersBySectors(sectors, minCap, maxCap);
    }

    // Process CSV if provided
    if (req.file) {
      try {
        const csvString = req.file.buffer.toString("utf8");
        const records = parse(csvString, { columns: true, skip_empty_lines: true });
        
        for (const record of records) {
          const ticker = (record.Ticker || record.ticker || "").trim().toUpperCase();
          if (!ticker) continue;
          
          // Only add if it's not already in the FMP list
          if (!tickersData.some(t => t.ticker === ticker)) {
            tickersData.push({
              ticker: ticker,
              companyName: (record.Company || record.company || "").trim() || ticker,
              sector: (record.Sector || record.sector || "Other").trim(),
              subsector: (record.Subsector || record.subsector || "").trim()
            });
          }
        }
      } catch (err) {
        console.error("Error parsing CSV:", err);
        return res.status(400).json({ error: "Error parsing CSV file." });
      }
    }

    if (tickersData.length === 0) {
      return res.status(400).json({ error: "No tickers found for the selected sectors and no valid CSV was provided." });
    }

    // Check if analyst already exists
    const existing = db.analystExists(email);
    let analystId;

    if (existing) {
      analystId = existing.id;
      db.updateAnalystSectors(analystId, sectors);
      db.deleteTickersByAnalyst(analystId); // <-- Delete old tickers before inserting new ones
      console.log(`[API] Updating existing analyst sectors: ${name} (${email})`);
    } else {
      analystId = db.addAnalyst(name, email, sectors);
      console.log(`[API] New analyst registered: ${name} (${email})`);
    }

    // Save tickers
    db.addTickers(analystId, tickersData);

    // Enforce DB upload to GCS before sending the response (prevents Cloud Run CPU throttling)
    await gcsService.uploadDb();

    res.json({
      success: true,
      analystId,
      tickersAdded: tickersData.length,
      message: existing
        ? `Updated ${name}'s watchlist with ${tickersData.length} tickers`
        : `Registered ${name} with ${tickersData.length} tickers`,
    });
  } catch (err) {
    console.error("[API] Error registering analyst:", err);
    if (err.message && err.message.includes("UNIQUE constraint")) {
      return res.status(409).json({
        error: "An analyst with this email is already registered.",
      });
    }
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Get all analysts
app.get("/api/analysts", (req, res) => {
  try {
    const analysts = db.getAnalysts();
    res.json(analysts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get analyst tickers
app.get("/api/analyst/:id/tickers", (req, res) => {
  try {
    const analyst = db.getAnalystById(parseInt(req.params.id));
    if (!analyst) {
      return res.status(404).json({ error: "Analyst not found" });
    }

    const tickers = db.getTickersByAnalyst(analyst.id);
    res.json({ analyst, tickers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete analyst
app.delete("/api/analyst/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const analyst = db.getAnalystById(id);

    if (!analyst) {
      return res.status(404).json({ error: "Analyst not found" });
    }

    db.deleteAnalyst(id);
    
    // Enforce DB upload to GCS before sending the response
    await gcsService.uploadDb();
    
    res.json({ success: true, message: `Deleted analyst: ${analyst.name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual earnings check
app.post("/api/check-now", async (req, res) => {
  try {
    const { date } = req.body;
    const result = await cronJob.runEarningsCheck(date || null);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual weekly recap check
app.post("/api/check-weekly-now", async (req, res) => {
  try {
    const result = await cronJob.runWeeklyRecap();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get notification log
app.get("/api/logs", (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "100");
    const logs = db.getNotificationLog(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get check history
app.get("/api/check-history", (req, res) => {
  try {
    const history = db.getCheckHistory();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get upcoming earnings calendar
app.get("/api/calendar", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "Missing from and to dates" });
    }

    const tickersData = db.getTickersWithSectors();
    if (tickersData.length === 0) {
      return res.json([]);
    }
    
    // Map of ticker -> sector
    const trackedTickers = new Map();
    tickersData.forEach(t => trackedTickers.set(t.ticker, t.sector));

    const fullCalendar = await fmpService.getEarningsCalendar(from, to);
    
    // Filter to only tracked tickers and attach sector
    const filteredCalendar = [];
    for (const entry of fullCalendar) {
      if (entry.symbol && trackedTickers.has(entry.symbol)) {
        filteredCalendar.push({
          ...entry,
          sector: trackedTickers.get(entry.symbol)
        });
      }
    }

    res.json(filteredCalendar);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cache for company profiles
const profileCache = new Map();

// Get company profile
app.get("/api/profile/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    if (profileCache.has(symbol)) {
      return res.json(profileCache.get(symbol));
    }
    
    const profile = await fmpService.getCompanyProfile(symbol);
    if (profile) {
      profileCache.set(symbol, profile);
    }
    res.json(profile || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test email connection
app.get("/api/test-email", async (req, res) => {
  try {
    const ok = await emailService.testEmailConnection();
    res.json({ success: ok, message: ok ? "SMTP connected" : "SMTP failed" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback — serve index.html for SPA-style routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Error Handler ─────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error("[Server] Error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

const gcsService = require("./src/gcsService");

// ── Start Server ──────────────────────────────────────────────

app.listen(PORT, async () => {
  // Initialize Database from GCS if configured
  await gcsService.downloadDb();
  db.getDb(); // Force schema initialization

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  🏛️  Laguna Capital — Earnings Reminder`);
  console.log(`  🌐  http://localhost:${PORT}`);
  
  if (process.env.DISABLE_CRON === "true") {
    console.log(`  📅  Cron: DISABLED (Using Cloud Scheduler)`);
  } else {
    console.log(`  📅  Cron: ${process.env.CRON_SCHEDULE || "30 16 * * 1-5"} (${process.env.CRON_TIMEZONE || "America/New_York"})`);
    // Start local cron job
    cronJob.startCron();
  }
  console.log(`${"=".repeat(60)}\n`);
});

// ── Graceful Shutdown ─────────────────────────────────────────

process.on("SIGINT", async () => {
  console.log("\n[Server] Shutting down...");
  cronJob.stopCron();
  db.closeDb();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n[Server] Shutting down...");
  cronJob.stopCron();
  db.closeDb();
  process.exit(0);
});
