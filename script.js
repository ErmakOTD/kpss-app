// ======== ПУБЛИЧНАЯ ССЫЛКА ========
const PUBLISHED_HTML_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUMSq2ZBr4A0RpER5z6aXE49k6FEGHVumRZJm0SWHKit25wSpZI3buwEv08Anjg0llBHsweATSNzF6/pubhtml";
const SPREADSHEET_ID = "2PACX-1vRUMSq2ZBr4A0RpER5z6aXE49k6FEGHVumRZJm0SWHKit25wSpZI3buwEv08Anjg0llBHsweATSNzF6";

// ======== ВСТАВЬ СЮДА URL ТВОЕГО APPS SCRIPT WEB APP ========
// Пример: https://script.google.com/macros/s/AKfycb.../exec
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwwalEkAJu_6U34WK1gbwuC4q0y41Ez2zedWYoZntUmlxGmkSFTEmyqjfVt9wdIHeTQrA/exec";

// ======== ДАННЫЕ ========
let appData = { important: [], schedule: [], hashtags: [], gallery: [], other: [], chats: [] };
let loadAttempts = 0;

// ======== ФИЛЬТР "ПРОЧЕЕ" ========
let otherActiveTag = ""; // #tag

// ======== ADMIN ========
let isAdmin = false;
const ADMIN_PASSWORD = "kpssadmin";

// ======== START ========
window.onload = function () {
  initAdminTap();
  loadAllData();
  setInterval(() => { loadAttempts = 0; loadAllData(); }, 5 * 60 * 1000);

  window.onclick = function (e) {
    if (e.target.classList.contains("modal")) closeModal(e.target.id);
    if (e.target.classList.contains("image-modal")) closeImageModal();
  };
};

// ======== ЗАГРУЗКА ========
async function loadAllData() {
  showLoading(true);
  loadAttempts++;

  try {
    const pubhtml = await fetchWithTimeout(PUBLISHED_HTML_URL);
    if (!pubhtml) throw new Error("Не удалось получить pubhtml");

    const sheets = extractSheetsFromPubhtml(pubhtml);
    if (!sheets.length) throw new Error("Не найдено ни одной вкладки (gid) в pubhtml");

    const temp = { important: [], schedule: [], hashtags: [], gallery: [], other: [], chats: [] };

    for (const sh of sheets) {
      const csvUrl = `https://docs.google.com/spreadsheets/d/e/${SPREADSHEET_ID}/pub?output=csv&gid=${encodeURIComponent(sh.gid)}&single=true`;
      const csvText = await fetchWithTimeout(csvUrl);
      if (!csvText) continue;

      const rows = parseCsv(csvText);
      if (!rows || rows.length < 2) continue;

      const headers = (rows[0] || []).map(h => (h ?? "").toString().trim());
      const type = detectSheetType(headers);
      if (!type) continue;

      const data = rowsToObjects(rows, headers);
      if (data.length) temp[type] = temp[type].concat(data);
    }

    appData = temp;

    updateMembersText();

    if (hasData()) {
      renderAll();
      showLoading(false);
      showUpdateIndicator();
      if (isAdmin) renderAdminPage();
    } else {
      throw new Error("Нет данных (листы пустые или не распознаны по заголовкам)");
    }
  } catch (err) {
    console.error(err);

    if (loadAttempts < 3) {
      setTimeout(loadAllData, 1000);
    } else {
      showLoading(false);
      showError("Не удалось загрузить данные");
    }
  }
}

function updateMembersText() {
  // Если у тебя есть лист с участниками — тут можно считать.
  // Пока оставим заглушку:
  const text = "данные из таблицы";
  const m1 = document.getElementById("membersCount");
  const m2 = document.getElementById("headerMembers");
  if (m1) m1.textContent = text;
  if (m2) m2.textContent = text;
}

function hasData() {
  return (appData.important?.length || 0) > 0 ||
         (appData.schedule?.length || 0) > 0 ||
         (appData.hashtags?.length || 0) > 0 ||
         (appData.gallery?.length || 0) > 0 ||
         (appData.other?.length || 0) > 0 ||
         (appData.chats?.length || 0) > 0;
}

