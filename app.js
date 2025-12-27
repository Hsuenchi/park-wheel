// app.js
const $ = (sel) => document.querySelector(sel);

const parkInput = $("#parkInput");
const addBtn = $("#addBtn");

// ✅ optional legacy nodes (null-safe)
const listSection = $("#listSection");
const listTitle = $("#listTitle");
const chips = $("#chips");

const emptyState = $("#emptyState");
const emptyText = $("#emptyText");
const wheelSection = $("#wheelSection");

const wheelRotator = $("#wheelRotator");
const wheelSvg = $("#wheelSvg");

const spinBtn = $("#spinBtn");
const spinText = $("#spinText");

const resultBox = $("#result");
const resultName = $("#resultName");

const newBatchBtn = $("#btnNewBatch");

// filters
const mapBtn = $("#mapBtn");
const modeSelect = $("#modeSelect");
const districtGroup = $("#districtGroup");
const districtSelect = $("#districtSelect");
const locBtn = $("#locBtn");
const resetNoRepeatBtn = $("#resetNoRepeatBtn");
const filterHint = $("#filterHint");

// preserve + favorite
const preserveBtn = $("#preserveBtn");
const favBtn = $("#favBtn");

// favorites section
const favList = $("#favList");
const favEmpty = $("#favEmpty");
const favClearBtn = $("#favClearBtn");

// record + undo + modal
const undoBtn = $("#undoBtn");
const recordBtn = $("#recordBtn");
const recordPanel = $("#recordPanel");
const recordCloseBtn = $("#recordCloseBtn");
const recordList = $("#recordList");
const recordEmpty = $("#recordEmpty");

const loveModal = $("#loveModal");
const loveCloseBtn = $("#loveCloseBtn");

// constants
const BATCH_SIZE = 6;
const NEAR_TOP_N = 30;

const DATA_URLS = ["./parks.full.json", "./parks.names.json"];
const CUSTOM_KEY = "tripweb_custom_parks_v1";

const SHOWN_KEY  = "tripweb_shown_parks_v1";   // legacy
const WIN_KEY    = "tripweb_won_parks_v1";     // in-batch no-repeat
const SEALED_KEY = "tripweb_sealed_parks_v1";  // cross-batch seal

// ✅ new: record/history + undo + love flag
const HISTORY_KEY     = "tripweb_history_v1";
const UNDO_STACK_KEY  = "tripweb_undo_stack_v1";
const LOVE_SHOWN_KEY  = "tripweb_love_shown_v1";

// favorites + near cursor
const FAV_KEY = "tripweb_fav_parks_v1";
const NEAR_CURSOR_KEY = "tripweb_near_cursor_v1";
const NEAR_LOC_KEY    = "tripweb_near_loc_v1";

// state
let parks = [];
let isSpinning = false;
let rotation = 0;
let selectedPark = null;

let masterPool = [];
let customParks = [];
let parkMeta = new Map();

let userLoc = null;
let lastBatchSet = new Set();

// near cache
let nearSorted = [];
let nearCursor = 0;
let nearLocKey = "";

// favorites + history
let favorites = [];
let history = [];

/** 色盤 */
const colors = [
  { start: "#BFC8D7", end: "#A8B3C5" },
  { start: "#E2D2D2", end: "#D1C0C0" },
  { start: "#E3E2B4", end: "#D4D3A0" },
  { start: "#A2B59F", end: "#8FA48C" },
  { start: "#BFC8D7", end: "#A8B3C5" },
  { start: "#E2D2D2", end: "#D1C0C0" },
  { start: "#E3E2B4", end: "#D4D3A0" },
  { start: "#A2B59F", end: "#8FA48C" },
];

// =========================
// Utils
// =========================
function normalizeName(x) { return String(x ?? "").trim(); }

function uniqueStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const s = normalizeName(v);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function loadCustomParks() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return uniqueStrings(arr);
  } catch { return []; }
}
function saveCustomParks() {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(customParks));
}

function loadSet(key) {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(normalizeName).filter(Boolean) : []);
  } catch { return new Set(); }
}
function saveSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

function loadArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return uniqueStrings(Array.isArray(arr) ? arr : []);
  } catch { return []; }
}
function saveArray(key, arr) {
  localStorage.setItem(key, JSON.stringify(uniqueStrings(arr)));
}

