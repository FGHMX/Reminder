// ============================================================
// Database Module — SQLite via better-sqlite3
// ============================================================

const Database = require("better-sqlite3");
const path = require("path");
const gcsService = require("./gcsService");

const DB_PATH = process.env.GCS_BUCKET_NAME 
  ? gcsService.LOCAL_DB_PATH 
  : path.join(__dirname, "..", "earnings_reminder.db");

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = DELETE");
    db.pragma("foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema() {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS analysts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      email       TEXT    NOT NULL UNIQUE,
      sectors     TEXT    NOT NULL DEFAULT '[]',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      analyst_id  INTEGER NOT NULL,
      ticker      TEXT    NOT NULL,
      sector      TEXT    NOT NULL DEFAULT '',
      subsector   TEXT    NOT NULL DEFAULT '',
      company_name TEXT   NOT NULL DEFAULT '',
      FOREIGN KEY (analyst_id) REFERENCES analysts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tickers_analyst
      ON tickers(analyst_id);

    CREATE INDEX IF NOT EXISTS idx_tickers_ticker
      ON tickers(ticker);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_tickers_analyst_ticker
      ON tickers(analyst_id, ticker);

    CREATE TABLE IF NOT EXISTS notification_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      analyst_id    INTEGER NOT NULL,
      ticker        TEXT    NOT NULL,
      company_name  TEXT    NOT NULL DEFAULT '',
      document_type TEXT    NOT NULL,
      title         TEXT    NOT NULL DEFAULT '',
      url           TEXT    NOT NULL DEFAULT '',
      sent_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (analyst_id) REFERENCES analysts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS check_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      check_date      TEXT    NOT NULL,
      tickers_checked INTEGER NOT NULL DEFAULT 0,
      earnings_found  INTEGER NOT NULL DEFAULT 0,
      emails_sent     INTEGER NOT NULL DEFAULT 0,
      details         TEXT    NOT NULL DEFAULT '{}',
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration for existing tables
  try {
    d.exec("ALTER TABLE analysts ADD COLUMN sectors TEXT NOT NULL DEFAULT '[]'");
  } catch (err) {
    // Column already exists, ignore
  }

  // Upload initial schema creation if using GCS
  gcsService.scheduleDbUpload();
}

// ── Analyst CRUD ──────────────────────────────────────────────

function addAnalyst(name, email, sectors = []) {
  const d = getDb();
  const stmt = d.prepare(
    "INSERT INTO analysts (name, email, sectors) VALUES (?, ?, ?)"
  );
  const info = stmt.run(name.trim(), email.trim().toLowerCase(), JSON.stringify(sectors));
  gcsService.scheduleDbUpload();
  return info.lastInsertRowid;
}

function updateAnalystSectors(id, sectors) {
  const d = getDb();
  const stmt = d.prepare("UPDATE analysts SET sectors = ? WHERE id = ?");
  stmt.run(JSON.stringify(sectors), id);
  gcsService.scheduleDbUpload();
}

function getAnalysts() {
  const d = getDb();
  const analysts = d
    .prepare(
      `SELECT a.id, a.name, a.email, a.sectors, a.created_at,
              COUNT(t.id) AS ticker_count
       FROM analysts a
       LEFT JOIN tickers t ON t.analyst_id = a.id
       GROUP BY a.id
       ORDER BY a.name`
    )
    .all();
    
  return analysts.map(a => ({
    ...a,
    sectors: JSON.parse(a.sectors || '[]')
  }));
}

function getAnalystById(id) {
  const d = getDb();
  const analyst = d.prepare("SELECT * FROM analysts WHERE id = ?").get(id);
  if (analyst) {
    analyst.sectors = JSON.parse(analyst.sectors || '[]');
  }
  return analyst;
}

function deleteAnalyst(id) {
  const d = getDb();
  d.prepare("DELETE FROM analysts WHERE id = ?").run(id);
  gcsService.scheduleDbUpload();
}

function analystExists(email) {
  const d = getDb();
  return d
    .prepare("SELECT id FROM analysts WHERE email = ?")
    .get(email.trim().toLowerCase());
}

// ── Tickers CRUD ──────────────────────────────────────────────

