/* eslint-disable no-undef */
// ─── State ─────────────────────────────────────────────────────────────────────
let residents = [];
let shops = [];
let assignments = {};
let nextId = 1;
const CATS = ['Food', 'Service', 'Recreation', 'Creative', 'Retail'];
const CAT_COLORS = { Food: '#e03030', Service: '#d07800', Recreation: '#148828', Creative: '#8820b0', Retail: '#1060c0' };

// ─── SQL.js + IndexedDB Persistence ───────────────────────────────────────────
const IDB_NAME = 'tiny-tower-idb';
const IDB_STORE = 'sqlite';
const SAVE_DEBOUNCE_MS = 500;
let sqlDb = null;
let saveTimeout = null;

async function initDb() {
  if (!window.initSqlJs) throw new Error('SQL.js not loaded');
  const SQL = await window.initSqlJs({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/sql.js@1.10.2/dist/${f}`
  });
  const saved = await idbGet();
  sqlDb = new SQL.Database(saved ? new Uint8Array(saved) : null);
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS residents (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      skills TEXT NOT NULL,
      fav TEXT
    )
  `);
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      cat TEXT NOT NULL,
      slots INTEGER NOT NULL
    )
  `);
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS assignments (
      shop_id INTEGER NOT NULL,
      resident_id INTEGER NOT NULL,
      PRIMARY KEY (shop_id, resident_id)
    )
  `);
  return loadFromDb();
}

async function idbGet() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.close();
        resolve(null);
        return;
      }
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get('db');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    };
    r.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE);
    };
  });
}

async function idbSet(data) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(data, 'db');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    r.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE);
    };
  });
}

function loadFromDb() {
  if (!sqlDb) return;
  const stmt = sqlDb.prepare('SELECT id, name, skills, fav FROM residents');
  residents = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    residents.push({
      id: row.id,
      name: row.name,
      skills: JSON.parse(row.skills || '{}'),
      fav: row.fav || null
    });
  }
  stmt.free();

  const stmt2 = sqlDb.prepare('SELECT id, name, cat, slots FROM shops');
  shops = [];
  while (stmt2.step()) {
    const row = stmt2.getAsObject();
    shops.push({
      id: row.id,
      name: row.name,
      cat: row.cat,
      slots: row.slots
    });
  }
  stmt2.free();

  const stmt3 = sqlDb.prepare('SELECT shop_id, resident_id FROM assignments');
  assignments = {};
  while (stmt3.step()) {
    const row = stmt3.getAsObject();
    const sid = String(row.shop_id);
    if (!assignments[sid]) assignments[sid] = [];
    assignments[sid].push(row.resident_id);
  }
  stmt3.free();

  const maxId = Math.max(0, ...residents.map(r => r.id), ...shops.map(s => s.id));
  nextId = maxId + 1;
}

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(persistToDb, SAVE_DEBOUNCE_MS);
}

function persistToDb() {
  saveTimeout = null;
  if (!sqlDb) return;
  sqlDb.run('DELETE FROM residents');
  sqlDb.run('DELETE FROM shops');
  sqlDb.run('DELETE FROM assignments');
  const insRes = sqlDb.prepare('INSERT INTO residents (id, name, skills, fav) VALUES (?, ?, ?, ?)');
  residents.forEach(r => {
    insRes.bind([r.id, r.name, JSON.stringify(r.skills), r.fav || null]);
    insRes.step();
    insRes.reset();
  });
  console.log("Saving residents:", residents);
  residents.forEach(r => {
    console.log("skills raw:", r.skills, "stringified:", JSON.stringify(r.skills));
  });
  insRes.free();
  const insShop = sqlDb.prepare('INSERT INTO shops (id, name, cat, slots) VALUES (?, ?, ?, ?)');
  shops.forEach(s => {
    insShop.bind([s.id, s.name, s.cat, s.slots]);
    insShop.step();
    insShop.reset();
  });
  insShop.free();
  const insAssign = sqlDb.prepare('INSERT INTO assignments (shop_id, resident_id) VALUES (?, ?)');
  for (const [shopId, rids] of Object.entries(assignments)) {
    (rids || []).forEach(rid => {
      insAssign.bind([parseInt(shopId, 10), rid]);
      insAssign.step();
      insAssign.reset();
    });
  }
  insAssign.free();
  const data = sqlDb.export();
  idbSet(data).catch(console.error);
}

