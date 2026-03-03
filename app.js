/* ===================== CONFIG ===================== */

// Основная таблица (чтение)
const PUBLISHED_HTML_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUMSq2ZBr4A0RpER5z6aXE49k6FEGHVumRZJm0SWHKit25wSpZI3buwEv08Anjg0llBHsweATSNzF6/pubhtml";
const SPREADSHEET_ID = "2PACX-1vRUMSq2ZBr4A0RpER5z6aXE49k6FEGHVumRZJm0SWHKit25wSpZI3buwEv08Anjg0llBHsweATSNzF6";

// Users/Chat API (обязательно /exec)
const USERS_CHAT_API_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ13vq3-vw9K1dtgZ8x-xW8CUZElJkXoEqDaX9IazumBLHrWnlVhOR9Q7HA5OdIr5lvyM7TlGymdwNT/pubhtml";

// Admin запись (если нужна)
const MAIN_DATA_APPS_SCRIPT_URL = "PASTE_MAIN_DATA_WEBAPP_EXEC_URL_HERE";
const ADMIN_PASSWORD = "kpssadmin";

/* ===================== STATE ===================== */

let appData = { important: [], schedule: [], hashtags: [], gallery: [], other: [], chats: [] };
let loadAttempts = 0;
let otherActiveTag = "";

let isAdmin = false;

// auth
let currentUser = null;
let currentPeer = null;

// chat loading
let seenMsgIds = new Set();     // FIX дублей
let lastCursor = null;          // cursor = created_at of last received
let chatTimer = null;

// unread global
let globalUnread = 0;

// emoji list
const EMOJIS = ["😀","😄","😁","😂","😅","😊","😍","😘","😎","🤔","😴","😭","😡","👍","👎","🙏","🔥","💯","🎉","❤️","💔","🤝","✅","⚠️","📌","📅","📍","💬","🫶"];

/* ===================== INIT ===================== */

window.addEventListener("load", () => {
  bindUI();
  loadSession();
  initAdminTap();

  loadAllData();
  setInterval(() => { loadAttempts = 0; loadAllData(); }, 5 * 60 * 1000);

  // swipe: open right drawer by swiping LEFT
  initSwipeForDrawer();
});

/* ===================== UI BINDINGS ===================== */

function bindUI() {
  // header buttons
  $("#menuSquareBtn").addEventListener("click", toggleSidebar);
  $("#circleMenuBtn").addEventListener("click", openDrawer);

  // drawer
  $("#drawerBackdrop").addEventListener("click", closeDrawer);
  $("#drawerCloseBtn").addEventListener("click", closeDrawer);
  $("#drawerRefreshBtn").addEventListener("click", () => { refreshData(); closeDrawer(); });
  $("#drawerAuthBtn").addEventListener("click", () => { openAuthModal(); closeDrawer(); });
  $("#drawerLogoutBtn").addEventListener("click", () => { logoutUser(); closeDrawer(); });
  $("#drawerReloadBtn").addEventListener("click", () => location.reload());
  $("#drawerAboutBtn").addEventListener("click", () => { showAbout(); closeDrawer(); });

  // modal close
  $("#modalCloseBtn").addEventListener("click", () => closeModal("infoModal"));

  // image modal
  $("#imageModalCloseBtn").addEventListener("click", closeImageModal);
  $("#imageModal").addEventListener("click", (e) => {
    if (e.target.id === "imageModal") closeImageModal();
  });

  // sidebar nav click
  document.querySelectorAll(".menu-item[data-page]").forEach(item => {
    item.addEventListener("click", () => {
      switchPage(item.dataset.page, item);
      closeSidebarOnMobile();
    });
  });

  // other search
  $("#otherSearchInput").addEventListener("keyup", () => renderOtherPage());
}

/* ===================== MENU / PAGES ===================== */

function toggleSidebar() {
  $("#sidebar").classList.toggle("closed");
  $("#mainContent").classList.toggle("expanded");
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 768) {
    $("#sidebar").classList.add("closed");
    $("#mainContent").classList.add("expanded");
  }
}

function switchPage(pageName, el) {
  // stop chat timer if leaving chat
  if (pageName !== "chat") stopChatTimer();

  document.querySelectorAll(".menu-item").forEach(i => i.classList.remove("active"));
  if (el) el.classList.add("active");

  const titles = {
    home:"КПСС", schedule:"Расписание", hashtags:"Хэштеги", other:"Прочее",
    gallery:"Галерея", important:"Важное", chats:"Чаты", contacts:"Контакты",
    chat:"Чат", admin:"⚙️ Админ"
  };
  $("#mainTitle").textContent = titles[pageName] || "КПСС";

  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const page = $(`#page-${pageName}`);
  if (page) page.classList.add("active");

  $("#otherSearchBox").style.display = (pageName === "other") ? "block" : "none";

  if (pageName === "other") renderOtherPage();
  if (pageName === "admin") renderAdminPage();
  if (pageName === "contacts") renderContactsPage();
  if (pageName === "chats") renderChatsPage();
  if (pageName === "chat") renderChatPage();
}

