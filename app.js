// app.js
const $ = (sel) => document.querySelector(sel);

const parkInput = $("#parkInput");
const addBtn = $("#addBtn");

// ✅ 方法A：列表區塊不存在也沒關係（全部都做 null-safe）
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

// ✅ 新增：map + filters（都是最小 UI 元件）
const mapBtn = $("#mapBtn");

const modeSelect = $("#modeSelect");
const districtGroup = $("#districtGroup");
const districtSelect = $("#districtSelect");
const locBtn = $("#locBtn");
const resetNoRepeatBtn = $("#resetNoRepeatBtn");
const filterHint = $("#filterHint");

// ✅ 新增：保留按鍵（按了就「不封印」目前結果）
const preserveBtn = $("#preserveBtn");

// ✅ 每次抽幾個
const BATCH_SIZE = 6;

// ✅ near 強化：只從最近 N 個中挑（再抽 6）
const NEAR_TOP_N = 30;

// === 資料來源 ===
const DATA_URLS = ["./parks.full.json", "./parks.names.json"];
const CUSTOM_KEY = "tripweb_custom_parks_v1";

// ✅ 不重複紀錄
// SHOWN_KEY：舊邏輯「整批封印」已停用（保留不刪，避免舊資料干擾）
const SHOWN_KEY = "tripweb_shown_parks_v1";   // (legacy)
const WIN_KEY   = "tripweb_won_parks_v1";     // 同一批內「結果不重複」
const SEALED_KEY = "tripweb_sealed_parks_v1"; // ✅ 跨批次：只封印「抽中的那個」

// === 目前轉盤顯示的公園（抽樣結果）===
let parks = [];              // 字串陣列：rebuildWheel 用這個
let isSpinning = false;
let rotation = 0;            // 目前角度（deg）
let selectedPark = null;

// === 全部抽樣池（JSON + 自訂）===
let masterPool = [];         // names (string)
let customParks = [];

// ✅ meta：name -> {name, district, lat, lng, address}
let parkMeta = new Map();

// ✅ 定位
let userLoc = null;          // {lat,lng}

// 用來降低「換一批」跟上一批重複率
let lastBatchSet = new Set();

/** 色盤：淡藍灰 / 淡粉灰 / 淡黃 / 淡綠 */
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
function normalizeName(x) {
  return String(x ?? "").trim();
}
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
  } catch {
    return [];
  }
}
function saveCustomParks() {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(customParks));
}

function loadSet(key) {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(normalizeName).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}
function saveSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

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

