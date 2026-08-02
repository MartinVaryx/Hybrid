/* =========================================================================================
 * HYBRID — Sandbox map editor
 * ========================================================================================= */

let sandboxSelectedFortId = null;
let sandboxNextFortId = 1;
let sandboxEditEnabled = true;
let sandboxWired = false;

/* ============================= UNDO / REDO SYSTEM ============================= */

let sandboxUndoStack = [];
let sandboxRedoStack = [];
const SANDBOX_MAX_HISTORY = 50;

function sandboxGetStateSnapshot() {
  return {
    nest: { x: S.nest.x, y: S.nest.y },
    forts: S.forts.map(f => ({ ...f })),
    selectedFortId: sandboxSelectedFortId,
    nextFortId: sandboxNextFortId
  };
}

function sandboxApplyStateSnapshot(snapshot) {
  S.nest = { x: snapshot.nest.x, y: snapshot.nest.y };
  S.forts = snapshot.forts.map(f => ({ ...f }));
  sandboxSelectedFortId = snapshot.selectedFortId;
  sandboxNextFortId = snapshot.nextFortId;
  renderMap();
  sandboxSelectFort(sandboxSelectedFortId);
  if (typeof recordSandboxSnapshot === 'function') {
    recordSandboxSnapshot();
  }
}

function recordSandboxHistory() {
  if (!sandboxEditEnabled) return;
  const snap = sandboxGetStateSnapshot();
  
  // Prevent duplicate consecutive entries
  if (sandboxUndoStack.length > 0) {
    const last = sandboxUndoStack[sandboxUndoStack.length - 1];
    if (JSON.stringify(last) === JSON.stringify(snap)) return;
  }
  
  sandboxUndoStack.push(snap);
  if (sandboxUndoStack.length > SANDBOX_MAX_HISTORY) {
    sandboxUndoStack.shift();
  }
  sandboxRedoStack = [];
  sandboxUpdateUndoRedoUI();
}

function sandboxUndo() {
  if (!sandboxEditEnabled || sandboxUndoStack.length <= 1) return;
  const current = sandboxUndoStack.pop();
  sandboxRedoStack.push(current);
  
  const previous = sandboxUndoStack[sandboxUndoStack.length - 1];
  sandboxApplyStateSnapshot(previous);
  sandboxUpdateUndoRedoUI();
  sandboxSetStatus('Krok späť (Undo)');
}

function sandboxRedo() {
  if (!sandboxEditEnabled || sandboxRedoStack.length === 0) return;
  const next = sandboxRedoStack.pop();
  sandboxUndoStack.push(next);
  sandboxApplyStateSnapshot(next);
  sandboxUpdateUndoRedoUI();
  sandboxSetStatus('Krok dopredu (Redo)');
}

function sandboxUpdateUndoRedoUI() {
  const undoBtn = document.getElementById('sbUndoBtn');
  const redoBtn = document.getElementById('sbRedoBtn');
  if (undoBtn) undoBtn.disabled = !sandboxEditEnabled || sandboxUndoStack.length <= 1;
  if (redoBtn) redoBtn.disabled = !sandboxEditEnabled || sandboxRedoStack.length === 0;
}

function sandboxWireUndoRedoControls() {
  let undoBtn = document.getElementById('sbUndoBtn');
  let redoBtn = document.getElementById('sbRedoBtn');

  if (!undoBtn || !redoBtn) {
    const parent = document.getElementById('sandboxFortControls') || document.getElementById('sandboxEditorPanel');
    if (parent) {
      const group = document.createElement('div');
      group.id = 'sbUndoRedoGroup';
      group.style.display = 'inline-flex';
      group.style.gap = '6px';
      group.style.marginLeft = '8px';

      if (!undoBtn) {
        undoBtn = document.createElement('button');
        undoBtn.id = 'sbUndoBtn';
        undoBtn.className = 'act-mini';
        undoBtn.setAttribute('data-i18n', 'sandbox.btn_undo');
        undoBtn.setAttribute('data-i18n-title', 'sandbox.title_undo');
        undoBtn.textContent = t('sandbox.btn_undo');
        undoBtn.title = t('sandbox.title_undo');
        group.appendChild(undoBtn);
      }
      if (!redoBtn) {
        redoBtn = document.createElement('button');
        redoBtn.id = 'sbRedoBtn';
        redoBtn.className = 'act-mini';
        redoBtn.setAttribute('data-i18n', 'sandbox.btn_redo');
        redoBtn.setAttribute('data-i18n-title', 'sandbox.title_redo');
        redoBtn.textContent = t('sandbox.btn_redo');
        redoBtn.title = t('sandbox.title_redo');
        group.appendChild(redoBtn);
      }
      parent.appendChild(group);
    }
  }

  if (undoBtn) undoBtn.onclick = sandboxUndo;
  if (redoBtn) redoBtn.onclick = sandboxRedo;
  sandboxUpdateUndoRedoUI();
}

