// ============================================================
// Laguna Capital — Earnings Reminder Frontend Logic
// ============================================================

(function () {
  "use strict";

  // ── DOM Refs ──────────────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const registerForm = $("#register-form");
  const csvFileInput = $("#csv-file");
  const dropzone = $("#dropzone");
  const dropzoneContent = $("#dropzone-content");
  const dropzoneFile = $("#dropzone-file");
  const fileName = $("#file-name");
  const removeFileBtn = $("#remove-file");
  const csvPreview = $("#csv-preview");
  const csvThead = $("#csv-thead");
  const csvTbody = $("#csv-tbody");
  const csvCount = $("#csv-count");
  const submitBtn = $("#submit-btn");
  const copyExampleBtn = $("#copy-example");
  const csvExampleCode = $("#csv-example-code");

  const analystsGrid = $("#analysts-grid");
  const emptyAnalysts = $("#empty-analysts");

  const checkDateInput = $("#check-date");
  const checkNowBtn = $("#check-now-btn");

  const logTbody = $("#log-tbody");
  const emptyLogs = $("#empty-logs");
  const checkHistoryContainer = $("#check-history");

  const modalOverlay = $("#modal-overlay");
  const modalTitle = $("#modal-title");
  const modalBody = $("#modal-body");
  const modalClose = $("#modal-close");

  const toastContainer = $("#toast-container");

  const statAnalysts = $("#stat-analysts");
  const statTickers = $("#stat-tickers");
  const statNotifications = $("#stat-notifications");

  // Set default date to today
  if (checkDateInput) {
    checkDateInput.value = new Date().toISOString().split("T")[0];
  }

  // ── Toast System ──────────────────────────────────────────

  function showToast(message, type = "info") {
    const icons = { success: "✅", error: "❌", info: "ℹ️" };
    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `<span>${icons[type] || ""}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("removing");
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ── Navigation ────────────────────────────────────────────

  $$(".nav__link").forEach((link) => {
    link.addEventListener("click", (e) => {
      $$(".nav__link").forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
    });
  });

  const sections = ["register", "dashboard", "calendar", "logs"];
  window.addEventListener(
    "scroll",
    debounce(() => {
      const scrollY = window.scrollY + 100;
      for (const id of sections) {
        const section = document.getElementById(id);
        if (section && scrollY >= section.offsetTop && scrollY < section.offsetTop + section.offsetHeight) {
          $$(".nav__link").forEach((l) => l.classList.remove("active"));
          const activeLink = $(`.nav__link[data-section="${id}"]`);
          if (activeLink) activeLink.classList.add("active");
        }
      }
    }, 100)
  );

  // ── CSV File Handling ─────────────────────────────────────

  // Drag and drop
  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.endsWith(".csv")) {
      csvFileInput.files = files;
      handleFileSelected(files[0]);
    } else {
      showToast("Solo se aceptan archivos CSV", "error");
    }
  });

  csvFileInput.addEventListener("change", () => {
    if (csvFileInput.files.length > 0) {
      handleFileSelected(csvFileInput.files[0]);
    }
  });

  removeFileBtn.addEventListener("click", () => {
    csvFileInput.value = "";
    dropzoneContent.style.display = "";
    dropzoneFile.style.display = "none";
    csvPreview.style.display = "none";
  });

  function handleFileSelected(file) {
    fileName.textContent = file.name;
    dropzoneContent.style.display = "none";
    dropzoneFile.style.display = "flex";

    // Parse and preview CSV
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = parseCSV(e.target.result);
        if (rows.length === 0) {
          showToast("El CSV está vacío", "error");
          return;
        }
        renderCSVPreview(rows);
      } catch (err) {
        showToast("Error al leer el CSV: " + err.message, "error");
      }
    };
    reader.readAsText(file);
  }

  function parseCSV(text) {
    const lines = text
      .replace(/^\uFEFF/, "")
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim());
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || "";
      });
      rows.push(row);
    }
    return rows;
  }

  function renderCSVPreview(rows) {
    if (rows.length === 0) return;

    const headers = Object.keys(rows[0]);
    csvThead.innerHTML = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;

    const previewRows = rows.slice(0, 10);
    csvTbody.innerHTML = previewRows
      .map(
        (row) =>
          `<tr>${headers.map((h) => `<td>${escapeHtml(row[h] || "")}</td>`).join("")}</tr>`
      )
      .join("");

    csvCount.textContent = `Mostrando ${previewRows.length} de ${rows.length} filas`;
    csvPreview.style.display = "";
  }

  // Copy example CSV
  copyExampleBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(csvExampleCode.textContent).then(() => {
      showToast("Ejemplo CSV copiado al portapapeles", "success");
    });
  });

  // ── Form Submit ───────────────────────────────────────────

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nameVal = $("#analyst-name").value.trim();
    const emailVal = $("#analyst-email").value.trim();

    if (!nameVal || !emailVal) {
      showToast("Completa todos los campos", "error");
      return;
    }

    if (!csvFileInput.files.length) {
      showToast("Selecciona un archivo CSV", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Registrando...';

    const formData = new FormData();
    formData.append("name", nameVal);
    formData.append("email", emailVal);
    formData.append("csv", csvFileInput.files[0]);

    try {
      const res = await fetch("/api/analyst", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (res.ok && data.success) {
        showToast(data.message, "success");
        registerForm.reset();
        dropzoneContent.style.display = "";
        dropzoneFile.style.display = "none";
        csvPreview.style.display = "none";
        loadDashboard();
      } else {
        showToast(data.error || "Error al registrar", "error");
      }
    } catch (err) {
      showToast("Error de conexión: " + err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span class="btn__icon">🚀</span> Registrar Analista';
    }
  });

  // ── Dashboard ─────────────────────────────────────────────

  const avatarColors = [
    "linear-gradient(135deg, #3b82f6, #2563eb)",
    "linear-gradient(135deg, #8b5cf6, #6d28d9)",
    "linear-gradient(135deg, #10b981, #059669)",
    "linear-gradient(135deg, #f59e0b, #d97706)",
    "linear-gradient(135deg, #ef4444, #dc2626)",
    "linear-gradient(135deg, #06b6d4, #0891b2)",
    "linear-gradient(135deg, #ec4899, #db2777)",
  ];

  async function loadDashboard() {
    try {
      const analysts = await fetch("/api/analysts").then((r) => r.json());
      const logs = await fetch("/api/logs?limit=200").then((r) => r.json());
      const history = await fetch("/api/check-history").then((r) => r.json());

      // Update hero stats
      statAnalysts.textContent = analysts.length;
      statTickers.textContent = analysts.reduce((sum, a) => sum + (a.ticker_count || 0), 0);
      statNotifications.textContent = logs.length;

      // Render analysts
      renderAnalysts(analysts);

      // Render logs
      renderLogs(logs);

      // Render check history
      renderCheckHistory(history);
    } catch (err) {
      console.error("Error loading dashboard:", err);
    }
  }

  function renderAnalysts(analysts) {
    if (analysts.length === 0) {
      analystsGrid.style.display = "none";
      emptyAnalysts.style.display = "";
      return;
    }

    analystsGrid.style.display = "";
    emptyAnalysts.style.display = "none";

    analystsGrid.innerHTML = analysts
      .map((a, i) => {
        const initials = a.name
          .split(" ")
          .map((w) => w[0])
          .join("")
          .toUpperCase()
          .slice(0, 2);
        const color = avatarColors[i % avatarColors.length];
        const date = new Date(a.created_at).toLocaleDateString("es-MX", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });

        return `
          <div class="analyst-card" style="animation-delay: ${i * 0.08}s">
            <div class="analyst-card__header">
              <div class="analyst-card__avatar" style="background: ${color}">${initials}</div>
              <div class="analyst-card__info">
                <div class="analyst-card__name">${escapeHtml(a.name)}</div>
                <div class="analyst-card__email">${escapeHtml(a.email)}</div>
                <div class="analyst-card__date">Registrado: ${date}</div>
              </div>
            </div>
            <div class="analyst-card__stats">
              <div class="analyst-card__stat">
                <div class="analyst-card__stat-value">${a.ticker_count || 0}</div>
                <div class="analyst-card__stat-label">Tickers</div>
              </div>
            </div>
            <div class="analyst-card__actions">
              <button class="btn btn--ghost btn--sm" onclick="window.viewTickers(${a.id}, '${escapeHtml(a.name)}')">
                <span class="btn__icon">👁️</span> Ver Tickers
              </button>
              <button class="btn btn--danger btn--sm" onclick="window.deleteAnalyst(${a.id}, '${escapeHtml(a.name)}')">
                <span class="btn__icon">🗑️</span> Eliminar
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderLogs(logs) {
    if (logs.length === 0) {
      logTbody.innerHTML = "";
      emptyLogs.style.display = "";
      return;
    }

    emptyLogs.style.display = "none";
    logTbody.innerHTML = logs
      .map((log) => {
        const date = new Date(log.sent_at).toLocaleDateString("es-MX", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        const badgeClass =
          log.document_type === "Earnings Call Transcript"
            ? "doc-badge--transcript"
            : log.document_type === "Earnings Release"
              ? "doc-badge--release"
              : "doc-badge--report";

        return `
          <tr>
            <td>${date}</td>
            <td>${escapeHtml(log.analyst_name)}</td>
            <td><strong>${escapeHtml(log.ticker)}</strong></td>
            <td>${escapeHtml(log.company_name)}</td>
            <td><span class="doc-badge ${badgeClass}">${escapeHtml(log.document_type)}</span></td>
            <td>${escapeHtml(log.title).slice(0, 60)}${log.title.length > 60 ? "..." : ""}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderCheckHistory(history) {
    if (history.length === 0) {
      checkHistoryContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">Sin verificaciones registradas</p>';
      return;
    }

    checkHistoryContainer.innerHTML = history
      .map((h) => {
        const date = new Date(h.created_at).toLocaleDateString("es-MX", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        return `
          <div class="check-item">
            <span class="check-item__date">${date}</span>
            <div class="check-item__stats">
              <span class="check-item__stat">📊 <strong>${h.tickers_checked}</strong> tickers</span>
              <span class="check-item__stat">🔔 <strong>${h.earnings_found}</strong> earnings</span>
              <span class="check-item__stat">📧 <strong>${h.emails_sent}</strong> emails</span>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // ── View Tickers Modal ────────────────────────────────────

  window.viewTickers = async function (analystId, analystName) {
    modalTitle.textContent = `Tickers de ${analystName}`;
    modalBody.innerHTML = '<div style="text-align: center; padding: 30px;"><span class="spinner"></span></div>';
    modalOverlay.classList.add("active");

    try {
      const data = await fetch(`/api/analyst/${analystId}/tickers`).then((r) => r.json());
      const tickers = data.tickers || [];

      if (tickers.length === 0) {
        modalBody.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Sin tickers registrados</p>';
        return;
      }

      // Group by sector
      const bySector = {};
      for (const t of tickers) {
        const sector = t.sector || "Other";
        if (!bySector[sector]) bySector[sector] = [];
        bySector[sector].push(t);
      }

      let html = "";
      for (const [sector, items] of Object.entries(bySector)) {
        html += `<h4 style="color: var(--accent-blue); font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin: 16px 0 8px; font-weight: 700;">📊 ${escapeHtml(sector)}</h4>`;
        html += '<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;">';
        for (const t of items) {
          html += `
            <div style="padding: 6px 12px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 12px;">
              <strong style="color: var(--text-primary);">${escapeHtml(t.ticker)}</strong>
              <span style="color: var(--text-dim); margin-left: 6px;">${escapeHtml(t.subsector)}</span>
            </div>
          `;
        }
        html += "</div>";
      }

      modalBody.innerHTML = html;
    } catch (err) {
      modalBody.innerHTML = `<p style="color: var(--accent-red);">Error: ${err.message}</p>`;
    }
  };

  // ── Delete Analyst ────────────────────────────────────────

  window.deleteAnalyst = async function (id, name) {
    if (!confirm(`¿Eliminar al analista "${name}" y todos sus tickers?`)) return;

    try {
      const res = await fetch(`/api/analyst/${id}`, { method: "DELETE" });
      const data = await res.json();

      if (res.ok && data.success) {
        showToast(data.message, "success");
        loadDashboard();
      } else {
        showToast(data.error || "Error al eliminar", "error");
      }
    } catch (err) {
      showToast("Error: " + err.message, "error");
    }
  };

  // ── Manual Check ──────────────────────────────────────────

  checkNowBtn.addEventListener("click", async () => {
    const date = checkDateInput.value;
    if (!date) {
      showToast("Selecciona una fecha", "error");
      return;
    }

    checkNowBtn.disabled = true;
    checkNowBtn.innerHTML = '<span class="spinner"></span> Verificando...';
    showToast(`Verificando earnings para ${date}...`, "info");

    try {
      const res = await fetch("/api/check-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        showToast(
          `Verificación completa: ${data.earningsFound} earnings encontrados, ${data.emailsSent} emails enviados`,
          "success"
        );
        loadDashboard();
      } else {
        showToast(data.error || "Error en la verificación", "error");
      }
    } catch (err) {
      showToast("Error: " + err.message, "error");
    } finally {
      checkNowBtn.disabled = false;
      checkNowBtn.innerHTML = '<span class="btn__icon">⚡</span> Verificar Ahora';
    }
  });

  // ── Modal Controls ────────────────────────────────────────

  modalClose.addEventListener("click", () => {
    modalOverlay.classList.remove("active");
  });

  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.classList.remove("active");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalOverlay.classList.contains("active")) {
      modalOverlay.classList.remove("active");
    }
  });

  // ── Utilities ─────────────────────────────────────────────

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ── Calendar Logic ────────────────────────────────────────

  const calendarGrid = $("#calendar-grid");
  const calendarWeekLabel = $("#calendar-week-label");
  const prevWeekBtn = $("#prev-week-btn");
  const nextWeekBtn = $("#next-week-btn");
  const currentWeekBtn = $("#current-week-btn");

  let currentCalendarMonday = getMonday(new Date());

  function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay() || 7; // Get current day number, converting Sun. to 7
    if (day !== 1) date.setHours(-24 * (day - 1)); // Only manipulate the date if it isn't Mon.
    return date;
  }

  function addDays(d, days) {
    const date = new Date(d);
    date.setDate(date.getDate() + days);
    return date;
  }

  function getHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
  }

  async function loadCalendar() {
    if (!calendarGrid) return;
    const fromDate = currentCalendarMonday.toISOString().split("T")[0];
    const toDate = addDays(currentCalendarMonday, 4).toISOString().split("T")[0];
    
    calendarWeekLabel.textContent = `Semana del ${fromDate} al ${toDate}`;
    calendarGrid.innerHTML = '<p style="text-align:center; grid-column: 1/-1;">Cargando calendario...</p>';

    try {
      const res = await fetch(`/api/calendar?from=${fromDate}&to=${toDate}`);
      const events = await res.json();
      
      calendarGrid.innerHTML = "";
      
      const dayNames = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES"];
      
      for (let i = 0; i < 5; i++) {
        const dayDate = addDays(currentCalendarMonday, i);
        const dateStr = dayDate.toISOString().split("T")[0];
        
        const dayEvents = events.filter(e => (e.date || "").startsWith(dateStr));
        const bmo = dayEvents.filter(e => e.time === "bmo");
        const amc = dayEvents.filter(e => e.time === "amc");
        const dmh = dayEvents.filter(e => e.time !== "bmo" && e.time !== "amc"); // Others
        
        let html = `<div class="calendar-day">
          <div class="calendar-day-header">
            <div class="calendar-day-name">${dayNames[i]}</div>
            <div class="calendar-day-date">${dayDate.getDate()}</div>
          </div>`;

        const renderSection = (title, items, cssClass) => {
          if (items.length === 0) return "";
          let sectionHtml = `<div class="time-section ${cssClass}">
            <div class="time-section-title">${title}</div>
            <div class="time-section-grid">`;
          
          items.forEach(item => {
            let bgClass = "ticker-bg-default";
            if (item.sector) {
              const sectorSlug = item.sector.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
              bgClass = `sector-${sectorSlug}`;
            }
            
            const companyStr = (item.companyName && item.companyName !== item.symbol) ? `<div class="ticker-tile__company">${item.companyName}</div>` : "";
            
            sectionHtml += `
              <div class="ticker-tile ${bgClass}" title="${item.companyName || item.symbol} - ${item.sector || 'Unknown'}">
                <div class="ticker-tile__logo">
                  <img src="https://images.financialmodelingprep.com/symbol/${item.symbol}.png" onerror="this.style.display='none'" alt="${item.symbol}">
                </div>
                <div class="ticker-tile__symbol">${item.symbol}</div>
                ${companyStr}
              </div>`;
          });
          
          sectionHtml += `</div></div>`;
          return sectionHtml;
        };

        html += renderSection("Before Open", bmo, "time-section--bmo");
        html += renderSection("During Market", dmh, "time-section--dmh");
        html += renderSection("After Close", amc, "time-section--amc");

        if (dayEvents.length === 0) {
          html += `<p style="font-size: 0.75rem; color: var(--text-muted); text-align: center; margin-top: 2rem;">Sin reportes</p>`;
        }

        html += `</div>`;
        calendarGrid.innerHTML += html;
      }

      // Attach click events directly to tiles for the Sidebar
      const tiles = calendarGrid.querySelectorAll(".ticker-tile");
      tiles.forEach(tile => {
        // Change cursor to indicate clickability
        tile.style.cursor = "pointer";
        
        tile.addEventListener("click", (e) => {
          e.preventDefault();
          const symbolElement = tile.querySelector(".ticker-tile__symbol");
          const symbol = symbolElement ? symbolElement.textContent.trim() : tile.textContent.trim().split('\n')[0].trim();
          showProfileSidebar(symbol);
        });
      });

    } catch (err) {
      calendarGrid.innerHTML = `<p style="color: var(--accent-red); grid-column: 1/-1;">Error: ${err.message}</p>`;
    }
  }

  if (prevWeekBtn) prevWeekBtn.addEventListener("click", () => {
    currentCalendarMonday = addDays(currentCalendarMonday, -7);
    loadCalendar();
  });

  if (nextWeekBtn) nextWeekBtn.addEventListener("click", () => {
    currentCalendarMonday = addDays(currentCalendarMonday, 7);
    loadCalendar();
  });

  if (currentWeekBtn) currentWeekBtn.addEventListener("click", () => {
    currentCalendarMonday = getMonday(new Date());
    loadCalendar();
  });


  // ── Sidebar Logic ──────────────────────────────────────────

  const profileSidebar = $("#profile-sidebar");
  const sidebarOverlay = $("#sidebar-overlay");
  const sidebarClose = $("#sidebar-close");
  const sidebarContent = $("#profile-sidebar-content");
  
  let currentSidebarSymbol = null;

  async function showProfileSidebar(symbol) {
    if (!profileSidebar) return;
    
    // Open sidebar & overlay
    profileSidebar.classList.add("open");
    sidebarOverlay.classList.add("visible");
    document.body.style.overflow = "hidden"; // Prevent background scrolling
    
    // Show loading state
    sidebarContent.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">Cargando perfil...</div>';
    currentSidebarSymbol = symbol;

    try {
      const res = await fetch(`/api/profile/${symbol}`);
      const profile = await res.json();
      
      // If we clicked another ticker before it loaded
      if (currentSidebarSymbol !== symbol) return;

      if (!profile || Object.keys(profile).length === 0) {
        sidebarContent.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">Perfil no disponible</div>';
        return;
      }

      const img = profile.image ? `<img src="${profile.image}" class="sidebar__logo" alt="${symbol}">` : '';
      const mktCap = profile.mktCap ? (profile.mktCap / 1e9).toFixed(2) + 'B' : 'N/A';
      
      sidebarContent.innerHTML = `
        <div class="sidebar__header-info">
          ${img}
          <div>
            <div class="sidebar__company-name">${profile.companyName || symbol}</div>
            <div class="sidebar__symbol">${profile.exchangeShortName || 'N/A'}: ${symbol} &nbsp;•&nbsp; $${profile.price || 'N/A'}</div>
          </div>
        </div>
        <div class="sidebar__body-info">
          <div class="sidebar__row">
            <span class="sidebar__label">Industria:</span>
            <span class="sidebar__value">${profile.industry || 'N/A'}</span>
          </div>
          <div class="sidebar__row">
            <span class="sidebar__label">Sector:</span>
            <span class="sidebar__value">${profile.sector || 'N/A'}</span>
          </div>
          <div class="sidebar__row">
            <span class="sidebar__label">Market Cap:</span>
            <span class="sidebar__value">$${mktCap}</span>
          </div>
          <div class="sidebar__row">
            <span class="sidebar__label">CEO:</span>
            <span class="sidebar__value">${profile.ceo || 'N/A'}</span>
          </div>
          <div class="sidebar__desc">
            <div class="sidebar__desc-title">Acerca de</div>
            <p>${profile.description || 'Sin descripción disponible.'}</p>
          </div>
        </div>
      `;
    } catch (err) {
      if (currentSidebarSymbol === symbol) {
        sidebarContent.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--accent-red);">Error al cargar perfil</div>';
      }
    }
  }

  function closeSidebar() {
    if (profileSidebar) profileSidebar.classList.remove("open");
    if (sidebarOverlay) sidebarOverlay.classList.remove("visible");
    document.body.style.overflow = "";
    currentSidebarSymbol = null;
  }

  if (sidebarClose) sidebarClose.addEventListener("click", closeSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener("click", closeSidebar);

  // ── Init ──────────────────────────────────────────────────

  loadDashboard();
  loadCalendar();
})();