function loadNumber(key, fallback = 0) {
  const raw = localStorage.getItem(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
function saveNumber(key, n) { localStorage.setItem(key, String(Number(n) || 0)); }

function loadString(key, fallback = "") {
  const raw = localStorage.getItem(key);
  return typeof raw === "string" ? raw : fallback;
}
function saveString(key, s) { localStorage.setItem(key, String(s ?? "")); }

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed: ${url}`);
  return await res.json();
}

function getFirstString(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim()) return String(obj[k]).trim();
  }
  return "";
}
function toNumberMaybe(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function extractParksFromJson(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  if (typeof data[0] === "string") {
    return uniqueStrings(data).map((name) => ({ name }));
  }
  if (typeof data[0] === "object" && data[0]) {
    const out = [];
    for (const obj of data) {
      const name = getFirstString(obj, ["name","Name","公園名稱","公園名","parkName","title"]);
      if (!name) continue;
      const district = getFirstString(obj, ["district","District","行政區","區","town","addrDistrict"]);
      const address  = getFirstString(obj, ["address","Address","地址","addr","location","位置"]);
      const lat = toNumberMaybe(obj.lat ?? obj.latitude ?? obj.Latitude ?? obj.緯度 ?? obj.Y ?? obj.y);
      const lng = toNumberMaybe(obj.lng ?? obj.longitude ?? obj.Longitude ?? obj.經度 ?? obj.X ?? obj.x);
      out.push({ name: normalizeName(name), district: normalizeName(district), address: normalizeName(address), lat, lng });
    }
    const seen = new Set();
    const dedup = [];
    for (const p of out) {
      if (!p.name) continue;
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      dedup.push(p);
    }
    return dedup;
  }
  return [];
}

function shuffledCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandomUnique(all, count, excludeSet = new Set(), forceInclude = "") {
  const force = normalizeName(forceInclude);
  const pool = all.filter(n => !excludeSet.has(n));
  let picked = [];
  if (pool.length >= count) picked = shuffledCopy(pool).slice(0, count);
  else picked = shuffledCopy(all).slice(0, Math.min(count, all.length));

  if (force) {
    if (!picked.includes(force)) {
      if (picked.length >= count) picked[picked.length - 1] = force;
      else picked.push(force);
    }
    picked = uniqueStrings(picked);
    if (picked.length < count) {
      const remain = all.filter(n => !picked.includes(n));
      const more = shuffledCopy(remain).slice(0, count - picked.length);
      picked = picked.concat(more);
    }
  }
  return picked.slice(0, count);
}

function resetWheelInstant() {
  rotation = 0;
  wheelRotator.style.transition = "none";
  wheelRotator.style.transform = "rotate(0deg)";
  wheelRotator.offsetHeight;
  wheelRotator.style.transition = "";
}

function buildMapUrl(name) {
  const meta = parkMeta.get(name);
  if (meta && Number.isFinite(meta.lat) && Number.isFinite(meta.lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${meta.lat},${meta.lng}`)}`;
  }
  const query = meta?.address ? `${name} ${meta.address}` : name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function setFilterHint(msg = "") {
  if (!filterHint) return;
  filterHint.textContent = msg;
}

function setMapBtn(name) {
  if (!mapBtn) return;
  if (!name) {
    mapBtn.href = "#";
    mapBtn.setAttribute("aria-disabled", "true");
    return;
  }
  mapBtn.href = buildMapUrl(name);
  mapBtn.setAttribute("aria-disabled", "false");
}

// =========================
// Undo (stack snapshots of localStorage)
// =========================
const SNAP_KEYS = [
  WIN_KEY, SEALED_KEY, HISTORY_KEY, FAV_KEY,
  NEAR_CURSOR_KEY, NEAR_LOC_KEY,
  LOVE_SHOWN_KEY
];

function loadUndoStack() {
  try {
    const raw = localStorage.getItem(UNDO_STACK_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveUndoStack(stack) {
  localStorage.setItem(UNDO_STACK_KEY, JSON.stringify(stack));
}
function pushUndo(label = "") {
  const snap = { t: Date.now(), label, store: {} };
  for (const k of SNAP_KEYS) snap.store[k] = localStorage.getItem(k); // string|null
  const stack = loadUndoStack();
  stack.push(snap);
  while (stack.length > 40) stack.shift();
  saveUndoStack(stack);
  updateUndoUI();
}
function undoOnce() {
  const stack = loadUndoStack();
  const snap = stack.pop();
  if (!snap) return;

  // restore
  for (const k of SNAP_KEYS) {
    const v = snap.store[k];
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  }
  saveUndoStack(stack);

  // re-read in-memory caches
  favorites = loadArray(FAV_KEY);
  history = loadArray(HISTORY_KEY);
  nearCursor = loadNumber(NEAR_CURSOR_KEY, 0);
  nearLocKey = loadString(NEAR_LOC_KEY, "");

  // UI refresh
  selectedPark = null;
  renderAll();
  if (!isSpinning) loadNewBatch();

  setFilterHint("已恢復上一個動作。");
  updateUndoUI();
}
function updateUndoUI() {
  if (!undoBtn) return;
  const stack = loadUndoStack();
  undoBtn.disabled = isSpinning || stack.length === 0;
}

// =========================
// Favorites
// =========================
function loadFavorites() { return loadArray(FAV_KEY); }
function saveFavorites() { saveArray(FAV_KEY, favorites); }

function isFav(name) { return favorites.includes(name); }

function addFavorite(name) {
  const n = normalizeName(name);
  if (!n) return;
  pushUndo("favorite_add");
  if (!favorites.includes(n)) {
    favorites.unshift(n);
    favorites = uniqueStrings(favorites);
    saveFavorites();
    setFilterHint(`已收藏「${n}」❤️`);
  } else {
    setFilterHint(`「${n}」已在收藏裡 ❤️`);
  }
  renderFavorites();
  renderRecord();
  updateUndoUI();
}
function removeFavorite(name) {
  const n = normalizeName(name);
  pushUndo("favorite_remove");
  favorites = favorites.filter(x => x !== n);
  saveFavorites();
  renderFavorites();
  renderRecord();
  updateUndoUI();
}
function toggleFavorite(name) {
  const n = normalizeName(name);
  if (!n) return;
  if (isFav(n)) removeFavorite(n);
  else addFavorite(n);
}
function clearFavorites() {
  if (favorites.length === 0) return;
  pushUndo("favorite_clear");
  favorites = [];
  saveFavorites();
  renderFavorites();
  renderRecord();
  updateUndoUI();
}

function renderFavorites() {
  if (!favList || !favEmpty) return;
  favList.innerHTML = "";
  const has = favorites.length > 0;
  favEmpty.classList.toggle("hidden", has);

  for (const name of favorites) {
    const li = document.createElement("li");
    li.className = "favItem";

    const left = document.createElement("div");
    left.className = "favName";
    left.textContent = name;

    const actions = document.createElement("div");
    actions.className = "favActions";

    const open = document.createElement("a");
    open.className = "favOpen";
    open.href = buildMapUrl(name);
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "地圖";

    const rm = document.createElement("button");
    rm.className = "favRemove";
    rm.type = "button";
    rm.textContent = "移除";
    rm.dataset.removeFav = name;

    actions.appendChild(open);
    actions.appendChild(rm);

    li.appendChild(left);
    li.appendChild(actions);
    favList.appendChild(li);
  }
}

// =========================
// History / Record
// =========================
function loadHistory() { return loadArray(HISTORY_KEY); }
function saveHistory() { saveArray(HISTORY_KEY, history); }

function addHistory(name) {
  const n = normalizeName(name);
  if (!n) return;
  if (history.includes(n)) return;
  history.unshift(n);
  history = uniqueStrings(history);
  saveHistory();
}

function removeHistory(name) {
  const n = normalizeName(name);
  history = history.filter(x => x !== n);
  saveHistory();
}

function renderRecord() {
  if (!recordList || !recordEmpty) return;
  recordList.innerHTML = "";
  const has = history.length > 0;
  recordEmpty.classList.toggle("hidden", has);

  for (const name of history) {
    const li = document.createElement("li");
    li.className = "recordItem";

    const nm = document.createElement("div");
    nm.className = "recordName";
    nm.textContent = name;

    const acts = document.createElement("div");
    acts.className = "recordActions";

    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "btn-recFav" + (isFav(name) ? " isOn" : "");
    fav.textContent = "♥";
    fav.title = "收藏 / 取消收藏";
    fav.dataset.favToggle = name;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-recDel";
    del.textContent = "刪除";
    del.title = "刪除紀錄並恢復可抽";
    del.dataset.recDelete = name;

    acts.appendChild(fav);
    acts.appendChild(del);

    li.appendChild(nm);
    li.appendChild(acts);
    recordList.appendChild(li);
  }
}

function openRecordPanel() {
  if (!recordPanel) return;
  renderRecord();
  recordPanel.classList.remove("hidden");
}
function closeRecordPanel() {
  if (!recordPanel) return;
  recordPanel.classList.add("hidden");
}

// ✅ 刪除紀錄 = 解除封印 + 解除同批不重複 + 移出紀錄
function deleteRecordAndUnseal(name) {
  const n = normalizeName(name);
  if (!n) return;

  pushUndo("record_delete_unseal");

  // remove history
  removeHistory(n);

  // unseal + unwon
  const sealed = loadSet(SEALED_KEY);
  const won = loadSet(WIN_KEY);
  sealed.delete(n);
  won.delete(n);
  saveSet(SEALED_KEY, sealed);
  saveSet(WIN_KEY, won);

  setFilterHint(`已刪除紀錄「${n}」：它已重新變成可被抽到。`);
  renderRecord();

  // 若不是轉動中，刷新 batch（避免剛好卡住）
  if (!isSpinning) loadNewBatch();
  updateUndoUI();
}

// =========================
// Modal (love)
// =========================
function showLoveModalOnceIfCompleted(sealedSet) {
  const total = masterPool.length;
  if (total <= 0) return;

  const already = localStorage.getItem(LOVE_SHOWN_KEY) === "1";
  if (already) return;

  if (sealedSet.size >= total) {
    localStorage.setItem(LOVE_SHOWN_KEY, "1");
    if (loveModal) loveModal.classList.remove("hidden");
  }
}
function closeLoveModal() {
  if (!loveModal) return;
  loveModal.classList.add("hidden");
}

// =========================
// UI
// =========================
function updateControlLocksByMode() {
  const mode = modeSelect ? modeSelect.value : "all";
  const hasDistrictData = districtSelect && districtSelect.options && districtSelect.options.length > 0;

  if (districtSelect) {
    const enableDistrict = (mode === "district") && hasDistrictData && !isSpinning;
    districtSelect.disabled = !enableDistrict;
  }

  if (locBtn) {
    const enableLoc = (mode === "near") && !userLoc && !isSpinning;
    locBtn.disabled = !enableLoc;
  }

  if (resetNoRepeatBtn) resetNoRepeatBtn.disabled = isSpinning;
  if (modeSelect) modeSelect.disabled = isSpinning;

  updateUndoUI();

  if (mode === "district" && !hasDistrictData && !isSpinning) {
    setFilterHint("你的資料裡沒有行政區欄位（district/行政區/區），所以無法依行政區篩選。");
  }
  if (mode === "near" && !isSpinning) {
    setFilterHint(userLoc ? `已取得定位：將依序提供最近 ${NEAR_TOP_N} 個（每批 ${BATCH_SIZE} 個）。` : "最近模式需要定位：請按「取得定位」。");
  }
}

function setUIState() {
  const hasParks = parks.length > 0;
  emptyState.classList.toggle("hidden", hasParks);
  wheelSection.classList.toggle("hidden", !hasParks);

  if (listSection) listSection.classList.add("hidden");
  if (listTitle) listTitle.textContent = "";

  parkInput.disabled = isSpinning;
  addBtn.disabled = isSpinning;
  spinBtn.disabled = isSpinning || !hasParks;
  if (newBatchBtn) newBatchBtn.disabled = isSpinning || masterPool.length === 0;

  spinText.textContent = isSpinning ? "轉動中..." : "開始轉動！";

  updateControlLocksByMode();

  if (!selectedPark || isSpinning) {
    resultBox.classList.add("hidden");
    setMapBtn(null);

    if (preserveBtn) { preserveBtn.disabled = true; preserveBtn.classList.add("hidden"); }
    if (favBtn) { favBtn.disabled = true; favBtn.classList.add("hidden"); }
  } else {
    resultBox.classList.remove("hidden");
    resultName.textContent = selectedPark;
    setMapBtn(selectedPark);

    if (preserveBtn) { preserveBtn.disabled = false; preserveBtn.classList.remove("hidden"); }
    if (favBtn) { favBtn.disabled = false; favBtn.classList.remove("hidden"); }
  }
}

function renderChips() {
  if (!chips) return;
  chips.innerHTML = "";
}

function renderAll() {
  setUIState();
  renderChips();
  renderFavorites();
  renderRecord();
}

// =========================
// SVG Helpers
// =========================
function polarToXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polarToXY(cx, cy, r, startAngle);
  const end = polarToXY(cx, cy, r, endAngle);
  const largeArcFlag = (endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

function rebuildWheel() {
  wheelSvg.innerHTML = "";
  if (parks.length === 0) return;

  const cx = 200, cy = 200, r = 200;
  const segmentAngle = 360 / parks.length;

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  wheelSvg.appendChild(defs);

  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", "textShadow");
  filter.innerHTML = `<feDropShadow dx="0" dy="1.2" stdDeviation="0.6" flood-color="rgba(0,0,0,0.35)"/>`;
  defs.appendChild(filter);

  parks.forEach((name, i) => {
    const startAngle = i * segmentAngle - 90 - (segmentAngle / 2);
    const endAngle = startAngle + segmentAngle;

    const grad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    grad.setAttribute("id", `gradient-${i}`);
    grad.setAttribute("x1", "0%");
    grad.setAttribute("y1", "0%");
    grad.setAttribute("x2", "100%");
    grad.setAttribute("y2", "100%");

    const c = colors[i % colors.length];
    const stop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", c.start);
    const stop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop2.setAttribute("offset", "100%");
    stop2.setAttribute("stop-color", c.end);

    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", arcPath(cx, cy, r, startAngle, endAngle));
    path.setAttribute("fill", `url(#gradient-${i})`);
    path.setAttribute("stroke", "white");
    path.setAttribute("stroke-width", "3");
    g.appendChild(path);

    const midAngle = startAngle + segmentAngle / 2;
    const textR = 150;
    const p = polarToXY(cx, cy, textR, midAngle);
    const px = Math.round(p.x);
    const py = Math.round(p.y);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(px));
    text.setAttribute("y", String(py));
    text.setAttribute("fill", "white");
    text.setAttribute("font-family", `"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui`);
    text.setAttribute("font-weight", "800");

    const len = name.length;
    let fs = 18;
    if (len >= 10) fs = 17;
    if (len >= 12) fs = 16;
    if (len >= 14) fs = 15;
    text.setAttribute("font-size", String(fs));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("filter", "url(#textShadow)");
    text.setAttribute("transform", `rotate(${midAngle + 90}, ${px}, ${py})`);

    const MAX = 12;
    const label = (name.length > MAX) ? (name.slice(0, MAX) + "…") : name;
    text.textContent = label;

    g.appendChild(text);
    wheelSvg.appendChild(g);
  });
}