// ─── Page navigation ───────────────────────────────────────────────────────────
function switchPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  btn.classList.add('active');
}

// ─── Inner tabs (Data Entry) ───────────────────────────────────────────────────
function switchInner(tab) {
  document.getElementById('inner-residents').style.display = tab === 'residents' ? '' : 'none';
  document.getElementById('inner-shops').style.display = tab === 'shops' ? '' : 'none';
  document.querySelectorAll('.inner-tab').forEach((t, i) =>
    t.classList.toggle('active', (i === 0 && tab === 'residents') || (i === 1 && tab === 'shops')));
}

// ─── Update header badges ──────────────────────────────────────────────────────
function updateBadges() {
  document.getElementById('hdr-residents').textContent = residents.length + ' RES';
  document.getElementById('hdr-shops').textContent = shops.length + ' SHOPS';
  const nb = document.getElementById('nav-res-count');
  nb.textContent = residents.length;
  nb.style.display = residents.length ? '' : 'none';
}

// ─── Add Resident ──────────────────────────────────────────────────────────────
function addResident() {
  const name = document.getElementById('r-name').value.trim();
  if (!name) return alert('Please enter a name.');
  if (residents.find(r => r.name.toLowerCase().trim() === name.toLowerCase().trim())) {
    return alert(name + ' already exists. Use the Residents tab to edit them.');
  }
  const skills = {};
  CATS.forEach(c => { skills[c] = parseInt(document.querySelector('#sk-' + c + ' input[type=range]').value, 10); });
  const fav = document.getElementById('r-fav').value.trim() || null;
  residents.push({ id: nextId++, name, skills, fav });
  document.getElementById('r-name').value = '';
  document.getElementById('r-fav').value = '';
  updateBadges();
  renderResidentPage();
  scheduleSave();
}

// ─── Add Shop ──────────────────────────────────────────────────────────────────
function addShop() {
  const name = document.getElementById('s-name').value.trim();
  if (!name) return alert('Please enter a shop name.');
  if (shops.find(s => s.name.toLowerCase().trim() === name.toLowerCase().trim())) {
    return alert(name + ' already exists.');
  }
  const cat = document.getElementById('s-cat').value;
  const slots = parseInt(document.getElementById('s-slots').value, 10);
  shops.push({ id: nextId++, name, cat, slots });
  document.getElementById('s-name').value = '';
  updateFavDropdown();
  renderShopList();
  updateBadges();
  scheduleSave();
}

function deleteResident(id) {
  residents = residents.filter(r => r.id !== id);
  for (const sid in assignments) assignments[sid] = assignments[sid].filter(rid => rid !== id);
  updateBadges();
  renderResidentPage();
  scheduleSave();
}

function deleteShop(id) {
  shops = shops.filter(s => s.id !== id);
  delete assignments[id];
  updateFavDropdown();
  renderShopList();
  updateBadges();
  scheduleSave();
}

