/* =========================================================================================
 * HYBRID — Sandbox map editor
 * ========================================================================================= */

let sandboxSelectedFortId = null;
let sandboxNextFortId = 1;
let sandboxSelectedNestId = null;
let sandboxNextNestId = 1;
let sandboxEditEnabled = true;
let sandboxWired = false;
let sandboxLocationIconVisible = true;

/* ============================= UNDO / REDO SYSTEM ============================= */

let sandboxUndoStack = [];
let sandboxRedoStack = [];
const SANDBOX_MAX_HISTORY = 50;

// Snapshots the FULL S.nests array (every nest's position AND population -
// food, brood cohorts, scouts/predators, everything makeNestState() sets up),
// not just a single nest's x/y - sandbox now supports multiple, addable/
// removable nests, so undo/redo needs to restore all of them, not just
// whichever one happened to be "active" at snapshot time.
function sandboxGetStateSnapshot() {
  return {
    nests: JSON.parse(JSON.stringify(S.nests)),
    activeNestIndex: S.activeNestIndex,
    focusedNestIndex: S.focusedNestIndex,
    forts: S.forts.map(f => ({ ...f })),
    selectedFortId: sandboxSelectedFortId,
    selectedNestId: sandboxSelectedNestId,
    nextFortId: sandboxNextFortId,
    nextNestId: sandboxNextNestId
  };
}