// =========================
// District options
// =========================
function updateDistrictOptions() {
  if (!districtSelect) return;

  const districts = new Set();
  for (const name of masterPool) {
    const meta = parkMeta.get(name);
    const d = normalizeName(meta?.district);
    if (d) districts.add(d);
  }

  const list = [...districts].sort((a,b)=>a.localeCompare(b, "zh-Hant"));
  districtSelect.innerHTML = "";
  for (const d of list) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    districtSelect.appendChild(opt);
  }
}

// =========================
// Distance
// =========================
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function getFilteredPoolNamesNonNear() {
  const mode = modeSelect ? modeSelect.value : "all";

  if (mode === "district") {
    const d = normalizeName(districtSelect?.value);
    if (!d) return masterPool.slice();
    return masterPool.filter((name) => normalizeName(parkMeta.get(name)?.district) === d);
  }

  return masterPool.slice();
}

// =========================
// Near cache & batch
// =========================
function computeNearLocKey(loc) {
  if (!loc) return "";
  return `${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`;
}

function buildNearCacheIfNeeded(force = false) {
  if (!userLoc) return false;

  const newKey = computeNearLocKey(userLoc);
  const storedKey = loadString(NEAR_LOC_KEY, "");
  const storedCursor = loadNumber(NEAR_CURSOR_KEY, 0);

  if (!force && storedKey === newKey) {
    nearLocKey = storedKey;
    nearCursor = storedCursor;
  } else {
    nearLocKey = newKey;
    nearCursor = 0;
    saveString(NEAR_LOC_KEY, nearLocKey);
    saveNumber(NEAR_CURSOR_KEY, nearCursor);
  }

  const withCoord = masterPool
    .map((name) => {
      const meta = parkMeta.get(name);
      if (!meta || !Number.isFinite(meta.lat) || !Number.isFinite(meta.lng)) return null;
      const km = haversineKm(userLoc.lat, userLoc.lng, meta.lat, meta.lng);
      return { name, km };
    })
    .filter(Boolean)
    .sort((a, b) => a.km - b.km);

  nearSorted = withCoord.slice(0, NEAR_TOP_N).map(x => x.name);
  return true;
}