// ─── Resident page: expandable cards ──────────────────────────────────────────
function renderResidentPage() {
  const el = document.getElementById('residents-content');
  if (!residents.length) {
    el.innerHTML = `<div class="empty-state">
      <div style="font-size:40px;margin-bottom:10px;">👥</div>
      <h3>NO RESIDENTS</h3>
      <p>Add residents in Data Entry</p>
    </div>`;
    return;
  }

  el.innerHTML = '<div class="edit-hint">✎ Tap a resident to edit</div>' +
    residents.map(r => {
      const best = CATS.reduce((a, b) => r.skills[a] >= r.skills[b] ? a : b);
      const favShop = r.fav ? shops.find(s => s.name.toLowerCase() === r.fav.toLowerCase()) : null;
      const favLabel = r.fav ? (favShop ? favShop.name : r.fav + ' (??)') : null;
      // Make a set of all shop names (lowercase for comparison)
      const shopNames = new Set(shops.map(s => s.name.toLowerCase()));

      // Start with None option
      let shopOpts = `<option value="">— None —</option>`;

      // If the resident has a fav that's not in shops, add it first
      if (r.fav && !shopNames.has(r.fav.toLowerCase())) {
        shopOpts += `<option value="${r.fav}" selected>${r.fav}</option>`;
      }

      // Add all existing shops
      shopOpts += shops
        .map(s => {
          const isSelected = r.fav && s.name.toLowerCase() === r.fav.toLowerCase() ? "selected" : "";
          return `<option value="${s.name}" ${isSelected}>${s.name} (${s.cat})</option>`;
        })
        .join("");

      const skillSliders = CATS.map(cat => `
        <div class="skill-item" id="esk-${cat}-${r.id}">
          <label><span class="skill-dot dot-${cat}"></span>${cat === 'Recreation' ? 'Rec' : cat}</label>
          <div class="skill-input-wrap">
            <input type="range" min="0" max="9" value="${r.skills[cat] ?? 5}"
              oninput="this.nextElementSibling.textContent=this.value">
            <span class="skill-val">${r.skills[cat] ?? 5}</span>
          </div>
        </div>`).join('');

      return `<div class="resident-card" id="rcard-${r.id}">
        <div class="resident-row" onclick="toggleResident(${r.id})">
          <span class="cat-badge cat-${best}">${best[0]}</span>
          <span class="name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-dark);font-size:17px;">${r.name}</span>
          ${favLabel ? `<span class="fav-star" title="Dream: ${favLabel}">${favShop ? '★' : '☆'}</span>` : ''}
          <span class="meta" style="color:var(--muted);font-size:15px;flex-shrink:0;">${best[0]}:${r.skills[best]}</span>
          <span class="resident-chevron">▶</span>
        </div>
        <div class="resident-edit-panel">
          <div class="skill-grid">${skillSliders}</div>
          <div class="form-group">
            <label>Dream Job</label>
            <select id="efav-${r.id}">${shopOpts}</select>
          </div>
          <div class="edit-row">
            <button class="btn btn-green" style="flex:2;" onclick="saveResident(${r.id})">✓ SAVE</button>
            <button class="btn btn-gray" style="flex:1;" onclick="toggleResident(${r.id})">CANCEL</button>
            <button class="btn" style="flex:0;padding:10px 12px;background:var(--red);color:white;border-color:var(--border-dark);" onclick="if(confirm('Delete ${r.name.replace(/'/g, "\\'")}?'))deleteResident(${r.id})">🗑</button>
          </div>
        </div>
      </div>`;
    }).join('');
}

function toggleResident(id) {
  const card = document.getElementById('rcard-' + id);
  card.classList.toggle('expanded');
}

function saveResident(id) {
  const r = residents.find(x => x.id === id);
  if (!r) return;
  CATS.forEach(cat => {
    const slider = document.querySelector('#esk-' + cat + '-' + id + ' input[type=range]');
    if (slider) r.skills[cat] = parseInt(slider.value, 10);
  });
  const favSel = document.getElementById('efav-' + id);
  r.fav = favSel ? (favSel.value || null) : r.fav;
  renderResidentPage();
  scheduleSave();
}

// ─── Shop list ─────────────────────────────────────────────────────────────────
function renderShopList() {
  const el = document.getElementById('shop-list');
  document.getElementById('s-count').textContent = shops.length;
  if (!shops.length) { el.innerHTML = '<div class="empty-slot">No shops yet</div>'; return; }
  el.innerHTML = shops.map(s => `<div class="list-item">
    <span class="cat-badge cat-${s.cat}">${s.cat[0]}</span>
    <span class="name">${s.name}</span>
    <span class="meta">${s.slots} slots</span>
    <button class="del-btn" onclick="deleteShop(${s.id})">X</button>
  </div>`).join('');
}

function updateFavDropdown() {
  document.getElementById('shops-datalist').innerHTML = shops.map(s => `<option value="${s.name}">`).join('');
}