// ======== ВЫТАСКИВАЕМ GID ИЗ pubhtml ========
function extractSheetsFromPubhtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const links = Array.from(doc.querySelectorAll("a[href*='gid=']"));

    const found = new Map(); // gid -> title
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/gid=(\d+)/);
      if (!m) continue;
      const gid = m[1];
      const title = (a.textContent || "").trim() || `gid_${gid}`;
      if (!found.has(gid)) found.set(gid, title);
    }

    if (!found.size) {
      const re = /gid=(\d+)/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const gid = m[1];
        if (!found.has(gid)) found.set(gid, `gid_${gid}`);
      }
    }

    return Array.from(found.entries()).map(([gid, title]) => ({ gid, title }));
  } catch {
    return [];
  }
}

// ======== ОПРЕДЕЛЯЕМ ТИП ЛИСТА ПО ЗАГОЛОВКАМ ========
function detectSheetType(headers) {
  const h = headers.map(x => x.toLowerCase().trim());

  // important: sender,text,time/date,(link optional)
  if (h.includes("sender") && h.includes("text") && (h.includes("time") || h.includes("date"))) return "important";

  // schedule: day,time,subject,room,teacher
  if (h.includes("day") && h.includes("time") && h.includes("subject")) return "schedule";

  // hashtags: category,tag
  if (h.includes("category") && h.includes("tag")) return "hashtags";

  // gallery: title,image_url/date
  if (h.includes("title") && (h.includes("image_url") || h.includes("image"))) return "gallery";

  // other: title,url,hashtags/tags
  if (h.includes("title") && h.includes("url") && (h.includes("hashtags") || h.includes("tags"))) return "other";

  // chats: title,emoji,text
  if (h.includes("title") && (h.includes("emoji") || h.includes("icon")) && h.includes("text")) return "chats";

  return null;
}

function rowsToObjects(rows, headers) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(v => (v ?? "").toString().trim() === "")) continue;

    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const key = (headers[j] ?? "").toString().trim();
      if (!key) continue;
      obj[key] = (row[j] ?? "").toString().trim();
    }
    if (Object.keys(obj).length) out.push(obj);
  }
  return out;
}

// ======== CSV ПАРСЕР ========
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
      continue;
    }
    if (ch === "," && !inQuotes) { row.push(cur); cur = ""; continue; }
    if (ch === "\n" && !inQuotes) { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    cur += ch;
  }
  row.push(cur);
  rows.push(row);

  while (rows.length && rows[rows.length - 1].every(v => (v ?? "").toString().trim() === "")) rows.pop();
  return rows;
}

async function fetchWithTimeout(url, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-cache" });
    clearTimeout(id);
    return res.ok ? await res.text() : null;
  } catch {
    clearTimeout(id);
    return null;
  }
}

// ======== РЕНДЕР ========
function renderAll() {
  renderHomePage();
  renderSchedulePage();
  renderHashtagsPage();
  renderOtherPage();
  renderGalleryPage();
  renderImportantPage();
  // chats пока не показаны отдельной вкладкой — если надо, добавлю
}

