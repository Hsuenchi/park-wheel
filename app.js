const $ = (sel) => document.querySelector(sel);

// DOM
const emptyState = $("#emptyState");
const emptyText = $("#emptyText");

const wheelSection = $("#wheelSection");
const wheelRotator = $("#wheelRotator");
const wheelSvg = $("#wheelSvg");

const spinBtn = $("#spinBtn");
const spinText = $("#spinText");
const newBatchBtn = $("#btnNewBatch");

const resultBox = $("#result");
const resultName = $("#resultName");
const mapBtn = $("#mapBtn");

const modeSelect = $("#modeSelect");
const districtGroup = $("#districtGroup");
const districtSelect = $("#districtSelect");
const locBtn = $("#locBtn");
const refreshBtn = $("#refreshBtn");
const filterHint = $("#filterHint");

const preserveBtn = $("#preserveBtn");
const favBtn = $("#favBtn");

// panels
const undoBtn = $("#undoBtn");

const recordBtn = $("#recordBtn");
const recordPanel = $("#recordPanel");
const recordCloseBtn = $("#recordCloseBtn");
const recordClearBtn = $("#recordClearBtn");
const recordList = $("#recordList");
const recordEmpty = $("#recordEmpty");

const favPanelBtn = $("#favPanelBtn");
const favPanel = $("#favPanel");
const favPanelCloseBtn = $("#favPanelCloseBtn");
const favPanelClearBtn = $("#favPanelClearBtn");
const favPanelList = $("#favPanelList");
const favPanelEmpty = $("#favPanelEmpty");

const loveModal = $("#loveModal");
const loveCloseBtn = $("#loveCloseBtn");

// constants
const BATCH_SIZE = 6;
const NEAR_TOP_N = 18;
const DATA_URLS = ["./parks.full.json", "./parks.names.json"];

const WIN_KEY    = "tripweb_won_parks_v1";
const SEALED_KEY = "tripweb_sealed_parks_v1";
const HISTORY_KEY     = "tripweb_history_v1";
const UNDO_STACK_KEY  = "tripweb_undo_stack_v1";
const LOVE_SHOWN_KEY  = "tripweb_love_shown_v1";
const FAV_KEY = "tripweb_fav_parks_v1";

// state
let parks = [];
let isSpinning = false;
let rotation = 0;
let selectedPark = null;

let masterPool = [];
let parkMeta = new Map();
let userLoc = null;

let favorites = [];
let history = [];

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
function normalizeName(x){ return String(x ?? "").trim(); }

