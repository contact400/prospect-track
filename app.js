import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let currentUser = null;
let currentUserProfile = null;
let isAdmin = false;
let allProspects = [];
let allUsers = [];
let exportMode = false;
let selectedMLS = new Set();
let unsubscribeProspects = null;
let activeFilters = { sort: "newest", mailing: "all", visit: "all", eval: "all", type: "all", municipality: "all" };

// ── Property type detection ────────────────────────────────
function detectPropertyType(address) {
  if (!address) return "house";
  const a = address.toLowerCase();
  if (/\bapp\.?\s*\d|#\s*\d|\bapt\.?\s*\d|, app |, apt |bureau\s*\d|suite\s*\d|unit\s*\d|\bunité\s*\d/.test(a)) return "condo";
  return "house";
}

function extractMunicipality(address) {
  if (!address) return "Unknown";
  const match = address.match(/,\s*([^,(]+?)(?:\s*\(([^)]+)\))?\s*(?:H\w\d|\d[A-Z]\d|$)/i);
  if (match) {
    const inner = match[2] || match[1];
    return inner.trim().replace(/\s+/g, " ");
  }
  const parts = address.split(",");
  if (parts.length >= 2) return parts[parts.length - 1].trim().split(" ").slice(0,2).join(" ");
  return "Unknown";
}

function getMunicipalities() {
  const set = new Set(allProspects.map(p => extractMunicipality(p.listingAddress)));
  return [...set].filter(Boolean).sort();
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadUserProfile(user.uid);
    showApp();
  } else {
    currentUser = null; currentUserProfile = null; isAdmin = false;
    showLogin();
  }
});

async function loadUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (snap.exists()) {
    currentUserProfile = { uid, ...snap.data() };
    isAdmin = currentUserProfile.role === "admin";
  }
}

window.handleLogin = async function () {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginBtn");
  const err = document.getElementById("loginError");
  err.style.display = "none"; btn.textContent = "Signing in..."; btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    err.textContent = "Invalid email or password. Please try again.";
    err.style.display = "block"; btn.textContent = "Sign in"; btn.disabled = false;
  }
};

window.handleLogout = async function () {
  if (unsubscribeProspects) unsubscribeProspects();
  await signOut(auth);
};

function showLogin() {
  document.getElementById("loginScreen").classList.add("active");
  document.getElementById("appScreen").classList.remove("active");
  document.getElementById("loginEmail").value = "";
  document.getElementById("loginPassword").value = "";
}

function showApp() {
  document.getElementById("loginScreen").classList.remove("active");
  document.getElementById("appScreen").classList.add("active");
  setupRoleUI();
  subscribeToProspects();
  if (isAdmin) { loadAllUsers(); renderDashboard(); }
}

function setupRoleUI() {
  const name = currentUserProfile?.name || currentUser.email;
  const role = isAdmin ? "Admin" : "Agent";
  document.getElementById("userPill").textContent = `${name} · ${role}`;
  document.getElementById("mobileUserPill").textContent = `${name} · ${role}`;
  if (isAdmin) {
    document.getElementById("dashNav").style.display = "";
    document.getElementById("adminNav").style.display = "";
    document.getElementById("dashNavMobile").style.display = "";
    document.getElementById("adminNavMobile").style.display = "";
    document.getElementById("addProspectBtn").style.display = "";
  }
}

window.switchView = function (name, el) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  if (el) document.querySelectorAll(`[data-view="${name}"]`).forEach(n => n.classList.add("active"));
  document.getElementById("mobileTitle").textContent =
    name === "prospects" ? "Prospects" : name === "dashboard" ? "Dashboard" : "Admin";
  if (name === "dashboard") renderDashboard();
  if (name === "admin") renderAdmin();
};

window.toggleMobileNav = function () {
  const d = document.getElementById("mobileDrawer");
  d.style.display = d.style.display === "block" ? "none" : "block";
};
window.closeMobileNav = function () {
  document.getElementById("mobileDrawer").style.display = "none";
};

function subscribeToProspects() {
  const q = query(collection(db, "prospects"), orderBy("createdAt", "desc"));
  unsubscribeProspects = onSnapshot(q, (snap) => {
    allProspects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProspects();
    updateProspectCount();
    if (isAdmin) renderDashboard();
  });
}

function updateProspectCount() {
  document.getElementById("prospectCount").textContent =
    `${allProspects.length} expired listing${allProspects.length !== 1 ? "s" : ""}`;
}