function renderHomePage() {
  const container = document.getElementById("page-home");
  if (!container) return;

  let html = "";

  if (appData.important?.length) {
    html += `<div class="section">
      <div class="section-header" onclick="toggleSection(this)"><span>📌</span> Важное<span>▼</span></div>
      <div class="section-content">`;
    appData.important.slice(0, 3).forEach(item => {
      html += `<div class="important-card">
          <div class="sender">${escapeHtml(item.sender || "")}</div>
          <div class="text">${escapeHtml(item.text || "")}</div>
          ${item.link ? `<a href="${escapeAttr(item.link)}" target="_blank" class="link" onclick="event.stopPropagation()">🔗 Ссылка</a>` : ""}
          <div class="time">${escapeHtml(item.time || "")} ${item.date ? "· " + escapeHtml(item.date) : ""}</div>
        </div>`;
    });
    html += `</div></div>`;
  }

  if (appData.schedule?.length) {
    html += `<div class="section">
      <div class="section-header" onclick="toggleSection(this)"><span>📅</span> Ближайшее<span>▼</span></div>
      <div class="section-content"><div class="schedule-grid">`;
    appData.schedule.slice(0, 4).forEach(lesson => {
      html += `<div class="schedule-lesson">
          <div class="lesson-time">${escapeHtml(lesson.time || "")}</div>
          <div class="lesson-details">
            <div class="lesson-name">${escapeHtml(lesson.subject || "")}</div>
            <div class="lesson-place">${escapeHtml(lesson.room || "")} ${lesson.teacher ? "· " + escapeHtml(lesson.teacher) : ""}</div>
          </div>
        </div>`;
    });
    html += `</div></div></div>`;
  }

  if (appData.other?.length) {
    html += `<div class="section">
      <div class="section-header" onclick="toggleSection(this)"><span>🔗</span> Прочее<span>▼</span></div>
      <div class="section-content"><div class="other-list">`;

    appData.other.slice(0, 4).forEach(item => {
      const url = item.url || "";
      const title = item.title || "";
      const text = item.text || "";
      const date = item.date || "";
      const tags = splitTags(item.hashtags || item.tags || "");

      html += `<div class="other-item">
          <div class="other-icon">🔗</div>
          <div class="other-body">
            <div class="other-title">
              <a href="${escapeAttr(url)}" target="_blank" title="${escapeAttr(url)}">${escapeHtml(title)}</a>
              <span class="other-date">${escapeHtml(date)}</span>
            </div>
            ${text ? `<div class="other-text">${escapeHtml(text)}</div>` : ``}
            ${tags.length ? `<div class="other-tags">${tags.slice(0,6).map(t => `<span class="hashtag" onclick="openOtherWithTag('${escapeJs(t)}')">${escapeHtml(t)}</span>`).join("")}</div>` : ``}
          </div>
        </div>`;
    });

    html += `</div></div></div>`;
  }

  container.innerHTML = html || `<div class="section" style="padding:20px;text-align:center;">Нет данных</div>`;
}

function renderImportantPage() {
  const container = document.getElementById("page-important");
  if (!container) return;

  if (!appData.important?.length) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Нет важного</div>`;
    return;
  }

  let html = `<div class="section"><div class="section-header"><span>📌</span> Вся важная информация<span></span></div><div class="section-content">`;
  appData.important.forEach(item => {
    html += `<div class="important-card">
        <div class="sender">${escapeHtml(item.sender || "")}</div>
        <div class="text">${escapeHtml(item.text || "")}</div>
        ${item.link ? `<a href="${escapeAttr(item.link)}" target="_blank" class="link">🔗 Ссылка</a>` : ""}
        <div class="time">${escapeHtml(item.time || "")} ${item.date ? "· " + escapeHtml(item.date) : ""}</div>
      </div>`;
  });
  html += `</div></div>`;
  container.innerHTML = html;
}

function renderSchedulePage() {
  const container = document.getElementById("page-schedule");
  if (!container) return;

  if (!appData.schedule?.length) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Нет расписания</div>`;
    return;
  }

  const byDay = {};
  appData.schedule.forEach(lesson => {
    const day = lesson.day || "";
    if (!day) return;
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(lesson);
  });

  let html = `<div class="section"><div class="section-header"><span>📅</span> Полное расписание<span></span></div><div class="section-content"><div class="schedule-grid">`;
  Object.keys(byDay).forEach(day => {
    html += `<div class="schedule-day"><h3>${escapeHtml(day)}</h3>`;
    byDay[day].forEach(lesson => {
      html += `<div class="schedule-lesson">
          <div class="lesson-time">${escapeHtml(lesson.time || "")}</div>
          <div class="lesson-details">
            <div class="lesson-name">${escapeHtml(lesson.subject || "")}</div>
            <div class="lesson-place">${escapeHtml(lesson.room || "")} ${lesson.teacher ? "· " + escapeHtml(lesson.teacher) : ""}</div>
          </div>
        </div>`;
    });
    html += `</div>`;
  });
  html += `</div></div></div>`;
  container.innerHTML = html;
}