function loadNearBatch() {
  if (!userLoc) {
    parks = [];
    selectedPark = null;
    setFilterHint("最近模式需要定位：請按「取得定位」。");
    resetWheelInstant();
    wheelSvg.innerHTML = "";
    renderAll();
    return;
  }

  buildNearCacheIfNeeded(false);

  if (!nearSorted || nearSorted.length === 0) {
    parks = [];
    selectedPark = null;
    setFilterHint("你的資料沒有足夠的經緯度（lat/lng），所以無法用『距離我最近』。");
    resetWheelInstant();
    wheelSvg.innerHTML = "";
    renderAll();
    return;
  }

  if (nearCursor >= nearSorted.length) {
    parks = [];
    selectedPark = null;
    setFilterHint("沒有再更近了...");
    resetWheelInstant();
    wheelSvg.innerHTML = "";
    renderAll();
    return;
  }

  const batch = nearSorted.slice(nearCursor, nearCursor + BATCH_SIZE);
  nearCursor += batch.length;
  saveNumber(NEAR_CURSOR_KEY, nearCursor);

  parks = batch;
  lastBatchSet = new Set(parks);
  selectedPark = null;

  resetWheelInstant();
  rebuildWheel();
  setFilterHint(`最近 ${NEAR_TOP_N} 個中：第 ${Math.ceil((nearCursor)/BATCH_SIZE)} 批（${batch.length} 個）。`);
  renderAll();
}