function uniqueStrings(arr){
  const out = [];
  const seen = new Set();
  for (const v of arr){
    const s = normalizeName(v);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function setEmptyText(msg){
  if (emptyText) emptyText.textContent = msg;
}
function setFilterHint(msg=""){
  if (filterHint) filterHint.textContent = msg;
}

function loadSet(key){
  try{
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(normalizeName).filter(Boolean) : []);
  }catch{ return new Set(); }
}
function saveSet(key, set){ localStorage.setItem(key, JSON.stringify([...set])); }

function loadArray(key){
  try{
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return uniqueStrings(Array.isArray(arr) ? arr : []);
  }catch{ return []; }
}
function saveArray(key, arr){ localStorage.setItem(key, JSON.stringify(uniqueStrings(arr))); }

async function fetchJson(url){
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed: ${url}`);
  return await res.json();
}

function getFirstString(obj, keys){
  for (const k of keys){
    if (obj && obj[k] != null && String(obj[k]).trim()) return String(obj[k]).trim();
  }
  return "";
}

function toNumberMaybe(v){
  if (v == null) return undefined;
  if (typeof v === "string"){
    const cleaned = v.replace(/,/g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ✅ 你目前的 extractParksFromJson 會呼叫它，但你原檔沒定義會直接噴錯
function looksLikeTWD97XY(x, y){
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  // 台灣 TWD97 TM2 常見範圍大約：
  // X: 100000~400000, Y: 2400000~2900000
  return x > 100000 && x < 400000 && y > 2400000 && y < 2900000;
}

// ✅ 支援官方 parks.full.json（records/result.records/features）+ pm_Latitude/pm_Longitude
function extractParksFromJson(data){
  // 1) normalize array
  let arr = data;

  if (data && !Array.isArray(data) && typeof data === "object"){
    if (Array.isArray(data.records)) arr = data.records;
    else if (data.result && Array.isArray(data.result.records)) arr = data.result.records;
    else if (Array.isArray(data.data)) arr = data.data;
    else if (Array.isArray(data.features)) arr = data.features; // GeoJSON
  }

  if (!Array.isArray(arr) || arr.length === 0) return [];

  // ["公園A","公園B"...]
  if (typeof arr[0] === "string"){
    return uniqueStrings(arr).map((name) => ({ name }));
  }

  // helper：抓數字欄位
  const getNum = (obj, keys) => {
    for (const k of keys){
      const v = obj?.[k];
      const n = toNumberMaybe(v);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };

  // [{...},{...}]
  if (typeof arr[0] === "object" && arr[0]){
    const out = [];

    for (const raw of arr){
      const obj = raw && raw.properties ? raw.properties : raw;

      const name = getFirstString(obj, [
        "name","Name","公園名稱","公園名","parkName","title",
        "pm_ParkName","pm_parkname","ParkName"
      ]);
      if (!name) continue;

      const address = getFirstString(obj, [
        "address","Address","地址","addr","location","位置",
        "pm_Address","pm_address"
      ]);

      let district = getFirstString(obj, [
        "district","District","行政區","區","town","addrDistrict",
        "pm_area","pm_district","pm_District"
      ]);
      if (!district && address){
        const m = String(address).match(/([一-龥]{1,4}區)/);
        if (m) district = m[1];
      }

      // ✅ 先吃 WGS84 經緯度欄位
      let lat = getNum(obj, [
        "pm_Latitude","pm_latitude","pm_lat","Latitude","latitude","lat","緯度","Y","y"
      ]);
      let lng = getNum(obj, [
        "pm_Longitude","pm_longitude","pm_lng","pm_lon","Longitude","longitude","lng","經度","X","x"
      ]);

      // ✅ 再補：如果資料其實是 TWD97 X/Y（常見欄位）
      let x = getNum(obj, ["pm_X","pm_x","X","x","twd97X","TWD97X","座標X"]);
      let y = getNum(obj, ["pm_Y","pm_y","Y","y","twd97Y","TWD97Y","座標Y"]);

      // GeoJSON geometry.coordinates = [lng, lat]
      if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && raw?.geometry?.coordinates && Array.isArray(raw.geometry.coordinates)){
        const glng = toNumberMaybe(raw.geometry.coordinates[0]);
        const glat = toNumberMaybe(raw.geometry.coordinates[1]);
        if (!Number.isFinite(lat) && Number.isFinite(glat)) lat = glat;
        if (!Number.isFinite(lng) && Number.isFinite(glng)) lng = glng;
      }

      // 如果 lat/lng 取不到，但 x/y 像 TWD97：先塞進去避免空值（但 near 仍會因非WGS84而跳過）
      if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && looksLikeTWD97XY(x, y)){
        lat = y;   // Y
        lng = x;   // X
      }

      out.push({
        name: normalizeName(name),
        district: normalizeName(district),
        address: normalizeName(address),
        lat,
        lng,
      });
    }

    // 去重（name）
    const seen = new Set();
    const dedup = [];
    for (const p of out){
      if (!p.name) continue;
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      dedup.push(p);
    }
    return dedup;
  }

  return [];
}

function shuffledCopy(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickRandomUnique(all, count){
  return shuffledCopy(all).slice(0, Math.min(count, all.length));
}

function resetWheelInstant(){
  rotation = 0;
  if (!wheelRotator) return;
  wheelRotator.style.transition = "none";
  wheelRotator.style.transform = "rotate(0deg)";
  wheelRotator.offsetHeight;
  wheelRotator.style.transition = "";
}

function buildMapUrl(name){
  const meta = parkMeta.get(name);
  if (meta && Number.isFinite(meta.lat) && Number.isFinite(meta.lng) && Math.abs(meta.lat) <= 90 && Math.abs(meta.lng) <= 180){
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${meta.lat},${meta.lng}`)}`;
  }
  const query = meta?.address ? `${name} ${meta.address}` : name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
function setMapBtn(name){
  if (!mapBtn) return;
  if (!name){
    mapBtn.href = "#";
    mapBtn.setAttribute("aria-disabled", "true");
    return;
  }
  mapBtn.href = buildMapUrl(name);
  mapBtn.setAttribute("aria-disabled", "false");
}

// =========================
// Undo (snapshot localStorage)
// =========================
const SNAP_KEYS = [ WIN_KEY, SEALED_KEY, HISTORY_KEY, FAV_KEY, LOVE_SHOWN_KEY ];

function loadUndoStack(){
  try{
    const raw = localStorage.getItem(UNDO_STACK_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{ return []; }
}
function saveUndoStack(stack){ localStorage.setItem(UNDO_STACK_KEY, JSON.stringify(stack)); }

function pushUndo(label=""){
  const snap = { t: Date.now(), label, store: {} };
  for (const k of SNAP_KEYS) snap.store[k] = localStorage.getItem(k);
  const stack = loadUndoStack();
  stack.push(snap);
  while (stack.length > 40) stack.shift();
  saveUndoStack(stack);
  updateUndoUI();
}
function updateUndoUI(){
  if (!undoBtn) return;
  const stack = loadUndoStack();
  undoBtn.disabled = isSpinning || stack.length === 0;
}
function undoOnce(){
  const stack = loadUndoStack();
  const snap = stack.pop();
  if (!snap) return;

  for (const k of SNAP_KEYS){
    const v = snap.store[k];
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  }
  saveUndoStack(stack);

  favorites = loadArray(FAV_KEY);
  history = loadArray(HISTORY_KEY);

  selectedPark = null;
  renderAll();
  if (!isSpinning) loadNewBatch();

  setFilterHint("已恢復上一個動作。");
  updateUndoUI();
}

// =========================
// Favorites + History
// =========================
function saveFavorites(){ saveArray(FAV_KEY, favorites); }
function saveHistory(){ saveArray(HISTORY_KEY, history); }
function isFav(name){ return favorites.includes(name); }

function addHistory(name){
  const n = normalizeName(name);
  if (!n) return;
  if (history.includes(n)) return;
  history.unshift(n);
  history = uniqueStrings(history);
  saveHistory();
}

function toggleFavorite(name){
  const n = normalizeName(name);
  if (!n) return;
  pushUndo("toggle_fav");
  if (favorites.includes(n)) favorites = favorites.filter(x => x !== n);
  else favorites.unshift(n);
  favorites = uniqueStrings(favorites);
  saveFavorites();
  renderFavPanel();
  renderRecordPanel();
}

function clearFavorites(){
  if (favorites.length === 0) return;
  pushUndo("fav_clear");
  favorites = [];
  saveFavorites();
  renderFavPanel();
  renderRecordPanel();
}

function openRecordPanel(){
  recordPanel?.classList.remove("hidden");
  recordPanel?.setAttribute("aria-hidden","false");
  renderRecordPanel();
}
function closeRecordPanel(){
  recordPanel?.classList.add("hidden");
  recordPanel?.setAttribute("aria-hidden","true");
}
function openFavPanel(){
  favPanel?.classList.remove("hidden");
  favPanel?.setAttribute("aria-hidden","false");
  renderFavPanel();
}
function closeFavPanel(){
  favPanel?.classList.add("hidden");
  favPanel?.setAttribute("aria-hidden","true");
}

function renderRecordPanel(){
  if (!recordList || !recordEmpty) return;
  recordList.innerHTML = "";
  recordEmpty.classList.toggle("hidden", history.length > 0);

  for (const name of history){
    const li = document.createElement("li");
    li.className = "panelItem";

    const nm = document.createElement("div");
    nm.className = "itemName";
    nm.textContent = name;

    const acts = document.createElement("div");
    acts.className = "itemActions";

    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "itemHeart" + (isFav(name) ? " isOn" : "");
    fav.textContent = "♥";
    fav.dataset.favToggle = name;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "itemBtn";
    del.textContent = "刪除";
    del.dataset.recDelete = name;

    acts.appendChild(fav);
    acts.appendChild(del);

    li.appendChild(nm);
    li.appendChild(acts);
    recordList.appendChild(li);
  }
}

function renderFavPanel(){
  if (!favPanelList || !favPanelEmpty) return;
  favPanelList.innerHTML = "";
  favPanelEmpty.classList.toggle("hidden", favorites.length > 0);

  for (const name of favorites){
    const li = document.createElement("li");
    li.className = "panelItem";

    const nm = document.createElement("div");
    nm.className = "itemName";
    nm.textContent = name;

    const acts = document.createElement("div");
    acts.className = "itemActions";

    const open = document.createElement("a");
    open.className = "itemMap";
    open.href = buildMapUrl(name);
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "地圖";

    const rm = document.createElement("button");
    rm.className = "itemBtn";
    rm.type = "button";
    rm.textContent = "移除";
    rm.dataset.favRemove = name;

    acts.appendChild(open);
    acts.appendChild(rm);

    li.appendChild(nm);
    li.appendChild(acts);
    favPanelList.appendChild(li);
  }
}

function deleteRecordAndUnseal(name){
  const n = normalizeName(name);
  if (!n) return;

  pushUndo("record_delete_unseal");

  history = history.filter(x => x !== n);
  saveHistory();

  const sealed = loadSet(SEALED_KEY);
  const won = loadSet(WIN_KEY);
  sealed.delete(n);
  won.delete(n);
  saveSet(SEALED_KEY, sealed);
  saveSet(WIN_KEY, won);

  setFilterHint(`已刪除紀錄：${n}（已重新可被抽到）`);
  renderRecordPanel();
  if (!isSpinning) loadNewBatch();
}

// ✅ 一鍵刪除（舊重置不重複）
function clearAllRecordsAndResetNoRepeat(){
  pushUndo("record_clear_all");

  history = [];
  saveHistory();

  localStorage.removeItem(WIN_KEY);
  localStorage.removeItem(SEALED_KEY);
  localStorage.removeItem(LOVE_SHOWN_KEY);

  setFilterHint("已一鍵刪除。");
  renderRecordPanel();
  if (!isSpinning) loadNewBatch();
}

// =========================
// Mode UI
// =========================
function updateDistrictOptions(){
  if (!districtSelect) return;

  const districts = new Set();
  for (const name of masterPool){
    const meta = parkMeta.get(name);
    const d = normalizeName(meta?.district);
    if (d) districts.add(d);
  }
  const list = [...districts].sort((a,b)=>a.localeCompare(b,"zh-Hant"));
  districtSelect.innerHTML = "";
  for (const d of list){
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    districtSelect.appendChild(opt);
  }
}

/**
 * ✅ 改成「你那個能成功抓定位版本」的鎖定/提示邏輯：
 * - loc 只有 near 模式顯示；定位成功後變暗不可按
 * - near 模式提示：未定位 →「請按取得定位，再按重新整理」
 * - near 模式且 parks 空時，emptyText 也同步提示
 */
function updateControlLocksByMode(){
  const mode = modeSelect ? modeSelect.value : "all";
  const hasDistrictData = districtSelect && districtSelect.options && districtSelect.options.length > 0;

  if (districtGroup) districtGroup.hidden = mode !== "district";
  if (districtSelect) districtSelect.disabled = !(mode === "district" && hasDistrictData && !isSpinning);

  if (locBtn){
    locBtn.hidden = mode !== "near";
    locBtn.disabled = !(mode === "near" && !userLoc && !isSpinning);
  }

  if (refreshBtn) refreshBtn.disabled = isSpinning;
  if (modeSelect) modeSelect.disabled = isSpinning;

  if (mode === "near"){
    setFilterHint(
      userLoc
        ? `已定位：從最近 ${NEAR_TOP_N} 個公園中隨機抽 ${BATCH_SIZE} 個。`
        : "最近模式需要定位：請按「取得定位」，再按「重新整理」。"
    );
    if (emptyText && parks.length === 0){
      emptyText.textContent = userLoc
        ? "請按「重新整理」刷新最近公園…"
        : "最近模式需要定位：請按「取得定位」。";
    }
  } else {
    // 非 near 不強制蓋掉提示（你原本會清空，這裡維持偏接近舊版：不額外清空）
  }

  updateUndoUI();
}

function setUIState(){
  const hasParks = parks.length > 0;
  emptyState?.classList.toggle("hidden", hasParks);
  wheelSection?.classList.toggle("hidden", !hasParks);

  if (spinBtn) spinBtn.disabled = isSpinning || !hasParks;
  if (newBatchBtn) newBatchBtn.disabled = isSpinning || masterPool.length === 0;

  if (spinText) spinText.textContent = isSpinning ? "轉動中..." : "開始轉動！";
  updateControlLocksByMode();

  if (!selectedPark || isSpinning){
    resultBox?.classList.add("hidden");
    setMapBtn(null);
    preserveBtn?.classList.add("hidden");
    favBtn?.classList.add("hidden");
  } else {
    resultBox?.classList.remove("hidden");
    if (resultName) resultName.textContent = selectedPark;
    setMapBtn(selectedPark);
    preserveBtn?.classList.remove("hidden");
    favBtn?.classList.remove("hidden");
  }
}

function renderAll(){
  setUIState();
  // panels 是打開時才 render，避免每次都重排
}

// =========================
// SVG wheel
// =========================
function polarToXY(cx, cy, r, angleDeg){
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx, cy, r, startAngle, endAngle){
  const start = polarToXY(cx, cy, r, startAngle);
  const end = polarToXY(cx, cy, r, endAngle);
  const largeArcFlag = (endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}
function rebuildWheel(){
  if (!wheelSvg) return;
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

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", arcPath(cx, cy, r, startAngle, endAngle));
    path.setAttribute("fill", `url(#gradient-${i})`);
    path.setAttribute("stroke", "white");
    path.setAttribute("stroke-width", "3");
    wheelSvg.appendChild(path);

    const midAngle = startAngle + segmentAngle / 2;
    const textR = 150;
    const p = polarToXY(cx, cy, textR, midAngle);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(Math.round(p.x)));
    text.setAttribute("y", String(Math.round(p.y)));
    text.setAttribute("fill", "white");
    text.setAttribute("font-family", `"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui`);
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
    text.setAttribute("transform", `rotate(${midAngle + 90}, ${Math.round(p.x)}, ${Math.round(p.y)})`);

    const MAX = 12;
    text.textContent = (name.length > MAX) ? (name.slice(0, MAX) + "…") : name;
    wheelSvg.appendChild(text);
  });
}

