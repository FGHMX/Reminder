// ============================================================
// Laguna Capital — Earnings Reminder Server
// ============================================================

require("dotenv").config();

const express = require("express");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
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

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "text/csv" ||
      file.originalname.endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

// ── API Routes ────────────────────────────────────────────────

// Register analyst with CSV
app.post("/api/analyst", upload.single("csv"), (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "CSV file is required" });
    }

    // Check if analyst already exists
    const existing = db.analystExists(email);
    let analystId;

    if (existing) {
      analystId = existing.id;
      console.log(`[API] Updating existing analyst: ${name} (${email})`);
    } else {
      analystId = db.addAnalyst(name, email);
      console.log(`[API] New analyst registered: ${name} (${email})`);
    }

    // Parse CSV (strip BOM if present)
    const csvContent = fs.readFileSync(req.file.path, "utf-8").replace(/^\uFEFF/, "");
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    if (records.length === 0) {
      return res.status(400).json({ error: "CSV file is empty or has no data rows" });
    }

    // Normalize column names (case-insensitive)
    const normalizedRecords = records.map((row) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        const lowerKey = key.toLowerCase().trim();
        if (lowerKey === "ticker" || lowerKey === "symbol") {
          normalized.ticker = value;
        } else if (lowerKey === "sector") {
          normalized.sector = value;
        } else if (
          lowerKey === "subsector" ||
          lowerKey === "industry" ||
          lowerKey === "sub-sector" ||
          lowerKey === "sub_sector"
        ) {
          normalized.subsector = value;
        }
      }
      return normalized;
    });

    // Validate that we have tickers
    const validRecords = normalizedRecords.filter(
      (r) => r.ticker && r.ticker.trim().length > 0
    );

    if (validRecords.length === 0) {
      return res.status(400).json({
        error:
          'No valid tickers found. CSV must have a "ticker" column.',
      });
    }

    // Save tickers
    db.addTickers(analystId, validRecords);

    // Cleanup uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      analystId,
      tickersAdded: validRecords.length,
      message: existing
        ? `Updated ${name}'s watchlist with ${validRecords.length} tickers`
        : `Registered ${name} with ${validRecords.length} tickers`,
    });
  } catch (err) {
    console.error("[API] Error registering analyst:", err);

    // Cleanup file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    if (err.message && err.message.includes("UNIQUE constraint")) {
      return res.status(409).json({
        error: "An analyst with this email is already registered. The CSV will update their tickers.",
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
app.delete("/api/analyst/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const analyst = db.getAnalystById(id);

    if (!analyst) {
      return res.status(404).json({ error: "Analyst not found" });
    }

    db.deleteAnalyst(id);
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
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  res.status(500).json({ error: err.message || "Internal server error" });
});

// ── Start Server ──────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  🏛️  Laguna Capital — Earnings Reminder`);
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  📅  Cron: ${process.env.CRON_SCHEDULE || "30 16 * * 1-5"} (${process.env.CRON_TIMEZONE || "America/New_York"})`);
  console.log(`${"=".repeat(60)}\n`);

  // Start cron job
  cronJob.startCron();
});

// ── Graceful Shutdown ─────────────────────────────────────────

process.on("SIGINT", () => {
  console.log("\n[Server] Shutting down...");
  cronJob.stopCron();
  db.closeDb();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[Server] Shutting down...");
  cronJob.stopCron();
  db.closeDb();
  process.exit(0);
});