// =========================
// Batch logic
// =========================
function loadNewBatch(forceInclude = "") {
  if (masterPool.length === 0) return;

  const mode = modeSelect ? modeSelect.value : "all";
  if (mode === "near") {
    loadNearBatch();
    return;
  }

  const sealedSet = loadSet(SEALED_KEY);

  const basePool = getFilteredPoolNamesNonNear();
  const maxCount = Math.min(BATCH_SIZE, basePool.length);

  const remaining = basePool.filter(n => !sealedSet.has(n));

  if (remaining.length === 0) {
    parks = [];
    lastBatchSet = new Set();
    selectedPark = null;

    setFilterHint("🎉 這個篩選範圍內都已抽過（封印完）！目前 0 個可抽。請按『重置不重複』或切換模式。");

    resetWheelInstant();
    wheelSvg.innerHTML = "";
    renderAll();
    return;
  }

  const primaryCount = Math.min(maxCount, remaining.length);
  let primary = pickRandomUnique(remaining, primaryCount, new Set(), forceInclude);

  let batch = primary.slice();
  if (batch.length < maxCount) {
    const need = maxCount - batch.length;
    const fillerCandidates = basePool.filter(n => !batch.includes(n));
    const filler = pickRandomUnique(fillerCandidates, need, lastBatchSet, "");
    batch = uniqueStrings(batch.concat(filler));

    while (batch.length < maxCount && basePool.length > 0) {
      batch.push(basePool[Math.floor(Math.random() * basePool.length)]);
    }
    batch = batch.slice(0, maxCount);
  }

  parks = batch;
  lastBatchSet = new Set(parks);
  selectedPark = null;

  resetWheelInstant();
  rebuildWheel();
  renderAll();
}