function renderHashtagsPage() {
  const container = document.getElementById("page-hashtags");
  if (!container) return;

  if (!appData.hashtags?.length) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Нет хэштегов</div>`;
    return;
  }

  const byCategory = {};
  appData.hashtags.forEach(t => {
    const cat = t.category || "Другое";
    const tag = t.tag || "";
    if (!tag) return;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(tag);
  });

  let html = `<div class="section">
    <div class="section-header"><span>✨</span> Все хэштеги<span></span></div>
    <div class="hashtags-container">`;

  Object.keys(byCategory).forEach(category => {
    html += `<div class="hashtag-category">
        <div class="category-title">${escapeHtml(category)}</div>
        <div class="hashtag-cloud">`;
    byCategory[category].forEach(tag => {
      html += `<span class="hashtag" onclick="openOtherWithTag('${escapeJs(tag)}')">${escapeHtml(tag)}</span>`;
    });
    html += `</div></div>`;
  });

  html += `</div></div>`;
  container.innerHTML = html;
}

function renderGalleryPage() {
  const container = document.getElementById("page-gallery");
  if (!container) return;

  if (!appData.gallery?.length) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Нет галереи</div>`;
    return;
  }

  let html = `<div class="section"><div class="section-header"><span>🖼️</span> Галерея<span></span></div><div class="gallery-grid">`;
  appData.gallery.forEach(item => {
    const imgUrl = item.image_url || item.image || "";
    html += `<div class="gallery-item" onclick="openImageModal('${escapeJs(imgUrl)}')">`;
    if (imgUrl) html += `<img class="gallery-image" src="${escapeAttr(imgUrl)}" onerror="this.style.display='none'">`;
    html += `<div class="gallery-caption">${escapeHtml(item.title || "")}</div></div>`;
  });
  html += `</div></div>`;
  container.innerHTML = html;
}