function sandboxApplyStateSnapshot(snapshot) {
  S.nests = JSON.parse(JSON.stringify(snapshot.nests));
  S.activeNestIndex = Math.min(snapshot.activeNestIndex || 0, S.nests.length - 1);
  S.focusedNestIndex = Math.min(snapshot.focusedNestIndex || 0, S.nests.length - 1);
  S.forts = snapshot.forts.map(f => ({ ...f }));
  sandboxSelectedFortId = snapshot.selectedFortId;
  sandboxSelectedNestId = snapshot.selectedNestId;
  sandboxNextFortId = snapshot.nextFortId;
  sandboxNextNestId = snapshot.nextNestId;
  renderMap();
  sandboxSelectFort(sandboxSelectedFortId);
  sandboxSelectNest(sandboxSelectedNestId);
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
    // Same container as the add/remove nest buttons, so undo/redo lands
    // right next to them instead of in the (mostly hidden) editor panel.
    const parent = document.getElementById('sandbox-controls') || document.getElementById('sandboxEditorPanel');
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
  // Use script.js's shared world<->screen conversion (screenPxToWorld/getMapLetterbox)
  // instead of a separate naive %-of-rect calculation - two independent implementations
  // of the same conversion drift apart and produce inconsistent, aspect-distorted results.
  const world = screenPxToWorld(wrap, ev.clientX, ev.clientY);
  const x = sandboxClampPct(world.x);
  const y = sandboxClampPct(world.y);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function sandboxMakeDraggable(el, onDrag, onEnd, isEnabled = () => sandboxEditEnabled) {
  const img = el.tagName === 'IMG' ? el : el.querySelector('img');

  if (img) {
    img.draggable = false;
    img.ondragstart = (e) => e.preventDefault();
  } else {
    el.draggable = false;
    el.ondragstart = (e) => e.preventDefault();
  }

  el.addEventListener('pointerdown', (ev) => {
    if (!isEnabled()) return;

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
  sandboxWireToggleAllHiddenScoutsControl();
  if (currentGameMode !== 'sandbox') return;

  sandboxWireInsectDrag();
  sandboxWireMapEventExtras();

  const locIcon = document.querySelector('#mapWrap #sandbox-location-icon')
  if (locIcon) {
    // The location icon is just a visual marker - it doesn't affect the
    // simulation, so unlike nest/fort dragging it stays draggable even
    // while the simulation is running (sandboxEditEnabled === false).
    locIcon.classList.add('sandbox-draggable');
    sandboxApplyLocationIconVisibility();
    sandboxMakeDraggable(locIcon, (x, y) => {
      S.locationIcon.x = x;
      S.locationIcon.y = y;
      setWorldPosition(locIcon, document.getElementById('mapWrap'), x, y);
    }, (hasMoved) => {
      if (hasMoved) {
        recordSandboxHistory();
        renderMap();
      }
    }, () => currentGameMode === 'sandbox');
  }


  // --- NEST DRAG (one per alive nest) ---
  // script.js's renderMap() renders one .nest-event container per alive
  // S.nests entry (dataset.nestId = nest.id), not a single shared
  // '.nest-icon' - this used to grab only the FIRST nest icon on the page
  // and write into the S.nest accessor (whichever nest happens to be
  // "active", not necessarily the one under the cursor), which is why
  // dragging silently did nothing useful once a second nest existed.
  document.querySelectorAll('#mapWrap .nest-event').forEach(container => {
    const nestId = Number(container.dataset.nestId);
    const nest = S.nests.find(n => n.id === nestId);
    if (!nest) return;

    container.classList.toggle('sandbox-selected', sandboxSelectedNestId === nest.id);

    const img = container.querySelector('.nest-icon');
    if (img) img.classList.toggle('sandbox-draggable', sandboxEditEnabled);

    sandboxMakeDraggable(container, (x, y) => {
      nest.x = x;
      nest.y = y;
      setWorldPosition(container, document.getElementById('mapWrap'), x, y);
    }, (hasMoved) => {
      if (!hasMoved) {
        if (sandboxEditEnabled) sandboxSelectNest(nest.id);
      } else {
        recordSandboxHistory();
        renderMap();
      }
    });
  });

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
      setWorldPosition(container, document.getElementById('mapWrap'), x, y);
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

function sandboxSelectNest(id) {
  sandboxSelectedNestId = id;
  document.querySelectorAll('#mapWrap .nest-event').forEach(el => {
    el.classList.toggle('sandbox-selected', el.dataset.nestId == String(sandboxSelectedNestId));
  });
  const removeBtn = document.getElementById('sbRemoveNestBtn');
  if (removeBtn) removeBtn.disabled = !sandboxEditEnabled || sandboxSelectedNestId == null;
}

/* ============================= ADD / REMOVE NEST ============================= */

function sandboxAddNest() {
  if (!sandboxEditEnabled) return;
  const jitter = () => (Math.random() * 16) - 8;
  const id = sandboxNextNestId++;
  const nest = makeNestState(
    id,
    sandboxClampPct(50 + jitter()),
    sandboxClampPct(50 + jitter()),
    S.settings
  );
  S.nests.push(nest);
  recordSandboxHistory();
  renderMap();
  sandboxSelectNest(id);
}

// Shared removal logic (mirrors sandboxRemoveFortById). A colony needs at
// least one nest to exist - the whole sim (S.food/S.queen/... accessors,
// S.activeNestIndex/focusedNestIndex) assumes S.nests is never empty.
function sandboxRemoveNestById(id) {
  if (!sandboxEditEnabled || id == null) return;
  if (S.nests.length <= 1) {
    alert('Nemôžete odstrániť posledné hniezdo.');
    return;
  }
  const idx = S.nests.findIndex(n => n.id === id);
  if (idx === -1) return;

  S.nests.splice(idx, 1);
  if (sandboxSelectedNestId === id) sandboxSelectedNestId = null;

  // Keep the active/focused pointers in range so the S.food/S.queen/...
  // accessors and the Nest Analytics panel don't point past the end.
  if (S.activeNestIndex >= S.nests.length) S.activeNestIndex = S.nests.length - 1;
  if (S.focusedNestIndex >= S.nests.length) S.focusedNestIndex = S.nests.length - 1;

  recordSandboxHistory();
  renderMap();
  if (typeof sandboxRefreshOpenNestAnalytics === 'function') sandboxRefreshOpenNestAnalytics();
}

function sandboxRemoveSelectedNest() {
  if (!sandboxEditEnabled) return;
  if (sandboxSelectedNestId == null) {
    alert('Najprv vyberte hniezdo kliknutím na mape.');
    return;
  }
  sandboxRemoveNestById(sandboxSelectedNestId);
  sandboxSelectNest(null);
}

function sandboxWireNestControls() {
  let addBtn = document.getElementById('sbAddNestBtn');
  let removeBtn = document.getElementById('sbRemoveNestBtn');

  // Same "create if the page doesn't already have one" fallback pattern as
  // sandboxWireUndoRedoControls() below, since these buttons may not exist
  // in every host page's HTML yet.
  if (!addBtn || !removeBtn) {
    const parent = document.getElementById('sandbox-controls') || document.getElementById('sandboxEditorPanel');
    if (parent) {
      const group = document.createElement('div');
      group.id = 'sbNestControlsGroup';
      group.style.display = 'inline-flex';
      group.style.gap = '6px';
      group.style.marginLeft = '8px';

      if (!addBtn) {
        addBtn = document.createElement('button');
        addBtn.id = 'sbAddNestBtn';
        addBtn.className = 'act-mini';
        addBtn.setAttribute('data-i18n', 'sandbox.btn_add_nest');
        const addLabel = t('sandbox.btn_add_nest');
        addBtn.textContent = addLabel !== 'sandbox.btn_add_nest' ? addLabel : '+ Hniezdo';
        group.appendChild(addBtn);
      }
      if (!removeBtn) {
        removeBtn = document.createElement('button');
        removeBtn.id = 'sbRemoveNestBtn';
        removeBtn.className = 'act-mini danger';
        removeBtn.setAttribute('data-i18n', 'sandbox.btn_remove_nest');
        const removeLabel = t('sandbox.btn_remove_nest');
        removeBtn.textContent = removeLabel !== 'sandbox.btn_remove_nest' ? removeLabel : '− Hniezdo';
        group.appendChild(removeBtn);
      }
      parent.appendChild(group);
    }
  }

  if (addBtn) addBtn.onclick = sandboxAddNest;
  if (removeBtn) {
    removeBtn.onclick = sandboxRemoveSelectedNest;
    removeBtn.disabled = !sandboxEditEnabled || sandboxSelectedNestId == null;
  }
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
    maxDefense: defDefense,
    capacity: 100,
    population: Math.round(50 + Math.random() * 50),
    marked: false
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
  sandboxRemoveFortById(sandboxSelectedFortId);
  sandboxSelectFort(null);
}

// Shared removal logic used by both the (legacy) editor-panel remove button
// and the per-fort "remove" button in the bottom action panel.
function sandboxRemoveFortById(id) {
  if (!sandboxEditEnabled || id == null) return;
  S.forts = S.forts.filter(f => f.id !== id);
  if (sandboxSelectedFortId === id) sandboxSelectedFortId = null;
  recordSandboxHistory();
  renderMap();
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

function sandboxGetConditionDefaults() {
  return {
    id: `cond-${Date.now()}-${Math.round(Math.random() * 10000)}`,
    type: 'fort_falls',
    fortId: 'any',
    value: 1,
    outcome: 'victory',
    active: true,
    label: ''
  };
}

function sandboxReadConditionsFromEditor() {
  const list = document.getElementById('sandboxConditionsList');
  if (!list) return [];
  const rows = [...list.querySelectorAll('.condition-row')];
  return rows.map((row) => {
    const rowId = row.dataset.conditionId || `cond-${Date.now()}-${Math.random()}`;
    const type = row.querySelector('[data-role="type"]')?.value || 'fort_falls';
    const outcome = row.querySelector('[data-role="outcome"]')?.value || 'victory';
    const fortId = row.querySelector('[data-role="fortId"]')?.value || 'any';
    const value = Number(row.querySelector('[data-role="value"]')?.value ?? 0);
    const active = row.querySelector('[data-role="active"]')?.checked !== false;
    const label = row.querySelector('[data-role="label"]')?.value || '';
    return {
      id: rowId,
      type,
      fortId: fortId === 'any' ? 'any' : Number(fortId),
      value: Number.isFinite(value) ? value : 0,
      outcome,
      active,
      label
    };
  });
}

function sandboxRenderConditionsEditor() {
  const list = document.getElementById('sandboxConditionsList');
  if (!list) return;
  const current = Array.isArray(S.conditions) && S.conditions.length ? S.conditions : [];
  list.innerHTML = '';

  if (!current.length) {
    const empty = document.createElement('div');
    empty.className = 'conditions-empty';
    empty.textContent = 'Žiadne podmienky. Pridajte prvú podmienku.';
    list.appendChild(empty);
    return;
  }

  current.forEach((cond) => {
    const row = document.createElement('div');
    row.className = 'condition-row';
    row.dataset.conditionId = cond.id || `cond-${Date.now()}-${Math.random()}`;

    const typeSelect = document.createElement('select');
    typeSelect.dataset.role = 'type';
    const types = [
      ['fort_falls', 'Pevnosť padne'],
      ['fort_defense_below', 'Obrana pevnosti klesne pod'],
      ['fort_attacked', 'Pevnosť je napadnutá'],
      ['forts_fallen_over', 'Viac ako X pevností padne'],
      ['humans_killed_over', 'Zabitých ľudí > X'],
      ['humans_remaining_below', 'Ľudia < X'],
      ['nest_collapses', 'Hniezdo zanikne']
    ];
    types.forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if ((cond.type || 'fort_falls') === value) opt.selected = true;
      typeSelect.appendChild(opt);
    });

    const fortSelect = document.createElement('select');
    fortSelect.dataset.role = 'fortId';
    const fortOptions = [document.createElement('option')];
    fortOptions[0].value = 'any';
    fortOptions[0].textContent = 'Akákoľvek pevnosť';
    if ((cond.fortId ?? 'any') === 'any') fortOptions[0].selected = true;
    fortSelect.appendChild(fortOptions[0]);
    S.forts.forEach((fort) => {
      const opt = document.createElement('option');
      opt.value = String(fort.id);
      opt.textContent = `Pevnosť ${fort.id}`;
      if (String(cond.fortId || 'any') === String(fort.id)) opt.selected = true;
      fortSelect.appendChild(opt);
    });

    const outcomeSelect = document.createElement('select');
    outcomeSelect.dataset.role = 'outcome';
    ['victory', 'defeat'].forEach((value) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value === 'victory' ? 'Víťazstvo' : 'Prehra';
      if ((cond.outcome || 'victory') === value) opt.selected = true;
      outcomeSelect.appendChild(opt);
    });

    const valueInput = document.createElement('input');
    valueInput.type = 'number';
    valueInput.min = '0';
    valueInput.dataset.role = 'value';
    valueInput.value = Number(cond.value ?? 0);
    valueInput.style.width = '72px';

    const activeToggle = document.createElement('label');
    activeToggle.className = 'condition-active';
    const activeChk = document.createElement('input');
    activeChk.type = 'checkbox';
    activeChk.dataset.role = 'active';
    activeChk.checked = cond.active !== false;
    activeToggle.appendChild(activeChk);
    activeToggle.append('Aktívna');

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.dataset.role = 'label';
    labelInput.placeholder = 'Voliteľný popis';
    labelInput.value = cond.label || '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'nest-btn small danger';
    removeBtn.textContent = 'Odstrániť';
    removeBtn.onclick = () => {
      // Read current input values from the DOM before removing the row
      const current = sandboxReadConditionsFromEditor();
      S.conditions = current.filter(item => item.id !== cond.id);
      sandboxRenderConditionsEditor();
    };

    row.appendChild(typeSelect);
    row.appendChild(fortSelect);
    row.appendChild(outcomeSelect);
    row.appendChild(valueInput);
    row.appendChild(activeToggle);
    row.appendChild(labelInput);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });
}

function sandboxWireConditionsOverlay() {
  const overlay = document.getElementById('sandboxConditionsOverlay');
  const openBtn = document.getElementById('sbConditionsBtn');
  const closeX = document.getElementById('sbConditionsCloseX');
  const doneBtn = document.getElementById('sbConditionsDoneBtn');
  const addBtn = document.getElementById('sbAddConditionBtn');
  if (!overlay || !openBtn) return;

  const open = () => {
    if (!Array.isArray(S.conditions)) S.conditions = [];
    sandboxRenderConditionsEditor();
    sandboxCloseEditorPanel();
    overlay.classList.remove('hidden');
  };
  const close = () => {
    overlay.classList.add('hidden');
    sandboxOpenEditorPanel();
  };

  openBtn.onclick = open;
  if (closeX) closeX.onclick = close;
  if (doneBtn) doneBtn.onclick = () => {
    S.conditions = sandboxReadConditionsFromEditor();
    close();
  };
  if (addBtn) addBtn.onclick = () => {
    // Read current input values from the DOM first so unsaved edits are kept
    const arr = sandboxReadConditionsFromEditor();
    arr.push({ ...sandboxGetConditionDefaults(), id: `cond-${Date.now()}-${Math.round(Math.random() * 10000)}` });
    S.conditions = arr;
    sandboxRenderConditionsEditor();
  };

  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
}

function sandboxWireIntroOverlay() {
  const overlay = document.getElementById('sandboxIntroOverlay');
  const openBtn = document.getElementById('sbIntroBtn');
  const closeX = document.getElementById('sbIntroCloseX');
  const doneBtn = document.getElementById('sbIntroDoneBtn');
  if (!overlay || !openBtn) return;
  const open = () => {
    overlay.classList.remove('hidden');
    sandboxCloseEditorPanel();
  };
  const close = () => {
    overlay.classList.add('hidden');
    sandboxOpenEditorPanel()
  };
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
  sandboxResetHiddenScoutsPeek();
  sandboxHiddenScoutPositions = [];
  recordSandboxHistory();
}

function sandboxLoadLevelObject(obj) {
  // Supports both the current multi-nest `nests: [{id,x,y,population}]`
  // format (matching what script.js's own initGame()/recordSandboxSnapshot()
  // already read/write) and the legacy single `nest: {x,y}` format, which
  // gets auto-wrapped into a single-entry array.
  const levelNests = Array.isArray(obj.nests) && obj.nests.length > 0
    ? obj.nests
    : [obj.nest || { x: 50, y: 50 }];
  S.nests = levelNests.map((n, i) => makeNestState(n.id ?? (i + 1), n.x, n.y, S.settings));
  sandboxNextNestId = S.nests.reduce((max, n) => Math.max(max, n.id), 0) + 1;
  sandboxSelectedNestId = null;

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

  S.conditions = normalizeLevelConditions(obj.conditions || obj.goals || obj.objectives || []);
  if (!Array.isArray(S.conditions) || !S.conditions.length) {
    S.conditions = [{ id: 'cond-default-victory', type: 'nest_collapses', outcome: 'victory', value: 0, fortId: 'any', active: true }];
  }

  applySettingsToInputs(obj.settings);
  setMapBackground(obj.background || null);
  initGame(true);

  // Per-nest population overrides (new format: obj.nests[i].population),
  // falling back to the legacy single-nest obj.population field applied to
  // the first nest only - mirrors initGame()'s own campaign-loading logic.
  levelNests.forEach((n, i) => {
    const pop = n.population || (i === 0 ? obj.population : null);
    if (!pop) return;
    S.activeNestIndex = i;
    applyPopulationOverrides(pop);
  });
  S.activeNestIndex = 0;
  S.focusedNestIndex = 0;

  render();
  recordSandboxSnapshot();
  
  sandboxUndoStack = [];
  sandboxRedoStack = [];
  sandboxResetHiddenScoutsPeek();
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
    ? { nests: S.nests, forts: S.forts }
    : initialSandboxSnapshot;

  const conditions = Array.isArray(S.conditions) ? S.conditions : [];
  return {
    id: (document.getElementById('sbLevelFileInput').value || sandboxSlugToFilename(name)).replace(/\.json$/i, ''),
    name: name,
    description: document.getElementById('sbLevelDescInput').value.trim(),
    intro: document.getElementById('sbIntroInput').value,
    background: document.getElementById('sbBackgroundInput').value.trim() || null,
    // Every nest's position AND population (food, brood cohorts, scouts/
    // predators) - matches the format script.js's initGame() already reads
    // for campaign levels (CURRENT_LEVEL.nests[i].population).
    nests: source.nests.map(n => ({
      id: n.id,
      x: n.x,
      y: n.y,
      population: {
        food: n.food,
        queenReserve: n.queenReserve,
        scoutsAvailable: n.scoutsAvailable,
        scoutsHidden: n.scoutsHidden,
        scoutsCooldown: n.scoutsCooldown,
        predatorsAvailable: n.predatorsAvailable,
        predatorsCooldown: n.predatorsCooldown,
        eggs: JSON.parse(JSON.stringify(n.eggs || [])),
        larva: JSON.parse(JSON.stringify(n.larva || [])),
        cocoon: JSON.parse(JSON.stringify(n.cocoon || [])),
        nymph: JSON.parse(JSON.stringify(n.nymph || []))
      }
    })),
    forts: source.forts.map(f => ({
      id: f.id,
      x: f.x,
      y: f.y,
      defense: f.alive === false ? (f.maxDefense || f.defense) : f.defense,
      capacity: f.capacity != null ? f.capacity : 100,
      population: f.population != null ? f.population : Math.round(50 + Math.random() * 50)
    })),
    conditions: conditions.map(cond => ({
      id: cond.id,
      type: cond.type,
      fortId: cond.fortId,
      value: Number(cond.value || 0),
      outcome: cond.outcome,
      active: cond.active !== false,
      label: cond.label || ''
    })),
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
  if (currentBtn) currentBtn.onclick = () => sandboxDownloadLevel(sandboxBuildLevelObject(true));
}

/* ============================= STATUS + ENABLE/DISABLE ============================= */

function sandboxSetStatus(text) {
  const el = document.getElementById('sbStatus');
  if (el) el.textContent = text;
}

function sandboxSetEditEnabled(enabled) {
  sandboxEditEnabled = enabled;
  ['sbLevelNameInput', 'sbLevelDescInput', 'sbLevelFileInput', 'sbBackgroundInput',
   'sbIntroBtn', 'sbNewBtn', 'sbLoadBtn', 'sbExportCurrentBtn',
   'sbAddFortBtn', 'sbRemoveFortBtn', 'sbLocationBtn',
   'sbAddNestBtn', 'sbRemoveNestBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
  const defInput = document.getElementById('sbFortDefenseInput');
  if (defInput) defInput.disabled = !enabled || sandboxSelectedFortId == null;
  const removeNestBtn = document.getElementById('sbRemoveNestBtn');
  if (removeNestBtn) removeNestBtn.disabled = !enabled || sandboxSelectedNestId == null;
  sandboxUpdateUndoRedoUI();
  renderMap();
}

/* ============================= SHOW/HIDE + INIT ============================= */

function sandboxOnModeChanged() {
  sandboxSetUIVisible(currentGameMode === 'sandbox');
  if (currentGameMode === 'sandbox') {
    sandboxNextFortId = S.forts.reduce((max, f) => Math.max(max, f.id), 0) + 1;
    sandboxNextNestId = (S.nests || []).reduce((max, n) => Math.max(max, n.id), 0) + 1;
    sandboxSelectedFortId = null;
    sandboxSelectedNestId = null;
    if (sandboxUndoStack.length === 0 && S && S.nests && S.nests.length) {
      recordSandboxHistory();
    }
  }
  sandboxEnhanceNestAnalytics(); // panel should appear/disappear immediately on mode switch, not wait for a render tick
}

function sandboxSetUIVisible(visible) {
  const panel = document.getElementById('sandboxEditorPanel');
  const fortControlsHead = document.getElementById('sandboxLogHead');
  const editorToggleBtn = document.getElementById('sandboxEditorToggleBtn');
  if (fortControlsHead) fortControlsHead.classList.toggle('hidden', !visible);
  if (editorToggleBtn) editorToggleBtn.classList.toggle('hidden', !visible);
  // The editor panel is now an overlay opened via the EDITOR button, so it
  // always starts closed whenever sandbox UI visibility changes (entering or
  // leaving sandbox mode).
  if (panel) panel.classList.add('hidden');
}

function sandboxOpenEditorPanel() {
  const panel = document.getElementById('sandboxEditorPanel');
  if (panel) panel.classList.remove('hidden');
}

function sandboxCloseEditorPanel() {
  const panel = document.getElementById('sandboxEditorPanel');
  if (panel) panel.classList.add('hidden');
}

function sandboxWireEditorToggle() {
  const editorToggleBtn = document.getElementById('sandboxEditorToggleBtn');
  const closeBtn = document.getElementById('sbEditorCloseX');
  const panel = document.getElementById('sandboxEditorPanel');
  if (editorToggleBtn) editorToggleBtn.onclick = () => sandboxOpenEditorPanel();
  if (closeBtn) closeBtn.onclick = () => sandboxCloseEditorPanel();
  // Clicking the dimmed backdrop (outside the card) also closes it, like other overlays.
  if (panel) {
    panel.addEventListener('click', (ev) => {
      if (ev.target === panel) sandboxCloseEditorPanel();
    });
  }
}

/* ============================= PAUSE MODE ============================= */
// Dragging insects mutates S.events (e.x/e.y) directly, outside the normal
// render()/runStepAnimation() flow. If a step animation or auto-advance were
// to run while the user is mid-drag, the two writers could stomp on each
// other. Pause mode blocks anything that mutates simulation state (advancing
// a step, hiring, scanning, building a fort) while editing, same spirit as
// sandboxEditEnabled but for time rather than layout.

let sandboxPaused = false;
const SANDBOX_PAUSE_GUARDED_FNS = ['advanceStep', 'Hire', 'scanForHidden', 'buildFort'];
let sandboxPauseWrapped = false;

function sandboxWrapGuardedFunctions() {
  if (sandboxPauseWrapped) return;
  sandboxPauseWrapped = true;
  SANDBOX_PAUSE_GUARDED_FNS.forEach(name => {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function (...args) {
      if (sandboxPaused && currentGameMode === 'sandbox') {
        sandboxSetStatus('Simulácia je pozastavená (Pauza)');
        return;
      }
      return orig.apply(this, args);
    };
  });
}

function sandboxSetPaused(paused) {
  sandboxPaused = paused;

  const btn = document.getElementById('sbPauseBtn');

  if (btn) {
    btn.classList.toggle('sandbox-selected', paused);
    btn.textContent = paused
      ? t('sandbox.btn_resume')
      : t('sandbox.btn_pause');
    btn.title = t('sandbox.title_pause');
  }

  // Immediately enable/disable scout + predator dragging.
  sandboxWireInsectDrag();

  sandboxSetStatus(paused ? 'Pozastavené' : 'Beží');

  // If the Nest Analytics overlay is open, flip its readouts between plain
  // text and editable inputs right away rather than waiting for a reopen.
  sandboxRefreshOpenNestAnalytics();
}

function sandboxTogglePaused() {
  sandboxSetPaused(!sandboxPaused);
}

function sandboxWirePauseControl() {
  const btn = document.getElementById('sbPauseBtn');
  if (!btn) return;
  btn.onclick = sandboxTogglePaused;
  sandboxSetPaused(sandboxPaused);
  sandboxWrapRenderPhaseBanner();
  sandboxSyncPauseBtnVisibility();
}

// The pause button lives next to #stopSimBtn in the header and should follow
// the exact same show/hide rule (sandbox mode + phase active + not game
// over). Rather than duplicating that rule here, we just mirror stopSimBtn's
// own "hidden" class after every renderPhaseBanner() call, which is the
// single place script.js already computes it.
function sandboxSyncPauseBtnVisibility() {
  const btn = document.getElementById('sbPauseBtn');
  if (!btn) return;
  const stopBtn = document.getElementById('stopSimBtn');
  const visible = stopBtn
    ? !stopBtn.classList.contains('hidden')
    : (currentGameMode === 'sandbox' && S.phase === 'active' && !S.gameOver);
  btn.classList.toggle('hidden', !visible);
  // Don't leave the sim stuck paused once the pause control itself
  // disappears (simulation stopped/ended, or we left sandbox mode).
  if (!visible && sandboxPaused) sandboxSetPaused(false);
}

let sandboxRenderPhaseBannerWrapped = false;
function sandboxWrapRenderPhaseBanner() {
  if (sandboxRenderPhaseBannerWrapped) return;
  const orig = window.renderPhaseBanner;
  if (typeof orig !== 'function') return;
  sandboxRenderPhaseBannerWrapped = true;
  window.renderPhaseBanner = function (...args) {
    const result = orig.apply(this, args);
    sandboxSyncPauseBtnVisibility();
    // Covers stopSimulation() and any other phase change (e.g. 'stopped')
    // that should flip the analytics overlay's edit state, not just pause.
    sandboxRefreshOpenNestAnalytics();
    return result;
  };
}

/* ============================= LOCATION ICON SHOW/HIDE TOGGLE ============================= */
// #locationBtn is a plain toggle: it doesn't move the icon (that's drag,
// wired in sandboxOnMapRendered), it just lets the editor declutter the map
// by hiding the marker without deleting/moving it. Purely an editor
// convenience — not saved with the level.

function sandboxApplyLocationIconVisibility() {
  const locIcon = document.getElementById('sandbox-location-icon');
  if (locIcon) locIcon.classList.toggle('hidden', !sandboxLocationIconVisible);

  const btn = document.getElementById('locationBtn');
  if (btn) {
    btn.classList.add('sandbox-visibility-btn');
    btn.classList.toggle('sandbox-state-visible', sandboxLocationIconVisible);
    btn.classList.toggle('sandbox-state-hidden', !sandboxLocationIconVisible);
    btn.title = sandboxLocationIconVisible
      ? t('sandbox.title_hide_location')
      : t('sandbox.title_show_location');
  }
}

function sandboxSetLocationIconVisible(visible) {
  sandboxLocationIconVisible = visible;
  sandboxApplyLocationIconVisibility();
}

function sandboxToggleLocationIconVisible() {
  sandboxSetLocationIconVisible(!sandboxLocationIconVisible);
}

function sandboxWireLocationToggle() {
  const btn = document.getElementById('locationBtn');
  if (!btn) return;
  btn.onclick = sandboxToggleLocationIconVisible;
  sandboxApplyLocationIconVisibility();
}

/* ============================= DRAG (insects: scouts / predators) ============================= */
// Reuses the same pointer-drag machinery as the nest/fort drag above, applied
// to the .map-event containers script.js tags with data-event-id/data-event-type.

function sandboxWireInsectDrag() {
  if (currentGameMode !== 'sandbox') return;

  document.querySelectorAll('#mapWrap .map-event[data-event-id]').forEach(container => {
    const img = container.querySelector('.event-icon');
    if (!img) return;

    const enabled = sandboxPaused;

    img.classList.toggle('sandbox-draggable', enabled);

    const eid = Number(container.dataset.eventId);

    sandboxMakeDraggable(
      container,
      (x, y) => {
        const e = S.events.find(ev => ev.id === eid);
        if (!e) return;

        e.x = x;
        e.y = y;

        setWorldPosition(
          container,
          document.getElementById('mapWrap'),
          x,
          y
        );
      },
      (hasMoved) => {
        if (hasMoved) renderMap();
      },
      () => sandboxPaused
    );
  });
}

/* ============================= FORCE FORT CONQUEST ============================= */

const SANDBOX_FORCE_CONQUEST_REINFORCEMENT = 10;

// Predators "available" to be thrown at a forced conquest: the idle pool
// plus anything currently out on a hunt elsewhere (it gets redirected to
// the fort). Predators on cooldown are never available for this.
function sandboxHuntActivePredators() {
  return S.events
    .filter(e => e.type === 'hunt' && e.status === 'pending')
    .reduce((sum, e) => sum + Math.max(0, e.groupSize - e.neutralized - e.killed), 0);
}

function sandboxPredatorsAvailableForConquest() {
  return Math.max(0, S.predatorsAvailable || 0) + sandboxHuntActivePredators();
}

// Pulls up to `count` predators for a forced/reinforced fort attack: idle
// predators first, then predators redirected off active hunts. Returns how
// many were actually drawn (may be less than requested if not enough are
// available).
function sandboxDrawPredatorsForConquest(count) {
  let remaining = count;

  const fromIdle = Math.min(remaining, Math.max(0, S.predatorsAvailable || 0));
  S.predatorsAvailable = Math.max(0, (S.predatorsAvailable || 0) - fromIdle);
  remaining -= fromIdle;

  if (remaining > 0) {
    const huntEvents = S.events.filter(e => e.type === 'hunt' && e.status === 'pending');
    for (const e of huntEvents) {
      if (remaining <= 0) break;
      const active = Math.max(0, e.groupSize - e.neutralized - e.killed);
      const take = Math.min(active, remaining);
      if (take <= 0) continue;
      e.groupSize -= take;
      remaining -= take;
    }
  }

  return count - remaining;
}

function sandboxForceConquest(fortId) {
  if (currentGameMode !== 'sandbox' || sandboxPaused) return;
  const fort = S.forts.find(f => f.id === fortId && f.alive);
  if (!fort) return;

  const existingAttack = S.events.find(e => e.type === 'fort' && e.status === 'pending');
  if (existingAttack && existingAttack.targetFortId !== fort.id) {
    sandboxSetStatus('Útok na inú pevnosť už prebieha');
    return;
  }

  const availablePool = sandboxPredatorsAvailableForConquest();
  if (availablePool <= 0) {
    sandboxSetStatus('Žiadni dostupní predátori');
    return;
  }

  if (existingAttack) {
    const attackers = sandboxDrawPredatorsForConquest(Math.min(SANDBOX_FORCE_CONQUEST_REINFORCEMENT, availablePool));
    existingAttack.originalAttackers += attackers;
    delete existingAttack.iconPositions; // force renderMap to re-lay-out icons for the new count

    log('[Sandbox] ' + t('sandbox.log_forced_conquest_reinforced', { id: fort.id, count: attackers }));
    renderMap();
    sandboxSetStatus('Útok posilnený o ' + attackers + ' predátorov');
    return;
  }

  const attackers = sandboxDrawPredatorsForConquest(Math.max(1, Math.min(S.predatorsAvailable || 1, availablePool)));
  S.fortCooldown = 0;

  S.events.push({
    id: nid(),
    type: 'fort',
    status: 'pending',
    outcome: null,
    originalAttackers: attackers,
    killed: 0,
    targetFortId: fort.id
  });

  log('[Sandbox] ' + t('sandbox.log_forced_conquest', { id: fort.id, count: attackers }));
  renderMap();
  sandboxSetStatus('Útok vynútený');
}

/* ============================= SCOUT VISIBILITY ============================= */

let sandboxPeekedHiddenScoutIds = null;

// Persistent positions for scouts currently in S.scoutsHidden.
// These survive show/hide-all toggles.
let sandboxHiddenScoutPositions = [];


/*
 * Make sure every hidden scout has a permanent sandbox position.
 *
 * We only create positions for NEW hidden scouts. Existing positions
 * are never regenerated.
 */
function sandboxEnsureHiddenScoutPositions() {
  const hiddenCount = Math.max(0, Number(S.scoutsHidden || 0));

  while (sandboxHiddenScoutPositions.length < hiddenCount) {
    const temp = {
      type: 'search',
      status: 'pending',
      outcome: null
    };

    assignEventCoords(temp);

    sandboxHiddenScoutPositions.push({
      x: temp.x,
      y: temp.y
    });
  }

  // If the hidden population decreased permanently, discard only the
  // positions that no longer correspond to hidden scouts.
  if (sandboxHiddenScoutPositions.length > hiddenCount) {
    sandboxHiddenScoutPositions.length = hiddenCount;
  }
}


/* ---- INDIVIDUAL SCOUT: permanently hide this scout ---- */

function sandboxToggleScoutVisibility(eventId) {
  const e = S.events.find(
    ev => ev.id === eventId &&
         ev.type === 'search' &&
         ev.status === 'pending' &&
         !ev.outcome
  );

  if (!e) return;

  /*
   * If this scout was temporarily revealed by "Show All",
   * clicking its individual button means:
   *
   *   "I want this scout to stay revealed."
   *
   * Therefore remove it from the temporary peek set and keep
   * it as a normal visible scout.
   */
  if (
    sandboxPeekedHiddenScoutIds &&
    sandboxPeekedHiddenScoutIds.has(eventId)
  ) {
    sandboxPeekedHiddenScoutIds.delete(eventId);

    if (sandboxPeekedHiddenScoutIds.size === 0) {
      sandboxPeekedHiddenScoutIds = null;
    }

    /*
     * Keep the scout in S.events.
     * Do NOT increase S.scoutsHidden.
     * Do NOT remove the event.
     *
     * Its current x/y position is preserved automatically.
     */
    renderMap();
    return;
  }

  /*
   * Normal scout:
   * permanently hide it and return it to S.scoutsHidden.
   */

  // Preserve its current map position.
  sandboxHiddenScoutPositions.push({
    x: e.x,
    y: e.y
  });

  S.events = S.events.filter(
    ev => ev.id !== eventId
  );

  S.scoutsHidden = (S.scoutsHidden || 0) + 1;

  renderMap();
}


/* ---- RESET TEMPORARY SHOW-ALL ---- */

function sandboxResetHiddenScoutsPeek() {
  if (!sandboxPeekedHiddenScoutIds) return;

  const temporaryIds = sandboxPeekedHiddenScoutIds;

  // Remove only the temporary materialized scouts.
  S.events = S.events.filter(
    e => !temporaryIds.has(e.id)
  );

  // The scouts return to S.scoutsHidden.
  S.scoutsHidden =
    (S.scoutsHidden || 0) + temporaryIds.size;

  sandboxPeekedHiddenScoutIds = null;

  /*
   * IMPORTANT:
   * Do NOT regenerate sandboxHiddenScoutPositions here.
   * Those positions belong to these hidden scouts and must survive
   * the toggle.
   */
  renderMap();
}


/* ---- SHOW / HIDE ALL HIDDEN SCOUTS ---- */

function sandboxToggleAllHiddenScouts() {

  /* SECOND PRESS — hide the temporary scouts again */
  if (sandboxPeekedHiddenScoutIds) {
    const count = sandboxPeekedHiddenScoutIds.size;

    sandboxResetHiddenScoutsPeek();

    sandboxSetStatus(
      `Skrytí skauti opäť skrytí (${count})`
    );

    return;
  }


  const hiddenCount =
    Math.max(0, Number(S.scoutsHidden || 0));

  if (hiddenCount <= 0) {
    sandboxSetStatus('Žiadni skrytí skauti');
    return;
  }


  /*
   * Ensure the hidden pool has stable coordinates.
   *
   * This only creates positions for scouts that don't have one yet.
   */
  sandboxEnsureHiddenScoutPositions();


  /*
   * Materialize the hidden scouts temporarily.
   */
  sandboxPeekedHiddenScoutIds = new Set();

  for (let i = 0; i < hiddenCount; i++) {

    const pos = sandboxHiddenScoutPositions[i];

    const e = {
      id: nid(),
      type: 'search',
      status: 'pending',
      outcome: null,
      x: pos.x,
      y: pos.y,

      // Marker so we know this is only a temporary visual reveal.
      _sandboxTemporaryHiddenReveal: true
    };

    S.events.push(e);
    sandboxPeekedHiddenScoutIds.add(e.id);
  }

  // They are now represented by temporary events.
  S.scoutsHidden = 0;

  renderMap();

  sandboxSetStatus(
    `Zobrazení skrytí skauti (${hiddenCount})`
  );
}


/* ---- SHOW/HIDE-ALL BUTTON ---- */

function sandboxWireToggleAllHiddenScoutsControl() {

  let btn = document.getElementById(
    'sbToggleHiddenScoutsBtn'
  );

  if (!btn) {
    const parent = document.getElementById('static-ctrls');
    if (!parent) return;

    btn = document.createElement('button');
    btn.id = '';
    btn.className = 'nest-btn control-btn';

    const main = document.createElement('span');
    main.className = 'btn-main';
    main.textContent = '👁';

    btn.appendChild(main);
    parent.appendChild(btn);
  }

  const isPeeking =
    !!sandboxPeekedHiddenScoutIds;

  btn.title = t(
    'sandbox.title_toggle_hidden_scouts'
  );

  btn.classList.toggle(
    'sandbox-peeking',
    isPeeking
  );

  btn.onclick =
    sandboxToggleAllHiddenScouts;

  btn.classList.toggle(
    'hidden',
    currentGameMode !== 'sandbox'
  );
}

/* ============================= BOTTOM-BAR ACTION EXTRAS ============================= */
// script.js's renderMap() already builds the fort (reinforce/capacity) and
// scout/predator (distract/kill) action buttons into #controls-containter
// based on which map-event is "open" (activeOpenMapKey). We append our extra
// sandbox-only buttons to that same container after renderMap() runs, using
// the DOM's .open marker rather than touching script.js's internal state.

function sandboxWireMapEventExtras() {
  if (currentGameMode !== 'sandbox') return;
  const controlsContainer = document.getElementById('controls-containter');
  if (!controlsContainer) return;

  const openFortEl = document.querySelector('#mapWrap .fort-event.open');
  if (openFortEl) {
    const fortId = Number(openFortEl.dataset.fortId);
    const fort = S.forts.find(f => f.id === fortId);
    if (fort && fort.alive) {
      const btn = document.createElement('button');
      btn.className = 'nest-btn control-btn map-action-btn';
      const main = document.createElement('span');
      main.className = 'btn-main';
      main.textContent = '⚔';
      btn.appendChild(main);
      btn.title = t('sandbox.title_force_conquest');
      btn.disabled = sandboxPaused;
      btn.onclick = (ev) => { ev.stopPropagation(); sandboxForceConquest(fort.id); };
      controlsContainer.appendChild(btn);
    }

    // Fort population + defense fields (script.js's renderMap creates them
    // read-only by default). Enable editing here, gated on the layout
    // edit-lock, same as every other sandbox layout control.
    if (fort && fort.alive) {
      const popInput = document.getElementById('fortPopulationInput');
      if (popInput) {
        popInput.readOnly = !sandboxEditEnabled;
        popInput.disabled = !sandboxEditEnabled;
        popInput.onchange = () => {
          const capacity = Math.max(0, fort.capacity || 0);
          const val = parseInt(popInput.value, 10);
          fort.population = isNaN(val) ? 0 : Math.max(0, Math.min(val, capacity));
          recordSandboxHistory();
          renderMap();
        };
      }

      const defInput = document.getElementById('fortDefenseInput');
      if (defInput) {
        defInput.readOnly = !sandboxEditEnabled;
        defInput.disabled = !sandboxEditEnabled;
        defInput.onchange = () => {
          const val = parseInt(defInput.value, 10);
          fort.defense = isNaN(val) ? 0 : Math.max(0, val);
          fort.maxDefense = fort.defense;
          recordSandboxHistory();
          renderMap();
        };
      }

      const capacityInput = document.getElementById('fortCapacityInput');
      if (capacityInput) {
        capacityInput.readOnly = !sandboxEditEnabled;
        capacityInput.disabled = !sandboxEditEnabled;
        capacityInput.onchange = () => {
          const val = parseInt(capacityInput.value, 10);
          fort.capacity = isNaN(val) ? 0 : Math.max(0, val);
          fort.population = Math.max(0, Math.min(fort.population || 0, fort.capacity));
          recordSandboxHistory();
          renderMap();
        };
      }

      // Remove-fort button - sandbox-only, appended to the bottom action
      // panel right next to the defense/capacity fields above. Only usable
      // while layout editing is unlocked, same as those fields.
      const removeFortBtn = document.createElement('button');
      removeFortBtn.className = 'nest-btn danger control-btn sandbox-remove-fort-btn';
      removeFortBtn.type = 'button';
      removeFortBtn.setAttribute('data-i18n', 'sandbox.btn_remove_fort');
      removeFortBtn.textContent = t('sandbox.btn_remove_fort');
      removeFortBtn.disabled = !sandboxEditEnabled;
      removeFortBtn.onclick = (ev) => {
        ev.stopPropagation();
        sandboxRemoveFortById(fort.id);
      };
      controlsContainer.appendChild(removeFortBtn);


    }
  }

  const openScoutEl = document.querySelector('#mapWrap .map-event.open[data-event-type="search"]');
  if (openScoutEl) {
    const eid = Number(openScoutEl.dataset.eventId);
    const e = S.events.find(ev => ev.id === eid);
    if (e) {
      const btn = document.createElement('button');
      btn.className = 'nest-btn control-btn map-action-btn sandbox-visibility-btn';
      btn.classList.add(e._hideOnMap ? 'sandbox-state-hidden' : 'sandbox-state-visible');
      const main = document.createElement('span');
      main.className = 'btn-main';
      main.textContent = '👁';
      btn.appendChild(main);
      btn.title = e._hideOnMap ? t('sandbox.title_show_scout') : t('sandbox.title_hide_scout');
      btn.onclick = (ev) => { ev.stopPropagation(); sandboxToggleScoutVisibility(e.id); };
      controlsContainer.appendChild(btn);

      btn.classList.toggle(
        'hidden',
        currentGameMode !== 'sandbox'
      );
    }
  }
}

/* ============================= NEST ANALYTICS EDITING (sandbox only) ============================= */
// renderStats() (script.js) populates #stageRow with one read-only chip per
// stat (grouped stat-group-row / chips-wrap / stage-chip elements), tagged
// with data-stat-key so this file can find them. In sandbox mode, for every
// stat that has a directly-settable field (queen status, food storage,
// queen reserve, the brood-lifecycle counts, and scout/predator
// available/cooldown/hidden counts), we swap that chip's value into a live
// input/select right in place — there is exactly one row per stat, editable
// in sandbox and the plain read-only default everywhere else (campaign
// mode, or derived-only stats like totals/working/fort-duty that have no
// backing field to edit). Committing a field writes into S and re-runs
// renderStats(), which rebuilds the chips and (via the wrap below) re-runs
// this enhancement, keeping the swapped-in inputs fresh.

function sandboxAnalyticsEditable() {
  return currentGameMode === 'sandbox' && !!S;
}

const SANDBOX_ANALYTICS_FIELDS = [
  { key: 'queenState', type: 'select',
    get: () => (S.queen.alive ? 'alive' : 'dead'),
    set: v => { S.queen.alive = (v === 'alive'); },
    options: () => [
      { value: 'alive', label: t('stats.active') },
      { value: 'dead',  label: t('stats.dead') }
    ] },
  { key: 'food',              type: 'number',
    get: () => S.food,              set: v => { S.food = v; } },
  { key: 'queenReserve',      type: 'number',
    get: () => S.queenReserve,      set: v => { S.queenReserve = Math.min(v, S.settings.queenFoodReserveCap); } },
  { key: 'eggs',              type: 'number',
    get: () => sumCohort(S.eggs),   set: v => { S.eggs = [{ age: 0, count: v }]; } },
  { key: 'larva',             type: 'number',
    get: () => sumCohort(S.larva),  set: v => { S.larva = [{ age: 0, count: v }]; } },
  { key: 'cocoon',            type: 'number',
    get: () => sumCohort(S.cocoon), set: v => { S.cocoon = [{ age: 0, count: v }]; } },
  { key: 'nymph',             type: 'number',
    get: () => sumCohort(S.nymph),  set: v => { S.nymph = [{ age: 0, count: v }]; } },
  { key: 'scoutsAvailable',   type: 'number',
    get: () => S.scoutsAvailable,    set: v => { S.scoutsAvailable = v; } },
  { key: 'scoutsCooldown',    type: 'number',
    get: () => S.scoutsCooldown,     set: v => { S.scoutsCooldown = v; } },
  { key: 'scoutsHidden',      type: 'number',
    get: () => S.scoutsHidden,       set: v => { S.scoutsHidden = v; } },
  { key: 'predatorsAvailable',type: 'number',
    get: () => S.predatorsAvailable, set: v => { S.predatorsAvailable = v; } },
  { key: 'predatorsCooldown', type: 'number',
    get: () => S.predatorsCooldown,  set: v => { S.predatorsCooldown = v; } }
];

function sandboxCommitAnalyticsField(field, rawValue) {
  try {
    if (field.type === 'select') {
      field.set(rawValue);
    } else {
      let v = Math.round(Number(rawValue));
      if (!Number.isFinite(v) || v < 0) v = 0;
      field.set(v);
    }
  } catch (err) {
    console.error('[sandbox analytics] failed to apply field', field.key, err);
  }
  if (typeof renderStats === 'function') renderStats();
}

function sandboxBuildAnalyticsEditControl(field) {
  let control;
  if (field.type === 'select') {
    control = document.createElement('select');
    const current = field.get();
    field.options().forEach(opt => {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      if (opt.value === current) optionEl.selected = true;
      control.appendChild(optionEl);
    });
    control.addEventListener('change', () => sandboxCommitAnalyticsField(field, control.value));
  } else {
    control = document.createElement('input');
    control.type = 'number';
    control.min = '0';
    control.step = '1';
    control.value = field.get();
    control.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') control.blur();
    });
    control.addEventListener('change', () => sandboxCommitAnalyticsField(field, control.value));
  }
  control.className = 'analytics-edit-input';
  control.addEventListener('keydown', ev => ev.stopPropagation());
  control.addEventListener('click', ev => ev.stopPropagation());
  return control;
}

function sandboxEnhanceNestAnalytics() {
  const stageRow = document.getElementById('stageRow');
  if (!stageRow) return;

  // Not editable (campaign mode, or no sim yet) → leave every chip showing
  // its plain default value, exactly as renderStats() rendered it.
  if (!sandboxAnalyticsEditable()) return;

  SANDBOX_ANALYTICS_FIELDS.forEach(field => {
    const chip = stageRow.querySelector(`.stage-chip[data-stat-key="${field.key}"]`);
    const valEl = chip && chip.querySelector('.chip-val');
    if (!valEl) return;
    try {
      valEl.innerHTML = '';
      valEl.appendChild(sandboxBuildAnalyticsEditControl(field));
    } catch (err) {
      console.error('[sandbox analytics] failed to build control', field.key, err);
    }
  });
}

let sandboxAnalyticsWrapped = false;
function sandboxWrapRenderNestAnalytics() {
  if (sandboxAnalyticsWrapped) return;
  const orig = window.renderStats;
  if (typeof orig !== 'function') return;
  sandboxAnalyticsWrapped = true;
  window.renderStats = function (...args) {
    const result = orig.apply(this, args);
    sandboxEnhanceNestAnalytics();
    return result;
  };
}

// Keep the overlay in sync if it's open while pause/resume is toggled.
function sandboxRefreshOpenNestAnalytics() {
  const overlay = document.getElementById('nestAnalyticsOverlay');
  if (overlay && !overlay.classList.contains('hidden') && typeof renderStats === 'function') {
    renderStats();
  }
}

function sandboxInit() {
  sandboxSetUIVisible(currentGameMode === 'sandbox');
  if (sandboxWired) return;
  sandboxWired = true;

  sandboxWireFortControls();
  sandboxWireNestControls();
  sandboxWireUndoRedoControls();
  sandboxWireKeyboardShortcuts();
  sandboxWireBackgroundInput();
  sandboxWireIntroOverlay();
  sandboxWireConditionsOverlay();
  sandboxWireLoadButton();
  sandboxWireExportButtons();
  sandboxWireEditorToggle();
  sandboxWrapGuardedFunctions();
  sandboxWirePauseControl();
  sandboxWireLocationToggle();
  sandboxWrapRenderNestAnalytics();
  sandboxEnhanceNestAnalytics(); // show the edit panel immediately, don't wait for the next renderStats() tick

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
window.sandboxTogglePaused = sandboxTogglePaused;
window.sandboxToggleLocationIconVisible = sandboxToggleLocationIconVisible;
window.sandboxForceConquest = sandboxForceConquest;
window.sandboxToggleScoutVisibility = sandboxToggleScoutVisibility;
window.sandboxToggleAllHiddenScouts = sandboxToggleAllHiddenScouts;