function addTickers(analystId, tickerRows) {
  const d = getDb();

  const stmt = d.prepare(
    `INSERT INTO tickers (analyst_id, ticker, sector, subsector)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(analyst_id, ticker) DO UPDATE SET
       sector = excluded.sector,
       subsector = excluded.subsector`
  );

  const insertMany = d.transaction((rows) => {
    for (const row of rows) {
      stmt.run(
        analystId,
        row.ticker.toUpperCase().trim(),
        (row.sector || "").trim(),
        (row.subsector || row.industry || "").trim()
      );
    }
  });

  insertMany(tickerRows);
  gcsService.scheduleDbUpload();
}

function getTickersByAnalyst(analystId) {
  const d = getDb();
  return d
    .prepare(
      "SELECT * FROM tickers WHERE analyst_id = ? ORDER BY sector, subsector, ticker"
    )
    .all(analystId);
}

function deleteTickersByAnalyst(analystId) {
  const d = getDb();
  d.prepare("DELETE FROM tickers WHERE analyst_id = ?").run(analystId);
  gcsService.scheduleDbUpload();
}

function getAllUniqueTickers() {
  const d = getDb();
  return d
    .prepare("SELECT DISTINCT ticker FROM tickers ORDER BY ticker")
    .all()
    .map((r) => r.ticker);
}

function getTickersWithSectors() {
  const d = getDb();
  return d
    .prepare("SELECT ticker, MAX(sector) as sector FROM tickers GROUP BY ticker")
    .all();
}

function getAnalystsForTicker(ticker) {
  const d = getDb();
  return d
    .prepare(
      `SELECT DISTINCT a.id, a.name, a.email, t.sector, t.subsector
       FROM analysts a
       JOIN tickers t ON t.analyst_id = a.id
       WHERE t.ticker = ?`
    )
    .all(ticker.toUpperCase());
}

// ── Notification Log ──────────────────────────────────────────

function logNotification(analystId, ticker, companyName, docType, title, url) {
  const d = getDb();
  d.prepare(
    `INSERT INTO notification_log
       (analyst_id, ticker, company_name, document_type, title, url)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(analystId, ticker, companyName, docType, title, url);
  gcsService.scheduleDbUpload();
}

function getNotificationLog(limit = 100) {
  const d = getDb();
  return d
    .prepare(
      `SELECT nl.*, a.name AS analyst_name, a.email AS analyst_email
       FROM notification_log nl
       JOIN analysts a ON a.id = nl.analyst_id
       ORDER BY nl.sent_at DESC
       LIMIT ?`
    )
    .all(limit);
}

// ── Check History ─────────────────────────────────────────────

function logCheckHistory(checkDate, tickersChecked, earningsFound, emailsSent, details) {
  const d = getDb();
  d.prepare(
    `INSERT INTO check_history
       (check_date, tickers_checked, earnings_found, emails_sent, details)
     VALUES (?, ?, ?, ?, ?)`
  ).run(checkDate, tickersChecked, earningsFound, emailsSent, JSON.stringify(details));
  gcsService.scheduleDbUpload();
}

function getCheckHistory(limit = 30) {
  const d = getDb();
  return d
    .prepare("SELECT * FROM check_history ORDER BY created_at DESC LIMIT ?")
    .all(limit);
}

// ── Utility ───────────────────────────────────────────────────

function wasAlreadyNotified(analystId, ticker, docType, date) {
  const d = getDb();
  return d
    .prepare(
      `SELECT id FROM notification_log
       WHERE analyst_id = ? AND ticker = ? AND document_type = ?
         AND DATE(sent_at) = ?`
    )
    .get(analystId, ticker, docType, date);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  addAnalyst,
  updateAnalystSectors,
  getAnalysts,
  getAnalystById,
  deleteAnalyst,
  analystExists,
  addTickers,
  getTickersByAnalyst,
  deleteTickersByAnalyst,
  getAllUniqueTickers,
  getTickersWithSectors,
  getAnalystsForTicker,
  logNotification,
  getNotificationLog,
  logCheckHistory,
  getCheckHistory,
  wasAlreadyNotified,
  closeDb,
};