/* ===================== DRAWER ===================== */

function openDrawer() {
  $("#rightDrawer").classList.add("open");
  $("#drawerBackdrop").classList.add("show");
}
function closeDrawer() {
  $("#rightDrawer").classList.remove("open");
  $("#drawerBackdrop").classList.remove("show");
}

/* swipe left to open drawer (from right edge) */
function initSwipeForDrawer() {
  let startX = 0, startY = 0, tracking = false;

  window.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    // start near right edge to avoid conflict with scrolling
    tracking = (window.innerWidth - startX) < 40;
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;

    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    // swipe left: dx negative
    if (Math.abs(dx) > 70 && Math.abs(dy) < 40 && dx < 0) {
      openDrawer();
    }
  }, { passive: true });

  // swipe right to close drawer (anywhere on drawer)
  $("#rightDrawer").addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
  }, { passive: true });

  $("#rightDrawer").addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 40 && dx > 0) closeDrawer();
  }, { passive: true });
}

/* ===================== LOADING MAIN DATA ===================== */

async function loadAllData() {
  showLoading(true);
  loadAttempts++;

  try {
    const pubhtml = await fetchWithTimeout(PUBLISHED_HTML_URL);
    if (!pubhtml) throw new Error("Не удалось получить pubhtml");

    const sheets = extractSheetsFromPubhtml(pubhtml);
    if (!sheets.length) throw new Error("Не найдено ни одной вкладки (gid)");

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
      renderAllMainPages();
      showLoading(false);
      showUpdateIndicator();
    } else {
      throw new Error("Нет данных (листы пустые или не распознаны)");
    }

    // refresh unread if logged in
    if (currentUser) refreshGlobalUnread();

  } catch (err) {
    console.error(err);
    if (loadAttempts < 3) setTimeout(loadAllData, 1000);
    else { showLoading(false); showError("Не удалось загрузить данные"); }
  }
}

function refreshData() { loadAttempts = 0; loadAllData(); }

function hasData() {
  return (appData.important?.length || 0) > 0 ||
    (appData.schedule?.length || 0) > 0 ||
    (appData.hashtags?.length || 0) > 0 ||
    (appData.gallery?.length || 0) > 0 ||
    (appData.other?.length || 0) > 0 ||
    (appData.chats?.length || 0) > 0;
}

/* ===================== RENDER MAIN PAGES ===================== */

function renderAllMainPages() {
  renderHomePage();
  renderSchedulePage();
  renderHashtagsPage();
  renderOtherPage();
  renderGalleryPage();
  renderImportantPage();
}