// ─── Optimizer ─────────────────────────────────────────────────────────────────
function runOptimizer() {
  if (!shops.length) return alert('Add at least one shop first.');
  if (!residents.length) return alert('Add at least one resident first.');

  const lockExisting = document.getElementById('lock-existing').checked;
  const newAssignments = {};

  if (lockExisting && Object.keys(assignments).length > 0) {
    for (const [shopId, rids] of Object.entries(assignments)) {
      const shop = shops.find(s => s.id === parseInt(shopId, 10));
      if (!shop) continue;
      newAssignments[shopId] = rids.filter(rid => residents.find(r => r.id === rid)).slice(0, shop.slots);
    }
  }

  shops.forEach(shop => { if (!newAssignments[shop.id]) newAssignments[shop.id] = []; });
  const assigned = new Set(Object.values(newAssignments).flat());

  const shopPriority = shops.map(shop => {
    const avail = residents.filter(r => !assigned.has(r.id));
    return { shop, scarcity: avail.filter(r => r.skills[shop.cat] >= 5).length / shop.slots };
  }).sort((a, b) => a.scarcity - b.scarcity);

  for (const { shop } of shopPriority) {
    const need = shop.slots - newAssignments[shop.id].length;
    if (need <= 0) continue;
    const candidates = residents.filter(r => !assigned.has(r.id));
    candidates.sort((a, b) => {
      const diff = b.skills[shop.cat] - a.skills[shop.cat];
      if (diff !== 0) return diff;
      const aFav = a.fav && a.fav.toLowerCase() === shop.name.toLowerCase() ? 2 : 0;
      const bFav = b.fav && b.fav.toLowerCase() === shop.name.toLowerCase() ? 2 : 0;
      if (bFav !== aFav) return bFav - aFav;
      const aFS = a.fav ? shops.find(s => s.name.toLowerCase() === a.fav.toLowerCase()) : null;
      const bFS = b.fav ? shops.find(s => s.name.toLowerCase() === b.fav.toLowerCase()) : null;
      return (bFS && bFS.cat === shop.cat ? 1 : 0) - (aFS && aFS.cat === shop.cat ? 1 : 0);
    });
    for (let i = 0; i < need && i < candidates.length; i++) {
      newAssignments[shop.id].push(candidates[i].id);
      assigned.add(candidates[i].id);
    }
  }

  assignments = newAssignments;
  renderResults();
  scheduleSave();
}

function renderResults() {
  const el = document.getElementById('results-area');
  let totalSkill = 0;
  let totalSlots = 0;
  let filledSlots = 0;
  shops.forEach(shop => {
    const rids = assignments[shop.id] || [];
    totalSlots += shop.slots;
    filledSlots += rids.length;
    rids.forEach(rid => {
      const r = residents.find(x => x.id === rid);
      if (r) totalSkill += r.skills[shop.cat];
    });
  });
  const pct = filledSlots > 0 ? Math.round((totalSkill / (filledSlots * 9)) * 100) : 0;
  const unplaced = residents.length - filledSlots;

  el.innerHTML = `
    <div class="stats-bar">
      <div class="stat"><span class="val">${totalSkill}</span><span class="lbl">Skill</span></div>
      <div class="stat"><span class="val">${pct}%</span><span class="lbl">Effic.</span></div>
      <div class="stat"><span class="val">${filledSlots}/${totalSlots}</span><span class="lbl">Filled</span></div>
      <div class="stat"><span class="val">${unplaced}</span><span class="lbl">Unplaced</span></div>
    </div>
    ${unplaced > 0 && residents.length > filledSlots ? `<div class="warning">⚠ ${unplaced} resident${unplaced > 1 ? 's' : ''} unplaced — add more slots.</div>` : ''}
    <div class="results-grid">${shops.map(renderShopCard).join('')}</div>`;
}

