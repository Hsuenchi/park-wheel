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

// ✅ 支援官方 parks.full.json（records/result.records/features/純陣列）
// ✅ 支援欄位：pm_name / pm_location / pm_Latitude / pm_Longitude
function extractParksFromJson(data){
  let arr = data;

  if (data && !Array.isArray(data) && typeof data === "object"){
    if (Array.isArray(data.records)) arr = data.records;
    else if (data.result && Array.isArray(data.result.records)) arr = data.result.records;
    else if (Array.isArray(data.data)) arr = data.data;
    else if (Array.isArray(data.features)) arr = data.features; // GeoJSON
  }

  if (!Array.isArray(arr) || arr.length === 0) return [];

  if (typeof arr[0] === "string"){
    return uniqueStrings(arr).map((name) => ({ name }));
  }

  const getNum = (obj, keys) => {
    for (const k of keys){
      const v = obj?.[k];
      const n = toNumberMaybe(v);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };

  if (typeof arr[0] === "object" && arr[0]){
    const out = [];

    for (const raw of arr){
      const obj = raw && raw.properties ? raw.properties : raw;

      const name = getFirstString(obj, [
        "name","Name","公園名稱","公園名","parkName","title",
        "pm_name","pm_Name",
        "pm_ParkName","pm_parkname","ParkName"
      ]);
      if (!name) continue;

      const address = getFirstString(obj, [
        "address","Address","地址","addr","location","位置",
        "pm_location","pm_Location",
        "pm_Address","pm_address"
      ]);

      let district = getFirstString(obj, [
        "district","District","行政區","區","town","addrDistrict",
        "pm_area","pm_district","pm_District"
      ]);
      if (!district && address){
        const m = String(address).match(/([一-龥]{1,3}區)/);
        if (m) district = m[1];
      }

      let lat = getNum(obj, [
        "pm_Latitude","pm_latitude","pm_lat","Latitude","latitude","lat","緯度"
      ]);
      let lng = getNum(obj, [
        "pm_Longitude","pm_longitude","pm_lng","pm_lon","Longitude","longitude","lng","經度"
      ]);

      if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && raw?.geometry?.coordinates && Array.isArray(raw.geometry.coordinates)){
        const glng = toNumberMaybe(raw.geometry.coordinates[0]);
        const glat = toNumberMaybe(raw.geometry.coordinates[1]);
        if (!Number.isFinite(lat) && Number.isFinite(glat)) lat = glat;
        if (!Number.isFinite(lng) && Number.isFinite(glng)) lng = glng;
      }

      out.push({
        name: normalizeName(name),
        district: normalizeName(district),
        address: normalizeName(address),
        lat,
        lng,
      });
    }

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
// SFX（demo_06 copy：每格「噠」＋停下「登愣」）
// =========================
const PRESET = {
  name: "樣本06｜厚木頭（更厚、更低）",
  tick: {
    type: "noise+click",
    clickWave: "triangle",
    clickFreq: 1450,
    noiseHp: 420,
    noiseBp: 1850,
    noiseQ: 5.6,
    lp: 6100,
    vol: 0.16,
    decay: 0.05
  },
  ding: {
    f1: 560,
    f2: 840,
    vol: 0.22,
    lp: 3000,
    delay: 0.075,
    fb: 0.16,
    attack: 0.012,
    tail: 0.9
  }
};

let audioCtx = null;
let sfxUnlocked = false;

function ensureAudio(){
  if(!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  return audioCtx;
}

async function unlockAudio(){
  try{
    const ctx = ensureAudio();
    if(ctx.state === "suspended") await ctx.resume();
    sfxUnlocked = true;
  }catch(e){}
}

// 取得 wheelRotator 即時角度（transition 中也抓得到）
function getRotationDeg(el){
  const tr = getComputedStyle(el).transform;
  if (!tr || tr === "none") return 0;
  if (tr.startsWith("matrix(")) {
    const v = tr.slice(7,-1).split(",").map(Number);
    const a=v[0], b=v[1];
    let deg = Math.atan2(b,a)*180/Math.PI;
    if(deg<0) deg += 360;
    return deg;
  }
  if (tr.startsWith("matrix3d(")) {
    const v = tr.slice(9,-1).split(",").map(Number);
    const a=v[0], b=v[1];
    let deg = Math.atan2(b,a)*180/Math.PI;
    if(deg<0) deg += 360;
    return deg;
  }
  return 0;
}

function playTick(){
  if(!sfxUnlocked) return;
  const ctx = ensureAudio();
  const t = ctx.currentTime;
  const p = PRESET.tick;

  const out = ctx.createGain();
  const v = p.vol * (0.88 + Math.random()*0.24);
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(v, t + 0.003);
  out.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.012, p.decay || 0.030));
  out.connect(ctx.destination);

  let nodeIn = out;

  if (p.lp && p.lp > 0){
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = p.lp;
    lp.Q.value = 0.7;
    lp.connect(out);
    nodeIn = lp;
  }

  if (String(p.type).includes("noise")){
    const dur = 0.018;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<data.length;i++){
      data[i] = (Math.random()*2-1) * (1 - i/data.length);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    let nOut = null;

    if (p.noiseHp && p.noiseHp>0){
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = p.noiseHp;
      hp.Q.value = 0.75;
      noise.connect(hp);
      nOut = hp;
    } else {
      nOut = noise;
    }

    if (p.noiseBp && p.noiseBp>0){
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = p.noiseBp + Math.random()*380;
      bp.Q.value = p.noiseQ || 7.0;
      nOut.connect(bp);
      nOut = bp;
    }

    nOut.connect(nodeIn);
    noise.start(t);
    noise.stop(t + 0.05);
  }

  if (String(p.type).includes("click")){
    const o = ctx.createOscillator();
    o.type = p.clickWave || "square";
    const cf = (p.clickFreq || 1900) * (0.95 + Math.random()*0.10);
    o.frequency.setValueAtTime(cf, t);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.0016);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.010);

    o.connect(g);
    g.connect(nodeIn);

    o.start(t);
    o.stop(t + 0.02);
  }
}