// ── Filters ────────────────────────────────────────────────
function renderFilterBar() {
  const bar = document.getElementById("filterBar");
  if (!bar) return;
  const hasActive = activeFilters.sort !== "newest" || activeFilters.mailing !== "all" || activeFilters.visit !== "all" || activeFilters.eval !== "all" || activeFilters.type !== "all" || activeFilters.municipality !== "all";
  const isOpen = bar.dataset.open === "true";

  const btn = (label, key, val, icon) => {
    const active = activeFilters[key] === val;
    return `<button onclick="setFilter('${key}','${val}')" style="padding:6px 12px;border-radius:99px;font-size:12px;font-family:var(--font);cursor:pointer;white-space:nowrap;border:1px solid ${active ? 'var(--accent)' : 'var(--border-med)'};background:${active ? 'var(--accent)' : 'var(--surface)'};color:${active ? '#fff' : 'var(--text-2)'};font-weight:${active ? '500' : '400'};transition:all 0.15s;">${icon ? icon + ' ' : ''}${label}</button>`;
  };

  const municipalities = getMunicipalities();
  const municipalityBtns = municipalities.map(m => btn(m, "municipality", m, "")).join("");

  bar.innerHTML = `
    <div style="margin-bottom:${isOpen ? '0' : '16px'};">
      <button onclick="toggleFilterBar()" style="display:flex;align-items:center;gap:8px;padding:7px 14px;border-radius:99px;font-size:13px;font-family:var(--font);cursor:pointer;border:1px solid ${hasActive ? 'var(--accent)' : 'var(--border-med)'};background:${hasActive ? 'var(--accent-light)' : 'var(--surface)'};color:${hasActive ? 'var(--accent)' : 'var(--text-2)'};font-weight:${hasActive ? '500' : '400'};">
        <span>⚙ Filters${hasActive ? ' (active)' : ''}</span>
        <span style="font-size:10px;">${isOpen ? '▲' : '▼'}</span>
      </button>
    </div>
    ${isOpen ? `
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-lg);margin-bottom:16px;background:var(--surface);">

      <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:2px;">Type</span>
      ${btn("All", "type", "all", "")}
      ${btn("Condo", "type", "condo", "🏢")}
      ${btn("House", "type", "house", "🏠")}
      <span style="width:1px;height:20px;background:var(--border);margin:0 2px;"></span>

      <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:2px;">Municipality</span>
      ${btn("All", "municipality", "all", "")}
      ${municipalityBtns}
      <span style="width:1px;height:20px;background:var(--border);margin:0 2px;"></span>

      <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:2px;">Sort</span>
      ${btn("Newest", "sort", "newest", "↓")}
      ${btn("Oldest", "sort", "oldest", "↑")}
      ${btn("Price ↑", "sort", "price_asc", "")}
      ${btn("Price ↓", "sort", "price_desc", "")}
      <span style="width:1px;height:20px;background:var(--border);margin:0 2px;"></span>

      <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:2px;">Mailers</span>
      ${btn("All", "mailing", "all", "")}
      ${btn("None sent", "mailing", "none", "✉️")}
      ${btn("1–3 sent", "mailing", "partial", "")}
      ${btn("All 4 sent", "mailing", "complete", "✅")}
      <span style="width:1px;height:20px;background:var(--border);margin:0 2px;"></span>

      <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:2px;">Visits</span>
      ${btn("All", "visit", "all", "")}
      ${btn("Not visited", "visit", "none", "")}
      ${btn("Visited", "visit", "some", "🚪")}
      <span style="width:1px;height:20px;background:var(--border);margin:0 2px;"></span>

      <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:2px;">Status</span>
      ${btn("All", "eval", "all", "")}
      ${btn("Eval booked", "eval", "booked", "📅")}
      ${btn("Contacted", "eval", "contacted", "☎️")}
      ${btn("No contact", "eval", "none", "")}

      ${hasActive ? `<span style="width:1px;height:20px;background:var(--border);margin:0 2px;"></span><button onclick="resetFilters()" style="padding:6px 12px;border-radius:99px;font-size:12px;font-family:var(--font);cursor:pointer;border:1px solid var(--red-bg);background:var(--red-bg);color:var(--red);font-weight:500;">✕ Reset all</button>` : ""}
    </div>` : ""}
  `;
}

window.toggleFilterBar = function() {
  const bar = document.getElementById("filterBar");
  bar.dataset.open = bar.dataset.open === "true" ? "false" : "true";
  renderFilterBar();
};

window.setFilter = function(key, val) {
  activeFilters[key] = val;
  renderFilterBar();
  renderProspects();
};

window.resetFilters = function() {
  activeFilters = { sort: "newest", mailing: "all", visit: "all", eval: "all", type: "all", municipality: "all" };
  renderFilterBar();
  renderProspects();
};

function getFilteredAndSorted() {
  const q = document.getElementById("searchInput").value.toLowerCase();
  let list = [...allProspects];

  if (q) {
    list = list.filter(p => {
      const names = (p.owners || []).map(o => o.name).join(" ").toLowerCase();
      return p.mls?.includes(q) || p.listingAddress?.toLowerCase().includes(q) || names.includes(q);
    });
  }
  if (activeFilters.type !== "all") {
    list = list.filter(p => detectPropertyType(p.listingAddress) === activeFilters.type);
  }
  if (activeFilters.municipality !== "all") {
    list = list.filter(p => extractMunicipality(p.listingAddress) === activeFilters.municipality);
  }
  if (activeFilters.mailing !== "all") {
    list = list.filter(p => {
      const sent = (p.mail || []).filter(Boolean).length;
      if (activeFilters.mailing === "none") return sent === 0;
      if (activeFilters.mailing === "partial") return sent >= 1 && sent <= 3;
      if (activeFilters.mailing === "complete") return sent === 4;
    });
  }
  if (activeFilters.visit !== "all") {
    list = list.filter(p => {
      const visits = (p.visits || []).length;
      if (activeFilters.visit === "none") return visits === 0;
      if (activeFilters.visit === "some") return visits > 0;
    });
  }
  if (activeFilters.eval !== "all") {
    list = list.filter(p => {
      const evalBooked = (p.visits || []).some(v => v.evalBooked === "yes");
      const contacted = (p.visits || []).some(v => v.contact === "yes");
      if (activeFilters.eval === "booked") return evalBooked;
      if (activeFilters.eval === "contacted") return contacted && !evalBooked;
      if (activeFilters.eval === "none") return !contacted && !evalBooked;
    });
  }
  list.sort((a, b) => {
    if (activeFilters.sort === "newest") return (b.expiry || "").localeCompare(a.expiry || "");
    if (activeFilters.sort === "oldest") return (a.expiry || "").localeCompare(b.expiry || "");
    if (activeFilters.sort === "price_asc") return (a.lastPrice || 0) - (b.lastPrice || 0);
    if (activeFilters.sort === "price_desc") return (b.lastPrice || 0) - (a.lastPrice || 0);
    return 0;
  });
  return list;
}