function renderShopCard(shop) {
  const rids = assignments[shop.id] || [];
  const workers = rids.map(rid => residents.find(r => r.id === rid)).filter(Boolean);
  const totalSk = workers.reduce((s, r) => s + r.skills[shop.cat], 0);
  const color = CAT_COLORS[shop.cat];
  const rows = [];
  for (let i = 0; i < shop.slots; i++) {
    const w = workers[i];
    if (w) {
      const sk = w.skills[shop.cat];
      const isFav = w.fav && w.fav.toLowerCase() === shop.name.toLowerCase();
      const blocks = Array.from({ length: 9 }, (_, j) =>
        `<div class="skill-block ${j < sk ? 'filled' : ''}" style="${j < sk ? 'background:' + color : ''}"></div>`).join('');
      rows.push(`<div class="worker-row">
        <span class="worker-name">${w.name}${isFav ? ' <span class="fav-star-anim">★</span>' : ''}</span>
        <div class="worker-skill">
          <div class="skill-bar-wrap">${blocks}</div>
          <span class="skill-num" style="color:${color}">${sk}</span>
        </div>
      </div>`);
    } else {
      rows.push('<div class="worker-row"><span class="empty-slot">[ EMPTY ]</span></div>');
    }
  }
  return `<div class="shop-card">
    <div class="shop-card-hdr">
      <span class="cat-badge cat-${shop.cat}">${shop.cat}</span>
      <span class="shop-name">${shop.name.toUpperCase()}</span>
      <div class="shop-score"><strong>${totalSk}</strong><span>/${shop.slots * 9}</span></div>
    </div>
    <div class="workers-list">${rows.join('')}</div>
  </div>`;
}

// ─── Image Import ──────────────────────────────────────────────────────────────
let pendingImport = [];

function handleDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleImageFile(file);
}

function handleImageFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => parseResidentsFromImage(ev.target.result.split(',')[1], file.type);
  reader.readAsDataURL(file);
}

function setStatus(msg, type) {
  const el = document.getElementById('parse-status');
  el.className = 'parse-status visible' + (type ? ' ' + type : '');
  document.getElementById('parse-msg').textContent = msg;
  document.getElementById('parse-spinner').style.display = type ? 'none' : 'block';
}

function hideStatus() {
  document.getElementById('parse-status').className = 'parse-status';
}

async function parseResidentsFromImage(base64Data, mediaType) {
  setStatus('Scanning image...');
  document.getElementById('preview-area').style.display = 'none';
  pendingImport = [];

  const prompt = `This is a screenshot from the mobile game Tiny Tower showing a list of residents.
For each resident visible, extract:
1. Their full name
2. Their 5 skill values shown as digits (in order: Food, Service, Recreation, Retail, Creative)
3. Their dream job / favorite shop (shown below their current job, often in a different color)

Return ONLY a JSON array, no other text, no markdown. Format:
[{"name":"PERRY MITCHELL","skills":{"Food":0,"Service":1,"Recreation":9,"Retail":2,"Creative":9},"fav":"MECHANIC"}]

Notes:
- Skills are 5 colored digits to the right of name, order: Food, Service, Recreation, Retail, Creative
- Dream job is shown in a distinct color (often green/orange) below current job
- UNEMPLOYED residents still have a dream job shown
- Return ALL residents visible`;

  try {
    const resp = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base64Data,
        mediaType,
        prompt
      })
    });
    
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    // --- Extract model text safely ---
    let raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // --- Clean out code fences, markdown, leading junk ---
    let clean = raw
      .replace(/```json|```/g, "")
      .replace(/^\s*[\r\n]+/g, "")
      .replace(/^[^{[]+/, ""); // remove any text before JSON starts

    // --- Trim anything AFTER the final closing ] ---
    const lastBracket = clean.lastIndexOf("]");
    if (lastBracket !== -1) {
      clean = clean.slice(0, lastBracket + 1);
    }

    // --- Try strict parse first ---
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (err1) {
      console.warn("Strict JSON parse failed, attempting relaxed parse…", err1);

      // Relaxed cleaning: fix unquoted keys, remove trailing commas
      let relaxed = clean
        .replace(/(\w+)\s*:/g, '"$1":') // add quotes around keys
        .replace(/,(\s*[}\]])/g, "$1"); // remove trailing commas

      try {
        parsed = JSON.parse(relaxed);
      } catch (err2) {
        console.error("Relaxed JSON parse also failed", err2);
        console.error("Raw response was:", raw);
        throw new Error("The model returned invalid JSON. Try scanning again.");
      }
    }
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('No residents found');
    pendingImport = parsed;
    showPreview(parsed);
    setStatus(`Found ${parsed.length} resident${parsed.length > 1 ? 's' : ''} — review below`, 'success');
  } catch (err) {
    console.error(err);
    if (err.message.includes('Gemini rate limit')) {
      setStatus('Error: Gemini rate limit 💀🥀', 'error');
    } else {
      setStatus('Error: ' + err.message, 'error');
    }
  }
}