function renderHomePage() {
  const container = $("#page-home");
  let html = "";

  if (appData.important?.length) {
    html += `<div class="section">
      <div class="section-header" data-toggle><span>📌</span> Важное<span>▼</span></div>
      <div class="section-content">`;
    appData.important.slice(0, 3).forEach(item => {
      html += `<div class="important-card">
        <div class="sender">${esc(item.sender || "")}</div>
        <div class="text">${esc(item.text || "")}</div>
        ${item.link ? `<a class="link" href="${escAttr(item.link)}" target="_blank">🔗 Ссылка</a>` : ""}
        <div class="time">${esc(item.time || "")} ${item.date ? "· " + esc(item.date) : ""}</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  if (appData.schedule?.length) {
    html += `<div class="section">
      <div class="section-header" data-toggle><span>📅</span> Ближайшее<span>▼</span></div>
      <div class="section-content"><div class="schedule-grid">`;
    appData.schedule.slice(0, 4).forEach(lesson => {
      html += `<div class="schedule-lesson">
        <div class="lesson-time">${esc(lesson.time || "")}</div>
        <div class="lesson-details">
          <div class="lesson-name">${esc(lesson.subject || "")}</div>
          <div class="lesson-place">${esc(lesson.room || "")} ${lesson.teacher ? "· " + esc(lesson.teacher) : ""}</div>
        </div>
      </div>`;
    });
    html += `</div></div></div>`;
  }

  container.innerHTML = html || `<div class="section" style="padding:20px;text-align:center;">Нет данных</div>`;
  bindSectionToggles(container);
}

function renderImportantPage() {
  const container = $("#page-important");
  if (!appData.important?.length) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Нет важного</div>`;
    return;
  }
  let html = `<div class="section">
    <div class="section-header" style="cursor:default;"><span>📌</span> Вся важная информация<span></span></div>
    <div class="section-content">`;
  appData.important.forEach(item => {
    html += `<div class="important-card">
      <div class="sender">${esc(item.sender || "")}</div>
      <div class="text">${esc(item.text || "")}</div>
      ${item.link ? `<a class="link" href="${escAttr(item.link)}" target="_blank">🔗 Ссылка</a>` : ""}
      <div class="time">${esc(item.time || "")} ${item.date ? "· " + esc(item.date) : ""}</div>
    </div>`;
  });
  html += `</div></div>`;
  container.innerHTML = html;
}

function renderSchedulePage() {
  const container = $("#page-schedule");
  if (!appData.schedule?.length) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Нет расписания</div>`;
    return;
  }

  const byDay = {};
  appData.schedule.forEach(lesson => {
    const day = lesson.day || "";
    if (!day) return;
    (byDay[day] ||= []).push(lesson);
  });

  let html = `<div class="section">
    <div class="section-header" style="cursor:default;"><span>📅</span> Полное расписание<span></span></div>
    <div class="section-content"><div class="schedule-grid">`;

  Object.keys(byDay).forEach(day => {
    html += `<div class="schedule-day"><h3>${esc(day)}</h3>`;
    byDay[day].forEach(lesson => {
      html += `<div class="schedule-lesson">
        <div class="lesson-time">${esc(lesson.time || "")}</div>
        <div class="lesson-details">
          <div class="lesson-name">${esc(lesson.subject || "")}</div>
          <div class="lesson-place">${esc(lesson.room || "")} ${lesson.teacher ? "· " + esc(lesson.teacher) : ""}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  });

  html += `</div></div></div>`;
  container.innerHTML = html;
}

function renderHashtagsPage() {
  const container = $("#page-hashtags");
  if (!appData.hashtags?.length) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Нет хэштегов</div>`;
    return;
  }

  const byCategory = {};
  appData.hashtags.forEach(t => {
    const cat = t.category || "Другое";
    const tag = t.tag || "";
    if (!tag) return;
    (byCategory[cat] ||= []).push(tag.startsWith("#") ? tag : "#" + tag);
  });

  let html = `<div class="section">
    <div class="section-header" style="cursor:default;"><span>✨</span> Все хэштеги<span></span></div>
    <div class="hashtags-container">`;

  Object.keys(byCategory).forEach(category => {
    html += `<div class="hashtag-category">
      <div class="category-title">${esc(category)}</div>
      <div class="hashtag-cloud">`;
    byCategory[category].forEach(tag => {
      html += `<span class="hashtag" data-open-other="${escAttr(tag)}">${esc(tag)}</span>`;
    });
    html += `</div></div>`;
  });

  html += `</div></div>`;
  container.innerHTML = html;

  container.querySelectorAll("[data-open-other]").forEach(el => {
    el.addEventListener("click", () => openOtherWithTag(el.getAttribute("data-open-other")));
  });
}

function renderGalleryPage() {
  const container = $("#page-gallery");
  if (!appData.gallery?.length) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Нет галереи</div>`;
    return;
  }

  let html = `<div class="section">
    <div class="section-header" style="cursor:default;"><span>🖼️</span> Галерея<span></span></div>
    <div class="gallery-grid">`;

  appData.gallery.forEach(item => {
    const imgUrl = item.image_url || item.image || "";
    html += `<div class="gallery-item" data-img="${escAttr(imgUrl)}">`;
    if (imgUrl) html += `<img class="gallery-image" src="${escAttr(imgUrl)}" onerror="this.style.display='none'">`;
    html += `<div class="gallery-caption">${esc(item.title || "")}</div></div>`;
  });

  html += `</div></div>`;
  container.innerHTML = html;

  container.querySelectorAll("[data-img]").forEach(el => {
    el.addEventListener("click", () => openImageModal(el.getAttribute("data-img")));
  });
}