// =========================
// Distance (最近18 → 隨機6)
// =========================
function haversineKm(lat1, lng1, lat2, lng2){
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function getNearestTopNames(limit){
  if (!userLoc) return [];

  const withCoord = masterPool
    .map((name) => {
      const meta = parkMeta.get(name);
      if (!meta || !Number.isFinite(meta.lat) || !Number.isFinite(meta.lng)) return null;
      if (Math.abs(meta.lat) > 90 || Math.abs(meta.lng) > 180) return null; // 不是 WGS84 就跳過
      const km = haversineKm(userLoc.lat, userLoc.lng, meta.lat, meta.lng);
      return { name, km };
    })
    .filter(Boolean)
    .sort((a,b)=>a.km-b.km);

  if (withCoord.length === 0) return [];
  return withCoord.slice(0, limit).map(x => x.name);
}

function getFilteredPoolNamesNonNear(){
  const mode = modeSelect ? modeSelect.value : "all";
  if (mode === "district"){
    const d = normalizeName(districtSelect?.value);
    if (!d) return masterPool.slice();
    return masterPool.filter((name) => normalizeName(parkMeta.get(name)?.district) === d);
  }
  return masterPool.slice();
}

// =========================
// Batch
// =========================
function loadNewBatch(){
  if (masterPool.length === 0) return;

  const mode = modeSelect ? modeSelect.value : "all";
  const sealedSet = loadSet(SEALED_KEY);

  if (mode === "near"){
    if (!userLoc){
      parks = [];
      selectedPark = null;
      resetWheelInstant();
      if (wheelSvg) wheelSvg.innerHTML = "";
      setFilterHint("最近模式需要定位：請按「取得定位」，再按「重新整理」。");
      setEmptyText("最近模式需要定位：請按「取得定位」。");
      renderAll();
      return;
    }

    const basePool = getNearestTopNames(NEAR_TOP_N);
    if (basePool.length === 0){
      parks = [];
      selectedPark = null;
      resetWheelInstant();
      if (wheelSvg) wheelSvg.innerHTML = "";
      setFilterHint("找不到可用座標（無法計算最近）。");
      setEmptyText("找不到可用座標（無法計算最近）。");
      renderAll();
      return;
    }

    const remainingNear = basePool.filter(n => !sealedSet.has(n));
    if (remainingNear.length === 0){
      parks = [];
      selectedPark = null;
      resetWheelInstant();
      if (wheelSvg) wheelSvg.innerHTML = "";
      setFilterHint("沒有再更近了...");
      setEmptyText("沒有再更近了...");
      renderAll();
      return;
    }

    const maxCount = Math.min(BATCH_SIZE, basePool.length);
    const primaryCount = Math.min(maxCount, remainingNear.length);
    const primary = pickRandomUnique(remainingNear, primaryCount);

    let batch = primary.slice();
    if (batch.length < maxCount){
      const need = maxCount - batch.length;
      const fillerCandidates = basePool.filter(n => !batch.includes(n));
      const filler = pickRandomUnique(fillerCandidates, need);
      batch = uniqueStrings(batch.concat(filler));
      while (batch.length < maxCount && basePool.length > 0){
        batch.push(basePool[Math.floor(Math.random() * basePool.length)]);
      }
      batch = batch.slice(0, maxCount);
    }

    parks = batch;
    selectedPark = null;

    resetWheelInstant();
    rebuildWheel();
    setFilterHint(`已定位：從最近 ${NEAR_TOP_N} 個公園中隨機抽 ${parks.length} 個。`);
    renderAll();
    return;
  }

  // non-near
  const basePool = getFilteredPoolNamesNonNear();
  const remaining = basePool.filter(n => !sealedSet.has(n));

  if (remaining.length === 0){
    parks = [];
    selectedPark = null;
    resetWheelInstant();
    if (wheelSvg) wheelSvg.innerHTML = "";
    setEmptyText("這個範圍都抽過了（可到『記錄』→『一鍵刪除』重置）");
    renderAll();
    return;
  }

  parks = pickRandomUnique(remaining, Math.min(BATCH_SIZE, remaining.length));
  selectedPark = null;

  resetWheelInstant();
  rebuildWheel();
  renderAll();
}

// =========================
// Spin
// =========================
function spin(){
  if (isSpinning || parks.length === 0 || !wheelRotator) return;

  isSpinning = true;
  selectedPark = null;
  setUIState();

  const n = parks.length;
  const slice = 360 / n;

  const wonSet = loadSet(WIN_KEY);
  const sealedSet0 = loadSet(SEALED_KEY);

  let candidates = parks.filter(p => !wonSet.has(p) && !sealedSet0.has(p));
  if (candidates.length === 0){
    isSpinning = false;
    setFilterHint("轉過這個了! 請再轉一次或換一批!");
    renderAll();
    return;
  }

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

    const sealedSet1 = loadSet(SEALED_KEY);
    if (sealedSet1.has(picked)){
      isSpinning = false;
      setFilterHint("轉過這個了! 請再轉一次或換一批!");
      renderAll();
      return;
    }

    pushUndo("spin_pick");

    wonSet.add(picked);
    saveSet(WIN_KEY, wonSet);

    sealedSet1.add(picked);
    saveSet(SEALED_KEY, sealedSet1);

    addHistory(picked);

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

        // 彩蛋：全抽完
        const already = localStorage.getItem(LOVE_SHOWN_KEY) === "1";
        if (!already && loadSet(SEALED_KEY).size >= masterPool.length){
          localStorage.setItem(LOVE_SHOWN_KEY, "1");
          loveModal?.classList.remove("hidden");
          loveModal?.setAttribute("aria-hidden","false");
        }

        renderAll();
      }, 230);
    }, 150);
  }, 3800);
}