window.renderProspects = function () {
  renderFilterBar();
  const filtered = getFilteredAndSorted();
  const container = document.getElementById("prospectsContainer");
  const hasActive = activeFilters.sort !== "newest" || activeFilters.mailing !== "all" || activeFilters.visit !== "all" || activeFilters.eval !== "all" || activeFilters.type !== "all" || activeFilters.municipality !== "all";
  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">◎</div>
      <div class="empty-title">${hasActive ? "No prospects match these filters" : "No prospects found"}</div>
      <div class="empty-sub">${hasActive ? '<button onclick="resetFilters()" style="margin-top:8px;padding:6px 14px;border-radius:99px;background:var(--accent);color:#fff;border:none;font-size:13px;cursor:pointer;">Reset filters</button>' : allProspects.length === 0 && isAdmin ? "Add your first prospect using the button above." : "Try a different search."}</div>
    </div>`;
    return;
  }
  container.innerHTML = `<div class="prospects-grid">${filtered.map(p => prospectCard(p)).join("")}</div>`;
};

function prospectCard(p) {
  const initials = (p.owners?.[0]?.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const lastPrice = p.lastPrice ? "$" + Number(p.lastPrice).toLocaleString("fr-CA") : "—";
  const priceDrop = p.prevPrice ? `<span class="price-drop">↓ from $${Number(p.prevPrice).toLocaleString("fr-CA")}</span>` : "";
  const mailings = (p.mail || []).filter(Boolean).length;
  const visits = (p.visits || []).length;
  const evalBooked = (p.visits || []).some(v => v.evalBooked === "yes");
  const contacted = (p.visits || []).some(v => v.contact === "yes");
  const propType = detectPropertyType(p.listingAddress);
  const municipality = extractMunicipality(p.listingAddress);
  const statusBadge = evalBooked
    ? `<span class="badge badge-green">Eval booked</span>`
    : contacted ? `<span class="badge badge-blue">Contacted</span>`
    : mailings > 0 ? `<span class="badge badge-amber">${mailings} mailing${mailings > 1 ? "s" : ""} sent</span>`
    : `<span class="badge badge-gray">Not contacted</span>`;
  const typeBadge = propType === "condo"
    ? `<span class="badge badge-blue" style="background:#EEEDFE;color:#3C3489;">🏢 Condo</span>`
    : `<span class="badge badge-gray" style="background:#EAF3DE;color:#2D6A4F;">🏠 House</span>`;
  const sel = selectedMLS.has(p.mls) ? " selected" : "";
  const clickFn = exportMode ? `toggleSelectProspect('${p.mls}')` : `openProspectModal('${p.id}')`;
  return `<div class="prospect-card${sel}" onclick="${clickFn}">
    <div class="card-top">
      <div class="card-avatar">${initials}</div>
      <div class="card-main">
        <div class="card-name">${(p.owners || []).map(o => o.name).join(", ")}</div>
        <div class="card-addr">${p.owners?.[0]?.street || ""}, ${p.owners?.[0]?.city || ""}</div>
        <div class="card-mls">MLS #${p.mls} · Expires ${p.expiry || "—"} · ${municipality}</div>
      </div>
    </div>
    <div class="card-meta">${statusBadge}${typeBadge}<span class="badge badge-red">${p.status || "Expiré"}</span></div>
    <div class="card-tracking">
      <div class="track-item"><div class="track-label">Last price</div><div class="track-value">${lastPrice} ${priceDrop}</div></div>
      <div class="track-item"><div class="track-label">Mailings</div><div class="track-value">${mailings}/4</div></div>
      <div class="track-item"><div class="track-label">Visits</div><div class="track-value">${visits}</div></div>
    </div>
  </div>`;
}

window.openProspectModal = async function (id) {
  if (exportMode) return;
  const p = allProspects.find(x => x.id === id);
  if (!p) return;
  renderProspectModal(p);
  openModal("prospectModal");
};

function renderProspectModal(p) {
  const fmt = n => n ? "$" + Number(n).toLocaleString("fr-CA") : "—";
  const propType = detectPropertyType(p.listingAddress);
  const municipality = extractMunicipality(p.listingAddress);
  const ownersHtml = (p.owners || []).map(o => `
    <div class="owner-block"><div class="on">${o.name}</div>
    <div class="oa">${o.street}<br>${o.city} &nbsp;${o.postal}</div></div>`).join("");
  const mailHtml = [0,1,2,3].map(i => `
    <div class="mail-slot"><label>Mailing ${i+1}</label>
    <input type="date" value="${(p.mail || [])[i] || ""}" onchange="updateMailDate('${p.id}',${i},this.value)" /></div>`).join("");
  const visits = p.visits || [];
  const visitRows = visits.length === 0
    ? `<p style="font-size:13px;color:var(--text-3);padding:8px 0;">No visits logged yet.</p>`
    : `<div class="visit-col-labels"><span>Date</span><span>Contact?</span><span>Eval?</span><span></span></div>` +
      visits.map((v, i) => `
        <div class="visit-entry">
          <input type="date" value="${v.date || ""}" onchange="updateVisitField('${p.id}',${i},'date',this.value)" />
          <button class="yn-btn ${v.contact === 'yes' ? 'yes' : v.contact === 'no' ? 'no' : ''}" onclick="cycleVisitField('${p.id}',${i},'contact')">
            ${v.contact === 'yes' ? '✓' : v.contact === 'no' ? '✕' : '—'}<span class="yn-label">Contact</span>
          </button>
          <button class="yn-btn ${v.evalBooked === 'yes' ? 'yes' : v.evalBooked === 'no' ? 'no' : ''}" onclick="cycleVisitField('${p.id}',${i},'evalBooked')">
            ${v.evalBooked === 'yes' ? '✓' : v.evalBooked === 'no' ? '✕' : '—'}<span class="yn-label">Eval</span>
          </button>
          <button class="icon-btn red" onclick="removeVisit('${p.id}',${i})">✕</button>
        </div>`).join("");
  const adminActions = isAdmin ? `
    <div class="modal-section"><div class="modal-section-title">Admin</div>
    <button class="btn-danger" onclick="deleteProspect('${p.id}')">Delete prospect</button></div>` : "";
  document.getElementById("prospectModalContent").innerHTML = `
    <div class="modal-header">
      <div><div class="modal-title">${(p.owners || []).map(o => o.name).join(", ")}</div>
      <div class="modal-sub">MLS #${p.mls} · ${p.listingAddress || ""}</div></div>
      <button class="close-x" onclick="closeAllModals()">×</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      ${propType === "condo" ? '<span class="badge" style="background:#EEEDFE;color:#3C3489;">🏢 Condo</span>' : '<span class="badge" style="background:#EAF3DE;color:#2D6A4F;">🏠 House</span>'}
      <span class="badge badge-gray">📍 ${municipality}</span>
    </div>
    <div class="detail-grid">
      <div class="detail-field"><div class="lbl">Last price</div><div class="val">${fmt(p.lastPrice)}</div></div>
      <div class="detail-field"><div class="lbl">Original price</div><div class="val">${fmt(p.origPrice)}</div></div>
      <div class="detail-field"><div class="lbl">Contract start</div><div class="val">${p.contractStart || "—"}</div></div>
      <div class="detail-field"><div class="lbl">Expiry</div><div class="val">${p.expiry || "—"}</div></div>
    </div>
    <div class="modal-section"><div class="modal-section-title">Agency &amp; Broker</div>
      <div style="font-size:14px;font-weight:500;">${p.broker || "—"}</div>
      <div style="font-size:13px;color:var(--text-2);">${p.agency || ""} · ${p.brokerPhone || ""}</div>
    </div>
    <div class="modal-section"><div class="modal-section-title">Owner(s) — Mailing Address</div>${ownersHtml}</div>
    <div class="modal-section"><div class="modal-section-title">Mailing Attempts</div>
      <div class="mail-grid">${mailHtml}</div>
    </div>
    <div class="modal-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div class="modal-section-title" style="margin:0;">Door-to-Door Visits</div>
        <button class="btn-secondary" style="font-size:12px;padding:5px 10px;" onclick="addVisit('${p.id}')">+ Add visit</button>
      </div>
      ${visitRows}
    </div>
    ${adminActions}`;
}

window.updateMailDate = async function (id, idx, val) {
  const p = allProspects.find(x => x.id === id);
  if (!p) return;
  const mail = [...(p.mail || ["","","",""])];
  while (mail.length < 4) mail.push("");
  mail[idx] = val;
  await updateDoc(doc(db, "prospects", id), { mail });
  logActivity(id, `Mailing ${idx+1} date set to ${val}`);
};

window.updateVisitField = async function (id, idx, field, val) {
  const p = allProspects.find(x => x.id === id);
  if (!p) return;
  const visits = [...(p.visits || [])];
  visits[idx] = { ...visits[idx], [field]: val };
  await updateDoc(doc(db, "prospects", id), { visits });
};

window.cycleVisitField = async function (id, idx, field) {
  const p = allProspects.find(x => x.id === id);
  if (!p) return;
  const visits = [...(p.visits || [])];
  const cur = visits[idx][field];
  visits[idx] = { ...visits[idx], [field]: cur === "yes" ? "no" : cur === "no" ? "" : "yes" };
  await updateDoc(doc(db, "prospects", id), { visits });
  const label = field === "contact" ? "Contact made" : "Eval booked";
  if (visits[idx][field] === "yes") logActivity(id, `${label} — marked YES`);
  renderProspectModal({ ...p, visits });
};

window.addVisit = async function (id) {
  const p = allProspects.find(x => x.id === id);
  if (!p) return;
  const visits = [...(p.visits || []), { date: "", contact: "", evalBooked: "", agentId: currentUser.uid, agentName: currentUserProfile?.name || currentUser.email }];
  await updateDoc(doc(db, "prospects", id), { visits });
  logActivity(id, "Door-to-door visit logged");
  renderProspectModal({ ...p, visits });
};

window.removeVisit = async function (id, idx) {
  const p = allProspects.find(x => x.id === id);
  if (!p) return;
  const visits = [...(p.visits || [])];
  visits.splice(idx, 1);
  await updateDoc(doc(db, "prospects", id), { visits });
  renderProspectModal({ ...p, visits });
};

async function logActivity(prospectId, action) {
  await addDoc(collection(db, "activity"), {
    prospectId, action, agentId: currentUser.uid,
    agentName: currentUserProfile?.name || currentUser.email,
    timestamp: serverTimestamp()
  });
}

// ── Duplicate check ────────────────────────────────────────
function findDuplicates(mlsList) {
  return mlsList.filter(mls => allProspects.some(p => p.mls === mls));
}

function showDuplicateWarning(duplicates, onProceed, onSkip) {
  const dupList = duplicates.map(mls => {
    const existing = allProspects.find(p => p.mls === mls);
    return `<div style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px;display:flex;gap:10px;align-items:center;">
      <span style="background:var(--amber-bg);color:var(--amber);padding:2px 6px;border-radius:4px;font-weight:500;white-space:nowrap;">MLS ${mls}</span>
      <span style="flex:1;">${(existing?.owners||[]).map(o=>o.name).join(", ")}</span>
    </div>`;
  }).join("");
  document.getElementById("prospectModalContent").innerHTML = `
    <div class="modal-header">
      <div><div class="modal-title">Duplicate${duplicates.length > 1 ? "s" : ""} found</div>
      <div class="modal-sub">${duplicates.length} MLS number${duplicates.length > 1 ? "s" : ""} already exist${duplicates.length === 1 ? "s" : ""} in your database</div></div>
      <button class="close-x" onclick="closeAllModals()">×</button>
    </div>
    <div style="background:var(--amber-bg);border-radius:var(--radius);padding:12px 14px;margin-bottom:14px;">
      <p style="font-size:13px;color:var(--amber);font-weight:500;">The following prospects are already in your database:</p>
    </div>
    <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:16px;">${dupList}</div>
    <p style="font-size:13px;color:var(--text-2);margin-bottom:16px;">What would you like to do with the duplicate${duplicates.length > 1 ? "s" : ""}?</p>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button onclick="(${onSkip.toString()})()" style="padding:10px 16px;border-radius:var(--radius);border:1px solid var(--border-med);background:var(--surface);color:var(--text);font-size:13px;font-family:var(--font);cursor:pointer;text-align:left;">
        <strong>Skip duplicates</strong><br>
        <span style="font-size:12px;color:var(--text-3);">Import only new prospects, ignore the ${duplicates.length > 1 ? "ones" : "one"} already in the database</span>
      </button>
      <button onclick="(${onProceed.toString()})()" style="padding:10px 16px;border-radius:var(--radius);border:1px solid var(--border-med);background:var(--surface);color:var(--text);font-size:13px;font-family:var(--font);cursor:pointer;text-align:left;">
        <strong>Import anyway</strong><br>
        <span style="font-size:12px;color:var(--text-3);">Add all prospects including duplicates</span>
      </button>
      <button onclick="closeAllModals()" style="padding:10px 16px;border-radius:var(--radius);border:1px solid var(--border-med);background:var(--surface);color:var(--red);font-size:13px;font-family:var(--font);cursor:pointer;text-align:left;">
        <strong>Cancel import</strong><br>
        <span style="font-size:12px;color:var(--text-3);">Go back without importing anything</span>
      </button>
    </div>`;
  openModal("prospectModal");
}

// ── Add Prospect ───────────────────────────────────────────
window.openAddProspect = function (tab) {
  tab = tab || "single";
  document.getElementById("addProspectContent").innerHTML = `
    <div class="modal-header"><div class="modal-title">Add Prospects</div>
      <button class="close-x" onclick="closeAllModals()">×</button></div>
    <div style="display:flex;gap:0;margin-bottom:20px;border:1px solid var(--border-med);border-radius:var(--radius);overflow:hidden;">
      <button onclick="openAddProspect('single')" style="flex:1;padding:9px;font-size:13px;font-family:var(--font);border:none;cursor:pointer;background:${tab==='single'?'var(--accent)':'var(--surface)'};color:${tab==='single'?'#fff':'var(--text-2)'};">Single Entry</button>
      <button onclick="openAddProspect('bulk')" style="flex:1;padding:9px;font-size:13px;font-family:var(--font);border:none;border-left:1px solid var(--border-med);cursor:pointer;background:${tab==='bulk'?'var(--accent)':'var(--surface)'};color:${tab==='bulk'?'#fff':'var(--text-2)'};">Bulk CSV Import</button>
    </div>
    ${tab === 'single' ? singleEntryForm() : bulkImportForm()}`;
  openModal("addProspectModal");
};

function singleEntryForm() {
  return `
    <div class="form-group"><label>MLS #</label><input type="text" id="ap_mls" placeholder="e.g. 9183921" /></div>
    <div class="form-group"><label>Status</label>
      <select id="ap_status"><option value="Expiré">Expiré</option><option value="Annulé">Annulé</option></select></div>
    <div class="form-group"><label>Listing Address</label><input type="text" id="ap_listingAddr" placeholder="e.g. 10200 Boul. de l'Acadie, app. 814, Montréal (Ahuntsic-Cartierville)" /></div>
    <div class="form-group"><label>Contract Start</label><input type="date" id="ap_start" /></div>
    <div class="form-group"><label>Expiry Date</label><input type="date" id="ap_expiry" /></div>
    <div class="form-group"><label>Last Price ($)</label><input type="number" id="ap_price" /></div>
    <div class="form-group"><label>Original Price ($)</label><input type="number" id="ap_origPrice" /></div>
    <div class="form-group"><label>Previous Price ($)</label><input type="number" id="ap_prevPrice" /></div>
    <div class="form-group"><label>Agency</label><input type="text" id="ap_agency" /></div>
    <div class="form-group"><label>Broker Name</label><input type="text" id="ap_broker" /></div>
    <div class="form-group"><label>Broker Phone</label><input type="text" id="ap_phone" /></div>
    <hr class="divider" />
    <p style="font-size:13px;font-weight:500;margin-bottom:12px;">Owner 1 — Mailing Address</p>
    <div class="form-group"><label>Owner Name</label><input type="text" id="ap_o1name" /></div>
    <div class="form-group"><label>Street</label><input type="text" id="ap_o1street" /></div>
    <div class="form-group"><label>City</label><input type="text" id="ap_o1city" /></div>
    <div class="form-group"><label>Postal Code</label><input type="text" id="ap_o1postal" /></div>
    <hr class="divider" />
    <p style="font-size:13px;font-weight:500;margin-bottom:12px;">Owner 2 (optional)</p>
    <div class="form-group"><label>Owner Name</label><input type="text" id="ap_o2name" /></div>
    <div class="form-group"><label>Street</label><input type="text" id="ap_o2street" /></div>
    <div class="form-group"><label>City</label><input type="text" id="ap_o2city" /></div>
    <div class="form-group"><label>Postal Code</label><input type="text" id="ap_o2postal" /></div>
    <div id="ap_error" class="error-msg" style="display:none;margin-top:8px;"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeAllModals()">Cancel</button>
      <button class="btn-primary" style="width:auto;padding:9px 20px;" onclick="saveNewProspect()">Save Prospect</button>
    </div>`;
}

function bulkImportForm() {
  return `
    <div style="background:var(--accent-light);border-radius:var(--radius);padding:14px;margin-bottom:16px;">
      <p style="font-size:13px;font-weight:500;color:var(--accent);margin-bottom:6px;">How it works</p>
      <p style="font-size:12px;color:var(--accent);line-height:1.6;">1. Download the CSV template below<br>2. Open in Excel or Google Sheets<br>3. Fill in your prospects (one per row)<br>4. Save as CSV and upload here</p>
    </div>
    <div style="margin-bottom:16px;">
      <button class="btn-secondary" style="width:100%;" onclick="downloadTemplate()">↓ Download CSV Template</button>
    </div>
    <div class="form-group"><label>Upload your filled CSV</label>
      <input type="file" id="csvFileInput" accept=".csv" onchange="previewCSV(this)" style="padding:8px;background:var(--bg);" /></div>
    <div id="csvPreview" style="display:none;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:500;color:var(--text-2);margin-bottom:8px;" id="csvPreviewLabel"></div>
      <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius);" id="csvPreviewList"></div>
    </div>
    <div id="ap_error" class="error-msg" style="display:none;margin-top:8px;"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeAllModals()">Cancel</button>
      <button class="btn-primary" id="importBtn" style="width:auto;padding:9px 20px;display:none;" onclick="startBulkImport()">Import All</button>
    </div>`;
}

window.downloadTemplate = function() {
  const headers = "mls,status,listingAddress,contractStart,expiry,lastPrice,origPrice,prevPrice,agency,broker,brokerPhone,owner1Name,owner1Street,owner1City,owner1Postal,owner2Name,owner2Street,owner2City,owner2Postal";
  const example = '9183921,Expiré,"10200 Boul. de Acadie, app. 814, Montréal (Ahuntsic-Cartierville)",2025-09-17,2026-03-31,540000,540000,,LES IMMEUBLES HOME-PRO,Amir Keryakes,514-943-2647,Medhat Azer,10200 Acadie app. 814,Montreal,H4N 3L3,,,,';
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([headers + "\n" + example], {type:"text/csv"}));
  a.download = "prospects-template.csv"; a.click();
};

let parsedCSVRows = [];

window.previewCSV = function(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const rows = parseCSV(e.target.result);
    if (rows.length < 2) return;
    const headers = rows[0].map(h => h.trim().toLowerCase());
    parsedCSVRows = rows.slice(1).filter(r => r.some(c => c.trim()));
    const get = (row, col) => { const idx = headers.indexOf(col); return idx >= 0 ? (row[idx] || "").trim() : ""; };
    const preview = parsedCSVRows.map(row => {
      const mls = get(row,"mls"); const owner = get(row,"owner1name");
      const addr = get(row,"listingaddress"); const price = get(row,"lastprice");
      const isDup = allProspects.some(p => p.mls === mls);
      const ptype = detectPropertyType(addr);
      const muni = extractMunicipality(addr);
      return `<div style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="background:${isDup ? 'var(--amber-bg)' : 'var(--accent-light)'};color:${isDup ? 'var(--amber)' : 'var(--accent)'};padding:2px 6px;border-radius:4px;font-weight:500;white-space:nowrap;">MLS ${mls}${isDup ? ' ⚠' : ''}</span>
        <span style="flex:1;">${owner}</span>
        <span style="background:${ptype==='condo'?'#EEEDFE':'#EAF3DE'};color:${ptype==='condo'?'#3C3489':'#2D6A4F'};padding:2px 6px;border-radius:4px;font-size:11px;">${ptype==='condo'?'🏢':'🏠'} ${ptype}</span>
        <span style="color:var(--text-3);font-size:11px;">📍${muni}</span>
        <span style="color:var(--text-3);">$${Number(price).toLocaleString("fr-CA")}</span>
      </div>`;
    }).join("");
    const dupCount = parsedCSVRows.filter(row => {
      const idx = headers.indexOf("mls"); const mls = idx >= 0 ? (row[idx]||"").trim() : "";
      return allProspects.some(p => p.mls === mls);
    }).length;
    document.getElementById("csvPreviewLabel").textContent = parsedCSVRows.length + " prospect(s) ready to import" + (dupCount > 0 ? ` · ⚠ ${dupCount} duplicate${dupCount > 1 ? "s" : ""} detected` : "");
    document.getElementById("csvPreviewList").innerHTML = preview;
    document.getElementById("csvPreview").style.display = "block";
    document.getElementById("importBtn").style.display = "block";
  };
  reader.readAsText(file);
};

function parseCSV(text) {
  const rows = []; let row = []; let cell = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && inQ && text[i+1] === '"') { cell += '"'; i++; }
    else if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { row.push(cell); cell = ""; }
    else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (ch === '\r' && text[i+1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else { cell += ch; }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

window.startBulkImport = function() {
  const hdrs = ["mls","status","listingaddress","contractstart","expiry","lastprice","origprice","prevprice","agency","broker","brokerphone","owner1name","owner1street","owner1city","owner1postal","owner2name","owner2street","owner2city","owner2postal"];
  const get = (row, col) => { const i = hdrs.indexOf(col); return i >= 0 ? (row[i]||"").trim() : ""; };
  const mlsList = parsedCSVRows.map(row => get(row, "mls")).filter(Boolean);
  const duplicates = findDuplicates(mlsList);
  if (duplicates.length > 0) {
    closeAllModals();
    showDuplicateWarning(
      duplicates,
      async function() { await doImport(parsedCSVRows, false); },
      async function() { await doImport(parsedCSVRows, true); }
    );
  } else {
    doImport(parsedCSVRows, false);
  }
};

async function doImport(rows, skipDuplicates) {
  closeAllModals();
  const hdrs = ["mls","status","listingaddress","contractstart","expiry","lastprice","origprice","prevprice","agency","broker","brokerphone","owner1name","owner1street","owner1city","owner1postal","owner2name","owner2street","owner2city","owner2postal"];
  let imported = 0; let skipped = 0; let failed = 0;
  for (const row of rows) {
    try {
      const get = col => { const i = hdrs.indexOf(col); return i >= 0 ? (row[i]||"").trim() : ""; };
      const mls = get("mls");
      if (!mls || !get("owner1name")) { failed++; continue; }
      if (skipDuplicates && allProspects.some(p => p.mls === mls)) { skipped++; continue; }
      const owners = [{name:get("owner1name"),street:get("owner1street"),city:get("owner1city"),postal:get("owner1postal")}];
      if (get("owner2name")) owners.push({name:get("owner2name"),street:get("owner2street"),city:get("owner2city"),postal:get("owner2postal")});
      await addDoc(collection(db,"prospects"), {
        mls, status:get("status")||"Expiré", listingAddress:get("listingaddress"),
        contractStart:get("contractstart"), expiry:get("expiry"),
        lastPrice:Number(get("lastprice"))||0, origPrice:Number(get("origprice"))||0,
        prevPrice:get("prevprice")?Number(get("prevprice")):null,
        agency:get("agency"), broker:get("broker"), brokerPhone:get("brokerphone"),
        owners, mail:["","","",""], visits:[],
        createdAt:serverTimestamp(), createdBy:currentUser.uid
      });
      imported++;
    } catch(e) { failed++; }
  }
  let msg = `Imported ${imported} prospect(s)`;
  if (skipped) msg += ` · ${skipped} duplicate${skipped > 1 ? "s" : ""} skipped`;
  if (failed) msg += ` · ${failed} failed`;
  showToast(msg);
}

window.saveNewProspect = async function () {
  const g = id => document.getElementById(id)?.value?.trim();
  const mls = g("ap_mls"); const o1name = g("ap_o1name");
  if (!mls || !o1name) {
    const e = document.getElementById("ap_error");
    e.textContent = "MLS # and at least one owner name are required.";
    e.style.display = "block"; return;
  }
  const duplicates = findDuplicates([mls]);
  const owners = [{ name: o1name, street: g("ap_o1street"), city: g("ap_o1city"), postal: g("ap_o1postal") }];
  if (g("ap_o2name")) owners.push({ name: g("ap_o2name"), street: g("ap_o2street"), city: g("ap_o2city"), postal: g("ap_o2postal") });
  const formData = {
    mls, status: g("ap_status"), listingAddress: g("ap_listingAddr"),
    contractStart: g("ap_start"), expiry: g("ap_expiry"),
    lastPrice: Number(g("ap_price")) || 0, origPrice: Number(g("ap_origPrice")) || 0,
    prevPrice: g("ap_prevPrice") ? Number(g("ap_prevPrice")) : null,
    agency: g("ap_agency"), broker: g("ap_broker"), brokerPhone: g("ap_phone"), owners
  };
  if (duplicates.length > 0) {
    closeAllModals();
    showDuplicateWarning(
      duplicates,
      async function() { await saveSingleProspect(formData); },
      function() { openAddProspect('single'); }
    );
  } else {
    await saveSingleProspect(formData);
  }
};

async function saveSingleProspect(data) {
  await addDoc(collection(db, "prospects"), {
    ...data, mail: ["","","",""], visits: [],
    createdAt: serverTimestamp(), createdBy: currentUser.uid
  });
  closeAllModals();
  showToast("Prospect added successfully");
}

window.deleteProspect = async function (id) {
  if (!confirm("Delete this prospect? This cannot be undone.")) return;
  await deleteDoc(doc(db, "prospects", id));
  closeAllModals();
  showToast("Prospect deleted");
};

window.startExportMode = function () {
  exportMode = true; selectedMLS.clear();
  document.getElementById("selBanner").classList.add("active");
  document.getElementById("exportModeBtn").style.display = "none";
  renderProspects();
};

window.cancelExportMode = function () {
  exportMode = false; selectedMLS.clear();
  document.getElementById("selBanner").classList.remove("active");
  document.getElementById("exportModeBtn").style.display = "";
  renderProspects();
};

window.toggleSelectProspect = function (mls) {
  if (selectedMLS.has(mls)) selectedMLS.delete(mls);
  else selectedMLS.add(mls);
  updateSelBanner(); renderProspects();
};

window.selectAllProspects = function () {
  allProspects.forEach(p => selectedMLS.add(p.mls));
  updateSelBanner(); renderProspects();
};

window.clearSelection = function () {
  selectedMLS.clear(); updateSelBanner(); renderProspects();
};

function updateSelBanner() {
  const n = selectedMLS.size;
  document.getElementById("selText").textContent = `${n} prospect${n !== 1 ? "s" : ""} selected`;
  document.getElementById("confirmExportBtn").disabled = n === 0;
}

window.showExportConfirm = function () {
  const sel = allProspects.filter(p => selectedMLS.has(p.mls));
  let num = 0;
  const items = sel.map(p => (p.owners || []).map(o => {
    num++;
    return `<div class="export-item"><div class="export-num">${num}</div>
      <div><div class="export-item-name">${o.name}</div>
      <div class="export-item-addr">${o.street}, ${o.city} ${o.postal}</div></div></div>`;
  }).join("")).join("");
  const totalLabels = sel.reduce((s, p) => s + (p.owners || []).length, 0);
  document.getElementById("exportModalContent").innerHTML = `
    <div class="modal-header"><div class="modal-title">Confirm export</div>
      <button class="close-x" onclick="closeAllModals()">×</button></div>
    <p style="font-size:13px;color:var(--text-2);">${sel.length} prospect${sel.length !== 1 ? "s" : ""} · ${totalLabels} mailing label${totalLabels !== 1 ? "s" : ""}</p>
    <div class="export-list">${items}</div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeAllModals()">Back</button>
      <button class="btn-confirm" onclick="doExport()">Download CSV ↓</button>
    </div>`;
  openModal("exportModal");
};

window.doExport = function () {
  const sel = allProspects.filter(p => selectedMLS.has(p.mls));
  const rows = [["Name","Street","City","Province","Postal Code"]];
  sel.forEach(p => {
    (p.owners || []).forEach(o => {
      if (!o.name) return;
      rows.push([o.name, o.street||"", o.city?.replace(/ \(.*\)/,"").trim()||"", "QC", o.postal||""]);
    });
  });
  const csv = rows.map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8;"}));
  a.download = "mailing_labels.csv"; a.click();
  closeAllModals(); cancelExportMode();
  showToast("Export downloaded");
};

async function renderDashboard() {
  const el = document.getElementById("dashboardContent");
  if (!el) return;
  const totalProspects = allProspects.length;
  const condos = allProspects.filter(p => detectPropertyType(p.listingAddress) === "condo").length;
  const houses = allProspects.filter(p => detectPropertyType(p.listingAddress) === "house").length;
  const totalMailings = allProspects.reduce((s, p) => s + (p.mail || []).filter(Boolean).length, 0);
  const totalVisits = allProspects.reduce((s, p) => s + (p.visits || []).length, 0);
  const evalsBooked = allProspects.filter(p => (p.visits || []).some(v => v.evalBooked === "yes")).length;
  const contacted = allProspects.filter(p => (p.visits || []).some(v => v.contact === "yes")).length;
  let activityHtml = '<p style="font-size:13px;color:var(--text-3);">No activity yet.</p>';
  try {
    const actSnap = await getDocs(query(collection(db, "activity"), orderBy("timestamp", "desc")));
    const acts = actSnap.docs.slice(0, 15).map(d => d.data());
    if (acts.length) {
      activityHtml = acts.map(a => {
        const prospect = allProspects.find(p => p.id === a.prospectId);
        const pName = prospect ? (prospect.owners?.[0]?.name || "MLS #" + prospect.mls) : "Unknown";
        const ts = a.timestamp?.toDate ? a.timestamp.toDate().toLocaleDateString("en-CA") : "";
        return `<div class="activity-item"><div class="activity-dot"></div>
          <div><div class="activity-text"><strong>${a.agentName || "Agent"}</strong> — ${a.action} on <em>${pName}</em></div>
          <div class="activity-time">${ts}</div></div></div>`;
      }).join("");
    }
  } catch(e) {}
  const agentStats = {};
  allProspects.forEach(p => {
    (p.visits || []).forEach(v => {
      const aid = v.agentId || "unknown"; const aname = v.agentName || "Unknown";
      if (!agentStats[aid]) agentStats[aid] = { name: aname, visits: 0, contacts: 0, evals: 0 };
      agentStats[aid].visits++;
      if (v.contact === "yes") agentStats[aid].contacts++;
      if (v.evalBooked === "yes") agentStats[aid].evals++;
    });
  });
  const agentCardsHtml = Object.values(agentStats).length === 0
    ? '<p style="font-size:13px;color:var(--text-3);">No visit activity logged yet.</p>'
    : Object.values(agentStats).map(a => `
      <div class="agent-card">
        <div class="agent-header"><div class="agent-avatar">${a.name.slice(0,2).toUpperCase()}</div>
        <div><div class="agent-name">${a.name}</div></div></div>
        <div class="agent-stats">
          <div class="agent-stat"><div class="agent-stat-num">${a.visits}</div><div class="agent-stat-lbl">Visits</div></div>
          <div class="agent-stat"><div class="agent-stat-num">${a.contacts}</div><div class="agent-stat-lbl">Contacts</div></div>
          <div class="agent-stat"><div class="agent-stat-num">${a.evals}</div><div class="agent-stat-lbl">Evals</div></div>
        </div></div>`).join("");
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Total prospects</div><div class="stat-value">${totalProspects}</div></div>
      <div class="stat-card"><div class="stat-label">🏢 Condos</div><div class="stat-value">${condos}</div></div>
      <div class="stat-card"><div class="stat-label">🏠 Houses</div><div class="stat-value">${houses}</div></div>
      <div class="stat-card"><div class="stat-label">Mailings sent</div><div class="stat-value">${totalMailings}</div></div>
      <div class="stat-card"><div class="stat-label">Door visits</div><div class="stat-value">${totalVisits}</div></div>
      <div class="stat-card"><div class="stat-label">Contacts made</div><div class="stat-value">${contacted}</div></div>
      <div class="stat-card"><div class="stat-label">Evals booked</div><div class="stat-value">${evalsBooked}</div></div>
    </div>
    <div class="section-title" style="margin-bottom:12px;">Agent activity</div>
    ${agentCardsHtml}
    <div class="section-title" style="margin:20px 0 12px;">Recent activity log</div>
    <div class="activity-list">${activityHtml}</div>`;
}