function showPreview(parsed) {
  const area = document.getElementById('preview-area');
  const list = document.getElementById('preview-list');
  area.style.display = 'block';
  list.innerHTML = parsed.map((r, i) => {
    const s = r.skills;
    const isDup = !!residents.find(ex => ex.name.toLowerCase().trim() === r.name.toLowerCase().trim());
    return `<div class="preview-resident" style="${isDup ? 'background:#fff0c0;border-color:#d07800;' : ''}">
      <span class="pr-name">${r.name}${isDup ? ' <span style="font-size:11px;color:#a05000">[UPDATE]</span>' : ''}</span>
      <span class="pr-skills">F:${s.Food} S:${s.Service} R:${s.Recreation} Re:${s.Retail} C:${s.Creative}</span>
      ${r.fav ? `<span class="pr-fav">♥ ${r.fav}</span>` : ''}
      <button class="del-btn" onclick="removePending(${i})" style="font-size:9px;padding:2px 5px;">X</button>
    </div>`;
  }).join('');
}

function removePending(i) {
  pendingImport.splice(i, 1);
  if (!pendingImport.length) { cancelImport(); return; }
  showPreview(pendingImport);
  setStatus(`${pendingImport.length} resident${pendingImport.length > 1 ? 's' : ''} ready`, 'success');
}

function confirmImport() {
  let added = 0;
  let updated = 0;
  pendingImport.forEach(r => {
    const norm = r.name.toLowerCase().trim();
    const existing = residents.find(ex => ex.name.toLowerCase().trim() === norm);
    if (existing) {
      existing.skills = {
        Food: r.skills.Food ?? existing.skills.Food,
        Service: r.skills.Service ?? existing.skills.Service,
        Recreation: r.skills.Recreation ?? existing.skills.Recreation,
        Retail: r.skills.Retail ?? existing.skills.Retail,
        Creative: r.skills.Creative ?? existing.skills.Creative
      };
      if (r.fav) existing.fav = r.fav;
      updated++;
    } else {
      residents.push({
        id: nextId++,
        name: r.name,
        skills: {
          Food: r.skills.Food ?? 5,
          Service: r.skills.Service ?? 5,
          Recreation: r.skills.Recreation ?? 5,
          Retail: r.skills.Retail ?? 5,
          Creative: r.skills.Creative ?? 5
        },
        fav: r.fav || null
      });
      added++;
    }
  });
  pendingImport = [];
  document.getElementById('preview-area').style.display = 'none';
  const parts = [];
  if (added) parts.push(added + ' added');
  if (updated) parts.push(updated + ' updated');
  if (parts.length) { setStatus(parts.join(', ') + '!', 'success'); setTimeout(hideStatus, 3000); }
  else hideStatus();
  updateBadges();
  renderResidentPage();
  scheduleSave();
}

function cancelImport() {
  pendingImport = [];
  document.getElementById('preview-area').style.display = 'none';
  hideStatus();
}

// ─── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    await initDb();
  } catch (e) {
    console.warn('DB init failed, using in-memory:', e);
    residents = [];
    shops = [];
    assignments = {};
    nextId = 1;
  }
  updateBadges();
  renderResidentPage();
  renderShopList();
  updateFavDropdown();
  if (Object.keys(assignments).length > 0 && shops.length > 0) renderResults();
}

document.addEventListener('DOMContentLoaded', init);