// =========================
// Actions
// =========================
function preserveSelected(){
  const name = normalizeName(selectedPark);
  if (!name) return;

  pushUndo("preserve");

  const sealedSet = loadSet(SEALED_KEY);
  const wonSet = loadSet(WIN_KEY);

  sealedSet.delete(name);
  wonSet.delete(name);
  saveSet(SEALED_KEY, sealedSet);
  saveSet(WIN_KEY, wonSet);

  // 保留：不留紀錄
  history = history.filter(x => x !== name);
  saveHistory();

  setFilterHint("已保留");
  renderAll();
}

/**
 * ✅ 改成「你那個能成功抓定位版本」的 requestLocation：
 * - 定位成功：如果此刻就在 near → 直接 loadNewBatch()
 * - 不在 near：只提示「切到距離我最近後按重新整理」
 */
function requestLocation(){
  if (!("geolocation" in navigator)){
    setFilterHint("你的瀏覽器不支援定位，無法使用『距離我最近』模式。");
    return;
  }

  setFilterHint("定位中…");
  if (locBtn) locBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateControlLocksByMode();

      // ✅ 如果此刻就在 near，定位成功後立刻刷新一批（不用切模式）
      if (!isSpinning && modeSelect?.value === "near"){
        loadNewBatch();
      } else {
        setFilterHint("已取得定位：切到『距離我最近』後按「重新整理」。");
      }
    },
    () => {
      userLoc = null;
      if (locBtn) locBtn.disabled = false;
      setFilterHint("定位失敗或你拒絕定位權限。你仍可使用隨機/行政區模式。");
      updateControlLocksByMode();
    },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 300000 }
  );
}