// =========================
// Actions
// =========================
function addPark(name) {
  const trimmed = normalizeName(name);
  if (!trimmed) return;

  if (!customParks.includes(trimmed)) {
    customParks.push(trimmed);
    customParks = uniqueStrings(customParks);
    saveCustomParks();
  }
  if (!masterPool.includes(trimmed)) {
    masterPool.push(trimmed);
    masterPool = uniqueStrings(masterPool);
  }
  if (!parkMeta.has(trimmed)) {
    parkMeta.set(trimmed, { name: trimmed });
  }

  parkInput.value = "";
  loadNewBatch(trimmed);
}

// ✅ 保留：解除封印 + 解除同批不重複 + 並且「不留紀錄」
function preserveSelected() {
  const name = normalizeName(selectedPark);
  if (!name) return;

  pushUndo("preserve");

  const sealedSet = loadSet(SEALED_KEY);
  const wonSet = loadSet(WIN_KEY);

  const wasSealed = sealedSet.delete(name);
  const wasWon = wonSet.delete(name);

  saveSet(SEALED_KEY, sealedSet);
  saveSet(WIN_KEY, wonSet);

  // ✅ 不留紀錄：若剛才已寫入紀錄，這裡移除
  if (history.includes(name)) {
    history = history.filter(x => x !== name);
    saveHistory();
  }

  if (wasSealed || wasWon) {
    setFilterHint(`已保留「${name}」：不封印、也不記錄（之後仍可能再抽到）。`);
  } else {
    setFilterHint(`「${name}」目前本來就不在封印中（已確保不記錄）。`);
  }

  renderAll();
  updateUndoUI();
}