// ✅ names + meta
function extractParksFromJson(data) {
  if (!Array.isArray(data) || data.length === 0) return [];

  // names.json：["xxx","yyy"]
  if (typeof data[0] === "string") {
    return uniqueStrings(data).map((name) => ({ name }));
  }

  // full.json：[{...}]
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

    // 去重（以 name 為準）
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

/** 洗牌（不改原陣列） */
function shuffledCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 取 count 個不重複
 * - excludeSet: 盡量避開上一批
 * - forceInclude: 必須包含的某個名字（例如你剛新增的）
 */
function pickRandomUnique(all, count, excludeSet = new Set(), forceInclude = "") {
  const force = normalizeName(forceInclude);
  const pool = all.filter(n => !excludeSet.has(n));

  let picked = [];
  if (pool.length >= count) {
    picked = shuffledCopy(pool).slice(0, count);
  } else {
    picked = shuffledCopy(all).slice(0, Math.min(count, all.length));
  }

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

// ✅ Google Maps URL
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
// UI
// =========================
function setUIState() {
  const hasParks = parks.length > 0;

  emptyState.classList.toggle("hidden", hasParks);
  wheelSection.classList.toggle("hidden", !hasParks);

  // ✅ 方法A：列表區塊永遠不顯示
  if (listSection) listSection.classList.add("hidden");
  if (listTitle) listTitle.textContent = "";

  parkInput.disabled = isSpinning;
  addBtn.disabled = isSpinning;
  spinBtn.disabled = isSpinning || !hasParks;

  if (newBatchBtn) newBatchBtn.disabled = isSpinning || masterPool.length === 0;

  // filters 也鎖住
  if (modeSelect) modeSelect.disabled = isSpinning;
  if (districtSelect) districtSelect.disabled = isSpinning;
  if (locBtn) locBtn.disabled = isSpinning;
  if (resetNoRepeatBtn) resetNoRepeatBtn.disabled = isSpinning;

  spinText.textContent = isSpinning ? "轉動中..." : "開始轉動！";

  if (!selectedPark || isSpinning) {
    resultBox.classList.add("hidden");
    setMapBtn(null);
    if (preserveBtn) {
      preserveBtn.disabled = true;
      preserveBtn.classList.add("hidden");
    }
  } else {
    resultBox.classList.remove("hidden");
    resultName.textContent = selectedPark;
    setMapBtn(selectedPark);

    // 只有出結果才顯示保留
    if (preserveBtn) {
      preserveBtn.disabled = false;
      preserveBtn.classList.remove("hidden");
    }
  }
}

// ✅ 方法A：不渲染 chips
function renderChips() {
  if (!chips) return;
  chips.innerHTML = "";
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
  filter.innerHTML = `
    <feDropShadow dx="0" dy="1.2" stdDeviation="0.6" flood-color="rgba(0,0,0,0.35)"/>
  `;
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
// Filter + Pool helpers
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

  const hasAny = list.length > 0;
  districtGroup.hidden = !(modeSelect && modeSelect.value === "district");
  districtSelect.disabled = !hasAny;

  if (!hasAny && modeSelect && modeSelect.value === "district") {
    setFilterHint("你的資料裡沒有行政區欄位（district/行政區/區），所以無法依行政區篩選。");
  }
}

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

function getFilteredPoolNames() {
  const mode = modeSelect ? modeSelect.value : "all";

  if (mode === "district") {
    const d = normalizeName(districtSelect?.value);
    if (!d) return masterPool.slice();
    return masterPool.filter((name) => normalizeName(parkMeta.get(name)?.district) === d);
  }

  if (mode === "near") {
    if (!userLoc) return masterPool.slice();

    const withCoord = masterPool
      .map((name) => {
        const meta = parkMeta.get(name);
        if (!meta || !Number.isFinite(meta.lat) || !Number.isFinite(meta.lng)) return null;
        const km = haversineKm(userLoc.lat, userLoc.lng, meta.lat, meta.lng);
        return { name, km };
      })
      .filter(Boolean)
      .sort((a, b) => a.km - b.km);

    if (withCoord.length === 0) return masterPool.slice();

    // ✅ 強化：只回傳最近 30 個（接著再由 loadNewBatch 抽 6）
    return withCoord.slice(0, NEAR_TOP_N).map(x => x.name);
  }

  return masterPool.slice();
}

function ensureModeUI() {
  if (!modeSelect) return;

  const mode = modeSelect.value;
  districtGroup.hidden = mode !== "district";
  if (locBtn) locBtn.hidden = mode !== "near";

  if (mode === "near") {
    setFilterHint(userLoc ? `已取得定位：將優先從最近 ${NEAR_TOP_N} 個公園挑選。` : "最近模式需要定位：請按「取得定位」。");
  } else {
    setFilterHint("");
  }

  updateDistrictOptions();
}

// =========================
// Batch logic（✅ 不自動重置 + 只封印「抽中的那個」）
// - 先抽未封印的（可抽中）
// - 若不足 6：用已封印的補滿 6（只是填格子，不會抽中）
// - 若真的全部都封印完：0 個可抽（提示手動重置）
// =========================
function loadNewBatch(forceInclude = "") {
  if (masterPool.length === 0) return;

  const sealedSet = loadSet(SEALED_KEY);

  // ✅ 先套用 filters
  const basePool = getFilteredPoolNames();
  const maxCount = Math.min(BATCH_SIZE, basePool.length);

  // ✅ 剩下「未封印」的（真正可抽中的）
  const remaining = basePool.filter(n => !sealedSet.has(n));

  // ✅ 抽完就抽完：不自動重置
  if (remaining.length === 0) {
    parks = [];
    lastBatchSet = new Set();
    selectedPark = null;

    setFilterHint("🎉 這個篩選範圍內都已抽過（封印完）！目前 0 個可抽。請按『重置不重複』或切換模式/行政區。");

    resetWheelInstant();
    wheelSvg.innerHTML = "";
    renderAll();
    return;
  }

  // ✅ 先抽可抽中的（未封印）
  const primaryCount = Math.min(maxCount, remaining.length);
  let primary = pickRandomUnique(remaining, primaryCount, new Set(), forceInclude);

  // ✅ 不足 6：用 basePool 補滿（可能包含已封印的，只是用來維持 6 格）
  let batch = primary.slice();

  if (batch.length < maxCount) {
    const need = maxCount - batch.length;
    const fillerCandidates = basePool.filter(n => !batch.includes(n)); // 可包含 sealed
    const filler = pickRandomUnique(fillerCandidates, need, lastBatchSet, "");
    batch = uniqueStrings(batch.concat(filler));

    // 極少見：basePool 太小導致仍不足，就允許重複補到滿
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

// ✅ 保留：把目前結果從封印移除（也移除同批 won，讓它可以再被抽到）
function preserveSelected() {
  const name = normalizeName(selectedPark);
  if (!name) return;

  const sealedSet = loadSet(SEALED_KEY);
  const wonSet = loadSet(WIN_KEY);

  const wasSealed = sealedSet.delete(name);
  const wasWon = wonSet.delete(name);

  saveSet(SEALED_KEY, sealedSet);
  saveSet(WIN_KEY, wonSet);

  if (wasSealed || wasWon) {
    setFilterHint(`已保留「${name}」：不會進入封印（之後仍可能再抽到）。`);
  } else {
    setFilterHint(`「${name}」目前本來就不在封印中。`);
  }

  renderAll();
}

// ✅ 轉盤：easing + bounce + 不重複「結果」+ 封印抽中的那個（跨批次）
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

  // ✅ 只從「未封印」且「同一批未抽過」的候選中抽
  let candidates = parks.filter((p) => !wonSet.has(p) && !sealedSet0.has(p));

  if (candidates.length === 0) {
    isSpinning = false;
    setFilterHint("這一批已沒有可抽的公園（可能都已封印或是填充格）。請按『換一批』。");
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

    // 防呆：若停到封印格（理論上不會）
    const sealedSet1 = loadSet(SEALED_KEY);
    if (sealedSet1.has(picked)) {
      isSpinning = false;
      setFilterHint("剛剛停到已封印的填充格（防呆）。請再轉一次或按『換一批』。");
      renderAll();
      return;
    }

    // ✅ 同一批結果不重複
    wonSet.add(picked);
    saveSet(WIN_KEY, wonSet);

    // ✅ 跨批次封印：只封印抽中的那個
    sealedSet1.add(picked);
    saveSet(SEALED_KEY, sealedSet1);

    // ✅ bounce
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
        renderAll();
      }, 230);
    }, 150);
  }, 3800);
}