function renderOtherPage() {
  const container = $("#page-other");
  const q = ($("#otherSearchInput")?.value || "").trim().toLowerCase();
  const tagFilter = (otherActiveTag || "").trim().toLowerCase();

  const items = (appData.other || []).filter(item => {
    const title = (item.title || "").toLowerCase();
    const text = (item.text || "").toLowerCase();
    const url = (item.url || "").toLowerCase();
    const tags = splitTags(item.hashtags || item.tags || "").map(t => t.toLowerCase());

    if (tagFilter && !tags.includes(tagFilter)) return false;
    if (!q) return true;
    if (q.startsWith("#")) return tags.some(t => t.includes(q));
    return title.includes(q) || text.includes(q) || url.includes(q) || tags.some(t => t.includes(q));
  });

  let html = `<div class="section">
    <div class="section-header" style="cursor:default;">
      <span>🔗</span> Прочее
      <span>${tagFilter ? esc(otherActiveTag) : ""}</span>
    </div>
    <div class="section-content">
      <div class="other-list">`;

  if (!items.length) {
    html += `<div style="padding:18px 16px;color:#b0b0b0;">Ничего не найдено</div>`;
  } else {
    items.forEach(item => {
      html += `<div class="other-item" onclick="window.open('${escAttr(item.url || "")}','_blank')">
        <div class="other-icon">🔗</div>
        <div class="other-body">
          <div class="other-title">
            <div class="t">${esc(item.title || "")}</div>
            <div class="other-date">${esc(item.date || "")}</div>
          </div>
          ${item.text ? `<div class="other-text">${esc(item.text)}</div>` : ``}
        </div>
      </div>`;
    });
  }

  html += `</div></div></div>`;
  container.innerHTML = html;
}

function bindSectionToggles(container) {
  container.querySelectorAll("[data-toggle]").forEach(h => {
    h.addEventListener("click", () => {
      const content = h.nextElementSibling;
      const arrow = h.querySelector("span:last-child");
      if (!content) return;
      const hidden = content.style.display === "none";
      content.style.display = hidden ? "block" : "none";
      if (arrow) arrow.textContent = hidden ? "▼" : "▶";
    });
  });
}

/* ===================== OTHER TAGS ===================== */

function openOtherWithTag(tag) {
  otherActiveTag = normalizeTag(tag);
  $("#otherSearchInput").value = "";
  // activate menu item
  const otherMenu = [...document.querySelectorAll(".menu-item")].find(x => x.dataset.page === "other");
  switchPage("other", otherMenu || null);
  $("#mainContent").scrollTo({ top: 0, behavior: "smooth" });
}

function splitTags(s) {
  const raw = String(s || "").trim();
  if (!raw) return [];
  return raw.replace(/,/g," ").split(/\s+/).map(x=>x.trim()).filter(Boolean).map(normalizeTag);
}
function normalizeTag(t) {
  const s = String(t||"").trim();
  if (!s) return "";
  return s.startsWith("#") ? s : ("#" + s);
}

/* ===================== AUTH + CONTACTS + CHATS ===================== */

function loadSession() {
  try {
    const s = localStorage.getItem("kpss_user");
    if (s) currentUser = JSON.parse(s);
  } catch {}
  updateAuthUI();
}

function saveSession(u) {
  currentUser = u;
  localStorage.setItem("kpss_user", JSON.stringify(u));
  updateMembersText();
  updateAuthUI();
  refreshGlobalUnread();
}

function logoutUser() {
  stopChatTimer();
  currentUser = null;
  currentPeer = null;
  localStorage.removeItem("kpss_user");
  updateMembersText();
  updateAuthUI();
  showUpdateIndicator();
  // back home
  const homeMenu = [...document.querySelectorAll(".menu-item")].find(x => x.dataset.page === "home");
  switchPage("home", homeMenu || null);
}

function updateMembersText() {
  const text = currentUser ? `👤 ${currentUser.username}` : "данные из таблицы";
  $("#membersCount").textContent = text;
  $("#headerMembers").textContent = text;
}

function updateAuthUI() {
  const logged = !!currentUser;
  $("#contactsMenuItem").style.display = logged ? "flex" : "none";
  $("#chatsMenuItem").style.display = logged ? "flex" : "none";
  $("#drawerLogoutBtn").style.display = logged ? "block" : "none";
}

function showAbout() {
  openModal("О проекте", `
    <div style="color:#b0b0b0;font-size:14px;line-height:1.5;">
      КПСС — сайт/приложение, которое читает данные из Google Таблицы.
      <br><br>
      <b>Админка:</b> 5 раз нажми на “КПСС” в боковом меню.
      <br><br>
      <b>Чаты:</b> регистрация и сообщения в отдельной таблице KPSS_USERS_CHAT через WebApp API.
    </div>
  `);
}