function spin() {
  if (isSpinning || parks.length === 0) return;

  isSpinning = true;
  selectedPark = null;
  setUIState();
  renderChips();

  const n = parks.length;
  const slice = 360 / n;

  const wonSet = loadSet(WIN_KEY);
  const sealedSet0 = loadSet(SEALED_KEY);

  // ✅ candidates: not won and not sealed
  let candidates = parks.filter((p) => !wonSet.has(p) && !sealedSet0.has(p));

  // ✅ 1) 你要的提示：轉到相同 / 已無可抽
  if (candidates.length === 0) {
    isSpinning = false;
    setFilterHint("轉過這個了! 請再轉一次或換一批!");
    renderAll();
    return;
  }

  // pick winner index by candidate
  const winnerName = candidates[Math.floor(Math.random() * candidates.length)];
  const winnerIndex = parks.indexOf(winnerName);

  const desiredNormalized = ((360 - winnerIndex * slice) % 360 + 360) % 360;
  const spins = 5 + Math.random() * 3;
  const delta = ((desiredNormalized - rotation) % 360 + 360) % 360;
  const totalRotation = rotation + (spins * 360) + delta;

  wheelRotator.style.transition = "transform 3800ms cubic-bezier(0.12, 0.78, 0.18, 1)";
  wheelRotator.style.transform = `rotate(${totalRotation}deg)`;

  window.setTimeout(() => {
    const normalized = ((totalRotation % 360) + 360) % 360;

    const idx = Math.floor(((360 - normalized + slice / 2) % 360) / slice);
    const picked = parks[idx];

    // ✅ 防呆：若停到封印格（統一你要的文案）
    const sealedSet1 = loadSet(SEALED_KEY);
    if (sealedSet1.has(picked)) {
      isSpinning = false;
      setFilterHint("轉過這個了! 請再轉一次或換一批!");
      renderAll();
      return;
    }

    // ✅ 這次會寫入封印/紀錄，所以先 pushUndo
    pushUndo("spin_pick");

    // in-batch no repeat
    wonSet.add(picked);
    saveSet(WIN_KEY, wonSet);

    // cross-batch seal
    sealedSet1.add(picked);
    saveSet(SEALED_KEY, sealedSet1);

    // ✅ record/history: 重複只記一次
    history = loadHistory();
    addHistory(picked);

    // bounce
    const BOUNCE = 7;
    wheelRotator.style.transition = "transform 140ms ease-out";
    wheelRotator.style.transform = `rotate(${totalRotation + BOUNCE}deg)`;

    window.setTimeout(() => {
      wheelRotator.style.transition = "transform 220ms ease-in";
      wheelRotator.style.transform = `rotate(${totalRotation}deg)`;

      window.setTimeout(() => {
        rotation = normalized;
        wheelRotator.style.transition = "none";
        wheelRotator.style.transform = `rotate(${rotation}deg)`;
        wheelRotator.offsetHeight;
        wheelRotator.style.transition = "";

        selectedPark = picked;
        isSpinning = false;

        // ✅ 4) 全收集告白
        showLoveModalOnceIfCompleted(sealedSet1);

        renderAll();
        updateUndoUI();
      }, 230);
    }, 150);
  }, 3800);
}

// =========================
// Location
// =========================
function requestLocation() {
  if (!("geolocation" in navigator)) {
    setFilterHint("你的瀏覽器不支援定位，無法使用『距離我最近』模式。");
    return;
  }

  setFilterHint("定位中…");
  if (locBtn) locBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      buildNearCacheIfNeeded(true);
      updateControlLocksByMode();

      if (!isSpinning && modeSelect && modeSelect.value === "near") loadNewBatch();
      else if (!isSpinning) setFilterHint("已取得定位。切到『距離我最近』即可使用。");
    },
    () => {
      if (locBtn) locBtn.disabled = false;
      userLoc = null;
      setFilterHint("定位失敗或你拒絕定位權限。你仍可使用隨機/行政區模式。");
      updateControlLocksByMode();
    },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 300000 }
  );
}