function renderAll() {
  setUIState();
  renderChips();
}

// =========================
// Location（距離最近）
// =========================
function requestLocation() {
  if (!("geolocation" in navigator)) {
    setFilterHint("你的瀏覽器不支援定位，無法使用『距離我最近』模式。");
    return;
  }

  setFilterHint("定位中…");
  locBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      locBtn.disabled = false;
      setFilterHint(`已取得定位：將優先從最近 ${NEAR_TOP_N} 個公園挑選。`);
      if (!isSpinning) loadNewBatch();
    },
    () => {
      locBtn.disabled = false;
      userLoc = null;
      setFilterHint("定位失敗或你拒絕定位權限。你仍可使用隨機/行政區模式。");
    },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 300000 }
  );
}

// =========================
// No-repeat reset
// =========================
function resetNoRepeat() {
  localStorage.removeItem(WIN_KEY);
  localStorage.removeItem(SEALED_KEY);

  // legacy：順手清掉避免舊資料干擾
  localStorage.removeItem(SHOWN_KEY);

  setFilterHint("已重置『封印/不重複』紀錄。");
  if (!isSpinning) loadNewBatch();
}

// =========================
// Init
// =========================
async function init() {
  if (emptyText) emptyText.textContent = "正在載入公園資料…";

  customParks = loadCustomParks();

  // ✅ 先嘗試抓 parks.full.json 的 meta；抓不到就退回 names.json
  let parksObjs = [];
  for (const url of DATA_URLS) {
    try {
      const data = await fetchJson(url);
      parksObjs = extractParksFromJson(data);
      if (parksObjs.length) break;
    } catch {}
  }

  // 建 meta map
  parkMeta = new Map();
  for (const p of parksObjs) {
    if (!p.name) continue;
    parkMeta.set(p.name, p);
  }

  // masterPool：names + custom
  const jsonNames = parksObjs.map(p => p.name);
  masterPool = uniqueStrings([...jsonNames, ...customParks]);

  // custom 也補 meta
  for (const n of customParks) {
    if (!parkMeta.has(n)) parkMeta.set(n, { name: n });
  }

  if (masterPool.length === 0) {
    if (emptyText) emptyText.textContent = "找不到公園資料（請確認 parks.full.json 或 parks.names.json 存在）";
    setUIState();
    return;
  }

  // filters init
  ensureModeUI();

  // ✅ 清 legacy（避免舊版整批封印干擾）
  localStorage.removeItem(SHOWN_KEY);

  // 先來一批
  loadNewBatch();

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

  // ✅ 保留按鍵
  if (preserveBtn) {
    preserveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      preserveSelected();
    });
  }

  // filters events
  if (modeSelect) {
    modeSelect.addEventListener("change", () => {
      ensureModeUI();
      if (!isSpinning) loadNewBatch();
    });
  }
  if (districtSelect) {
    districtSelect.addEventListener("change", () => {
      if (!isSpinning) loadNewBatch();
    });
  }
  if (locBtn) {
    locBtn.addEventListener("click", requestLocation);
  }
  if (resetNoRepeatBtn) {
    resetNoRepeatBtn.addEventListener("click", resetNoRepeat);
  }
}

init();