function sandboxWireKeyboardShortcuts() {
  window.addEventListener('keydown', (ev) => {
    if (currentGameMode !== 'sandbox' || !sandboxEditEnabled) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      if (ev.shiftKey) {
        ev.preventDefault();
        sandboxRedo();
      } else {
        ev.preventDefault();
        sandboxUndo();
      }
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      sandboxRedo();
    }
  });
}

/* ============================= DRAG (nest + forts) ============================= */

function sandboxClampPct(v) { return Math.max(0, Math.min(100, v)); }

function sandboxPointerToMapPercent(ev) {
  const wrap = document.getElementById('mapWrap');
  const rect = wrap.getBoundingClientRect();
  const x = sandboxClampPct(((ev.clientX - rect.left) / rect.width) * 100);
  const y = sandboxClampPct(((ev.clientY - rect.top) / rect.height) * 100);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function sandboxMakeDraggable(el, onDrag, onEnd) {
  const img = el.tagName === 'IMG' ? el : el.querySelector('img');
  if (img) {
    img.draggable = false;
    img.ondragstart = (e) => e.preventDefault();
  }

  el.addEventListener('pointerdown', (ev) => {
    if (!sandboxEditEnabled) return;

    ev.preventDefault();
    ev.stopPropagation();

    let hasMoved = false;
    const pointerId = ev.pointerId;

    try { el.setPointerCapture(pointerId); } catch (e) {}

    el.classList.add('sandbox-dragging');

    const move = (mev) => {
      hasMoved = true;
      const p = sandboxPointerToMapPercent(mev);
      onDrag(p.x, p.y);
    };

    const up = (uev) => {
      try { el.releasePointerCapture(pointerId); } catch (e) {}

      el.classList.remove('sandbox-dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);

      if (onEnd) onEnd(hasMoved);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

// Called by script.js's renderMap()
function sandboxOnMapRendered() {
  if (currentGameMode !== 'sandbox') return;

  // --- NEST DRAG ---
  const nestImg = document.querySelector('#mapWrap .nest-icon');
  if (nestImg) {
    nestImg.classList.toggle('sandbox-draggable', sandboxEditEnabled);
    sandboxMakeDraggable(nestImg, (x, y) => {
      S.nest.x = x;
      S.nest.y = y;
      nestImg.style.left = x + '%';
      nestImg.style.top = y + '%';
    }, (hasMoved) => {
      if (hasMoved) {
        recordSandboxHistory();
        renderMap();
      }
    });
  }

  // --- FORT DRAG & SELECT ---
  document.querySelectorAll('#mapWrap .fort-event').forEach((container, i) => {
    const f = S.forts[i];
    if (!f) return;

    container.dataset.fortId = f.id;
    container.classList.toggle('sandbox-selected', sandboxSelectedFortId === f.id);

    const img = container.querySelector('.fort-icon');
    if (img) img.classList.toggle('sandbox-draggable', sandboxEditEnabled);

    sandboxMakeDraggable(container, (x, y) => {
      f.x = x;
      f.y = y;
      container.style.left = x + '%';
      container.style.top = y + '%';
    }, (hasMoved) => {
      if (!hasMoved) {
        if (sandboxEditEnabled) sandboxSelectFort(f.id);
      } else {
        recordSandboxHistory();
        renderMap();
      }
    });
  });
}

function sandboxSelectFort(id) {
  sandboxSelectedFortId = id;
  const fort = id != null ? S.forts.find(f => f.id === id) : null;
  const defInput = document.getElementById('sbFortDefenseInput');
  if (defInput) {
    if (fort) {
      defInput.value = fort.defense;
      defInput.disabled = !sandboxEditEnabled;
    } else {
      defInput.value = '';
      defInput.disabled = true;
    }
  }
  document.querySelectorAll('#mapWrap .fort-event').forEach(el => {
    el.classList.toggle('sandbox-selected', el.dataset.fortId == String(sandboxSelectedFortId));
  });
}

/* ============================= ADD / REMOVE FORT ============================= */

function sandboxAddFort() {
  if (!sandboxEditEnabled) return;
  const defEl = document.getElementById('defaultFortDefenseInput');
  const defDefense = defEl ? (parseInt(defEl.value, 10) || 50) : 50;
  const jitter = () => (Math.random() * 16) - 8;
  const id = sandboxNextFortId++;
  S.forts.push({
    id,
    x: sandboxClampPct(50 + jitter()),
    y: sandboxClampPct(50 + jitter()),
    alive: true,
    defense: defDefense,
    maxDefense: defDefense
  });
  recordSandboxHistory();
  renderMap();
  sandboxSelectFort(id);
}

function sandboxRemoveSelectedFort() {
  if (!sandboxEditEnabled) return;
  if (sandboxSelectedFortId == null) {
    alert('Najprv vyberte pevnosť kliknutím na mape.');
    return;
  }
  S.forts = S.forts.filter(f => f.id !== sandboxSelectedFortId);
  sandboxSelectedFortId = null;
  recordSandboxHistory();
  renderMap();
  sandboxSelectFort(null);
}

function sandboxWireFortControls() {
  const addBtn = document.getElementById('sbAddFortBtn');
  const removeBtn = document.getElementById('sbRemoveFortBtn');
  const defInput = document.getElementById('sbFortDefenseInput');
  if (addBtn) addBtn.onclick = sandboxAddFort;
  if (removeBtn) removeBtn.onclick = sandboxRemoveSelectedFort;
  if (defInput) {
    defInput.addEventListener('change', () => {
      if (sandboxSelectedFortId == null) return;
      const fort = S.forts.find(f => f.id === sandboxSelectedFortId);
      if (!fort) return;
      const val = parseInt(defInput.value, 10);
      fort.defense = isNaN(val) ? 0 : val;
      fort.maxDefense = fort.defense;
      recordSandboxHistory();
      renderMap();
      sandboxSelectFort(fort.id);
    });
  }
}

/* ============================= BACKGROUND + TOOLBAR ============================= */

function sandboxWireBackgroundInput() {
  const input = document.getElementById('sbBackgroundInput');
  if (!input) return;
  input.addEventListener('input', () => setMapBackground(input.value.trim()));
}

function sandboxWireIntroOverlay() {
  const overlay = document.getElementById('sandboxIntroOverlay');
  const openBtn = document.getElementById('sbIntroBtn');
  const closeX = document.getElementById('sbIntroCloseX');
  const doneBtn = document.getElementById('sbIntroDoneBtn');
  if (!overlay || !openBtn) return;
  const open = () => overlay.classList.remove('hidden');
  const close = () => overlay.classList.add('hidden');
  openBtn.onclick = open;
  if (closeX) closeX.onclick = close;
  if (doneBtn) doneBtn.onclick = close;
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
}

/* ============================= NEW / LOAD ============================= */

function sandboxNewLevel() {
  if (!confirm('Začať novú (náhodnú) mapu? Neuložené zmeny sa stratia.')) return;
  startSandboxMode();
  sandboxUndoStack = [];
  sandboxRedoStack = [];
  recordSandboxHistory();
}

function sandboxLoadLevelObject(obj) {
  S.nest = { x: (obj.nest && obj.nest.x != null) ? obj.nest.x : 50, y: (obj.nest && obj.nest.y != null) ? obj.nest.y : 50 };
  S.forts = Array.isArray(obj.forts)
    ? obj.forts.map((f, i) => {
        const def = f.defense != null ? f.defense : 50;
        return { id: f.id != null ? f.id : i + 1, x: f.x, y: f.y, alive: true, defense: def, maxDefense: def };
      })
    : [];
  sandboxNextFortId = S.forts.reduce((max, f) => Math.max(max, f.id), 0) + 1;
  sandboxSelectedFortId = null;

  const nameEl = document.getElementById('sbLevelNameInput');
  const descEl = document.getElementById('sbLevelDescInput');
  const fileEl = document.getElementById('sbLevelFileInput');
  const introEl = document.getElementById('sbIntroInput');
  const bgEl = document.getElementById('sbBackgroundInput');
  if (nameEl) nameEl.value = obj.name || 'Nová úroveň';
  if (descEl) descEl.value = obj.description || '';
  if (fileEl) fileEl.value = (obj.id ? obj.id.replace(/\.json$/i, '') : 'level') + '.json';
  if (introEl) introEl.value = obj.intro || '';
  if (bgEl) bgEl.value = obj.background || '';

  applySettingsToInputs(obj.settings);
  setMapBackground(obj.background || null);
  initGame(true);
  recordSandboxSnapshot();
  
  sandboxUndoStack = [];
  sandboxRedoStack = [];
  recordSandboxHistory();
  sandboxSetStatus('Načítané zo súboru');
}

function sandboxWireLoadButton() {
  const loadBtn = document.getElementById('sbLoadBtn');
  const fileInput = document.getElementById('sbLoadFile');
  if (!loadBtn || !fileInput) return;
  loadBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        sandboxLoadLevelObject(JSON.parse(reader.result));
      } catch (e) {
        alert('Neplatný JSON súbor: ' + e.message);
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  };
}

/* ============================= EXPORT ============================= */

function sandboxSlugToFilename(name) {
  const slug = (name || 'level')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'level';
  return slug + '.json';
}

function sandboxReadSettingsFromInputs() {
  const out = {};
  Object.entries(LEVEL_SETTINGS_INPUT_MAP).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const n = parseFloat(el.value);
    out[key] = isNaN(n) ? el.value : n;
  });
  return out;
}

function sandboxBuildLevelObject(useCurrentState) {
  const name = (document.getElementById('sbLevelNameInput').value || '').trim() || 'Nová úroveň';
  const source = useCurrentState || !initialSandboxSnapshot
    ? { nest: S.nest, forts: S.forts }
    : initialSandboxSnapshot;

  return {
    id: (document.getElementById('sbLevelFileInput').value || sandboxSlugToFilename(name)).replace(/\.json$/i, ''),
    name: name,
    description: document.getElementById('sbLevelDescInput').value.trim(),
    intro: document.getElementById('sbIntroInput').value,
    background: document.getElementById('sbBackgroundInput').value.trim() || null,
    nest: { x: source.nest.x, y: source.nest.y },
    forts: source.forts.map(f => ({ id: f.id, x: f.x, y: f.y, defense: f.alive === false ? (f.maxDefense || f.defense) : f.defense })),
    settings: sandboxReadSettingsFromInputs()
  };
}

function sandboxDownloadLevel(level) {
  const filename = (document.getElementById('sbLevelFileInput').value.trim() || sandboxSlugToFilename(level.name));
  const blob = new Blob([JSON.stringify(level, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : filename + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sandboxWireExportButtons() {
  const currentBtn = document.getElementById('sbExportCurrentBtn');
  const defaultBtn = document.getElementById('sbExportDefaultBtn');
  if (currentBtn) currentBtn.onclick = () => sandboxDownloadLevel(sandboxBuildLevelObject(true));
  if (defaultBtn) defaultBtn.onclick = () => sandboxDownloadLevel(sandboxBuildLevelObject(false));
}

/* ============================= STATUS + ENABLE/DISABLE ============================= */

function sandboxSetStatus(text) {
  const el = document.getElementById('sbStatus');
  if (el) el.textContent = text;
}

function sandboxSetEditEnabled(enabled) {
  sandboxEditEnabled = enabled;
  ['sbLevelNameInput', 'sbLevelDescInput', 'sbLevelFileInput', 'sbBackgroundInput',
   'sbIntroBtn', 'sbNewBtn', 'sbLoadBtn', 'sbExportCurrentBtn', 'sbExportDefaultBtn',
   'sbAddFortBtn', 'sbRemoveFortBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
  const defInput = document.getElementById('sbFortDefenseInput');
  if (defInput) defInput.disabled = !enabled || sandboxSelectedFortId == null;
  sandboxUpdateUndoRedoUI();
  renderMap();
}

/* ============================= SHOW/HIDE + INIT ============================= */

function sandboxOnModeChanged() {
  sandboxSetUIVisible(currentGameMode === 'sandbox');
  if (currentGameMode === 'sandbox') {
    sandboxNextFortId = S.forts.reduce((max, f) => Math.max(max, f.id), 0) + 1;
    sandboxSelectedFortId = null;
    if (sandboxUndoStack.length === 0 && S && S.nest) {
      recordSandboxHistory();
    }
  }
}

function sandboxSetUIVisible(visible) {
  const panel = document.getElementById('sandboxEditorPanel');
  const fortControls = document.getElementById('sandboxFortControls');
  if (panel) panel.classList.toggle('hidden', !visible);
  if (fortControls) fortControls.classList.toggle('hidden', !visible);
}

function sandboxInit() {
  sandboxSetUIVisible(currentGameMode === 'sandbox');
  if (sandboxWired) return;
  sandboxWired = true;

  sandboxWireFortControls();
  sandboxWireUndoRedoControls();
  sandboxWireKeyboardShortcuts();
  sandboxWireBackgroundInput();
  sandboxWireIntroOverlay();
  sandboxWireLoadButton();
  sandboxWireExportButtons();

  document.getElementById('sbNewBtn').onclick = sandboxNewLevel;

  const bgEl = document.getElementById('sbBackgroundInput');
  if (bgEl) bgEl.value = '';
  const fileEl = document.getElementById('sbLevelFileInput');
  if (fileEl && !fileEl.value) fileEl.value = 'level-1.json';

  sandboxOnModeChanged();

  if (currentGameMode === 'sandbox') sandboxOnMapRendered();
}

window.sandboxInit = sandboxInit;
window.sandboxOnMapRendered = sandboxOnMapRendered;
window.sandboxOnModeChanged = sandboxOnModeChanged;
window.sandboxSetUIVisible = sandboxSetUIVisible;
window.sandboxSetEditEnabled = sandboxSetEditEnabled;
window.sandboxUndo = sandboxUndo;
window.sandboxRedo = sandboxRedo;