function renderOtherPage() {
  const container = document.getElementById("page-other");
  if (!container) return;

  const q = (document.getElementById("otherSearchInput")?.value || "").trim().toLowerCase();
  const tagFilter = (otherActiveTag || "").trim().toLowerCase();

  const items = (appData.other || []).filter(item => {
    const title = (item.title || "").toLowerCase();
    const text = (item.text || "").toLowerCase();
    const url = (item.url || "").toLowerCase();
    const tags = splitTags(item.hashtags || item.tags || "").map(t => t.toLowerCase());

    if (tagFilter) {
      if (!tags.includes(tagFilter)) return false;
    }

    if (!q) return true;

    if (q.startsWith("#")) {
      return tags.some(t => t.includes(q));
    }

    return title.includes(q) || text.includes(q) || url.includes(q) || tags.some(t => t.includes(q));
  });

  let html = `<div class="section">
    <div class="section-header">
      <span>🔗</span> Прочее
      <span>${tagFilter ? escapeHtml(otherActiveTag) : ""}</span>
    </div>
    <div class="section-content">
      <div class="hashtags-container" style="padding:12px 16px 6px 16px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          ${tagFilter ? `<span class="hashtag active" onclick="clearOtherTag()">Сбросить</span>` : `<span class="hashtag" onclick="clearOtherTag()">Сбросить</span>`}
          ${tagFilter ? `<span style="color:#b0b0b0;font-size:12px;">Фильтр по тегу включён</span>` : `<span style="color:#b0b0b0;font-size:12px;">Кликни тег или введи #тег в поиск</span>`}
        </div>
      </div>
      <div class="other-list">
  `;

  if (!items.length) {
    html += `<div style="padding:18px 16px;color:#b0b0b0;">Ничего не найдено</div>`;
  } else {
    items.forEach(item => {
      const url = item.url || "";
      const title = item.title || "";
      const text = item.text || "";
      const date = item.date || "";
      const tags = splitTags(item.hashtags || item.tags || "");

      html += `<div class="other-item">
          <div class="other-icon">🔗</div>
          <div class="other-body">
            <div class="other-title">
              <a href="${escapeAttr(url)}" target="_blank" title="${escapeAttr(url)}">${escapeHtml(title)}</a>
              <span class="other-date">${escapeHtml(date)}</span>
            </div>
            ${text ? `<div class="other-text">${escapeHtml(text)}</div>` : ``}
            ${tags.length ? `<div class="other-tags">${tags.map(t => `<span class="hashtag ${tagFilter && t.toLowerCase()===tagFilter ? "active":""}" onclick="setOtherTag('${escapeJs(t)}')">${escapeHtml(t)}</span>`).join("")}</div>` : ``}
          </div>
        </div>`;
    });
  }

  html += `</div></div></div>`;
  container.innerHTML = html;
}

// ======== NAV ========
function switchPage(pageName, el) {
  document.querySelectorAll(".menu-item").forEach(i => i.classList.remove("active"));
  if (el) el.classList.add("active");

  const titles = {
    home: "КПСС",
    schedule: "Расписание",
    hashtags: "Хэштеги",
    other: "Прочее",
    gallery: "Галерея",
    important: "Важное",
    admin: "⚙️ Админ"
  };
  document.getElementById("mainTitle").textContent = titles[pageName] || "КПСС";

  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const page = document.getElementById(`page-${pageName}`);
  if (page) page.classList.add("active");

  const sb = document.getElementById("otherSearchBox");
  if (sb) sb.style.display = (pageName === "other") ? "block" : "none";

  if (pageName === "other") renderOtherPage();
  if (pageName === "admin") renderAdminPage();
}

function openOtherWithTag(tag) {
  setOtherTag(tag);
  const otherMenuItem = Array.from(document.querySelectorAll(".menu-item"))
    .find(x => (x.textContent || "").toLowerCase().includes("прочее"));
  switchPage("other", otherMenuItem || null);
  document.getElementById("mainContent")?.scrollTo({ top: 0, behavior: "smooth" });
}

function setOtherTag(tag) {
  otherActiveTag = normalizeTag(tag);
  const inp = document.getElementById("otherSearchInput");
  if (inp) inp.value = "";
  renderOtherPage();
}

function clearOtherTag() {
  otherActiveTag = "";
  renderOtherPage();
}

function splitTags(s) {
  const raw = String(s || "").trim();
  if (!raw) return [];
  const parts = raw
    .replace(/,/g, " ")
    .split(/\s+/)
    .map(x => x.trim())
    .filter(Boolean)
    .map(normalizeTag);

  const seen = new Set();
  const out = [];
  for (const t of parts) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function normalizeTag(t) {
  const s = String(t || "").trim();
  if (!s) return "";
  return s.startsWith("#") ? s : ("#" + s);
}

// ======== UI HELPERS ========
function toggleSection(header) {
  const content = header.nextElementSibling;
  const arrow = header.querySelector("span:last-child");
  if (!content) return;
  if (content.style.display === "none") {
    content.style.display = "block";
    if (arrow) arrow.textContent = "▼";
  } else {
    content.style.display = "none";
    if (arrow) arrow.textContent = "▶";
  }
}

function openImageModal(imageUrl) {
  if (!imageUrl) return;
  document.getElementById("modalImage").src = imageUrl;
  document.getElementById("imageModal").classList.add("active");
}

function closeImageModal() {
  document.getElementById("imageModal").classList.remove("active");
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("closed");
  document.getElementById("mainContent").classList.toggle("expanded");
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.add("closed");
    document.getElementById("mainContent").classList.add("expanded");
  }
}

function showLoading(show) {
  document.getElementById("loading").style.display = show ? "flex" : "none";
  document.getElementById("app").style.display = show ? "none" : "block";
  document.getElementById("error").style.display = "none";
}

function showError(message) {
  document.getElementById("error").style.display = "block";
  document.getElementById("errorMessage").textContent = message;
  document.getElementById("app").style.display = "none";
  document.getElementById("loading").style.display = "none";
}

function showUpdateIndicator() {
  const ind = document.getElementById("updateIndicator");
  ind.classList.add("show");
  setTimeout(() => ind.classList.remove("show"), 2000);
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove("active");
}

function refreshData() {
  loadAttempts = 0;
  loadAllData();
}

// ======== SAFE ========
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
function escapeJs(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

// ======== RIGHT DRAWER ========
function openDrawer() {
  document.getElementById("rightDrawer")?.classList.add("open");
  document.getElementById("drawerBackdrop")?.classList.add("show");
}
function closeDrawer() {
  document.getElementById("rightDrawer")?.classList.remove("open");
  document.getElementById("drawerBackdrop")?.classList.remove("show");
}

function showAbout() {
  closeDrawer();
  document.getElementById("infoModalTitle").textContent = "О проекте";
  document.getElementById("infoModalContent").innerHTML = `
    <div style="color:#b0b0b0;font-size:14px;line-height:1.5;">
      КПСС — сайт/приложение, которое читает данные из Google Таблицы и показывает их красиво.
      <br><br>
      <b>Скрытая админка:</b> 5 раз нажми на “КПСС” в боковом меню.
    </div>
  `;
  document.getElementById("infoModal").classList.add("active");
}

// ======== ADMIN: 5 taps ========
let tapCount = 0;
let tapTimer = null;

function initAdminTap() {
  const title = document.getElementById("kpssTitle");
  if (!title) return;

  title.addEventListener("click", () => {
    tapCount++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => (tapCount = 0), 1200);

    if (tapCount >= 5) {
      tapCount = 0;
      showAdminPasswordModal();
    }
  });
}

function showAdminPasswordModal() {
  document.getElementById("infoModalTitle").textContent = "Админ-доступ";
  document.getElementById("infoModalContent").innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="color:#b0b0b0;font-size:13px;">Введи пароль:</div>
      <input id="adminPassInput" type="password"
            style="width:100%;padding:14px 16px;border-radius:14px;background:#404040;border:1px solid #505050;color:#f0f0f0;font-size:14px;"
            placeholder="Пароль" />
      <button class="retry-btn" style="margin-top:6px;" onclick="checkAdminPassword()">Войти</button>
      <div id="adminPassError" style="color:#ff99cc;font-size:13px;display:none;">Неверный пароль</div>
    </div>
  `;
  document.getElementById("infoModal").classList.add("active");
  setTimeout(() => document.getElementById("adminPassInput")?.focus(), 50);
}