function openAuthModal() {
  openModal("Вход / Регистрация", `
    <div class="auth-form">
      <input id="auth_username" placeholder="Username (уникальный)">
      <input id="auth_pass" type="password" placeholder="Пароль">
      <button class="btn" id="authLoginBtn">Войти</button>
      <button class="btn" id="authRegBtn" style="background:#404040;color:#ff99cc;border:1px solid #505050;">Зарегистрироваться</button>
      <div id="auth_err" style="color:#ff99cc;font-size:13px;display:none;margin-top:8px;"></div>
      <div style="color:#808080;font-size:12px;line-height:1.35;margin-top:10px;">
        * Это простая регистрация (для группы), не для “важных” паролей.
      </div>
    </div>
  `);

  $("#authLoginBtn").onclick = authLogin;
  $("#authRegBtn").onclick = authRegister;
}

function authErr(msg) {
  const el = $("#auth_err");
  el.style.display = "block";
  el.textContent = msg;
}

function ensureChatApi() {
  return USERS_CHAT_API_URL && !USERS_CHAT_API_URL.includes("PASTE_");
}

async function authLogin() {
  const u = ($("#auth_username").value || "").trim();
  const p = ($("#auth_pass").value || "").trim();
  if (!u || !p) return authErr("Заполни username и пароль");
  if (!ensureChatApi()) return authErr("Вставь USERS_CHAT_API_URL (/exec) в app.js");

  try {
    const r = await jsonp(`${USERS_CHAT_API_URL}?action=login&username=${enc(u)}&pass=${enc(p)}`);
    if (!r?.ok) return authErr(r?.error || "Ошибка входа");
    saveSession(r.data);
    closeModal("infoModal");
    showUpdateIndicator();
  } catch (e) {
    authErr("Ошибка сети: " + (e?.message || e));
  }
}

async function authRegister() {
  const u = ($("#auth_username").value || "").trim();
  const p = ($("#auth_pass").value || "").trim();
  if (!u || !p) return authErr("Заполни username и пароль");
  if (!ensureChatApi()) return authErr("Вставь USERS_CHAT_API_URL (/exec) в app.js");

  try {
    const r = await jsonp(`${USERS_CHAT_API_URL}?action=register&username=${enc(u)}&pass=${enc(p)}`);
    if (!r?.ok) return authErr(r?.error || "Ошибка регистрации");
    saveSession(r.data);
    closeModal("infoModal");
    showUpdateIndicator();
  } catch (e) {
    authErr("Ошибка сети: " + (e?.message || e));
  }
}

/* Telegram-like chats list */
async function renderChatsPage() {
  const container = $("#page-chats");
  if (!currentUser) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Войди, чтобы видеть чаты</div>`;
    return;
  }
  if (!ensureChatApi()) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;color:#ff99cc;">Нужен USERS_CHAT_API_URL</div>`;
    return;
  }

  container.innerHTML = `<div class="section" style="padding:20px;">Загрузка...</div>`;

  try {
    const r = await jsonp(`${USERS_CHAT_API_URL}?action=chats&user_id=${enc(currentUser.user_id)}`);
    if (!r?.ok) throw new Error(r?.error || "Ошибка");

    const chats = r.data || [];
    globalUnread = chats.reduce((s,c)=>s+(Number(c.unread||0)),0);
    updateGlobalUnreadBadge();

    let html = `<div class="section">
      <div class="section-header" style="cursor:default;"><span>💬</span> Чаты<span>${esc(currentUser.username)}</span></div>
      <div class="section-content"><div class="other-list">`;

    if (!chats.length) {
      html += `<div style="padding:18px 16px;color:#b0b0b0;">Нет чатов. Открой “Контакты” и напиши кому-то.</div>`;
    } else {
      chats.forEach(c => {
        html += `
          <div class="other-item" data-open-chat="${escAttr(c.peer_id)}" data-peer-name="${escAttr(c.peer_name)}">
            <div class="other-icon">👤</div>
            <div class="other-body">
              <div class="other-title">
                <div class="t">${esc(c.peer_name)}</div>
                <div class="row-right">
                  <span class="other-date">${esc(formatTime(c.last_time))}</span>
                  ${Number(c.unread||0) ? `<span class="badge">${Number(c.unread||0)}</span>` : ``}
                </div>
              </div>
              <div class="other-text">${esc(c.last_text || "…")}</div>
            </div>
          </div>
        `;
      });
    }

    html += `</div></div></div>`;
    container.innerHTML = html;

    container.querySelectorAll("[data-open-chat]").forEach(el => {
      el.addEventListener("click", () => {
        openChat(el.getAttribute("data-open-chat"), el.getAttribute("data-peer-name"));
      });
    });

  } catch (e) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;color:#ff99cc;">Ошибка: ${esc(e?.message || e)}</div>`;
  }
}

