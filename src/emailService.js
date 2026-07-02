// ============================================================
// Email Service — Nodemailer + Premium HTML Template
// ============================================================

const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

// ── Build HTML Email ──────────────────────────────────────────

function buildEarningsEmail(analystName, date, earningsItems) {
  // Group items by sector → subsector
  const grouped = {};
  for (const item of earningsItems) {
    const sector = item.sector || "Other";
    const subsector = item.subsector || "General";
    if (!grouped[sector]) grouped[sector] = {};
    if (!grouped[sector][subsector]) grouped[sector][subsector] = [];
    grouped[sector][subsector].push(item);
  }

  let sectorsHtml = "";

  for (const [sector, subsectors] of Object.entries(grouped)) {
    let subsectorsHtml = "";

    for (const [subsector, items] of Object.entries(subsectors)) {
      let itemsHtml = "";
      for (const item of items) {
        const epsHtml =
          item.eps != null
            ? `<span style="color: ${item.eps >= (item.epsEstimated || 0) ? "#34d399" : "#f87171"}; font-weight: 600;">EPS: $${item.eps}</span>
               <span style="color: #94a3b8; font-size: 12px;"> (Est: $${item.epsEstimated || "N/A"})</span>`
            : "";

        const revenueHtml =
          item.revenue != null
            ? `<span style="color: #94a3b8; font-size: 12px; margin-left: 12px;">Rev: $${formatNumber(item.revenue)}</span>`
            : "";

        const linkHtml = item.url
          ? `<a href="${item.url}" style="color: #60a5fa; text-decoration: none; font-size: 13px; display: inline-block; margin-top: 4px;">📄 View Document →</a>`
          : "";

        const docBadgeColor =
          item.documentType === "Earnings Call Transcript"
            ? "#8b5cf6"
            : item.documentType === "Earnings Release"
              ? "#3b82f6"
              : "#f59e0b";

        itemsHtml += `
          <div style="background: #1e293b; border-radius: 8px; padding: 14px 16px; margin-bottom: 8px; border-left: 3px solid ${docBadgeColor};">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 6px;">
              <div>
                <span style="color: #f1f5f9; font-weight: 700; font-size: 15px;">${item.companyName}</span>
                <span style="color: #64748b; font-size: 13px; margin-left: 8px;">${item.ticker}</span>
              </div>
              <span style="background: ${docBadgeColor}22; color: ${docBadgeColor}; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; white-space: nowrap;">${item.documentType}</span>
            </div>
            <div style="margin-top: 6px;">
              ${epsHtml}${revenueHtml}
            </div>
            <div style="margin-top: 4px; color: #cbd5e1; font-size: 13px;">${item.title}</div>
            ${linkHtml}
          </div>
        `;
      }

      subsectorsHtml += `
        <div style="margin-bottom: 16px;">
          <h4 style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 8px 0; font-weight: 600;">${subsector}</h4>
          ${itemsHtml}
        </div>
      `;
    }

    sectorsHtml += `
      <div style="margin-bottom: 24px;">
        <h3 style="color: #e2e8f0; font-size: 16px; margin: 0 0 12px 0; padding-bottom: 8px; border-bottom: 1px solid #334155; font-weight: 700;">
          📊 ${sector}
        </h3>
        ${subsectorsHtml}
      </div>
    `;
  }

  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 640px; margin: 0 auto; padding: 24px 16px;">

    <!-- Header -->
    <div style="text-align: center; padding: 32px 20px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 16px 16px 0 0; border: 1px solid #334155; border-bottom: none;">
      <h1 style="margin: 0; color: #f8fafc; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
        🏛️ Laguna Capital
      </h1>
      <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px;">
        Earnings Intelligence Report
      </p>
    </div>

    <!-- Greeting -->
    <div style="background: #1e293b; padding: 20px 24px; border-left: 1px solid #334155; border-right: 1px solid #334155;">
      <p style="margin: 0; color: #cbd5e1; font-size: 14px;">
        Hola <strong style="color: #f1f5f9;">${analystName}</strong>,
      </p>
      <p style="margin: 8px 0 0; color: #94a3b8; font-size: 13px;">
        Las siguientes empresas de tu cobertura publicaron documentos de earnings el <strong style="color: #cbd5e1;">${formattedDate}</strong>:
      </p>
    </div>

    <!-- Summary Bar -->
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #1e293b 100%); padding: 14px 24px; display: flex; justify-content: space-around; border-left: 1px solid #334155; border-right: 1px solid #334155;">
      <div style="text-align: center;">
        <div style="color: #60a5fa; font-size: 22px; font-weight: 800;">${earningsItems.length}</div>
        <div style="color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Documents</div>
      </div>
      <div style="text-align: center;">
        <div style="color: #a78bfa; font-size: 22px; font-weight: 800;">${new Set(earningsItems.map((e) => e.ticker)).size}</div>
        <div style="color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Companies</div>
      </div>
      <div style="text-align: center;">
        <div style="color: #34d399; font-size: 22px; font-weight: 800;">${Object.keys(grouped).length}</div>
        <div style="color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Sectors</div>
      </div>
    </div>

    <!-- Content -->
    <div style="background: #0f172a; padding: 24px; border: 1px solid #334155; border-top: none;">
      ${sectorsHtml}
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 20px; background: #1e293b; border-radius: 0 0 16px 16px; border: 1px solid #334155; border-top: none;">
      <p style="margin: 0; color: #64748b; font-size: 11px;">
        Laguna Capital — Earnings Reminder System<br>
        This is an automated notification. Powered by FMP API.
      </p>
    </div>

  </div>
</body>
</html>
  `.trim();
}

// ── Send Email ────────────────────────────────────────────────

async function sendEarningsEmail(analystEmail, analystName, date, earningsItems) {
  const html = buildEarningsEmail(analystName, date, earningsItems);
  const companiesCount = new Set(earningsItems.map((e) => e.ticker)).size;

  const subject = `🔔 Earnings Alert — ${companiesCount} ${companiesCount === 1 ? "company" : "companies"} reported | ${date}`;

  try {
    const info = await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: analystEmail,
      subject,
      html,
    });
    console.log(`[Email] Sent to ${analystEmail}: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send to ${analystEmail}:`, err.message);
    return false;
  }
}

// ── Test Connection ───────────────────────────────────────────

async function testEmailConnection() {
  try {
    await getTransporter().verify();
    console.log("[Email] SMTP connection verified ✓");
    return true;
  } catch (err) {
    console.error("[Email] SMTP connection failed:", err.message);
    return false;
  }
}

// ── Helper ────────────────────────────────────────────────────

function formatNumber(num) {
  if (num == null) return "N/A";
  if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
  return num.toFixed(2);
}

// ── Build IPO Email ──────────────────────────────────────────

function buildIPOEmail(analystName, date, ipoItems) {
  let itemsHtml = "";
  for (const item of ipoItems) {
    itemsHtml += `
      <div style="background: #1e293b; border-radius: 8px; padding: 14px 16px; margin-bottom: 8px; border-left: 3px solid #10b981;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 6px;">
          <div>
            <span style="color: #f1f5f9; font-weight: 700; font-size: 15px;">${item.company}</span>
            <span style="color: #64748b; font-size: 13px; margin-left: 8px;">${item.symbol}</span>
          </div>
          <span style="background: #10b98122; color: #10b981; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; white-space: nowrap;">IPO</span>
        </div>
        <div style="margin-top: 6px;">
          <span style="color: #94a3b8; font-size: 12px;">Sector: <strong>${item.sector}</strong></span>
          <span style="color: #94a3b8; font-size: 12px; margin-left: 12px;">Exchange: ${item.exchange || 'N/A'}</span>
        </div>
      </div>
    `;
  }

  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 640px; margin: 0 auto; padding: 24px 16px;">
    <!-- Header -->
    <div style="text-align: center; padding: 32px 20px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 16px 16px 0 0; border: 1px solid #334155; border-bottom: none;">
      <h1 style="margin: 0; color: #f8fafc; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
        🏛️ Laguna Capital
      </h1>
      <p style="margin: 8px 0 0; color: #10b981; font-size: 14px;">
        IPO Alert
      </p>
    </div>
    <!-- Greeting -->
    <div style="background: #1e293b; padding: 20px 24px; border-left: 1px solid #334155; border-right: 1px solid #334155;">
      <p style="margin: 0; color: #cbd5e1; font-size: 14px;">
        Hola <strong style="color: #f1f5f9;">${analystName}</strong>,
      </p>
      <p style="margin: 8px 0 0; color: #94a3b8; font-size: 13px;">
        Las siguientes empresas en tu cobertura han programado o realizado su IPO alrededor del <strong style="color: #cbd5e1;">${formattedDate}</strong>:
      </p>
    </div>
    <!-- Content -->
    <div style="background: #0f172a; padding: 24px; border: 1px solid #334155; border-top: none;">
      ${itemsHtml}
    </div>
    <!-- Footer -->
    <div style="text-align: center; padding: 20px; background: #1e293b; border-radius: 0 0 16px 16px; border: 1px solid #334155; border-top: none;">
      <p style="margin: 0; color: #64748b; font-size: 11px;">
        Laguna Capital — Earnings Reminder System<br>
        This is an automated notification. Powered by FMP API.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

async function sendIPOEmail(analystEmail, analystName, date, ipoItems) {
  const html = buildIPOEmail(analystName, date, ipoItems);
  const subject = `🚀 IPO Alert — ${ipoItems.length} new IPO(s) detected`;

  try {
    const info = await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: analystEmail,
      subject,
      html,
    });
    console.log(`[Email] Sent IPO alert to ${analystEmail}: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send IPO alert to ${analystEmail}:`, err.message);
    return false;
  }
}

module.exports = {
  sendEarningsEmail,
  sendIPOEmail,
  testEmailConnection,
  buildEarningsEmail,
};