function playDengLeng(){
  if(!sfxUnlocked) return;
  const ctx = ensureAudio();
  const t0 = ctx.currentTime;
  const p = PRESET.ding;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = p.lp || 4200;
  lp.Q.value = 0.6;

  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(p.vol || 0.20, t0 + (p.attack || 0.01));
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + (p.tail || 0.80));

  const delay = ctx.createDelay(0.2);
  delay.delayTime.value = p.delay || 0.065;

  const fb = ctx.createGain();
  fb.gain.value = p.fb || 0.14;

  lp.connect(out);
  out.connect(ctx.destination);

  lp.connect(delay);
  delay.connect(fb);
  fb.connect(delay);
  delay.connect(out);

  function tone(at, freq, dur, peak){
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, at);

    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.setValueAtTime(freq*2, at);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, at);
    g2.gain.exponentialRampToValueAtTime(peak*0.18, at + 0.008);
    g2.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(dur, 0.22));

    o.connect(g); g.connect(lp);
    o2.connect(g2); g2.connect(lp);

    o.start(at);  o.stop(at + dur + 0.03);
    o2.start(at); o2.stop(at + Math.min(dur,0.25) + 0.03);
  }

  tone(t0,        p.f1 || 660, 0.12, 0.22);
  tone(t0 + 0.10, p.f2 || 990, 0.22, 0.28);
}