async function loadAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  allUsers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

async function renderAdmin() {
  await loadAllUsers();
  const el = document.getElementById("adminContent");
  const usersHtml = allUsers.length === 0
    ? '<p style="font-size:13px;color:var(--text-3);">No users yet.</p>'
    : allUsers.map(u => `
      <div class="admin-card">
        <div class="agent-avatar">${(u.name || u.email || "?").slice(0,2).toUpperCase()}</div>
        <div class="admin-card-info"><div class="admin-card-name">${u.name || "—"}</div>
        <div class="admin-card-email">${u.email || ""}</div></div>
        <span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'} admin-card-role">${u.role || "agent"}</span>
      </div>`).join("");
  el.innerHTML = `
    <div class="section-title" style="margin-bottom:12px;">Team members (${allUsers.length})</div>
    ${usersHtml}
    <div style="margin-top:24px;padding:16px;background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);">
      <div class="section-title" style="margin-bottom:8px;">How to add agents</div>
      <p style="font-size:13px;color:var(--text-2);line-height:1.6;">
        1. Firebase → Authentication → Users → Add user<br>
        2. Copy UID → Firestore → users collection → Add document<br>
        3. Document ID = UID, fields: <code>name</code>, <code>email</code>, <code>role: "agent"</code>
      </p>
    </div>`;
}