/* Contacts show last msg + button "write" */
async function renderContactsPage() {
  const container = $("#page-contacts");
  if (!currentUser) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Войди, чтобы видеть контакты</div>`;
    return;
  }
  if (!ensureChatApi()) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;color:#ff99cc;">Нужен USERS_CHAT_API_URL</div>`;
    return;
  }

  container.innerHTML = `<div class="section" style="padding:20px;">Загрузка...</div>`;

  try {
    // contacts_with_last includes last_text/last_time/unread
    const r = await jsonp(`${USERS_CHAT_API_URL}?action=contacts_with_last&user_id=${enc(currentUser.user_id)}`);
    if (!r?.ok) throw new Error(r?.error || "Ошибка");

    const list = r.data || [];
    globalUnread = list.reduce((s,c)=>s+(Number(c.unread||0)),0);
    updateGlobalUnreadBadge();

    let html = `<div class="section">
      <div class="section-header" style="cursor:default;"><span>📇</span> Контакты<span>${esc(currentUser.username)}</span></div>
      <div class="section-content"><div class="other-list">`;

    if (!list.length) {
      html += `<div style="padding:18px 16px;color:#b0b0b0;">Пока нет других пользователей</div>`;
    } else {
      list.forEach(c => {
        html += `
          <div class="other-item" data-open-chat="${escAttr(c.user_id)}" data-peer-name="${escAttr(c.username)}">
            <div class="other-icon">👤</div>
            <div class="other-body">
              <div class="other-title">
                <div class="t">${esc(c.username)}</div>
                <div class="row-right">
                  <span class="other-date">${esc(formatTime(c.last_time))}</span>
                  ${Number(c.unread||0) ? `<span class="badge">${Number(c.unread||0)}</span>` : ``}
                </div>
              </div>
              <div class="other-text">${esc(c.last_text || "Написать сообщение")}</div>
            </div>
          </div>
        `;
      });
    }

    html += `</div></div></div>`;
    container.innerHTML = html;

    container.querySelectorAll("[data-open-chat]").forEach(el => {
      el.addEventListener("click", () => {
        openChat(el.getAttribute("data-open-chat"), el.getAttribute("data-peer-name"));
      });
    });

  } catch (e) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;color:#ff99cc;">Ошибка: ${esc(e?.message || e)}</div>`;
  }
}

/* ===================== CHAT PAGE ===================== */

function openChat(peerId, peerName) {
  currentPeer = { user_id: peerId, username: peerName };
  seenMsgIds = new Set();
  lastCursor = null;

  // go chat page
  switchPage("chat", null);

  // mark read immediately (server)
  markRead().catch(()=>{});
}

function renderChatPage() {
  const container = $("#page-chat");
  if (!currentUser) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Нужен вход</div>`;
    return;
  }
  if (!currentPeer) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Выбери контакт</div>`;
    return;
  }

  container.innerHTML = `
    <div class="section">
      <div class="chat-header-row">
        <div class="chat-back" id="chatBackBtn">←</div>
        <div class="chat-title">${esc(currentPeer.username)}</div>
        <div style="color:#808080;font-size:12px;" id="readHint"></div>
      </div>

      <div class="chat-wrap">
        <div id="chatBox" class="chat-box"></div>

        <div id="emojiPanel" class="emoji-panel"></div>

        <div class="chat-input-row">
          <button class="emoji-btn" id="emojiBtn">😊</button>
          <input id="chatInput" placeholder="Сообщение...">
          <button class="btn" id="sendBtn">Отпр.</button>
        </div>
      </div>
    </div>
  `;

  $("#chatBackBtn").onclick = () => {
    const chatsMenu = $("#chatsMenuItem");
    if (chatsMenu && chatsMenu.style.display !== "none") switchPage("chats", chatsMenu);
    else switchPage("contacts", $("#contactsMenuItem"));
  };

  $("#sendBtn").onclick = sendChat;
  $("#chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

  // emoji panel
  const panel = $("#emojiPanel");
  panel.innerHTML = EMOJIS.map(x => `<div class="emoji" data-e="${escAttr(x)}">${esc(x)}</div>`).join("");
  panel.querySelectorAll("[data-e]").forEach(el => {
    el.addEventListener("click", () => {
      const input = $("#chatInput");
      input.value = (input.value || "") + el.getAttribute("data-e");
      input.focus();
    });
  });

  $("#emojiBtn").onclick = () => panel.classList.toggle("show");

  // initial load
  loadChatMessages(true);

  // timer
  startChatTimer();
}