// ✅ 每跨過一格就噠：用 rAF 追 CSS transition 的即時角度
function startSegmentTicks(durationMs, sliceDeg){
  if (!wheelRotator) return () => {};

  let prevAngle = getRotationDeg(wheelRotator);
  let unwrapped = 0;
  let prevBucket = 0;
  const startTime = performance.now();
  let rafId = 0;

  const step = () => {
    if (!isSpinning) return;

    const now = performance.now();
    const angle = getRotationDeg(wheelRotator);

    let delta = angle - prevAngle;
    if (delta < -180) delta += 360;
    if (delta > 180) delta -= 360;

    unwrapped += delta;

    const bucket = Math.floor(unwrapped / sliceDeg);
    const diff = bucket - prevBucket;
    if (diff > 0){
      for(let i=0;i<diff;i++) playTick();
      prevBucket = bucket;
    }

    prevAngle = angle;

    if (now - startTime <= durationMs + 140){
      rafId = requestAnimationFrame(step);
    }
  };

  rafId = requestAnimationFrame(step);
  return () => { if (rafId) cancelAnimationFrame(rafId); };
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

  updateUndoUI();

  if (mode === "near"){
    setFilterHint(
      userLoc
        ? `已定位：從最近 ${NEAR_TOP_N} 個公園中隨機抽 ${BATCH_SIZE} 個。`
        : "最近模式需要定位：請按「取得定位」，再按「重新整理」。"
    );
  } else {
    setFilterHint("");
  }
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
      if (Math.abs(meta.lat) > 90 || Math.abs(meta.lng) > 180) return null;
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
      setEmptyText("最近模式需要定位：請按「取得定位」，再按「重新整理」。");
      setFilterHint("最近模式需要定位：請按「取得定位」，再按「重新整理」。");
      renderAll();
      return;
    }

    const basePool = getNearestTopNames(NEAR_TOP_N);
    if (basePool.length === 0){
      parks = [];
      selectedPark = null;
      resetWheelInstant();
      if (wheelSvg) wheelSvg.innerHTML = "";
      setEmptyText("找不到可用座標（無法計算最近）。");
      setFilterHint("找不到可用座標（無法計算最近）。");
      renderAll();
      return;
    }

    const remainingNear = basePool.filter(n => !sealedSet.has(n));
    if (remainingNear.length === 0){
      parks = [];
      selectedPark = null;
      resetWheelInstant();
      if (wheelSvg) wheelSvg.innerHTML = "";
      setEmptyText("沒有再更近了...");
      setFilterHint("沒有再更近了...");
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
    setEmptyText("");
    setFilterHint(`已定位：從最近 ${NEAR_TOP_N} 個公園中隨機抽 ${parks.length} 個。`);
    renderAll();
    return;
  }

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
  setEmptyText("");
  renderAll();
}

// =========================
// Spin (✅ 每格噠 + 停下登愣)
// =========================
function spin(){
  if (isSpinning || parks.length === 0 || !wheelRotator) return;

  // ✅ iOS：必須在使用者點擊事件內解鎖
  unlockAudio();

  isSpinning = true;
  selectedPark = null;
  setUIState();

  const n = parks.length;
  const slice = 360 / n;
  const SPIN_MS = 3800;

  let stopTicks = startSegmentTicks(SPIN_MS, slice);

  const wonSet = loadSet(WIN_KEY);
  const sealedSet0 = loadSet(SEALED_KEY);

  let candidates = parks.filter(p => !wonSet.has(p) && !sealedSet0.has(p));
  if (candidates.length === 0){
    stopTicks?.();
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
      stopTicks?.();
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

        stopTicks?.();
        playDengLeng();

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

  history = history.filter(x => x !== name);
  saveHistory();

  setFilterHint("已保留");
  renderAll();
}

// ✅✅✅ 定位邏輯：只在 near 模式才自動刷新
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

function refreshNow(){
  if (isSpinning) return;

  const mode = modeSelect?.value ?? "all";

  if (mode === "near" && !userLoc){
    setFilterHint("最近模式需要定位：請先按「取得定位」。");
    setEmptyText("最近模式需要定位：請先按「取得定位」。");
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

  // ✅ 同時讀 full + names（用 name 合併，把 district/address 補齊）
  const merged = new Map(); // name -> meta
  for (const url of DATA_URLS){
    try{
      const data = await fetchJson(url);
      const list = extractParksFromJson(data);

      for (const p of list){
        if (!p?.name) continue;
        const prev = merged.get(p.name) || { name: p.name };
        merged.set(p.name, {
          name: p.name,
          district: prev.district || p.district || "",
          address: prev.address || p.address || "",
          lat: (prev.lat ?? p.lat),
          lng: (prev.lng ?? p.lng),
        });
      }
    }catch{}
  }

  const parksObjs = [...merged.values()];

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

  // ✅ 額外：第一次觸碰畫面也解鎖音訊（iOS 更穩）
  document.addEventListener("touchstart", unlockAudio, { passive: true, once: true });
  document.addEventListener("mousedown", unlockAudio, { passive: true, once: true });

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