// =========================
// Reset no-repeat
// =========================
function resetNoRepeat() {
  pushUndo("reset_no_repeat");

  localStorage.removeItem(WIN_KEY);
  localStorage.removeItem(SEALED_KEY);
  localStorage.removeItem(SHOWN_KEY);
  localStorage.removeItem(NEAR_CURSOR_KEY);

  // ✅ 讓告白可再次觸發
  localStorage.removeItem(LOVE_SHOWN_KEY);

  setFilterHint("已重置『封印/不重複』紀錄。");
  if (!isSpinning) loadNewBatch();
  updateUndoUI();
}

// =========================
// Init
// =========================
async function init() {
  if (emptyText) emptyText.textContent = "正在載入公園資料…";

  favorites = loadFavorites();
  history = loadHistory();
  renderAll();

  customParks = loadCustomParks();

  // load data
  let parksObjs = [];
  for (const url of DATA_URLS) {
    try {
      const data = await fetchJson(url);
      parksObjs = extractParksFromJson(data);
      if (parksObjs.length) break;
    } catch {}
  }

  parkMeta = new Map();
  for (const p of parksObjs) {
    if (!p.name) continue;
    parkMeta.set(p.name, p);
  }

  const jsonNames = parksObjs.map(p => p.name);
  masterPool = uniqueStrings([...jsonNames, ...customParks]);

  for (const n of customParks) {
    if (!parkMeta.has(n)) parkMeta.set(n, { name: n });
  }

  if (masterPool.length === 0) {
    if (emptyText) emptyText.textContent = "找不到公園資料（請確認 parks.full.json 或 parks.names.json 存在）";
    setUIState();
    return;
  }

  updateDistrictOptions();

  // legacy cleanup
  localStorage.removeItem(SHOWN_KEY);

  loadNewBatch();

  // events
  addBtn.addEventListener("click", () => addPark(parkInput.value));
  parkInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPark(parkInput.value);
  });

  spinBtn.addEventListener("click", spin);

  if (newBatchBtn) {
    newBatchBtn.addEventListener("click", () => {
      if (isSpinning) return;
      loadNewBatch();
    });
  }

  if (preserveBtn) {
    preserveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      preserveSelected();
    });
  }

  if (favBtn) {
    favBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (selectedPark) toggleFavorite(selectedPark);
    });
  }

  if (favList) {
    favList.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const name = t.dataset.removeFav;
      if (name) removeFavorite(name);
    });
  }
  if (favClearBtn) favClearBtn.addEventListener("click", clearFavorites);

  if (modeSelect) {
    modeSelect.addEventListener("change", () => {
      updateControlLocksByMode();
      if (!isSpinning) loadNewBatch();
    });
  }
  if (districtSelect) {
    districtSelect.addEventListener("change", () => {
      if (!isSpinning) loadNewBatch();
    });
  }
  if (locBtn) locBtn.addEventListener("click", requestLocation);
  if (resetNoRepeatBtn) resetNoRepeatBtn.addEventListener("click", resetNoRepeat);

  // record panel
  if (recordBtn) recordBtn.addEventListener("click", openRecordPanel);
  if (recordCloseBtn) recordCloseBtn.addEventListener("click", closeRecordPanel);
  if (recordPanel) {
    recordPanel.addEventListener("click", (e) => {
      if (e.target === recordPanel) closeRecordPanel(); // 點遮罩關閉
    });
  }
  if (recordList) {
    recordList.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      const favName = t.dataset.favToggle;
      if (favName) {
        toggleFavorite(favName);
        renderRecord();
        return;
      }

      const delName = t.dataset.recDelete;
      if (delName) {
        deleteRecordAndUnseal(delName);
        return;
      }
    });
  }

  // undo
  if (undoBtn) undoBtn.addEventListener("click", undoOnce);

  // love modal
  if (loveCloseBtn) loveCloseBtn.addEventListener("click", closeLoveModal);
  if (loveModal) {
    loveModal.addEventListener("click", (e) => {
      if (e.target === loveModal) closeLoveModal();
    });
  }

  updateUndoUI();
}

init();