function startChatTimer() {
  stopChatTimer();
  chatTimer = setInterval(() => {
    loadChatMessages(false);
    // refresh unread in sidebar badge
    refreshGlobalUnread();
  }, 3500);
}

function stopChatTimer() {
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
}

async function loadChatMessages(scrollToBottom) {
  if (!currentUser || !currentPeer) return;

  try {
    let url = `${USERS_CHAT_API_URL}?action=messages&user_id=${enc(currentUser.user_id)}&peer_id=${enc(currentPeer.user_id)}`;
    if (lastCursor) url += `&after=${enc(lastCursor)}`;

    const r = await jsonp(url);
    if (!r?.ok) return;

    const msgs = r.data || [];
    if (!msgs.length) return;

    const box = $("#chatBox");
    for (const m of msgs) {
      const mid = String(m.id || "");
      if (mid && seenMsgIds.has(mid)) continue;     // ✅ FIX дублей
      if (mid) seenMsgIds.add(mid);

      const mine = m.from_id === currentUser.user_id;
      const div = document.createElement("div");
      div.className = "bubble " + (mine ? "mine" : "their");

      const text = document.createElement("div");
      text.textContent = m.text || "";
      div.appendChild(text);

      const meta = document.createElement("div");
      meta.className = "msg-meta";
      const status = mine ? (m.read_by_me ? "✓✓" : "✓") : "";
      meta.textContent = `${formatTime(m.created_at)} ${status}`.trim();
      div.appendChild(meta);

      box.appendChild(div);

      // cursor
      if (m.created_at) lastCursor = m.created_at;
    }

    if (scrollToBottom) box.scrollTop = box.scrollHeight;
    else box.scrollTop = box.scrollHeight;

    // after showing messages from peer -> mark read
    await markRead();

  } catch {}
}

async function sendChat() {
  const input = $("#chatInput");
  const text = (input.value || "").trim();
  if (!text) return;
  input.value = "";

  try {
    await fetch(USERS_CHAT_API_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send",
        from_id: currentUser.user_id,
        to_id: currentPeer.user_id,
        text
      })
    });

    // local optimistic cursor refresh
    setTimeout(() => loadChatMessages(true), 600);
  } catch {}
}

async function markRead() {
  if (!currentUser || !currentPeer) return;

  // server will mark messages to currentUser from peer as read
  try {
    await fetch(USERS_CHAT_API_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mark_read",
        user_id: currentUser.user_id,
        peer_id: currentPeer.user_id
      })
    });

    // update hint quickly
    const hint = $("#readHint");
    if (hint) hint.textContent = "прочитано";
  } catch {}
}

/* ===================== UNREAD BADGES ===================== */

async function refreshGlobalUnread() {
  if (!currentUser || !ensureChatApi()) return;
  try {
    const r = await jsonp(`${USERS_CHAT_API_URL}?action=unread_total&user_id=${enc(currentUser.user_id)}`);
    if (!r?.ok) return;
    globalUnread = Number(r.data?.total || 0);
    updateGlobalUnreadBadge();
  } catch {}
}

function updateGlobalUnreadBadge() {
  const b1 = $("#globalUnreadBadge");
  if (!b1) return;
  if (globalUnread > 0) {
    b1.style.display = "inline-block";
    b1.textContent = String(globalUnread);
  } else {
    b1.style.display = "none";
  }
}

/* ===================== ADMIN (5 taps) ===================== */

let tapCount = 0;
let tapTimer = null;

function initAdminTap() {
  const title = $("#kpssTitle");
  title.addEventListener("click", () => {
    tapCount++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => tapCount = 0, 1200);
    if (tapCount >= 5) {
      tapCount = 0;
      showAdminPasswordModal();
    }
  });
}

function showAdminPasswordModal() {
  openModal("Админ-доступ", `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="color:#b0b0b0;font-size:13px;">Введи пароль:</div>
      <input id="adminPassInput" type="password" placeholder="Пароль"
        style="width:100%;padding:14px 16px;border-radius:14px;background:#404040;border:1px solid #505050;color:#f0f0f0;font-size:14px;" />
      <button class="btn" id="adminLoginBtn">Войти</button>
      <div id="adminPassError" style="color:#ff99cc;font-size:13px;display:none;">Неверный пароль</div>
    </div>
  `);

  $("#adminLoginBtn").onclick = () => {
    const v = ($("#adminPassInput").value || "");
    if (v === ADMIN_PASSWORD) {
      isAdmin = true;
      $("#adminMenuItem").style.display = "flex";
      closeModal("infoModal");
      showUpdateIndicator();
    } else {
      $("#adminPassError").style.display = "block";
    }
  };
}