function checkAdminPassword() {
  const v = document.getElementById("adminPassInput")?.value || "";
  const err = document.getElementById("adminPassError");
  if (v === ADMIN_PASSWORD) {
    isAdmin = true;
    closeModal("infoModal");
    enableAdminUI();
    showUpdateIndicator();
  } else {
    if (err) err.style.display = "block";
  }
}

function enableAdminUI() {
  const mi = document.getElementById("adminMenuItem");
  if (mi) mi.style.display = "flex";
  renderAdminPage();
}

function renderAdminPage() {
  const container = document.getElementById("page-admin");
  if (!container) return;

  if (!isAdmin) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Нет доступа</div>`;
    return;
  }

  container.innerHTML = `
    <div class="admin-wrap">
      <div class="admin-card">
        <h3>📌 Важное</h3>
        <div class="admin-row">
          <input id="adm_imp_sender" placeholder="Отправитель (sender)" value="Староста">
          <textarea id="adm_imp_text" rows="3" placeholder="Текст"></textarea>
          <input id="adm_imp_link" placeholder="Ссылка (необязательно)">
          <input id="adm_imp_time" placeholder="Время (например 12:30)">
          <input id="adm_imp_date" placeholder="Дата (например 03.03.2026)">
          <button class="admin-btn" onclick="submitAdmin('important')">Отправить</button>
          <div class="admin-note">Добавит строку в лист <b>important</b>.</div>
        </div>
      </div>

      <div class="admin-card">
        <h3>💬 Чаты</h3>
        <div class="admin-row">
          <input id="adm_chat_title" placeholder="Название">
          <input id="adm_chat_emoji" placeholder="Эмодзи (например 🔥)">
          <textarea id="adm_chat_text" rows="3" placeholder="Сообщение"></textarea>
          <button class="admin-btn" onclick="submitAdmin('chats')">Отправить</button>
          <div class="admin-note">Добавит строку в лист <b>chats</b>.</div>
        </div>
      </div>

      <div class="admin-card">
        <h3>📅 Расписание</h3>
        <div class="admin-row">
          <input id="adm_s_day" placeholder="День (например Понедельник)">
          <input id="adm_s_time" placeholder="Время (например 09:00)">
          <input id="adm_s_subject" placeholder="Предмет">
          <input id="adm_s_room" placeholder="Кабинет">
          <input id="adm_s_teacher" placeholder="Преподаватель (необязательно)">
          <button class="admin-btn" onclick="submitAdmin('schedule')">Отправить</button>
          <div class="admin-note">Добавит строку в лист <b>schedule</b>.</div>
        </div>
      </div>

      <div class="admin-card">
        <h3>🖼️ Галерея</h3>
        <div class="admin-row">
          <input id="adm_g_title" placeholder="Название">
          <input id="adm_g_url" placeholder="Ссылка на картинку (image_url)">
          <input id="adm_g_date" placeholder="Дата (необязательно)">
          <button class="admin-btn" onclick="submitAdmin('gallery')">Отправить</button>
          <div class="admin-note">Добавит строку в лист <b>gallery</b>.</div>
        </div>
      </div>

      <div class="admin-card">
        <h3>🔧 Примечание</h3>
        <div class="admin-note">
          После отправки данные добавятся в Google Таблицу. Затем нажми <b>🔄 Обновить данные</b> (кружок ● сверху справа).
        </div>
      </div>
    </div>
  `;
}

function val(id) {
  const el = document.getElementById(id);
  return (el?.value || "").trim();
}

// Отправка в Apps Script
async function submitAdmin(type) {
  if (!isAdmin) return;

  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("PASTE_YOUR")) {
    alert("Сначала вставь APPS_SCRIPT_URL (Web App) в index.html");
    return;
  }

  let data = {};
  if (type === "important") {
    data = {
      sender: val("adm_imp_sender"),
      text: val("adm_imp_text"),
      link: val("adm_imp_link"),
      time: val("adm_imp_time"),
      date: val("adm_imp_date")
    };
    if (!data.text) return alert("Заполни текст (important)");
  }
  if (type === "chats") {
    data = { title: val("adm_chat_title"), emoji: val("adm_chat_emoji"), text: val("adm_chat_text") };
    if (!data.title || !data.text) return alert("Заполни название и сообщение (chats)");
  }
  if (type === "schedule") {
    data = { day: val("adm_s_day"), time: val("adm_s_time"), subject: val("adm_s_subject"), room: val("adm_s_room"), teacher: val("adm_s_teacher") };
    if (!data.day || !data.time || !data.subject) return alert("Заполни день, время, предмет (schedule)");
  }
  if (type === "gallery") {
    data = { title: val("adm_g_title"), image_url: val("adm_g_url"), date: val("adm_g_date") };
    if (!data.title || !data.image_url) return alert("Заполни название и ссылку на картинку (gallery)");
  }

  // ВАЖНО: отправляем как form-urlencoded, без JSON заголовков (иначе preflight/CORS)
  const payload = JSON.stringify({ type, data });
  const body = "payload=" + encodeURIComponent(payload);

  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors", // важно: иначе браузер блокирует
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body
    });

    // Мы не можем прочитать ответ (no-cors), поэтому просто считаем успехом
    showUpdateIndicator();
    loadAttempts = 0;
    loadAllData();
  } catch (e) {
    alert("Ошибка отправки: " + (e?.message || e));
  }
}