/**
 * ✅ 改成「你那個能成功抓定位版本」的 refreshNow：
 * - near 且未定位：只提示並 return（不刷新）
 * - 其他：loadNewBatch + 提示已重新整理
 */
function refreshNow(){
  if (isSpinning) return;

  const mode = modeSelect?.value ?? "all";

  if (mode === "near" && !userLoc){
    setFilterHint("最近模式需要定位：請先按「取得定位」。");
    if (emptyText) emptyText.textContent = "最近模式需要定位：請按「取得定位」。";
    return;
  }

  loadNewBatch();
  setFilterHint("已重新整理。");
}

// =========================
// Init
// =========================
async function init(){
  setEmptyText("正在載入公園資料…");

  favorites = loadArray(FAV_KEY);
  history = loadArray(HISTORY_KEY);

  let parksObjs = [];
  for (const url of DATA_URLS){
    try{
      const data = await fetchJson(url);
      parksObjs = extractParksFromJson(data);
      if (parksObjs.length) break;
    }catch{}
  }

  parkMeta = new Map();
  for (const p of parksObjs){
    if (!p.name) continue;
    parkMeta.set(p.name, p);
  }

  masterPool = uniqueStrings(parksObjs.map(p => p.name));

  if (masterPool.length === 0){
    setEmptyText("找不到公園資料（請確認 parks.full.json 或 parks.names.json 存在）");
    setUIState();
    return;
  }

  updateDistrictOptions();
  updateControlLocksByMode();
  loadNewBatch();
  renderAll();

  spinBtn?.addEventListener("click", spin);
  newBatchBtn?.addEventListener("click", () => { if (!isSpinning) loadNewBatch(); });

  preserveBtn?.addEventListener("click", (e) => { e.preventDefault(); preserveSelected(); });
  favBtn?.addEventListener("click", (e) => { e.preventDefault(); if (selectedPark) toggleFavorite(selectedPark); });

  modeSelect?.addEventListener("change", () => {
    updateControlLocksByMode();
    if (!isSpinning) loadNewBatch();
  });
  districtSelect?.addEventListener("change", () => { if (!isSpinning) loadNewBatch(); });

  locBtn?.addEventListener("click", requestLocation);
  refreshBtn?.addEventListener("click", refreshNow);

  // record panel events
  recordBtn?.addEventListener("click", openRecordPanel);
  recordCloseBtn?.addEventListener("click", closeRecordPanel);
  recordPanel?.addEventListener("click", (e) => { if (e.target === recordPanel) closeRecordPanel(); });

  recordClearBtn?.addEventListener("click", clearAllRecordsAndResetNoRepeat);

  recordList?.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const favName = t.dataset.favToggle;
    if (favName){ toggleFavorite(favName); return; }
    const delName = t.dataset.recDelete;
    if (delName){ deleteRecordAndUnseal(delName); return; }
  });

  // fav panel events
  favPanelBtn?.addEventListener("click", openFavPanel);
  favPanelCloseBtn?.addEventListener("click", closeFavPanel);
  favPanel?.addEventListener("click", (e) => { if (e.target === favPanel) closeFavPanel(); });

  favPanelClearBtn?.addEventListener("click", clearFavorites);

  favPanelList?.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rm = t.dataset.favRemove;
    if (rm){
      pushUndo("fav_remove");
      favorites = favorites.filter(x => x !== rm);
      saveFavorites();
      renderFavPanel();
      renderRecordPanel();
    }
  });

  undoBtn?.addEventListener("click", undoOnce);
  updateUndoUI();

  // love modal close
  loveCloseBtn?.addEventListener("click", () => {
    loveModal?.classList.add("hidden");
    loveModal?.setAttribute("aria-hidden","true");
  });
  loveModal?.addEventListener("click", (e) => {
    if (e.target === loveModal){
      loveModal.classList.add("hidden");
      loveModal.setAttribute("aria-hidden","true");
    }
  });
}

init();