function renderAdminPage() {
  const container = $("#page-admin");
  if (!isAdmin) {
    container.innerHTML = `<div class="section" style="padding:20px;text-align:center;">Нет доступа</div>`;
    return;
  }
  container.innerHTML = `<div class="section" style="padding:20px;color:#b0b0b0;">
    Админка в этом варианте не развёрнута (твоя старая логика остаётся). Если нужно — скажи, какие формы оставляем, и я перенесу полностью сюда.
  </div>`;
}

/* ===================== COMMON HELPERS ===================== */

function openModal(title, html) {
  $("#infoModalTitle").textContent = title;
  $("#infoModalContent").innerHTML = html;
  $("#infoModal").classList.add("active");
}
function closeModal(id) { $(`#${id}`).classList.remove("active"); }

function openImageModal(url) {
  if (!url) return;
  $("#modalImage").src = url;
  $("#imageModal").classList.add("active");
}
function closeImageModal() { $("#imageModal").classList.remove("active"); }

function showLoading(show) {
  $("#loading").style.display = show ? "flex" : "none";
  $("#app").style.display = show ? "none" : "block";
  $("#error").style.display = "none";
}
function showError(message) {
  $("#error").style.display = "block";
  $("#errorMessage").textContent = message;
  $("#app").style.display = "none";
  $("#loading").style.display = "none";
}
function showUpdateIndicator() {
  const ind = $("#updateIndicator");
  ind.classList.add("show");
  setTimeout(() => ind.classList.remove("show"), 2000);
}

function $(sel) { return document.querySelector(sel); }
function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}
function escAttr(s) { return esc(s).replace(/"/g,"&quot;"); }
function enc(s) { return encodeURIComponent(String(s ?? "")); }

function formatTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    return `${hh}:${mm}`;
  } catch { return ""; }
}

/* ===================== CSV / SHEET PARSING ===================== */

function extractSheetsFromPubhtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const links = Array.from(doc.querySelectorAll("a[href*='gid=']"));
    const found = new Map();
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
    return Array.from(found.entries()).map(([gid,title]) => ({ gid, title }));
  } catch { return []; }
}

function detectSheetType(headers) {
  const h = headers.map(x => x.toLowerCase().trim());
  if (h.includes("sender") && h.includes("text") && (h.includes("time") || h.includes("date"))) return "important";
  if (h.includes("day") && h.includes("time") && h.includes("subject")) return "schedule";
  if (h.includes("category") && h.includes("tag")) return "hashtags";
  if (h.includes("title") && (h.includes("image_url") || h.includes("image"))) return "gallery";
  if (h.includes("title") && h.includes("url") && (h.includes("hashtags") || h.includes("tags"))) return "other";
  return null;
}

function rowsToObjects(rows, headers) {
  const out = [];
  for (let i=1;i<rows.length;i++){
    const row = rows[i];
    if (!row || row.every(v => (v ?? "").toString().trim() === "")) continue;
    const obj = {};
    for (let j=0;j<headers.length;j++){
      const key = (headers[j] ?? "").toString().trim();
      if (!key) continue;
      obj[key] = (row[j] ?? "").toString().trim();
    }
    if (Object.keys(obj).length) out.push(obj);
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  text = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n");

  for (let i=0;i<text.length;i++){
    const ch = text[i];
    const next = text[i+1];

    if (ch === '"') {
      if (inQuotes && next === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) { row.push(cur); cur=""; continue; }
    if (ch === "\n" && !inQuotes) { row.push(cur); rows.push(row); row=[]; cur=""; continue; }
    cur += ch;
  }
  row.push(cur);
  rows.push(row);

  while (rows.length && rows[rows.length-1].every(v => (v ?? "").toString().trim() === "")) rows.pop();
  return rows;
}

async function fetchWithTimeout(url, timeout=10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, cache:"no-cache" });
    clearTimeout(id);
    return res.ok ? await res.text() : null;
  } catch { clearTimeout(id); return null; }
}

/* ===================== JSONP (CORS SAFE GET) ===================== */

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Math.random().toString(36).slice(2);
    const s = document.createElement("script");

    window[cb] = (data) => {
      delete window[cb];
      s.remove();
      resolve(data);
    };

    s.onerror = () => {
      delete window[cb];
      s.remove();
      reject(new Error("JSONP load error"));
    };

    const sep = url.includes("?") ? "&" : "?";
    s.src = url + sep + "callback=" + cb;
    document.body.appendChild(s);
  });
}