window.openInviteAgent = function () {
  document.getElementById("inviteModalContent").innerHTML = `
    <div class="modal-header"><div class="modal-title">Add Agent</div>
      <button class="close-x" onclick="closeAllModals()">×</button></div>
    <ol style="font-size:13px;color:var(--text-2);line-height:2;padding-left:18px;">
      <li>Go to <strong>Authentication → Users → Add user</strong></li>
      <li>Enter the agent's email and a temporary password</li>
      <li>Copy the UID → Firestore → users collection</li>
      <li>New document: UID as ID, fields: <code>name</code>, <code>email</code>, <code>role: "agent"</code></li>
    </ol>
    <div class="modal-actions">
      <button class="btn-primary" style="width:auto;padding:9px 20px;" onclick="closeAllModals()">Got it</button>
    </div>`;
  openModal("inviteModal");
};

function openModal(id) {
  document.querySelectorAll(".modal").forEach(m => m.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.getElementById("modalOverlay").classList.add("open");
}

window.closeAllModals = function (e) {
  if (e && e.target !== document.getElementById("modalOverlay")) return;
  document.getElementById("modalOverlay").classList.remove("open");
  document.querySelectorAll(".modal").forEach(m => m.classList.remove("active"));
};

function showToast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

document.addEventListener("click", e => {
  if (e.target.classList.contains("close-x")) {
    document.getElementById("modalOverlay").classList.remove("open");
    document.querySelectorAll(".modal").forEach(m => m.classList.remove("active"));
  }
});
