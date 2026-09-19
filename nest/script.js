// ============================================================================
// NOTE: The DOM-free simulation core (state factory + pure sim math: dist,
// fortMark, assignEventCoords, advanceStepLogic, advanceNestStepLogic,
// processLifecycle, t/translations, etc.) has been extracted into
// nest-core.js. index.html must load it BEFORE this file:
//   <script src="nest-core.js"></script>
//   <script src="script.js"></script>
// Everything below still refers to S / advanceStepLogic / t / dist / ...
// as plain globals - they now live in nest-core.js but are visible here
// via the shared top-level script scope. See REFACTOR_NOTES.md.
// ============================================================================
/* ============================= I18N SYSTEM ============================= */
let TRANSLATIONS = {};
const DEBUG = false;
const BUILD_FORT_COST = 8;
const BUILD_FORT_CAPACITY = 40;
const BUILD_FORT_DEFENSE = 10;
// HIRE_COST removed - hiring a hybrid is now free, capped instead by
// canSustainOneMoreHybrid() (see hireAtFort()).
const DIST_FROM_FORT = 10;
const SCAN_REVEAL_RADIUS = 40;
const REVEAL_CHANCE = 0.6;
// [moved to nest-core.js] const CONQUEST_PRIORITY = 20; ... (8 lines)
const MIN_NEST_DIST_FROM_OTHER_NEST = 100; // map units kept between two nests when generating a sandbox map

// How much closer-to-an-enemy-nest hunting raises a predator's death risk.
// Within ENEMY_NEST_DEATH_RISK_RADIUS map units of a rival, alive nest, a
// hunting predator's death chance climbs linearly up to
// +ENEMY_NEST_MAX_DEATH_RISK_BONUS at zero distance - nests fight over the
// same humans, so hunting deep in a rival's territory is dangerous.
// [moved to nest-core.js] const ENEMY_NEST_DEATH_RISK_RADIUS = 70; ... (25 lines)

// Installs S.nest / S.food / S.queen / ... as accessor properties that
// forward to whichever nest is "active" (S.activeNestIndex). This lets the
// large body of existing single-nest simulation code (processLifecycle,
// searchChanceWithDistance, etc.) keep working completely unchanged - it's
// simply re-run once per alive nest, with the active pointer moved between
// runs. Direct multi-nest code (rendering, generation, save/load) works with
// S.nests directly instead of going through these accessors.
// [moved to nest-core.js] const NEST_SCOPED_FIELDS = [ ... (25 lines)

// [moved to nest-core.js] function fortMark(fort, nestId){ ... (7 lines)
function fortAnyMarked(fort){
  return !!(fort.marks && Object.values(fort.marks).some(m => m.marked));
}

// [moved to nest-core.js] function totalInsectsForNest(nest){ ... (13 lines)
// Per-nest breakdown used by S.history entries, so the Nest Analytics chart
// can plot the historical line for whichever nest is selected (rather than
// the combined total across all nests) - see renderChart().
// [moved to nest-core.js] function insectsByNestSnapshot(){ ... (14 lines)
// The closer `loc` (a hunt event's position) is to a rival, alive nest, the
// higher the extra death-risk bonus returned here (0 when no rival is near).
// [moved to nest-core.js] function enemyProximityDeathRisk(loc, ownNestId){ ... (6 lines)
/* ============================= MODE & RESTART STATE ============================= */
let currentGameMode = 'sandbox'; // 'sandbox' | 'campaign'
let initialSandboxSnapshot = null; // Stores initial layout/params when sandbox starts

/**
 * Saves a snapshot of the initial state right after sandbox generation.
 */
function recordSandboxSnapshot() {
  if (!S) return;
  initialSandboxSnapshot = {
    nests: JSON.parse(JSON.stringify(S.nests)),
    forts: JSON.parse(JSON.stringify(S.forts)),
    humans: S.humans,
    settings: JSON.parse(JSON.stringify(S.settings))
  };
}

/**
 * Restarts the current session back to its original state.
 */
function restartGame() {
  if (currentGameMode === 'campaign' && typeof CURRENT_LEVEL !== 'undefined' && CURRENT_LEVEL) {
    // Campaign Level Restart: initGame uses CURRENT_LEVEL to reset map and stats
    initGame(false);
  } else {
    // Sandbox Restart: restore initial nest, forts, and parameters
    if (initialSandboxSnapshot) {
      S.nests = JSON.parse(JSON.stringify(initialSandboxSnapshot.nests));
      S.forts = JSON.parse(JSON.stringify(initialSandboxSnapshot.forts));

      // Make the restart path explicitly authoritative for fort resources and
      // demand bundles. The stored snapshot already carries the original
      // resource stock and desired level per fort; restoring them directly
      // here prevents any mid-session trade / edit drift from surviving the
      // restart call.
      const snapshotFortMap = new Map((initialSandboxSnapshot.forts || []).map(f => [f.id, f]));
      S.forts = S.forts.map(f => {
        const src = snapshotFortMap.get(f.id);
        if (!src) return f;
        return {
          ...f,
          resources: JSON.parse(JSON.stringify(src.resources || emptyResourceBundle())),
          desiredResources: JSON.parse(JSON.stringify(src.desiredResources || defaultDesiredResourceLevels()))
        };
      });

      initGame(true); // Keep recorded layout intact (nests + forts)
      render();
    } else {
      initGame(false);
    }
  }

  hideMenu();
  if (typeof closeGameOverOverlay === 'function') {
    closeGameOverOverlay();
  }
  log(t('log.restarted_session') || 'Relikvia reštartovaná do pôvodného stavu.');
}

/**
 * Starts or switches to Sandbox mode.
 */
function startSandboxMode() {
  currentGameMode = 'sandbox';
  CURRENT_LEVEL = null;
  
  // Re-initialize game & record starting snapshot
  initGame(false);
  recordSandboxSnapshot();
  
  hideMenu();
  const menuOverlay = document.getElementById('menuOverlay');
  if (menuOverlay) menuOverlay.classList.add('hidden');
}



// Fallback embed so it works offline/locally without requiring fetch if needed
async function loadTranslations() {
  try {
    const response = await fetch('texts.json');
    if (response.ok) {
      TRANSLATIONS = await response.json();
    }
  } catch (e) {
    console.warn('Could not load external texts.json, using fallback.', e);
  }
}

function preloadMenuBackground() {
  const image = new Image();
  const revealPage = () => {
    document.body.classList.remove('page-loading');
  };
  image.onload = revealPage;
  image.onerror = revealPage;
  image.src = '/nest/assets/menu.jpeg';
}

preloadMenuBackground();

// [moved to nest-core.js] function t(key, params = {}) { ... (10 lines)

/* ============================= STATE ============================= */
// [moved to nest-core.js] let S = null; ... (1 lines)
let chart = null;

// ---------------------------------------------------------------------------
// WORLD ASPECT RATIO
//
// The world/level coordinate space is a 0-100 x 0-100 grid, but the TERRITORY
// it represents is not square - it's WORLD_ASPECT_RATIO times wider than it
// is tall (like a real map of a wide region: 1 coordinate-unit east covers
// more real ground than 1 coordinate-unit north). This is a FIXED, baked-in
// constant, not measured live from the DOM - game logic (dist(), search/hunt
// ranges, fort strength falloff, etc.) must stay a pure function of world
// coordinates so it's deterministic and matches rl_loop.py's Python mirror,
// which has no access to CSS/browser layout at all. If this ever changes,
// #mapWrap's `aspect-ratio` in style.css must be updated to the same ratio -
// they're required to agree for the map to render without distortion or
// wasted margin.
// ---------------------------------------------------------------------------
// [moved to nest-core.js] const WORLD_ASPECT_RATIO = 2; // width:height - keep in sync with #map ... (7 lines)

// ---------------------------------------------------------------------------
// WORLD -> SCREEN CONVERSION
//
// Converts world coordinates to pixels using ONE uniform px-per-REAL-unit
// scale (accounting for WORLD_ASPECT_RATIO), letterboxing only if the actual
// container doesn't exactly match WORLD_ASPECT_RATIO (it should, via CSS,
// but this degrades gracefully instead of distorting if it doesn't - e.g. a
// very small viewport where min-height overrides the aspect-ratio).
// Every place that positions something on #mapWrap should go through this.
// ---------------------------------------------------------------------------

function getMapLetterbox(wrap) {
  const rect = wrap.getBoundingClientRect();
  const scale = Math.min(rect.width / WORLD_ASPECT_RATIO, rect.height) / 100; // px per REAL unit
  return {
    scale,
    offsetX: (rect.width - 100 * WORLD_ASPECT_RATIO * scale) / 2,
    offsetY: (rect.height - 100 * scale) / 2
  };
}

function worldToScreenPx(wrap, wx, wy) {
  const lb = getMapLetterbox(wrap);
  return {
    left: lb.offsetX + wx * WORLD_ASPECT_RATIO * lb.scale,
    top: lb.offsetY + wy * lb.scale,
    scale: lb.scale
  };
}

function setWorldPosition(el, wrap, wx, wy) {
  const p = worldToScreenPx(wrap, wx, wy);
  el.style.left = p.left + 'px';
  el.style.top = p.top + 'px';
}

function screenPxToWorld(wrap, clientX, clientY) {
  const rect = wrap.getBoundingClientRect();
  const lb = getMapLetterbox(wrap);
  return {
    x: (clientX - rect.left - lb.offsetX) / (WORLD_ASPECT_RATIO * lb.scale),
    y: (clientY - rect.top - lb.offsetY) / lb.scale
  };
}

let _mapResizeHandle = null;
window.addEventListener('resize', () => {
  // positions are now computed in px (not %), so they need to be recomputed
  // when the container size changes - re-run the map render, debounced.
  clearTimeout(_mapResizeHandle);
  _mapResizeHandle = setTimeout(() => {
    if (typeof S !== 'undefined' && S && typeof renderMap === 'function') renderMap();
  }, 100);
});

// #mapWrap's own box can still settle to a different size AFTER the first
// renderMap() call without any window 'resize' event ever firing - e.g. a
// web font swapping in, or the sidebar reflowing once the menu overlay
// hands off to the game screen - both typically only on the very first
// paint right after a page load/refresh. Since icon positions are baked to
// px at render time, that late settling left them stuck at the pre-layout
// position until some unrelated render happened to fix it, which looked
// like the nest/fort icons "snapping" into place a moment after pressing
// Start. A ResizeObserver catches any actual box-size change directly
// (first load included), the same way the window listener above does for
// window resizes.
function observeMapWrapResize() {
  const wrap = document.getElementById('mapWrap');
  if (!wrap || typeof ResizeObserver === 'undefined') return;
  let lastW = wrap.clientWidth;
  let lastH = wrap.clientHeight;
  const ro = new ResizeObserver(() => {
    if (wrap.clientWidth === lastW && wrap.clientHeight === lastH) return;
    lastW = wrap.clientWidth;
    lastH = wrap.clientHeight;
    clearTimeout(_mapResizeHandle);
    _mapResizeHandle = setTimeout(() => {
      if (typeof S !== 'undefined' && S && typeof renderMap === 'function') renderMap();
    }, 100);
  });
  ro.observe(wrap);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeMapWrapResize);
} else {
  observeMapWrapResize();
}



function openNestAnalytics() {
  openNestAnalyticsFor(S.focusedNestIndex || 0);
}

// Opens the analytics overlay scoped to a specific nest. This moves both
// S.focusedNestIndex (remembered across steps/renders - see advanceStepLogic,
// which resets S.activeNestIndex to it after each per-nest simulation pass)
// and S.activeNestIndex (so the S.food/S.queen/S.eggs/... accessor shim
// immediately reflects the chosen nest for renderNestAnalytics below).
function openNestAnalyticsFor(idx) {
  if (!S || !S.nests || !S.nests[idx]) return;
  S.focusedNestIndex = idx;
  S.activeNestIndex = idx;
  renderNestAnalytics();
  const el = document.getElementById('nestAnalyticsOverlay');
  const nestIdEl = document.getElementById('AnalNestId');
  if (nestIdEl) {
    nestIdEl.textContent = ` #${idx + 1}`; // Displays "Analytika hniezda #1"
  }
  if (el) el.classList.remove('hidden');
}

/* ============================= NEST ANALYTICS RENDERER ============================= */
function renderNestAnalytics() {
  const row = document.getElementById('stageRow');
  if (!row || !S) return;

  // 1. Render multi-nest selector buttons if selector container exists
  const selector = document.getElementById('nestAnalyticsSelector');
  if (selector) {
    selector.innerHTML = '';
    if (S.nests && S.nests.length > 1) {
      selector.classList.remove('hidden');
      S.nests.forEach((nest, idx) => {
        const btn = document.createElement('button');
        btn.className = 'nest-btn control-btn nest-selector-btn' +
          (idx === S.activeNestIndex ? ' active' : '') +
          (!nest.alive ? ' fallen' : '');
        btn.textContent = t('analytics.nest_label') !== 'analytics.nest_label'
          ? t('analytics.nest_label', { id: nest.id })
          : ('Hniezdo ' + nest.id);
        btn.disabled = idx === S.activeNestIndex;
        btn.onclick = () => openNestAnalyticsFor(idx);
        selector.appendChild(btn);
      });
    } else {
      selector.classList.add('hidden');
    }
  }

  // 2. Render structured stat groups into #stageRow (replacing renderStats)
  row.innerHTML = '';

  const groups = [
    {
      title: t('stats.core'),
      items: [
        { key: 'food', label: t('stats.food_storage'), count: S.food, cls: 'food' },
        { key: 'queenReserve', label: t('stats.queenReserve'), count: S.queenReserve, cls: 'food' },
        { key: 'queenState', label: t('stats.queen'), count: S.queen.alive ? t('stats.active') : t('stats.dead'), cls: S.queen.alive ? 'good' : 'bad' }
      ]
    },
    {
      title: t('stats.scouts'),
      items: [
        { key: 'scoutsTotal', label: t('stats.total'), count: scoutsTotal(), cls: 'main' },
        { key: 'scoutsAvailable', label: t('stats.available'), count: S.scoutsAvailable },
        { key: 'scoutsWorking', label: t('stats.working'), count: scoutsWorking() },
        { key: 'scoutsCooldown', label: t('stats.cooldown'), count: S.scoutsCooldown },
        { key: 'scoutsHidden', label: t('stats.hidden'), count: S.scoutsHidden }
      ]
    },
    {
      title: t('stats.predators'),
      items: [
        { key: 'predatorsTotal', label: t('stats.total'), count: predatorsTotal(), cls: 'main' },
        { key: 'predatorsAvailable', label: t('stats.available'), count: S.predatorsAvailable },
        { key: 'predatorsWorking', label: t('stats.working'), count: predatorsWorking() },
        { key: 'predatorsCooldown', label: t('stats.cooldown'), count: S.predatorsCooldown },
        { key: 'predatorsFortDuty', label: t('stats.fort_duty'), count: predatorsFortDuty() }
      ]
    },
    {
      title: t('stats.immatures'),
      items: [
        { key: 'eggs', label: t('stats.eggs'), count: sumCohort(S.eggs) },
        { key: 'larva', label: t('stats.larvae'), count: sumCohort(S.larva) },
        { key: 'cocoon', label: t('stats.cocoons'), count: sumCohort(S.cocoon) },
        { key: 'nymph', label: t('stats.nymphs'), count: sumCohort(S.nymph) }
      ]
    }
  ];

  groups.forEach(g => {
    const groupEl = document.createElement('div');
    groupEl.className = 'stat-group-row';

    const titleEl = document.createElement('span');
    titleEl.className = 'group-title';
    titleEl.textContent = g.title + ':';
    groupEl.appendChild(titleEl);

    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'chips-wrap';

    g.items.forEach(item => {
      const chip = document.createElement('div');
      chip.className = 'stage-chip ' + (item.cls || '');
      chip.dataset.statKey = item.key;
      chip.innerHTML = `<span class="chip-label">${item.label}</span> <span class="chip-val">${item.count}</span>`;
      chipsWrap.appendChild(chip);
    });

    groupEl.appendChild(chipsWrap);
    row.appendChild(groupEl);
  });

  // 3. Refresh chart if chart logic exists
  if (typeof updatePopulationChart === 'function') {
    updatePopulationChart();
  }
}

function closeNestAnalytics() {
  const el = document.getElementById('nestAnalyticsOverlay');
  if (el) el.classList.add('hidden');
}

document.getElementById('nestAnalyticsCloseX').onclick = closeNestAnalytics;
document.getElementById('nestAnalyticsOverlay').addEventListener('click', (ev) => {
  if (ev.target.id === 'nestAnalyticsOverlay') closeNestAnalytics();
});

// [moved to nest-core.js] function freshState(){ ... (64 lines)

/**
 * Extracts the initial population fields (scouts, predators, eggs, larva,
 * cocoon, nymph) from S in a plain, JSON-cloneable shape, suitable for
 * saving into an exported level file.
 */
function capturePopulationSnapshot() {
  if (!S) return null;
  return {
    food: S.food,
    queenReserve: S.queenReserve,
    scoutsAvailable: S.scoutsAvailable,
    scoutsHidden: S.scoutsHidden,
    scoutsCooldown: S.scoutsCooldown,
    predatorsAvailable: S.predatorsAvailable,
    predatorsCooldown: S.predatorsCooldown,
    eggs: JSON.parse(JSON.stringify(S.eggs || [])),
    larva: JSON.parse(JSON.stringify(S.larva || [])),
    cocoon: JSON.parse(JSON.stringify(S.cocoon || [])),
    nymph: JSON.parse(JSON.stringify(S.nymph || []))
  };
}

/**
 * Applies an (optional, partial) population object - as produced by
 * capturePopulationSnapshot() and stored in level JSON - onto the current
 * S. Any field left out of `pop` keeps whatever freshState() already put
 * there, so old level files without population data keep working unchanged.
 *
 * food/queenReserve are included here (rather than read from a settings
 * input) because they're only editable via the Nest Analytics "Edit
 * values" panel now — the Settings overlay no longer has its own
 * duplicate fields for them.
 */
function applyPopulationOverrides(pop) {
  if (!pop || !S || typeof pop !== 'object') return;
  if (pop.food != null) S.food = Math.max(0, Math.round(Number(pop.food)) || 0);
  if (pop.queenReserve != null) S.queenReserve = Math.max(0, Math.min(S.settings.queenFoodReserveCap, Math.round(Number(pop.queenReserve)) || 0));
  if (pop.scoutsAvailable != null) S.scoutsAvailable = Math.max(0, Math.round(Number(pop.scoutsAvailable)) || 0);
  if (pop.scoutsHidden != null) {
    S.scoutsHidden = Math.max(0, Math.round(Number(pop.scoutsHidden)) || 0);
    ensureHiddenScoutPositions(S.nest);
  }
  if (pop.scoutsCooldown != null) S.scoutsCooldown = Math.max(0, Math.round(Number(pop.scoutsCooldown)) || 0);
  if (pop.predatorsAvailable != null) S.predatorsAvailable = Math.max(0, Math.round(Number(pop.predatorsAvailable)) || 0);
  if (pop.predatorsCooldown != null) S.predatorsCooldown = Math.max(0, Math.round(Number(pop.predatorsCooldown)) || 0);
  if (Array.isArray(pop.eggs)) S.eggs = JSON.parse(JSON.stringify(pop.eggs));
  if (Array.isArray(pop.larva)) S.larva = JSON.parse(JSON.stringify(pop.larva));
  if (Array.isArray(pop.cocoon)) S.cocoon = JSON.parse(JSON.stringify(pop.cocoon));
  if (Array.isArray(pop.nymph)) S.nymph = JSON.parse(JSON.stringify(pop.nymph));
}

// Search events are placed in a ring around their nest: SEARCH_MIN_DIST_FROM_NEST
// ("just outside the nest") never changes, but the outer edge of the ring
// shrinks as the wild (outside-fort) human population grows - scouts don't
// need to range far when humans are everywhere. At/below
// SEARCH_LOW_HUMANS_THRESHOLD the ring reaches SEARCH_FAR_MAX_DIST, comfortably
// past the map's own diagonal so the real cap ends up being the map edges
// themselves. At/above SEARCH_HIGH_HUMANS_THRESHOLD the ring shrinks to
// SEARCH_NEAR_MAX_DIST, just past the inner edge. Distances are in the same
// aspect-ratio-corrected "real" units as dist().
// [moved to nest-core.js] const SEARCH_MIN_DIST_FROM_NEST = 20; // >= the general anti-overlap m ... (13 lines)

// [moved to nest-core.js] function assignEventCoords(e) { ... (81 lines)

function generateMapElements() {
  const MARGIN_X = 3;  // Left/Right side margin (x: 3 to 97)
  const MARGIN_Y = 10; // Top/Bottom edge margin (y: 10 to 90)
  const MIN_NEST_DIST = 18; // Minimum distance between a fort and a nest
  const MIN_FORT_DIST = 30; // Minimum distance between forts

  // 1. Generate nest positions within custom margins. Nests are also kept
  // apart from each other (MIN_NEST_DIST_FROM_OTHER_NEST) so rival colonies
  // don't start on top of one another.
  const nestCount = Math.max(1, S.settings.nestCount || DEFAULT_NEST_COUNT);
  const nestPositions = [];
  for (let i = 0; i < nestCount; i++) {
    let attempts = 0;
    let bestCand = null;
    let maxMinDist = -1;
    let placed = false;
    while (attempts < 3000) {
      attempts++;
      const cand = {
        x: Math.floor(MARGIN_X + Math.random() * (100 - 2 * MARGIN_X)),
        y: Math.floor(MARGIN_Y + Math.random() * (100 - 2 * MARGIN_Y))
      };
      let minDist = Infinity;
      for (const other of nestPositions) {
        const d = dist(cand, other);
        if (d < minDist) minDist = d;
      }
      if (minDist > maxMinDist) { maxMinDist = minDist; bestCand = cand; }
      if (minDist >= MIN_NEST_DIST_FROM_OTHER_NEST) { nestPositions.push(cand); placed = true; break; }
    }
    if (!placed) nestPositions.push(bestCand || { x: 25, y: 25 });
  }
  S.nests = nestPositions.map((p, i) => makeNestState(i + 1, p.x, p.y, S.settings));

  S.locationIcon = {
    x: 10,
    y: 10
  };

  const count = S.settings.fortLimit || 10;
  S.forts = [];

  for (let i = 0; i < count; i++) {
    let placed = false;
    let attempts = 0;
    let bestCand = null;
    let maxMinDist = -1;

    while (attempts < 3000) {
      attempts++;

      const population = Math.round(50 + Math.random() * 50);
      const cand = {
        id: i + 1,
        x: MARGIN_X + Math.random() * (100 - 2 * MARGIN_X),
        y: MARGIN_Y + Math.random() * (100 - 2 * MARGIN_Y),
        alive: true,
        defense: Math.floor(50 + Math.random() * 51),
        maxDefense: null,
        capacity: 100,
        population,
        resources: randomFortResourceLevels(),
        desiredResources: defaultDesiredResourceLevels(),
        production: emptyFortResourceCounters(),
        workers: emptyFortResourceCounters(), // real split computed once below, after this candidate is actually placed - see AUTO WORKER ALLOCATION
        autoWorkers: true, // on by default
        hybrids: 0, // real starting distribution computed once below, after every fort is placed - see distributeHybridsAcrossForts()
        marks: {}
      };

      cand.maxDefense = cand.defense;

      let valid = true;
      let minDistToAll = Infinity;

      // Distance check: Fort to every nest
      S.nests.forEach(nest => {
        const dNest = dist(cand, nest);
        if (dNest < minDistToAll) minDistToAll = dNest;
        if (dNest < MIN_NEST_DIST) valid = false;
      });

      // Distance check: Fort to other Forts
      for (const existing of S.forts) {
        const dFort = dist(cand, existing);
        if (dFort < minDistToAll) minDistToAll = dFort;
        if (dFort < MIN_FORT_DIST) valid = false;
      }

      if (minDistToAll > maxMinDist) {
        maxMinDist = minDistToAll;
        bestCand = cand;
      }

      if (valid) {
        S.forts.push(cand);
        placed = true;
        break;
      }
    }

    let finalFort = null;
    if (placed) {
      finalFort = S.forts[S.forts.length - 1]; // the cand just pushed above
    } else if (bestCand) {
      S.forts.push(bestCand);
      finalFort = bestCand;
    }
  }

  // Distribute starting hybrids first, then allocate initial AUTO workers
  // so their resource targets include hybrid upkeep.
  distributeHybridsAcrossForts(S.settings.startingHybrids || 0);

  S.forts.forEach(fort => {
    if (fort.alive && fort.autoWorkers) {
      autoAllocateFortWorkers(fort, { isInitial: true });
    }
  });
}

// [moved to nest-core.js] function getNearestAliveFortDistance(originLoc) { ... (11 lines)

// [moved to nest-core.js] const FORT_STRENGTH_DISTANCE_DIVISOR = 280; // tune this - overall fal ... (11 lines)

// [moved to nest-core.js] function getFortPredatorStrength(targetFort) { ... (5 lines)

/* ===== DEBUG: FORT STRENGTH ZONES (delete this block + its call in renderMap to remove) ===== */
function debugRenderFortStrengthZones(wrap) {
  if (!wrap || !S.nest) return;
  const lb = getMapLetterbox(wrap);
  if (!lb.scale) return;

  // sample the actual curve to find where strength really changes - stays correct no matter how the curve above is tuned
  const step = 0.25;
  let r1 = null, r2 = null;
  let prevStrength = getFortStrengthAtDistance(0);
  for (let d = step; d <= FORT_STRENGTH_DISTANCE_DIVISOR * 1.5; d += step) {
    const s = getFortStrengthAtDistance(d);
    if (prevStrength === 3 && s === 2 && r1 === null) r1 = d;
    if (prevStrength === 2 && s === 1 && r2 === null) r2 = d;
    prevStrength = s;
    if (r1 !== null && r2 !== null) break;
  }

  const zones = [];
  if (r1 !== null) zones.push({ radius: r1, color: '#ff8c00', label: '3\u21922' }); // 3 -> 2 boundary
  if (r2 !== null) zones.push({ radius: r2, color: '#ffd400', label: '2\u21921' }); // 2 -> 1 boundary

  zones.forEach(z => {
    const diameterPx = z.radius * 2 * lb.scale; // one uniform scale now that the map itself letterboxes correctly - a true circle, matching real dist()
    const ring = document.createElement('div');
    ring.style.position = 'absolute';
    setWorldPosition(ring, wrap, S.nest.x, S.nest.y);
    ring.style.width = diameterPx + 'px';
    ring.style.height = diameterPx + 'px';
    ring.style.transform = 'translate(-50%, -50%)';
    ring.style.border = '3px dashed ' + z.color;
    ring.style.borderRadius = '50%';
    ring.style.pointerEvents = 'none';
    ring.style.zIndex = '3';
    ring.title = 'strength boundary ' + z.label;
    wrap.appendChild(ring);
  });
}
/* ===== END DEBUG: FORT STRENGTH ZONES ===== */

// Share of predators (that reached the fort) killed in the assault, based on
// the ratio of total predator damage to fort defense: defense at 2x damage
// or more -> 90% die; damage at 2x defense or more -> 10% die; linear
// interpolation in between.
// [moved to nest-core.js] function conquestDeathPct(ratio){ ... (6 lines)

// [moved to nest-core.js] function searchChanceWithDistance(loc) { ... (24 lines)

// Baseline share of active searchers to route toward fort marking, purely
// from population scarcity - independent of naturalFailures, which gets
// added on top of this at the call site. Same scarcity-onset idea as
// searchChanceWithDistance's penalty above, but a different curve: it's 0
// at ratio 2 (humans still plentiful - no baseline pressure to go marking),
// ramps up steeply (quadratically) as the ratio falls from 2 toward 1, and
// plateaus at its max (50%) for ratio <= 1 rather than continuing to
// change - once humans are that scarce, marking is already at its top
// baseline priority and shouldn't need to go higher just because things
// get worse still (naturalFailures on top of it can still push the total
// demand further).
// [moved to nest-core.js] const MARK_BASELINE_ONSET_RATIO = 2; ... (10 lines)

// [moved to nest-core.js] function huntChanceWithDistance(loc) { ... (13 lines)

// [moved to nest-core.js] function pickTargetFort(distancePower = 6) { ... (30 lines)

// Marking demand is built up in advanceNestStepLogic from three parts
// (population-scarcity baseline + idle predators + last step's failed
// searches - see the comment at that call site for the full breakdown),
// then capped by this step's activeSearchers. This function itself just
// receives that already-capped markerCount and doesn't care where the
// number came from. Unlike pickTargetFort (used to actually launch an
// assault, which requires a fort to already be marked), this makes fresh
// marking attempts against every alive, unmarked, populated fort with an
// open ring slot - there's no readiness bar to clear to be eligible, but
// readiness does drive *priority*: among eligible forts, only the one(s)
// tied for the highest readiness get picked from (see the selection logic
// below), so the readiest fort is always marked first. A single call can
// still mark more than one fort if markerCount and open slots both allow it.
//
// Normally only one scout at a time will approach a given fort to mark it.
// But multiple scouts are allowed to converge on it at once - a swarm
// racing to confirm the same juicy target - up to MARKING_SWARM_SIZE, which
// applies to every fort regardless of readiness (see maxMarkingScoutsForFort).
// Like the predator icons that ring a fort during an assault, these scouts
// are positioned evenly around the fort instead of stacking on the same
// spot.
// [moved to nest-core.js] const MARKING_SWARM_SIZE = 4; // ring size for every fort ... (6 lines)

// True for a fort-marking scout that hasn't been revealed by scanForHidden()
// yet. Used everywhere a pending/resolved event is turned into a map icon or
// step-transition animation, so an un-scanned marking scout stays invisible
// for its whole (usually one-step) lifetime, all the way through resolution
// if it's never revealed at all.
function isHiddenFortMarkScout(e) {
  if (e.type !== 'search' || !e.fortMarkScout) return false;
  // Per-individual reveal state (see scoutSlots in maybeMarkFortsFromSearch,
  // nest-core.js): the wave counts as "hidden" only while every one of its
  // still-alive scouts is unrevealed. Falls back to the old aggregate flag
  // for any event that somehow lacks scoutSlots.
  if (Array.isArray(e.scoutSlots)) {
    return e.scoutSlots.length > 0 && e.scoutSlots.every(s => s.hidden);
  }
  return !!e.hidden;
}

// World position of one ring bucket around a fort - deterministic from the
// fort + bucket index alone, out of the ring's MARKING_RING_SIZE physical
// positions (independent of MARKING_SWARM_SIZE, the max scouts that can be
// in flight - several scouts' slot ids can map onto the same bucket, see
// callers below).
function markingScoutSlotPosition(fort, ringIndex) {
  const angle = (2 * Math.PI * ringIndex) / MARKING_RING_SIZE - Math.PI / 2;
  return {
    x: Math.max(3, Math.min(97, fort.x + (SCOUT_FORT_DISTANCE / WORLD_ASPECT_RATIO) * Math.cos(angle))),
    y: Math.max(3, Math.min(97, fort.y + SCOUT_FORT_DISTANCE * Math.sin(angle)))
  };
}

// Which of the ring's MARKING_RING_SIZE physical positions an individual
// scout's stable slot id occupies. Several slot ids share one bucket once
// there are more scouts in flight than ring positions - that's the whole
// point (see MARKING_RING_SIZE in nest-core.js): it's what caps the number
// of icons shown, instead of an icon per scout no matter how many.
function markingScoutRingBucket(slotIndex) {
  return slotIndex % MARKING_RING_SIZE;
}

// [moved to nest-core.js] function maybeMarkFortsFromSearch(markerCount) { ... (116 lines)

function normalizeLevelConditions(rawConditions) {
  if (!Array.isArray(rawConditions)) return [];
  return rawConditions.filter(Boolean).map((cond, index) => {
    const outcome = String(cond.outcome || 'victory').toLowerCase();
    const type = String(cond.type || 'fort_falls');
    const fortId = cond.fortId ?? cond.targetFortId ?? 'any';
    return {
      id: cond.id || `cond-${index + 1}`,
      outcome: outcome === 'defeat' ? 'defeat' : 'victory',
      fortId: fortId === 'any' || fortId === 'all' ? 'any' : Number(fortId),
      type,
      value: Number(cond.value ?? 0),
      active: cond.active !== false,
      label: cond.label || ''
    };
  });
}

function describeCondition(cond) {
  if (!cond || !cond.type) return 'Neznáma podmienka';
  const fortLabel = cond.fortId && cond.fortId !== 'any' ? `pevnosť ${cond.fortId}` : 'akákoľvek pevnosť';
  const value = Number(cond.value || 0);
  switch (cond.type) {
    case 'fort_falls':
      return cond.fortId && cond.fortId !== 'any' ? `Pevnosť ${cond.fortId} padne.` : 'Niektorá pevnosť padne.';
    case 'fort_defense_below':
      return `${fortLabel} má obranu nižšiu ako ${value}.`;
    case 'fort_attacked':
      return `${fortLabel} je napadnutá.`;
    case 'forts_fallen_over':
      return `Padne viac než ${value} pevností.`;
    case 'humans_killed_over':
      return `Počet zabitých ľudí presiahne ${value}.`;
    case 'humans_remaining_below':
      return `Počet ľudí klesne pod ${value}.`;
    case 'nest_collapses':
      return 'Hniezdo zanikne.';
    default:
      return cond.label || `Podmienka: ${cond.type}`;
  }
}

function summarizeConditions(conditions) {
  const entries = Array.isArray(conditions) ? conditions.filter(c => c && c.active !== false) : [];
  if (!entries.length) return '';
  return entries.map(cond => `${cond.outcome === 'victory' ? 'Víťazstvo' : 'Porážka'}: ${describeCondition(cond)}`).join(' • ');
}

// [moved to nest-core.js] function conditionMatchesFort(cond, fort) { ... (5 lines)

// [moved to nest-core.js] function evaluateCustomCondition(cond) { ... (28 lines)

// [moved to nest-core.js] function maybeTriggerConditionGameOver() { ... (12 lines)

/* ============================= HELPER UTILS ============================= */
// [moved to nest-core.js] function scoutsWorking(){ ... (19 lines)
// Cross-nest totals for the top-level phase banner (which reports on the
// whole battlefield, not just the focused/active nest). scoutsWorking() /
// predatorsWorking() above are intentionally scoped to S.nest (the active
// nest) since they back per-nest stat panels and per-nest game logic -
// these variants sum the same pending-event counts across every alive nest.
function scoutsWorkingAll(){
  return S.nests.reduce((total, nest) => {
    if (!nest.alive) return total;
    return total + S.events.filter(e=>e.type==='search' && e.status==='pending' && !e.fortMarkScout && !e._hideOnMap && e.nestId===nest.id).length;
  }, 0);
}
function predatorsWorkingAll(){
  return S.nests.reduce((total, nest) => {
    if (!nest.alive) return total;
    return total + S.events.filter(e=>e.type==='hunt' && e.status==='pending' && !e._hideOnMap && e.nestId===nest.id)
      .reduce((a,e)=>a + (e.groupSize - e.killed), 0);
  }, 0);
}
// [moved to nest-core.js] function scoutsTotal(){ return S.scoutsAvailable + scoutsWorking() + S ... (2 lines)

// [moved to nest-core.js] function sumCohort(arr){ return arr.reduce((a,c)=>a+c.count,0); } ... (10 lines)

// [moved to nest-core.js] function selectNextPendingEvent(){ ... (12 lines)

/* ============================= SETUP ============================= */
const SETTINGS_INPUT_IDS = [
  'groupSizeInput','foodPerHumanInput','startHumansInput',
  'maxPointsInput','eggsPerSearchInput','eggCapInput','eggsPerFoodInput',
  'searchBaseChanceInput','searchRatioScaleInput','huntBaseChanceInput','huntRatioScaleInput',
  'huntDeathRiskInput','searchDeathRiskInput','scoutBiasPerFailedSearchInput','fortLimitInput','defaultFortDefenseInput',
  'fortFoodLowInput','fortFoodHighInput','fortHumanLowInput','fortHumanHighInput',
  'fortDistLowInput','fortDistHighInput',
  'fortPredatorThresholdInput','fortAttackThresholdInput',
  'scoutMarkChanceInput','fortMarkThresholdInput','autoTradeToggleBtn',
  'costDistractScoutInput','costKillScoutInput','costEscapePredatorInput','costKillPredatorInput',
  'costKillFortAttackerInput',
  'costSaveHumansInput','saveHumansAmountInput','costScanInput',
  'costIncreaseFortCapacityInput','fortCapacityIncreaseAmountInput','queenFoodReserveCapInput',
  'minPopulationThresholdInput','fortReinforceCostInput','fortReinforceDefenseBonusInput'
];

// Reflects `enabled` into the auto-trade toggle button's visual state.
// A <button> doesn't carry a `.value` the way the other settings inputs
// do, so it's handled separately here rather than through the generic
// value-map helpers (applyDefaultsToInputs/applySettingsToInputs) below -
// initGame() reads it back the same way, off btn.dataset.enabled.
function setAutoTradeToggleUI(enabled) {
  const btn = document.getElementById('autoTradeToggleBtn');
  if (!btn) return;
  btn.dataset.enabled = enabled ? 'true' : 'false';
  btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  btn.textContent = enabled ? '✓' : '✗';
}

function initGame(keepMap = false){
  const existingNests = S ? S.nests : null;
  const existingForts = S ? S.forts : null;
  const existingLocationIcon = S ? S.locationIcon : null;

  const D = freshState();
  S = freshState();
  
  const g = id => {
    const el = document.getElementById(id);
    return el ? el.value : null;
  };

  // Starting food and starting queen reserve are no longer set via the
  // Settings (parametre) overlay — those fields duplicated the "Edit values"
  // panel in the Nest Analytics overlay (sandbox.js), which can set them at
  // any time while in sandbox mode. They're still respected when loading a
  // saved level that specifies them explicitly.
  const levelSettings = (typeof CURRENT_LEVEL !== 'undefined' && CURRENT_LEVEL && CURRENT_LEVEL.settings) ? CURRENT_LEVEL.settings : null;
  const levelFood = levelSettings ? (levelSettings.food ?? levelSettings.startFood) : undefined;

  S.settings.lang                 = g('langSelect') || D.settings.lang;
  S.settings.groupSize            = clampInt(g('groupSizeInput'), 1, 20, D.settings.groupSize);
  S.settings.foodPerHuman          = clampInt(g('foodPerHumanInput'), 1, 50, D.settings.foodPerHuman);
  S.humans                         = clampInt(g('startHumansInput'), 1, 5000, D.humans);
  const startFood                  = clampInt(levelFood, 0, 5000, D.food);
  S.settings.maxPoints             = clampInt(g('maxPointsInput'), 1, 50, D.settings.maxPoints);
  S.settings.eggsPerSearch         = clampFloat(g('eggsPerSearchInput'), 0, 20, D.settings.eggsPerSearch);
  S.settings.eggCap                = clampInt(g('eggCapInput'), 0, 500, D.settings.eggCap);
  S.settings.eggsPerFood           = clampInt(g('eggsPerFoodInput'), 0, 50, D.settings.eggsPerFood);
  S.settings.searchBaseChance      = clampFloat(g('searchBaseChanceInput'), 0, 90, D.settings.searchBaseChance*100) / 100;
  S.settings.searchRatioScale      = clampFloat(g('searchRatioScaleInput'), 0, 100, D.settings.searchRatioScale*100) / 100;
  S.settings.huntBaseChance        = clampFloat(g('huntBaseChanceInput'), 0, 90, D.settings.huntBaseChance*100) / 100;
  S.settings.huntRatioScale        = clampFloat(g('huntRatioScaleInput'), 0, 100, D.settings.huntRatioScale*100) / 100;
  S.settings.huntDeathRisk         = clampFloat(g('huntDeathRiskInput'), 0, 100, D.settings.huntDeathRisk*100) / 100;
  S.settings.searchDeathRisk       = clampFloat(g('searchDeathRiskInput'), 0, 100, D.settings.searchDeathRisk*100) / 100;
  S.settings.scoutBiasPerFailedSearch = clampFloat(g('scoutBiasPerFailedSearchInput'), 0, 5, D.settings.scoutBiasPerFailedSearch);
  S.settings.fortLimit             = clampInt(g('fortLimitInput'), 1, 30, D.settings.fortLimit);
  S.settings.defaultFortDefense    = clampInt(g('defaultFortDefenseInput'), 1, 1000, D.settings.defaultFortDefense);
  S.settings.fortFoodLow           = clampFloat(g('fortFoodLowInput'), 0, 20, D.settings.fortFoodLow);
  S.settings.fortFoodHigh          = clampFloat(g('fortFoodHighInput'), 0, 20, D.settings.fortFoodHigh);
  S.settings.fortHumanLow          = clampFloat(g('fortHumanLowInput'), 0, 20, D.settings.fortHumanLow);
  S.settings.fortHumanHigh         = clampFloat(g('fortHumanHighInput'), 0, 20, D.settings.fortHumanHigh);
  S.settings.fortDistLow           = clampFloat(g('fortDistLowInput'), 0, 150, D.settings.fortDistLow);
  S.settings.fortDistHigh          = clampFloat(g('fortDistHighInput'), 0, 150, D.settings.fortDistHigh);
  S.settings.fortPredatorThreshold = clampInt(g('fortPredatorThresholdInput'), 1, 500, D.settings.fortPredatorThreshold);
  S.settings.fortAttackThreshold   = clampFloat(g('fortAttackThresholdInput'), 0, 10, D.settings.fortAttackThreshold);
  S.settings.scoutMarkChance       = clampFloat(g('scoutMarkChanceInput'), 0, 100, D.settings.scoutMarkChance*100) / 100;
  S.settings.fortMarkThreshold     = clampFloat(g('fortMarkThresholdInput'), 0, 10, D.settings.fortMarkThreshold);
  const autoTradeBtn = document.getElementById('autoTradeToggleBtn');
  S.settings.autoTradeEnabled      = autoTradeBtn ? (autoTradeBtn.dataset.enabled === 'true') : D.settings.autoTradeEnabled;
  S.settings.costDistractScout     = clampInt(g('costDistractScoutInput'), 0, 50, D.settings.costDistractScout);
  S.settings.costKillScout         = clampInt(g('costKillScoutInput'), 0, 50, D.settings.costKillScout);
  S.settings.costEscapePredator    = clampInt(g('costEscapePredatorInput'), 0, 50, D.settings.costEscapePredator);
  S.settings.costKillPredator      = clampInt(g('costKillPredatorInput'), 0, 50, D.settings.costKillPredator);
  S.settings.costKillFortAttacker  = clampInt(g('costKillFortAttackerInput'), 0, 50, D.settings.costKillFortAttacker);
  S.settings.costSaveHumans        = clampInt(g('costSaveHumansInput'), 0, 50, D.settings.costSaveHumans);
  S.settings.saveHumansAmount      = clampInt(g('saveHumansAmountInput'), 0, 500, D.settings.saveHumansAmount);
  S.settings.costScan              = clampInt(g('costScanInput'), 0, 50, D.settings.costScan);
  S.settings.costIncreaseFortCapacity   = clampInt(g('costIncreaseFortCapacityInput'), 0, 50, D.settings.costIncreaseFortCapacity);
  S.settings.fortCapacityIncreaseAmount = clampInt(g('fortCapacityIncreaseAmountInput'), 0, 500, D.settings.fortCapacityIncreaseAmount);
  S.settings.queenFoodReserveCap        = clampInt(g('queenFoodReserveCapInput'), 0, 500, D.settings.queenFoodReserveCap);
  S.settings.startQueenReserve          = clampInt(levelSettings && levelSettings.startQueenReserve, 0, S.settings.queenFoodReserveCap, S.settings.queenFoodReserveCap);
  S.settings.minPopulationThreshold = clampInt(g('minPopulationThresholdInput'), 0, 1000, D.settings.minPopulationThreshold);
  S.settings.fortReinforceCost          = clampInt(g('fortReinforceCostInput'), 0, 50, D.settings.fortReinforceCost);
  S.settings.fortReinforceDefenseBonus  = clampInt(g('fortReinforceDefenseBonusInput'), 0, 500, D.settings.fortReinforceDefenseBonus);
  // Rival nest count - like fortLimit, configurable via an (optional)
  // nestCountInput element; falls back to a level's own settings.nestCount,
  // then to the default, if that input isn't present in the page.
  S.settings.nestCount = clampInt(g('nestCountInput'), 1, 12, (levelSettings && levelSettings.nestCount) || D.settings.nestCount);

  if (keepMap && existingNests && existingNests.length > 0 && existingForts && existingForts.length > 0) {
    S.nests = existingNests;
    S.forts = existingForts;
    S.locationIcon = existingLocationIcon || { x: 10, y: 10 };
  } else if (typeof CURRENT_LEVEL !== 'undefined' && CURRENT_LEVEL && (CURRENT_LEVEL.nests || CURRENT_LEVEL.nest)) {
    // Campaign level setup. Supports both the multi-nest `nests: [{x,y,...}]`
    // format and the legacy single `nest: {x,y}` format (auto-wrapped into
    // a single-entry nests array).
    currentGameMode = 'campaign';
    const levelNests = Array.isArray(CURRENT_LEVEL.nests) && CURRENT_LEVEL.nests.length > 0
      ? CURRENT_LEVEL.nests
      : [CURRENT_LEVEL.nest];
    S.nests = levelNests.map((n, i) => makeNestState(n.id ?? (i + 1), n.x, n.y, S.settings));
    const li = CURRENT_LEVEL.locationIcon || { x: 10, y: 10 };
    S.locationIcon = { x: li.x, y: li.y };
    // Captured BEFORE the .map() below, which caches resolved values (incl.
    // hybrids) back onto these same CURRENT_LEVEL.forts[i] objects - a level
    // that hand-places specific hybrid counts per fort keeps them exactly as
    // authored; only when NONE of them do does distributeHybridsAcrossForts()
    // get a say below.
    const anyLevelAuthoredHybrids = CURRENT_LEVEL.forts.some(f => f.hybrids != null);
    S.forts = CURRENT_LEVEL.forts.map(f => {
      const def = (f.defense != null) ? f.defense : S.settings.defaultFortDefense;
      const capacity = (f.capacity != null) ? f.capacity : 100;
      const population = (f.population != null) ? f.population : Math.round(50 + Math.random() * 50);
      const resources = f.resources || randomFortResourceLevels();
      const desiredResources = f.desiredResources || defaultDesiredResourceLevels();
      const production = f.production || emptyFortResourceCounters();
      const hadExplicitWorkers = f.workers != null; // a level authoring its own split wins over AUTO's default
      const workers = f.workers || emptyFortResourceCounters();
      const autoWorkers = (f.autoWorkers != null) ? f.autoWorkers : true; // on by default
      const hybrids = (f.hybrids != null) ? f.hybrids : 0; // real starting distribution computed once below, after every fort exists, unless the level authored its own per-fort counts

      const fort = { id: f.id, x: f.x, y: f.y, alive: true, defense: def, maxDefense: def, capacity, population, resources, desiredResources, production, workers, autoWorkers, hybrids, marks: {} };

      // Cache a PRISTINE, independently-cloned copy back onto
      // CURRENT_LEVEL.forts[i] - restartGame()'s campaign path just calls
      // initGame(false) again on this SAME level object (no re-fetch), so
      // without this, every restart would re-roll fresh resources/workers/
      // population via the `|| randomFn()` fallbacks above, instead of
      // staying consistent across restarts the way the sandbox restart path
      // already does (see restartGame()). Cloning (rather than caching the
      // same object the live fort below uses) matters: without it, live
      // gameplay mutating S.forts[i].resources would drift the cached copy
      // right along with it, and a later restart would "restart" back into
      // whatever the economy happened to look like when the player quit,
      // not the level's actual original starting values.
      f.resources = JSON.parse(JSON.stringify(fort.resources));
      f.desiredResources = JSON.parse(JSON.stringify(fort.desiredResources));
      f.production = JSON.parse(JSON.stringify(fort.production));
      f.workers = JSON.parse(JSON.stringify(fort.workers));
      f.autoWorkers = fort.autoWorkers;
      f.hybrids = fort.hybrids;
      if (f.population == null) f.population = population;

      return fort;
    });

    // Only steps in when the level didn't hand-place hybrids itself (see
    // anyLevelAuthoredHybrids above) - spreads CURRENT_LEVEL.startingHybrids
    // (falling back to S.settings.startingHybrids, then 0) across whichever
    // forts are best equipped to sustain them. Hybrids hired afterward go
    // straight to whichever fort the player picks instead - see hireAtFort().
    if (!anyLevelAuthoredHybrids) {
      distributeHybridsAcrossForts(CURRENT_LEVEL.startingHybrids ?? S.settings.startingHybrids ?? 0);
    }

    // Allocate AUTO workers only after starting hybrids are in place.
    // Explicit worker splits remain untouched.
    S.forts.forEach(fort => {
      if (
        fort.alive &&
        fort.autoWorkers &&
        !CURRENT_LEVEL.forts.find(f => f.id === fort.id)?.workers
      ) {
        autoAllocateFortWorkers(fort, { isInitial: true });
      }
    });

    // Default starting food/reserve for every nest, then let per-nest
    // population overrides win where a level specifies them explicitly.
    S.nests.forEach((n, i) => {
      S.activeNestIndex = i;
      S.food = startFood;
      S.queenReserve = S.settings.startQueenReserve;
    });
    // Per-nest population overrides (new format: level.nests[i].population),
    // falling back to the legacy single-nest level.population field applied
    // to the first nest only.
    levelNests.forEach((n, i) => {
      const pop = n.population || (i === 0 ? CURRENT_LEVEL.population : null);
      if (!pop) return;
      S.activeNestIndex = i;
      applyPopulationOverrides(pop);
    });
    S.activeNestIndex = 0;
    setMapBackground(CURRENT_LEVEL.background || null);
  } else {
    // Sandbox setup
    currentGameMode = 'sandbox';
    CURRENT_LEVEL = null;
    setMapBackground(null);
    generateMapElements();
    S.nests.forEach((n, i) => {
      S.activeNestIndex = i;
      S.food = startFood;
      S.queenReserve = S.settings.startQueenReserve;
    });
  }

  if (keepMap) {
    S.nests.forEach((n, i) => {
      S.activeNestIndex = i;
      S.food = startFood;
      S.queenReserve = S.settings.startQueenReserve;
    });
  }

  S.nests.forEach(ensureHiddenScoutPositions);

  S.activeNestIndex = 0;
  S.focusedNestIndex = 0;

  if (currentGameMode === 'sandbox') {
    recordSandboxSnapshot(); // Save initial snapshot (after nests/food are set)
  }

  if (currentGameMode === 'sandbox') {
    S.maxPoints = 999;
    S.points = 999;
  } else {
    S.maxPoints = S.settings.maxPoints;
    S.points = S.maxPoints;
  }

  if (CURRENT_LEVEL && Array.isArray(CURRENT_LEVEL.conditions)) {
    S.conditions = normalizeLevelConditions(CURRENT_LEVEL.conditions);
  } else if (currentGameMode === 'campaign' && Array.isArray(S.conditions) && S.conditions.length === 0 && CURRENT_LEVEL && Array.isArray(CURRENT_LEVEL.goals)) {
    S.conditions = normalizeLevelConditions(CURRENT_LEVEL.goals);
  } else if (!Array.isArray(S.conditions) || S.conditions.length === 0) {
    S.conditions = [];
  }

  S.history.push({step:0, humans:S.humans, insects: totalInsectsAll(), insectsByNest: insectsByNestSnapshot(), adultInsects: totalAdultInsectsAll(), adultInsectsByNest: adultInsectsByNestSnapshot()});
  {
    const insectsCount = totalInsectsAll();
    log(
      t('log.nest_stirs_insects', { insects: insectsCount }, insectsCount) +
      t('log.nest_stirs_humans', { humans: S.humans }, S.humans)
    );
  }
  document.getElementById('gameOverOverlay').classList.add('hidden');
  setSetupEnabled(currentGameMode === 'sandbox');
  // Campaign levels lock the rest of SETTINGS_INPUT_IDS above (they're
  // level-design parameters, fixed by whoever built the level) - but
  // auto-trade is a player preference, not a level parameter, so it should
  // stay adjustable in SETUP regardless of game mode. It only actually
  // needs to lock once the simulation is running - beginSimulation()'s own
  // setSetupEnabled(false) call already covers that correctly, since it
  // isn't conditioned on currentGameMode the way this one is.
  const autoTradeBtnEl = document.getElementById('autoTradeToggleBtn');
  if (autoTradeBtnEl) autoTradeBtnEl.disabled = false;
  ensureSandboxMode();
  render();
}

let sandboxScriptLoaded = false;
let sandboxScriptLoading = false;

function ensureSandboxMode() {
  const settingsBtnEl = document.getElementById('settingsBtn');
  const locBtn = document.getElementById('locationBtn');
  const sandboxControlsEl = document.getElementById('sandbox-controls');
  if (settingsBtnEl) settingsBtnEl.classList.toggle('hidden', currentGameMode !== 'sandbox');
  if (locBtn) locBtn.classList.toggle('hidden', currentGameMode !== 'sandbox');
  // Holds the sandbox-only add/remove nest + undo/redo buttons (built lazily
  // by sandbox.js) - keep it out of the DOM flow entirely in campaign mode.
  if (sandboxControlsEl) sandboxControlsEl.classList.toggle('hidden', currentGameMode !== 'sandbox');

  if (currentGameMode !== 'sandbox') {
    if (typeof window.sandboxSetUIVisible === 'function') window.sandboxSetUIVisible(false);
    return;
  }
  if (sandboxScriptLoaded) {
    if (typeof window.sandboxOnModeChanged === 'function') window.sandboxOnModeChanged();
    return;
  }
  if (sandboxScriptLoading) return; // Guard: prevents secondary injection while fetch is in-flight
  sandboxScriptLoading = true;

  const s = document.createElement('script');
  s.src = 'sandbox.js';
  s.onload = () => {
    sandboxScriptLoaded = true;
    sandboxScriptLoading = false;
    if (typeof window.sandboxInit === 'function') window.sandboxInit();
  };
  document.head.appendChild(s);
}

function applyDefaultsToInputs(){
  const d = freshState();
  const map = {
    langSelect: d.settings.lang,
    groupSizeInput: d.settings.groupSize,
    foodPerHumanInput: d.settings.foodPerHuman,
    startHumansInput: d.humans,
    maxPointsInput: d.settings.maxPoints,
    eggsPerSearchInput: d.settings.eggsPerSearch,
    eggCapInput: d.settings.eggCap,
    eggsPerFoodInput: d.settings.eggsPerFood,
    searchBaseChanceInput: Math.round(d.settings.searchBaseChance*100),
    searchRatioScaleInput: Math.round(d.settings.searchRatioScale*100),
    huntBaseChanceInput: Math.round(d.settings.huntBaseChance*100),
    huntRatioScaleInput: Math.round(d.settings.huntRatioScale*100),
    huntDeathRiskInput: Math.round(d.settings.huntDeathRisk*100),
    searchDeathRiskInput: Math.round(d.settings.searchDeathRisk*100),
    scoutBiasPerFailedSearchInput: d.settings.scoutBiasPerFailedSearch,
    fortLimitInput: d.settings.fortLimit,
    defaultFortDefenseInput: d.settings.defaultFortDefense,
    fortFoodLowInput: d.settings.fortFoodLow,
    fortFoodHighInput: d.settings.fortFoodHigh,
    fortHumanLowInput: d.settings.fortHumanLow,
    fortHumanHighInput: d.settings.fortHumanHigh,
    fortDistLowInput: d.settings.fortDistLow,
    fortDistHighInput: d.settings.fortDistHigh,
    fortPredatorThresholdInput: d.settings.fortPredatorThreshold,
    fortAttackThresholdInput: d.settings.fortAttackThreshold,
    scoutMarkChanceInput: Math.round(d.settings.scoutMarkChance*100),
    fortMarkThresholdInput: d.settings.fortMarkThreshold,
    costDistractScoutInput: d.settings.costDistractScout,
    costKillScoutInput: d.settings.costKillScout,
    costEscapePredatorInput: d.settings.costEscapePredator,
    costKillPredatorInput: d.settings.costKillPredator,
    costKillFortAttackerInput: d.settings.costKillFortAttacker,
    costSaveHumansInput: d.settings.costSaveHumans,
    saveHumansAmountInput: d.settings.saveHumansAmount,
    costScanInput: d.settings.costScan,
    costIncreaseFortCapacityInput: d.settings.costIncreaseFortCapacity,
    fortCapacityIncreaseAmountInput: d.settings.fortCapacityIncreaseAmount,
    queenFoodReserveCapInput: d.settings.queenFoodReserveCap,
    minPopulationThresholdInput: d.settings.minPopulationThreshold,
    fortReinforceCostInput: d.settings.fortReinforceCost,
    fortReinforceDefenseBonusInput: d.settings.fortReinforceDefenseBonus,
  };
  Object.keys(map).forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value = map[id];
  });
  setAutoTradeToggleUI(!!d.settings.autoTradeEnabled);
}

function clampInt(v,min,max,fallback){
  let n = parseInt(v,10);
  if(isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function clampFloat(v,min,max,fallback){
  let n = parseFloat(v);
  if(isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
// [moved to nest-core.js] function successChance(base, ratioScale, ratio){ ... (3 lines)
function setSetupEnabled(enabled){
  SETTINGS_INPUT_IDS.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.disabled = !enabled;
  });
  // Language is a player preference, not a level/gameplay parameter (same
  // reasoning as autoTradeToggleBtn below) - it should stay changeable
  // regardless of game mode or whether the simulation is already running,
  // so it's deliberately left out of SETTINGS_INPUT_IDS and force-enabled
  // here instead, covering every caller of this function in one place.
  const langSelectEl = document.getElementById('langSelect');
  if (langSelectEl) langSelectEl.disabled = false;
  const note = document.getElementById('settingsNote');
  if(note){
    note.textContent = enabled ? t('settings.note_enabled') : t('settings.note_disabled');
    note.classList.toggle('locked', !enabled);
  }
  if (typeof window.sandboxSetEditEnabled === 'function') window.sandboxSetEditEnabled(enabled);
}

function openSettings(){ document.getElementById('settingsOverlay').classList.remove('hidden'); }
function closeSettings(){ document.getElementById('settingsOverlay').classList.add('hidden'); }
document.getElementById('settingsBtn').onclick = openSettings;
document.getElementById('settingsCloseX').onclick = closeSettings;

document.getElementById('settingsDoneBtn').onclick = () => {
  initGame();
  closeSettings();
};

document.getElementById('settingsOverlay').addEventListener('click', (ev) => {
  if (ev.target.id === 'settingsOverlay') closeSettings();
});

function openOptions(){ document.getElementById('optionsOverlay').classList.remove('hidden'); }
function closeOptions(){ document.getElementById('optionsOverlay').classList.add('hidden'); }
document.getElementById('optionsCloseX').onclick = closeOptions;

document.getElementById('optionsOverlay').addEventListener('click', (ev) => {
  if (ev.target.id === 'optionsOverlay') closeOptions();
});

function openAbout(){ document.getElementById('aboutOverlay').classList.remove('hidden'); }
function closeAbout(){ document.getElementById('aboutOverlay').classList.add('hidden'); }
document.getElementById('aboutCloseX').onclick = closeAbout;

document.getElementById('aboutOverlay').addEventListener('click', (ev) => {
  if (ev.target.id === 'aboutOverlay') closeAbout();
});

function closeGameOverOverlay() {
  document.getElementById('gameOverOverlay').classList.add('hidden');
}

document.getElementById('gameOverCloseX').onclick = closeGameOverOverlay;
document.getElementById('gameOverOverlay').addEventListener('click', (ev) => {
  if (ev.target.id === 'gameOverOverlay') closeGameOverOverlay();
});

document.addEventListener('DOMContentLoaded', () => {
  // Main Intro Menu Buttons
  const mainCampaignBtn = document.querySelector('#menuOverlay #campaignBtn');
  const mainSandboxBtn = document.querySelector('#menuOverlay #sandboxBtn');
  const mainSettingsBtn = document.getElementById('menuSettingsBtn');
  const mainAboutBtn = document.getElementById('aboutBtn');

  if (mainCampaignBtn) mainCampaignBtn.onclick = runCampaign;
  if (mainSandboxBtn) mainSandboxBtn.onclick = startSandboxMode;
  if (mainSettingsBtn) mainSettingsBtn.onclick = openOptions;
  if (mainAboutBtn) mainAboutBtn.onclick = openAbout;

  // In-Game Menu Buttons
  const ingameRestartBtn = document.getElementById('ingameRestartBtn');
  const ingameCampaignBtn = document.getElementById('ingameCampaignBtn');
  const ingameSandboxBtn = document.getElementById('ingameSandboxBtn');
  const ingameSettingsBtn = document.getElementById('ingameSettingsBtn');
  const ingameAboutBtn = document.getElementById('ingameAboutBtn');
  const gameOverRestartBtn = document.getElementById('restartBtn');

  if (ingameRestartBtn) ingameRestartBtn.onclick = restartGame;
  if (gameOverRestartBtn) gameOverRestartBtn.onclick = restartGame;
  if (ingameCampaignBtn) ingameCampaignBtn.onclick = runCampaign;
  if (ingameSandboxBtn) ingameSandboxBtn.onclick = startSandboxMode;
  if (ingameSettingsBtn) ingameSettingsBtn.onclick = () => { hideMenu(); openOptions(); };
  if (ingameAboutBtn) ingameAboutBtn.onclick = () => { hideMenu(); openAbout(); };

  const merchantLimitInput = document.getElementById('merchantLimitInput');
  const merchantLimitUp = document.getElementById('merchantLimitUp');
  const merchantLimitDown = document.getElementById('merchantLimitDown');
  const clampMerchantLimit = (v) => Math.max(0, Math.min(99, Number.isFinite(v) ? v : 3));

  const syncMerchantLimit = (val) => {
    if (!S || !S.settings) return;
    const n = clampMerchantLimit(Number(val));
    S.settings.merchantLimit = n;
    if (merchantLimitInput) merchantLimitInput.value = String(n);
  };

  if (merchantLimitInput) {
    merchantLimitInput.min = '0';
    merchantLimitInput.max = '99';
    merchantLimitInput.addEventListener('change', () => syncMerchantLimit(merchantLimitInput.value));
    merchantLimitInput.addEventListener('input', () => syncMerchantLimit(merchantLimitInput.value));
  }

  if (merchantLimitUp) merchantLimitUp.onclick = () => syncMerchantLimit((parseInt(merchantLimitInput?.value || S?.settings?.merchantLimit || 3, 10) || 3) + 1);
  if (merchantLimitDown) merchantLimitDown.onclick = () => syncMerchantLimit((parseInt(merchantLimitInput?.value || S?.settings?.merchantLimit || 3, 10) || 3) - 1);

  const autoTradeToggleBtn = document.getElementById('autoTradeToggleBtn');
  if (autoTradeToggleBtn) autoTradeToggleBtn.onclick = () => setAutoTradeToggleUI(autoTradeToggleBtn.dataset.enabled !== 'true');
});

/* Event Detail Overlay Handlers */
function openEventDetails(eid){
  S.selectedEventId = eid;
  const overlay = document.getElementById('eventDetailOverlay');
  const container = document.getElementById('eventDetailContent');
  if(container) container.innerHTML = getEventDetailsHTML(eid);
  if(overlay) overlay.classList.remove('hidden');
}

function closeEventDetails(){
  document.getElementById('eventDetailOverlay').classList.add('hidden');
}
document.getElementById('eventDetailCloseX').onclick = closeEventDetails;
document.getElementById('eventDetailOverlay').addEventListener('click', (ev) => {
  if(ev.target.id === 'eventDetailOverlay') closeEventDetails();
});

document.getElementById('fortResourcesCloseX').onclick = closeFortResourcesOverlay;
document.getElementById('fortResourcesOverlay').addEventListener('click', (ev) => {
  if(ev.target.id === 'fortResourcesOverlay') closeFortResourcesOverlay();
});

initCustomTooltips();

function beginSimulation() {
  if (S.phase === 'active' || S.animating) return;

  // 1. Reset fort health and alive status so damaged forts start fresh at current locations
  if (S && S.forts) {
    S.forts.forEach(f => {
      f.alive = true;
      if (f.maxDefense) f.defense = f.maxDefense;
      else f.maxDefense = f.defense;
    });
  }

  // 2. Re-initialize state keeping current nest & fort positions (S.step = 0, fresh populations/AP)
  initGame(true);

  // 3. Update the sandbox starting snapshot to this newly set state
  if (typeof recordSandboxSnapshot === 'function') {
    recordSandboxSnapshot();
  }

  setSetupEnabled(false);
  S.phase = 'active';

  // Dispatch each alive nest's initial scouts separately (tagged with its
  // own nestId) and give each nest a chance to open a fort assault, the
  // same way advanceStepLogic() loops nest-by-nest for every later step.
  S.nests.forEach((nest, idx) => {
    if (!nest.alive) return;
    S.activeNestIndex = idx;
    const n = S.scoutsAvailable;
    S.scoutsAvailable = 0;
    for (let i = 0; i < n; i++) {
      const e = { id: nid(), type: 'search', status: 'pending', outcome: null, nestId: nest.id };
      assignEventCoords(e);
      S.events.push(e);
    }
    maybeTriggerFort();
  });
  S.activeNestIndex = S.focusedNestIndex || 0;

  S.step = 1;
  S.points = S.maxPoints;
  selectNextPendingEvent();

  const incoming = S.events.filter(
    e => e.status === 'pending' &&
        (e.type === 'search' || e.type === 'hunt' || e.type === 'fort') &&
        !isHiddenFortMarkScout(e)
  );

  // Normal incoming events are hidden while their movement animation runs.
  // Fort-marking scouts are an exception: they must remain visible.
  incoming.forEach(e => {
    if (!e.forceVisible) {
      e._hideOnMap = true;
    }
  });
  S.animating = true;

  render();
  runStepAnimation([], incoming, () => {
    incoming.forEach(e => delete e._hideOnMap);
    S.animating = false;
    render();
  });
}

let _lastPhaseLogSignature = null;

function postPhaseLog(txt) {
  const signature = S.phase + '|' + S.step + '|' + txt;
  if (signature === _lastPhaseLogSignature) return;
  _lastPhaseLogSignature = signature;
  log(txt);
}

function renderPhaseBanner() {
  const btn = document.getElementById('phaseBtn');
  const stopBtn = document.getElementById('stopSimBtn');

  if (stopBtn) stopBtn.classList.toggle('hidden', !(currentGameMode === 'sandbox' && S.phase === 'active' && !S.gameOver));

  let txt;

  if (S.gameOver) {
    txt = t('phase.simulation_ended');
    btn.textContent = t('phase.view_result');
    btn.disabled = false;
    btn.onclick = renderOverlay;
    postPhaseLog(txt);
    return;
  }

  if (S.phase === 'idle') {
    txt = t('phase.idle_text');
    btn.textContent = t('phase.begin_simulation');
    btn.disabled = false;
    btn.onclick = beginSimulation;
  } else if (S.phase === 'stopped') {
    txt = 'Simulácia zastavená. Aktuálne rozloženie je nastavené ako nový štartovací stav.';
    btn.textContent = t('phase.begin_simulation');
    btn.disabled = false;
    btn.onclick = beginSimulation;
  } else {
    const searching = scoutsWorkingAll();
    const hunting = predatorsWorkingAll();
    const fortPending = S.events.some(e => e.type === 'fort' && e.status === 'pending');
    const parts = [];
    if (searching > 0) parts.push(t('activity.searching', { count: searching }));
    if (hunting > 0) parts.push(t('activity.hunting', { count: hunting }));
    if (fortPending) parts.push(t('activity.fort'));

    const actStr = parts.length ? parts.join(', ') + '.' : t('phase.quiet_step');
    txt = t('phase.active_text', { step: S.step, activity: actStr });
    btn.textContent = S.animating ? t('phase.resolving') : t('phase.resolve_step');
    btn.disabled = !!S.animating;
    btn.onclick = advanceStep;
  }

  // Skip logging while the incoming events for this step are still
  // mid-animation (_hideOnMap): scoutsWorkingAll()/predatorsWorkingAll()
  // read as transiently low (or zero) until the fly-in finishes, which
  // would otherwise log a bogus "quiet step" line right before the real,
  // settled count a moment later.
  if (!S.animating) postPhaseLog(txt);
}

/**
 * Stops an in-progress simulation without resetting the map or resource counters:
 * - freezes S.phase so no more steps can be resolved
 * - clears insect population (scouts/predators/broods) and any pending map events/trails
 * - re-enables the settings panel and (in sandbox mode) dragging the nest/forts again,
 *   via the same setSetupEnabled() hook initGame() uses.
 */
function stopSimulation() {
  if (!S || S.phase !== 'active' || S.gameOver) return;

  S.phase = 'stopped';
  S.animating = false;

  // Clear insect population for every nest, not just the currently active
  // one - S.eggs/S.scoutsAvailable/... only reach the active nest via the
  // accessor shim, so this loops S.activeNestIndex across all of them.
  S.nests.forEach((nest, idx) => {
    S.activeNestIndex = idx;
    S.eggs = []; S.larva = []; S.cocoon = []; S.nymph = [];
    S.scoutsAvailable = 0; S.scoutsCooldown = 0; S.scoutsHidden = 0;
    S.predatorsAvailable = 0; S.predatorsCooldown = 0;
  });
  S.activeNestIndex = S.focusedNestIndex || 0;

  // Clear events, trails, and active selections
  S.events = [];
  S.trails = [];
  S.selectedEventId = null;

  setSetupEnabled(true); // Re-enables settings inputs & calls sandboxSetEditEnabled(true)
  log('Simulácia bola manuálne zastavená. Mapu je teraz možné znova upravovať.');
  render();
}

document.getElementById('stopSimBtn').onclick = stopSimulation;

function advanceStep(){
  if (S.gameOver || S.animating) return;
  S.animating = true;

  advanceStepLogic();

  if (S.gameOver) {
    S.animating = false;
    render();
    return;
  }

  maybeTriggerConditionGameOver();

  const outgoing = S.events.filter(e => e.status === 'resolved' && (e.type === 'search' || e.type === 'hunt' || e.type === 'fort') && !isHiddenFortMarkScout(e));
  const incoming = S.events.filter(e => e.status === 'pending' && (e.type === 'search' || e.type === 'hunt' || e.type === 'fort') && !isHiddenFortMarkScout(e));

  incoming.forEach(e => { e._hideOnMap = true; });
  render();

  waitForAnimationAssets().then(() => {
    runStepAnimation(outgoing, incoming, () => {
      incoming.forEach(e => { delete e._hideOnMap; });
      S.animating = false;
      render();
    });
  });
}

// [moved to nest-core.js] function ratioHumansPerInsect(){ ... (9 lines)

// Number of nests still in play. Fort-trigger thresholds below were tuned
// assuming a single nest could hoard the colony's whole predator/food
// growth; with more rivals splitting the same humans/food over time, each
// nest structurally ends up smaller, so those thresholds are scaled down
// per alive nest so attacks remain reachable as nestCount grows.
// [moved to nest-core.js] function aliveNestCount(){ ... (3 lines)

function minHuntersForFeeding(){
  const s = S.settings;
  // Hidden scouts aren't part of the fed population yet, so leave them out
  // of the feeder count (mirrors processLifecycle's feederGroups).
  const feeders = (scoutsTotal() - S.scoutsHidden) + predatorsTotal() + sumCohort(S.nymph);
  const queenCost = S.queen.alive ? 1 : 0;
  const deficit = Math.max(0, feeders + queenCost - S.food);
  return s.foodPerHuman > 0 ? Math.ceil(deficit / s.foodPerHuman) : 0;
}

// [moved to nest-core.js] function fortFactorPct(value, low, high){ ... (6 lines)

// [moved to nest-core.js] function fortReadiness(targetFort){ ... (34 lines)

// [moved to nest-core.js] function maybeTriggerFort() { ... (86 lines)

// [moved to nest-core.js] function removeProportionally(pools, totalToRemove){ ... (19 lines)

/* ============================= HUMAN POPULATION MOBILITY ============================= */
// Each step, some humans wander into or out of the area depending on how
// dangerous it felt last step: many insects per human -> people flee
// (mobility skews toward -5), many humans per insect -> people resettle
// (mobility skews toward +5). A second, independent factor adds extra flee
// pressure just from a large absolute insect population, regardless of the
// ratio - see humanMobilityPopulationBias(). This models migration in/out of
// the whole map, so it runs once per step rather than once per nest.
// [moved to nest-core.js] const HUMAN_MOBILITY_MIN = -5; ... (16 lines)

// The total insect count (all nests) recorded at the end of the previous
// step - or null before any step has run. Mirrors previousHumanInsectRatio().
// [moved to nest-core.js] function previousTotalInsects(){ ... (4 lines)

// Maps a humans:insects ratio to a bias in [-1, 1]: -1 is full "flee" skew
// (insects far outnumber humans, i.e. ratio <= HUMAN_MOBILITY_FLEE_RATIO),
// +1 is full "return" skew (humans far outnumber insects, ratio >=
// HUMAN_MOBILITY_RETURN_RATIO). Interpolated on a log scale between those
// two thresholds so ratios in between map smoothly onto intermediate bias.
// [moved to nest-core.js] function humanMobilityBias(ratio){ ... (9 lines)

// Maps the previous step's total insect count (all nests) to a bias in
// [-1, 0]: 0 means the population is small enough to add no extra flee
// pressure, -1 means it's at/above HUMAN_MOBILITY_POP_SATURATION and pushes
// migration weights toward full flee (-5) as hard as this factor allows.
// Unlike the ratio bias, sheer insect numbers only ever push people to
// leave - a huge nest is a threat on its own regardless of the human:insect
// ratio right now - so this never skews toward "return".
// [moved to nest-core.js] function humanMobilityPopulationBias(totalInsectsPrev){ ... (4 lines)

// Rolls a weighted-random integer in [HUMAN_MOBILITY_MIN, HUMAN_MOBILITY_MAX].
// Each candidate value v starts from a neutral weight of 1, then gets two
// independent additive contributions:
//  - the humans:insects ratio bias, worth up to HUMAN_MOBILITY_RATIO_MAX_WEIGHT
//  - the absolute insect-population bias, worth up to HUMAN_MOBILITY_POP_MAX_WEIGHT
//    (about half the ratio's cap), which only ever pushes toward -5 (flee)
// A contribution is positive when its bias and v agree in sign (pushing that
// value's weight up toward the cap), and negative when they disagree
// (pulling it down) - so ratioBias near -1 puts most weight on -5 (mass
// exodus), near +1 puts most weight on +5 (mass resettling), and a large
// populationBias further stacks extra weight onto -5 on top of whatever the
// ratio is doing. Weight is floored just above zero so no value ever hits
// exactly zero chance.
// [moved to nest-core.js] function rollHumanMobility(ratioBias, populationBias){ ... (20 lines)

// Picks the {base}_singular / {base}_few / {base}_many translation key for a
// head-count, following Slovak numeral agreement (1 = singular, 2-4 = "few"
// plural, 5+ = "many"/genitive plural). English just reuses the same string
// for _few and _many, so this works for both languages via the same keys.
// [moved to nest-core.js] function humanCountPluralKey(base, count){ ... (6 lines)

// Applies this step's population mobility to S.humans (never below 0), based
// on last step's human:insect ratio and total insect count. Stores the rolled
// value on S.humanMobility so it's available to UI/logging/save-state if
// needed, and logs it.
// [moved to nest-core.js] function applyHumanMobility(){ ... (15 lines)

// Runs one simulation step for every alive nest in turn (each drawing on the
// same shared S.humans/S.forts pool - this is how nests "compete" for
// humans), then does the shared end-of-step bookkeeping once.
// [moved to nest-core.js] function advanceStepLogic(){ ... (48 lines)

// Per-nest simulation step: search/hunt/fort-assault dispatch & resolution,
// brood lifecycle, and starvation - all scoped to the currently active nest
// (S.activeNestIndex, set by advanceStepLogic above) via the S.food/S.queen/
// S.eggs/... accessor properties. S.humans and S.forts are shared across
// every nest, which is what makes nests compete for the same humans.
// [moved to nest-core.js] function advanceNestStepLogic(nest){ ... (360 lines)


// [moved to nest-core.js] function processLifecycle(bonusEggs, pop, naturalFailures, successfulS ... (1143 lines)



// [moved to nest-core.js] function eatFromCohorts(n){ ... (12 lines)

// [moved to nest-core.js] function removeFromNymphCohorts(n){ ... (9 lines)

// [moved to nest-core.js] function removeFromRecoveryLarvaCohorts(n){ ... (10 lines)

// [moved to nest-core.js] function distributeDeaths(groups, unfed){ ... (21 lines)

/* ============================= PLAYER ACTIONS ============================= */
function findEvent(id){ return S.events.find(e=>e.id===id); }

// Rolls a combat/field action's chance of ALSO costing an extra 1 AP -
// "your soldier gets killed" doing it - on top of the action's normal AP
// cost. Uses rollSoldierLoss() (nest-core.js, shared with
// nest_defense_dqn.html) against the relevant apLossRisk* setting. The loss
// is permanent - it reduces S.maxPoints (the inverse of what hireAtFort()
// does), not just the current turn's S.points - since points reset to
// maxPoints every step and a same-turn-only deduction would be invisible by
// the next step. Floored at 1 so the player is never left with zero max AP.
// Never blocks or reverses the action itself; the normal cost is already
// spent by the time callers reach this.
//
// Every AP is a hybrid stationed at SOME fort (fort.hybrids - see
// distributeHybridsAcrossForts()/hireAtFort() in nest-core.js), so losing
// one here has to come off a fort's count too, not just the global total -
// otherwise sum(fort.hybrids) would silently drift away from S.maxPoints,
// and a fort destroyed later would deduct its (now stale, too-high) hybrid
// count on top of losses already reflected in maxPoints from here. Picked
// at random among alive forts that currently host at least one; if none do
// (shouldn't normally happen while maxPoints > 0, but a level could hand-
// author maxPoints without matching hybrids), maxPoints still drops - it's
// just not attributable to any specific fort.
function applySoldierLossRisk(probability){
  if (!rollSoldierLoss(probability)) return;
  S.maxPoints = Math.max(1, S.maxPoints - 1);
  S.points = Math.min(S.points, S.maxPoints);

  const hostForts = S.forts.filter(f => f.alive && (f.hybrids || 0) > 0);
  if (hostForts.length > 0) {
    const fort = hostForts[Math.floor(Math.random() * hostForts.length)];
    fort.hybrids -= 1;
  }

  log(t('log.soldier_lost') !== 'log.soldier_lost'
    ? t('log.soldier_lost')
    : 'Prišli sme o bojovníka - maximálne body akcie klesli o 1.');
}

function distractScout(eid){
  const e = findEvent(eid);

  if (e && e.fortMarkScout) return;

  const cost = S.settings.costDistractScout;
  if(!e || e.status!=='pending' || e.outcome || S.points<cost) return;
  
  S.points -= cost; 
  applySoldierLossRisk(S.settings.apLossRiskDistractScout);
  e.outcome='distracted';
  log(t('log.scout_distracted'));
  selectNextPendingEvent();
  render();
}

function killScout(eid){
  const e = findEvent(eid);

  if (e && e.fortMarkScout) { killMarkingScout(eid); return; }

  const cost = S.settings.costKillScout;
  if(!e || e.status!=='pending' || e.outcome || S.points<cost) return;
  
  S.points -= cost; 
  applySoldierLossRisk(S.settings.apLossRiskKillScout);
  e.outcome='killed';
  log(t('log.scout_killed'));
  selectNextPendingEvent();
  render();
}

// Kills one scout out of a marking-scout wave/group (see
// maybeMarkFortsFromSearch in nest-core.js). Same "pay AP, remove one unit"
// pattern as killPredatorAction/killFortAttacker: the group stays pending
// and selected so the player can click this repeatedly until it's empty.
function killMarkingScout(eid){
  const e = findEvent(eid);
  if(!e || !e.fortMarkScout || e.status!=='pending') return;

  const remaining = (e.groupSize || 1) - (e.killed || 0);
  if(remaining<=0) return;

  const cost = S.settings.costKillScout;
  if(S.points<cost) return;

  S.points -= cost;
  applySoldierLossRisk(S.settings.apLossRiskKillMarkingScout);
  e.killed = (e.killed || 0) + 1;

  // Drop one individual slot along with the kill - prefer a revealed one,
  // since that's the only kind the player could actually have clicked on
  // the map (a hidden slot has no icon to click). Falls back to any slot if
  // none are currently revealed (e.g. killed via the event-details panel).
  if (Array.isArray(e.scoutSlots) && e.scoutSlots.length > 0) {
    let idx = e.scoutSlots.findIndex(s => !s.hidden);
    if (idx === -1) idx = 0;
    e.scoutSlots.splice(idx, 1);
    e.hidden = isHiddenFortMarkScout(e);
  }

  log(t('log.scout_killed'));

  if((e.groupSize || 1) - e.killed <= 0){
    selectNextPendingEvent();
  }
  render();
}

function escapePredator(eid){
  const e = findEvent(eid);
  const cost = S.settings.costEscapePredator;
  if(!e || e.status!=='pending') return;
  if(e.neutralized+e.killed >= e.groupSize) return;
  if(e.routeHunt && (e.neutralized || 0) >= MERCHANT_PAIR_SIZE) return; // only 2 humans on a merchant run - both already safe
  if(S.points<cost) return;
  S.points -= cost; e.neutralized += 1;
  applySoldierLossRisk(S.settings.apLossRiskEscapeHunt);
  log(t('log.human_escaped'));
  if(e.neutralized+e.killed >= e.groupSize){
    selectNextPendingEvent();
  }
  render();
}

function killPredatorAction(eid){
  const e = findEvent(eid);
  const cost = S.settings.costKillPredator;
  if(!e || e.status!=='pending') return;
  if(e.neutralized+e.killed >= e.groupSize) return;
  if(S.points<cost) return;
  S.points -= cost; e.killed += 1;
  applySoldierLossRisk(S.settings.apLossRiskKillPredator);
  log(t('log.predator_killed'));
  if(e.neutralized+e.killed >= e.groupSize){
    selectNextPendingEvent();
  }
  render();
}

// Opens the nest analytics overlay for a nest the player clicked on the map.
// Unlike the free selector buttons inside the overlay itself (which just
// switch which already-open nest you're looking at), reaching the overlay
// FROM the map costs an action point - it represents actually scouting the
// rival nest, not idle bookkeeping.
function openNestAnalyticsAction(idx){
  if (S.gameOver) return;
  const cost = S.settings.costNestAnalytics;
  if (S.points < cost) return;
  S.points -= cost;
  openNestAnalyticsFor(idx);
  render();
}

// Figures out what the next "Attack Nest" click will actually hit and what
// it costs, following the priority order: predators (on cooldown, i.e.
// physically resting at the nest rather than out on a hunt) first, then
// nymphs (always at the nest - brood doesn't leave), then scouts (on
// cooldown), and only once every insect is gone does the queen herself
// become a target. Returns null once there's nothing left to attack.
function nestAttackTargetInfo(nest){
  if (!nest) return null;
  // Both *Cooldown (resting after a mission) and *Available (idle, ready
  // to deploy) insects are physically present at the nest right now - only
  // scoutsWorking()/predatorsWorking() are actually out in the field. Both
  // pools must be checked here, or idle-but-available insects get skipped
  // straight past to the nymphs/queen even though they're sitting right there.
  if (nest.predatorsCooldown > 0 || nest.predatorsAvailable > 0) return { type: 'predator', cost: S.settings.costAttackNestPredator };
  if (sumCohort(nest.nymph) > 0) return { type: 'nymph', cost: S.settings.costKillNymph };
  if (nest.scoutsCooldown > 0 || nest.scoutsAvailable > 0) return { type: 'scout', cost: S.settings.costAttackNestScout };
  if (nest.queen && nest.queen.alive) return { type: 'queen', cost: S.settings.costAttackQueen };
  return null;
}

// Slovak accusative labels for the "Attack Nest" button tooltip, keyed by
// nestAttackTargetInfo()'s target.type - "Zabiť <label>". Looked up via
// t('actions.target_<type>') so it's actually localized; the object below
// is only a fallback for while translations haven't loaded yet.
const NEST_ATTACK_TARGET_FALLBACK_LABELS = {
  predator: 'Predátorku',
  nymph: 'Nymfu',
  scout: 'Skautku',
  queen: 'Kráľovnú'
};
function nestAttackTargetLabel(type){
  const key = 'actions.target_' + type;
  const label = t(key);
  return label !== key ? label : (NEST_ATTACK_TARGET_FALLBACK_LABELS[type] || type);
}

// Strikes a single insect (or, as a last resort, the queen) directly at the
// nest, following the priority in nestAttackTargetInfo(). One click = one
// kill, same "pay AP, remove one target" pattern as killScout/
// killPredatorAction, just aimed at the nest's resting population instead
// of a pending field event.
function attackNest(nestId){
  if (S.gameOver) return;
  const nest = S.nests.find(n => n.id === nestId);
  if (!nest || !nest.alive) return;

  const target = nestAttackTargetInfo(nest);
  if (!target || S.points < target.cost) return;

  S.points -= target.cost;
  applySoldierLossRisk(S.settings.apLossRiskAttackNest);

  // Route through the S.food/S.queen/S.nymph/... accessor shim so the
  // existing cohort helpers (removeFromNymphCohorts) act on THIS nest,
  // regardless of which nest is currently "active" for the simulation.
  const prevActiveIndex = S.activeNestIndex;
  S.activeNestIndex = S.nests.indexOf(nest);

  if (target.type === 'predator') {
    // Kill from whichever pool the target check actually found - mirror its
    // priority so we never decrement an empty *Cooldown pool into negative
    // numbers when it was really an idle *Available predator that qualified.
    if (nest.predatorsCooldown > 0) {
      nest.predatorsCooldown -= 1;
    } else {
      nest.predatorsAvailable -= 1;
    }
    log(t('log.nest_predator_killed', { id: nest.id }) !== 'log.nest_predator_killed'
      ? t('log.nest_predator_killed', { id: nest.id })
      : `Predátor v hniezde ${nest.id} bol zabitý útokom na hniezdo.`);
  } else if (target.type === 'nymph') {
    removeFromNymphCohorts(1);
    log(t('log.nest_nymph_killed', { id: nest.id }) !== 'log.nest_nymph_killed'
      ? t('log.nest_nymph_killed', { id: nest.id })
      : `Nymfa v hniezde ${nest.id} bola zabitá útokom na hniezdo.`);
  } else if (target.type === 'scout') {
    if (nest.scoutsCooldown > 0) {
      nest.scoutsCooldown -= 1;
    } else {
      nest.scoutsAvailable -= 1;
    }
    log(t('log.nest_scout_killed', { id: nest.id }) !== 'log.nest_scout_killed'
      ? t('log.nest_scout_killed', { id: nest.id })
      : `Skaut v hniezde ${nest.id} bol zabitý útokom na hniezdo.`);
  } else if (target.type === 'queen') {
    nest.queen.alive = false;
    log(t('log.nest_queen_killed', { id: nest.id }) !== 'log.nest_queen_killed'
      ? t('log.nest_queen_killed', { id: nest.id })
      : `Kráľovná hniezda ${nest.id} bola zabitá útokom na hniezdo!`);
  }

  // Mirrors the collapse check advanceStepLogic() runs at the start of every
  // step, but applied immediately so a killing blow doesn't leave a visibly
  // dead nest lingering on the map until the next step.
  if (totalInsectsForNest(nest) <= 0) {
    nest.alive = false;
    log(t('log.rival_nest_collapsed', { id: nest.id }) !== 'log.rival_nest_collapsed'
      ? t('log.rival_nest_collapsed', { id: nest.id })
      : `Hniezdo ${nest.id} zaniklo.`);
  }

  S.activeNestIndex = prevActiveIndex;
  render();
}

function saveHumans(fortId){
  const cost = S.settings.costSaveHumans;
  if(S.phase!=='active' || S.gameOver) return;
  if(S.points<cost) return;
  if(S.humans<=0) return;
  const amount = Math.min(S.settings.saveHumansAmount, S.humans);

  const fort = S.forts.find(f => f.id === fortId);
  if (!fort || !fort.alive) return;

  const capacity = Math.max(0, fort.capacity || 0);
  const population = Math.max(0, Math.min(fort.population || 0, capacity));
  const av_capacity = Math.max(0, capacity - population);

  if (av_capacity < amount) {log(t('log.fort_capacity_limit')); render(); return } 
  fort.population += amount;
  S.points -= cost;
  S.humans -= amount;
  applySoldierLossRisk(S.settings.apLossRiskSaveHumans);

  log(t('log.humans_evacuated', { count: amount }));
  render();
}

// The scan action reveals scouts from a single combined "hidden" pool:
//  - fort-marking scouts already dispatched with a target/position, just
//    waiting to be unhidden in place (see isHiddenFortMarkScout)
//  - the generic S.scoutsHidden count, which has no mission yet and gets
//    dispatched as a fresh search event on reveal (as before)
// While both pools still have scouts left, each reveal is picked one at a
// time with a 70% chance of coming from the marking pool (it's the more
// useful/urgent intel - which fort, how many scouts). Once one pool runs
// out, the rest of the budget just drains the other - most notably, if the
// marking pool is empty from the start, the whole weighted pick is skipped
// and every reveal just comes from the generic pool.
const SCAN_REVEAL_MARK_SCOUT_CHANCE = 0.6;
const SCAN_NOTHING_MAX_PROBABILITY = 0.6;
const SCAN_NOTHING_ZERO_THRESHOLD = 15;

function scanNothingProbability(hiddenCount){
  if (hiddenCount >= SCAN_NOTHING_ZERO_THRESHOLD) return 0;
  return SCAN_NOTHING_MAX_PROBABILITY *
    (SCAN_NOTHING_ZERO_THRESHOLD - hiddenCount) /
    (SCAN_NOTHING_ZERO_THRESHOLD - 1);
}

function hiddenFortMarkScouts(nestId) {
  return S.events.filter(e => isHiddenFortMarkScout(e) && e.status === 'pending' && e.nestId === nestId);
}

let scanPlacementMode = false;

function hiddenScoutCountAllNests(){
  const generic = S.nests.reduce((total, nest) => total + Math.max(0, nest.scoutsHidden || 0), 0);
  const marking = S.events.reduce((total, e) => {
    if (e.type !== 'search' || !e.fortMarkScout || e.status !== 'pending') return total;
    if (Array.isArray(e.scoutSlots)) return total + e.scoutSlots.filter(s => s.hidden).length;
    return total + (e.hidden ? 1 : 0);
  }, 0);
  return generic + marking;
}

function scanForHidden(){
  if (scanPlacementMode) {
    scanPlacementMode = false;
    render();
    return;
  }
  if(S.phase!=='active' || S.gameOver) return;
  if(S.points<S.settings.costScan) return;

  scanPlacementMode = true;
  log('Kliknite na mapu a vyberte miesto skenovania.');
  render();
}

function scanAt(clientX, clientY){
  const wrap = document.getElementById('mapWrap');
  scanPlacementMode = false;
  if(!wrap || S.phase!=='active' || S.gameOver || S.points<S.settings.costScan){
    render();
    return;
  }

  const point = screenPxToWorld(wrap, clientX, clientY);
  const genericMatches = [];
  const markingMatches = [];

  S.nests.forEach(nest => {
    ensureHiddenScoutPositions(nest);
    nest.hiddenScoutPositions.forEach((position, index) => {
      if (dist(point, position) <= SCAN_REVEAL_RADIUS && Math.random() < REVEAL_CHANCE) {
        genericMatches.push({ nest, index, position });
      }
    });
  });

  S.events.forEach(event => {
    if (event.type !== 'search' || !event.fortMarkScout || event.status !== 'pending') return;
    if (!Array.isArray(event.scoutSlots)) return;
    const fort = S.forts.find(f => f.id === event.targetFortId);
    if (!fort) return;
    // Roll each still-hidden individual scout separately, against its own
    // fixed ring position - so a scan can reveal part of a wave without
    // revealing the rest, instead of one roll deciding the whole group.
    event.scoutSlots.forEach(slot => {
      if (!slot.hidden) return;
      const pos = markingScoutSlotPosition(fort, markingScoutRingBucket(slot.slot));
      if (dist(point, pos) <= SCAN_REVEAL_RADIUS && Math.random() < REVEAL_CHANCE) {
        markingMatches.push({ event, slot });
      }
    });
  });

  S.points -= S.settings.costScan;

  genericMatches.forEach(match => {
    const event = {
      id: nid(),
      type: 'search',
      status: 'pending',
      outcome: null,
      nestId: match.nest.id,
      x: match.position.x,
      y: match.position.y
    };
    S.events.push(event);
  });

  const indicesByNest = new Map();
  genericMatches.forEach(match => {
    if (!indicesByNest.has(match.nest)) indicesByNest.set(match.nest, []);
    indicesByNest.get(match.nest).push(match.index);
  });
  indicesByNest.forEach((indices, nest) => {
    [...indices].sort((a, b) => b - a).forEach(index => nest.hiddenScoutPositions.splice(index, 1));
    nest.scoutsHidden = Math.max(0, nest.scoutsHidden - indices.length);
  });

  const touchedMarkingEvents = new Set();
  markingMatches.forEach(match => {
    match.slot.hidden = false;
    touchedMarkingEvents.add(match.event);
  });
  // Keep the legacy aggregate flag in sync for anything that still reads it
  // directly (e.g. the sandbox "show all hidden" toggle's event filter).
  touchedMarkingEvents.forEach(event => { event.hidden = isHiddenFortMarkScout(event); });

  const totalRevealed = genericMatches.length + markingMatches.length;
  const remaining = hiddenScoutCountAllNests();
  log(t('log.scan_revealed', {
    count: totalRevealed,
    remaining,
    remainingWord: wordForm('adj.hidden_fem', remaining)
  }));
  render();
  showScanRipple(document.getElementById('mapWrap'), point);
}

function showScanRipple(wrap, point){
  const position = worldToScreenPx(wrap, point.x, point.y);
  const ripple = document.createElement('div');
  ripple.className = 'scan-ripple';
  ripple.style.left = position.left + 'px';
  ripple.style.top = position.top + 'px';
  ripple.style.setProperty('--scan-ripple-diameter', `${SCAN_REVEAL_RADIUS * 2 * position.scale}px`);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  wrap.appendChild(ripple);
}

// Hiring is free (no AP cost) but tied to a specific fort and capped by
// canSustainOneMoreHybrid() - a fort that couldn't afford one more hybrid's
// sustainHybrids() upkeep right now doesn't get to hire one, so the button
// itself is disabled in that case (see the per-fort controls in renderMap())
// rather than silently accepting a hire it can't keep. No per-step throttle
// any more - canSustainOneMoreHybrid() is what naturally limits how many
// hires a fort can support, not an arbitrary once-per-turn cap.
function hireAtFort(fortId){
  if (S.phase !== 'active' || S.gameOver) return;
  const fort = S.forts.find(f => f.id === fortId && f.alive);
  if (!fort) return;
  if (!canSustainOneMoreHybrid(fort)) return;

  fort.hybrids = (fort.hybrids || 0) + 1;
  S.maxPoints += 1;
  log(t('log.hybrid_hired'));
  render();
}

let fortPlacementMode = false;

function buildFort(){
  if(S.phase!=='active' || S.gameOver) return;

  if(fortPlacementMode){
    cancelFortPlacement();
    return;
  }

  if(S.points<BUILD_FORT_COST){
    log(t('log.build_fort_no_ap'));
    render();
    return;
  }

  fortPlacementMode = true;
  log(t('log.build_fort_place_prompt'));
  render();
}

function cancelFortPlacement(){
  if(!fortPlacementMode) return;
  fortPlacementMode = false;
  log(t('log.build_fort_cancelled'));
  render();
}

function placeFortAt(clientX, clientY){
  const wrap = document.getElementById('mapWrap');
  fortPlacementMode = false;

  if(!wrap || S.phase!=='active' || S.gameOver){
    render();
    return;
  }
  if(S.points<BUILD_FORT_COST){
    log(t('log.build_fort_no_ap'));
    render();
    return;
  }

  const world = screenPxToWorld(wrap, clientX, clientY);
  const x = Math.max(3, Math.min(97, world.x));
  const y = Math.max(3, Math.min(97, world.y));

  S.points -= BUILD_FORT_COST;

  const newId = S.forts.reduce((max, f) => Math.max(max, f.id), 0) + 1;
  const fort = {
    id: newId,
    x, y,
    alive: true,
    defense: BUILD_FORT_DEFENSE,
    maxDefense: BUILD_FORT_DEFENSE,
    capacity: BUILD_FORT_CAPACITY,
    population: 0,
    resources: emptyResourceBundle(), // freshly built - starts with nothing, unlike the random initial forts
    desiredResources: defaultDesiredResourceLevels(),
    production: emptyFortResourceCounters(),
    workers: emptyFortResourceCounters(), // no population yet either - nobody to assign
    autoWorkers: true, // on by default - starts assigning as soon as this fort gains population
    marked: false
  };

  S.forts.push(fort);
  log(t('log.fort_built', { id: fort.id, capacity: fort.capacity, defense: fort.defense }));
  render();
}

// ---------------------------------------------------------------------------
// CUSTOM ICON TOOLTIPS
//
// Native title="" tooltips can only ever render plain text. The AP cost
// badge on every action needs to show not just its own cost but also,
// folded in, any resource costs/requirements/loss-risk that action
// involves (see costTooltipItems() below) - as icons only, no words, since
// there also isn't room to show those as a separate row of badges next to
// the AP badge. This is a single shared floating element, positioned next
// to whatever element the pointer is over, built from a
// data-tooltip-items attribute (a base64-JSON {icon, value}[] list - see
// encodeTooltipItems()) set INSTEAD OF title, on either a createElement'd
// element or one built via an HTML string - a single delegated listener on
// document handles both, so neither costBadgeHTML() (raw HTML, inserted
// via innerHTML) nor buildCostBadgeEl() (a real DOM element) need their
// own hover wiring.
// ---------------------------------------------------------------------------
let _customTooltipEl = null;
let _customTooltipTarget = null;

function ensureCustomTooltipEl() {
  if (_customTooltipEl) return _customTooltipEl;
  const el = document.createElement('div');
  el.id = 'customTooltip';
  document.body.appendChild(el);
  _customTooltipEl = el;
  return el;
}

// Renders a data-tooltip-items payload (base64-JSON {icon, value, net?}[] -
// e.g. the AP cost badge's breakdown - see costTooltipItems()/
// buildFortPeekItems()) as the shared white/black #customTooltip shell. A
// divider is drawn after any item explicitly flagged dividerAfter
// (costTooltipItems uses this to separate its AP entry from the resources
// that follow it). By default every item flows in one row; the target
// element can instead opt into data-tooltip-stacked (one item per row,
// e.g. the fort marker's resource peek, so each resource's stock and net
// production sit together on their own line) - see the #customTooltip.
// stacked rules, style.css.
// A THIRD payload, data-tooltip-columns (base64-JSON {title, items}[] - see
// buildMerchantIcons()), renders side-by-side columns instead: each with a
// text header (the only place this tooltip ever shows words - see
// buildMerchantIcons()) followed by that same icon+value item styling,
// stacked one per row. Used for the merchant icon's per-fort trade
// breakdown, where a flat single-column list can't show which goods belong
// to which fort. Mutually exclusive with data-tooltip-items - an element
// is expected to carry only one of the two attributes.
function buildTooltipItemEl(item) {
  const entry = document.createElement('span');
  entry.className = 'tooltip-item';

  const img = document.createElement('img');
  img.src = item.icon;
  img.alt = item.alt || '';
  entry.appendChild(img);

  const val = document.createElement('span');
  val.className = 'tooltip-item-value' + (item.insufficient ? ' tooltip-item-value-insufficient' : '');
  val.textContent = item.value;
  entry.appendChild(val);

  if (item.net != null) {
    const net = document.createElement('span');
    net.className = 'tooltip-item-net' +
      (item.netPositive ? ' tooltip-item-net-positive' : item.netNegative ? ' tooltip-item-net-negative' : '');
    net.textContent = item.net;
    entry.appendChild(net);
  }

  return entry;
}

function showCustomTooltip(target, x, y) {
  const itemsRaw = target.getAttribute('data-tooltip-items');
  const columnsRaw = target.getAttribute('data-tooltip-columns');
  if (!itemsRaw && !columnsRaw) return;

  const el = ensureCustomTooltipEl();
  el.innerHTML = '';

  if (columnsRaw) {
    let columns;
    try {
      columns = decodeTooltipPayload(columnsRaw);
    } catch (err) {
      return; // malformed payload - fail silently rather than show a broken tooltip
    }
    if (!Array.isArray(columns) || columns.length === 0) return;

    el.classList.remove('stacked');
    el.classList.add('columns-mode');

    columns.forEach((col, i) => {
      if (i > 0) {
        const divider = document.createElement('span');
        divider.className = 'tooltip-divider';
        el.appendChild(divider);
      }

      const colEl = document.createElement('span');
      colEl.className = 'tooltip-column';

      const title = document.createElement('span');
      title.className = 'tooltip-column-title';
      title.textContent = col.title;
      colEl.appendChild(title);

      if (!col.items || col.items.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'tooltip-column-empty';
        empty.textContent = '\u2014';
        colEl.appendChild(empty);
      } else {
        col.items.forEach(item => colEl.appendChild(buildTooltipItemEl(item)));
      }

      el.appendChild(colEl);
    });

    el.classList.add('visible');
    _customTooltipTarget = target;
    positionCustomTooltip(x, y);
    return;
  }

  let items;
  try {
    items = decodeTooltipPayload(itemsRaw);
  } catch (err) {
    return; // malformed payload - fail silently rather than show a broken tooltip
  }
  if (!Array.isArray(items) || items.length === 0) return;

  el.classList.remove('columns-mode');
  el.classList.toggle('stacked', target.hasAttribute('data-tooltip-stacked'));

  items.forEach((item, i) => {
    if (i > 0 && items[i - 1].dividerAfter) {
      const divider = document.createElement('span');
      divider.className = 'tooltip-divider';
      el.appendChild(divider);
    }
    el.appendChild(buildTooltipItemEl(item));
  });

  el.classList.add('visible');
  _customTooltipTarget = target;
  positionCustomTooltip(x, y);
}

function hideCustomTooltip() {
  if (!_customTooltipEl) return;
  _customTooltipEl.classList.remove('visible');
  _customTooltipTarget = null;
}

// Follows the cursor, offset down-right, clamped so it never runs off the
// viewport edge (flips to the other side of the cursor instead).
function positionCustomTooltip(x, y) {
  const el = _customTooltipEl;
  if (!el || !el.classList.contains('visible')) return;

  const OFFSET = 14;
  const rect = el.getBoundingClientRect();
  let left = x + OFFSET;
  let top = y + OFFSET;

  if (left + rect.width > window.innerWidth) left = x - OFFSET - rect.width;
  if (top + rect.height > window.innerHeight) top = y - OFFSET - rect.height;

  el.style.left = Math.max(4, left) + 'px';
  el.style.top = Math.max(4, top) + 'px';
}

function initCustomTooltips() {
  document.addEventListener('mouseover', (ev) => {
    const el = ev.target.closest('[data-tooltip-items], [data-tooltip-columns]');
    if (el && el !== _customTooltipTarget) showCustomTooltip(el, ev.clientX, ev.clientY);
  });
  document.addEventListener('mousemove', (ev) => {
    if (_customTooltipTarget) positionCustomTooltip(ev.clientX, ev.clientY);
  });
  document.addEventListener('mouseout', (ev) => {
    if (_customTooltipTarget && ev.target.closest('[data-tooltip-items], [data-tooltip-columns]') === _customTooltipTarget) {
      const stillInside = ev.relatedTarget && _customTooltipTarget.contains(ev.relatedTarget);
      if (!stillInside) hideCustomTooltip();
    }
  });
  // A tooltipped element can be removed from the DOM (e.g. re-rendered)
  // while still hovered, which would otherwise leave a stale tooltip
  // floating with no way to dismiss it - render() runs constantly, so this
  // is cheap insurance rather than a real per-frame cost.
  document.addEventListener('scroll', hideCustomTooltip, true);
}

// Builds the ordered {icon, value}[] list shown by the AP cost badge's
// tooltip (see showCustomTooltip() above): the AP cost itself first,
// always, then - only if `costDef` (a FORT_ACTION_COSTS entry) is given -
// requirement (not consumed - see meetsFortActionRequirement()), and/or
// its `lossRisk` chance of losing one more unit of some resource. This
// used to be a separate row of visible badges next to the AP badge
// (resourceCostBadgesHTML/buildResourceCostBadgesEl) - there wasn't room
// for that, so it all lives in the tooltip now instead.
//
// showCustomTooltip() can flag (and color red) whichever ones this
// SPECIFIC fort can't actually afford right now - the same shortfall
// meetsFortActionRequirement() uses to disable the button itself, just
// surfaced per-resource instead of as one pass/fail. Left null for cost
// badges with no particular fort in mind (or nothing to check against
// yet), which just skips flagging anything as insufficient.
// Builds the {icon, alt, value, net}[] items for a fort marker's hover
// "peek" tooltip - same {icon, value} shape as the cost-badge tooltip
// (costTooltipItems()) plus a `net` field the cost tooltip never sets:
// this step's net production (estimateFortResourceNet(), nest-core.js -
// production minus the guaranteed recurring drains: population's own food
// upkeep, hybrids' ammo/fuel upkeep), signed and pre-formatted so the
// player can gauge a fort's trajectory at a glance without opening the
// full resources overlay. Applies the same rounding as the resources
// overlay's own stock display for visual consistency. A final HYBRIDS
// entry (AP's own icon, no net - see below) tags along after the six
// resource types. Read-only/display-only - never touches fort state.
function buildFortPeekItems(fort) {
  const items = FORT_RESOURCE_TYPES.map(type => {
    const net = estimateFortResourceNet(fort, type);
    return {
      icon: `/nest/assets/${RESOURCE_ICONS[type]}`,
      alt: resourceLabel(type),
      value: String(roundResource(fort.resources ? fort.resources[type] : 0)),
      net: (net > 0 ? '+' : '') + String(net),
      netPositive: net > 0,
      netNegative: net < 0
    };
  });

  // Hybrids aren't a resource type (no FORT_RESOURCE_TYPES entry, no
  // production/net concept) but still belong in the same at-a-glance peek -
  // reuses the AP badge's own icon (logo_icon.png) since hybrids, like AP,
  // don't have a dedicated resource icon of their own.
  items.push({
    icon: '../assets/logo_icon.png',
    alt: t('stats.hybrids'),
    value: String(fort.hybrids || 0)
  });

  return items;
}

function costTooltipItems(cost, costDef, fort) {
  // dividerAfter marks the AP entry as its own group, separate from
  // whatever resources follow - see showCustomTooltip()'s divider logic,
  // which only draws one where a payload actually asks for it (a plain
  // resource list, like the fort marker's peek, has no such split).
  const items = [{ icon: '../assets/logo_icon.png', value: String(cost), alt: 'AP', dividerAfter: true }];
  if (!costDef) return items;

  FORT_RESOURCE_TYPES.forEach(type => {
    const amount = costDef[type];
    if (!amount) return;
    const owned = (fort && fort.resources) ? (fort.resources[type] || 0) : null;
    items.push({
      icon: `/nest/assets/${RESOURCE_ICONS[type]}`,
      value: String(amount),
      alt: resourceLabel(type),
      insufficient: owned != null && owned < amount
    });
  });


  if (costDef.lossRisk) {
    const chancePct = Math.round(costDef.lossRisk.chance * 100);
    items.push({ icon: `/nest/assets/${RESOURCE_ICONS[costDef.lossRisk.type]}`, value: `${chancePct}%`, alt: resourceLabel(costDef.lossRisk.type) });
  }

  return items;
}

// Base64-encoding the items JSON (rather than interpolating it straight
// into an HTML attribute) sidesteps quote-escaping entirely: every value
// going in here is either a fixed asset path or a plain number/percent
// string, so there's never any non-ASCII content to worry about.
// btoa()/atob() only handle strings whose characters are all in the Latin-1
// range (0-255) - Slovak diacritics like č/š/ž/ď/ľ/ň/ť/ô fall outside that,
// so encoding tooltip payloads with plain btoa(JSON.stringify(...)) throws
// InvalidCharacterError the moment any of them show up (resource/fort
// labels, log text, etc.). Route through UTF-8 bytes first so any Unicode
// text round-trips safely.
function encodeTooltipItems(items) {
  const bytes = new TextEncoder().encode(JSON.stringify(items));
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function decodeTooltipPayload(raw) {
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function costBadgeHTML(cost, costDef, fort){
  const iconSrc = '../assets/logo_icon.png';
  const items = encodeTooltipItems(costTooltipItems(cost, costDef, fort));
  return `<span class="btn-cost" data-tooltip-items="${items}"><span class="btn-cost-val"><strong>${cost}</strong></span><img src="${iconSrc}" alt="ap-icon" class="ap-icon"></span>`;
}

function buildCostBadgeEl(cost, costDef, fort){
  const span = document.createElement('span');
  span.className = 'btn-cost';
  span.setAttribute('data-tooltip-items', encodeTooltipItems(costTooltipItems(cost, costDef, fort)));
  const val = document.createElement('span');
  val.className = 'btn-cost-val';
  val.textContent = cost;
  const icon = document.createElement('img');
  icon.src = '../assets/logo_icon.png';
  icon.alt = 'ap-icon';
  icon.className = 'ap-icon';
  span.appendChild(val);
  span.appendChild(icon);
  return span;
}

// Wraps a control button together with its AP cost badge using the same
// layout as the hire/scan/build-fort buttons: cost shown above the button
// rather than inside it. `resourceCostDef` (an optional FORT_ACTION_COSTS
// entry) folds into that same badge's tooltip - see costTooltipItems() -
// rather than a separate row of badges; there wasn't room for one. `fort`,
// if given, lets that tooltip flag any resource in `resourceCostDef` this
// particular fort can't currently afford (see costTooltipItems()) - pass
// the fort the button acts on whenever resourceCostDef is a real cost, so
// the two stay in sync with each other.
function wrapButtonWithCostAbove(button, cost, alignRight = false, resourceCostDef = null, fort = null){
  const container = document.createElement('div');
  container.className = 'btn-container';

  const costHolder = document.createElement('div');
  costHolder.appendChild(buildCostBadgeEl(cost, resourceCostDef, fort));

  // Keep the cost badge aligned with the action below it
  if (alignRight) {
    costHolder.style.display = 'flex';
    costHolder.style.justifyContent = 'center';
  }

  container.appendChild(costHolder);

  // Right-align the kill image without changing its size
  if (alignRight) {
    button.style.display = 'block';
    button.style.marginLeft = 'auto';
    button.style.marginRight = '6px';
  }

  container.appendChild(button);

  return container;
}

function killFortAttacker(eid){
  const e = findEvent(eid);
  if(!e || e.type!=='fort' || e.status!=='pending') return;
  const remaining = e.originalAttackers - e.killed;
  if(remaining<=0) return;
  const cost = S.settings.costKillFortAttacker;
  if(S.points<cost) return;
  S.points -= cost;
  e.killed += 1;
  applySoldierLossRisk(S.settings.apLossRiskDefendFort);
  const targetFort = S.forts.find(f => f.id === e.targetFortId);
  if (targetFort) applyFortActionCost(targetFort, FORT_ACTION_COSTS.fortDefense);
  log(t('log.fort_attacker_killed', { id: e.targetFortId }));
  if(e.originalAttackers - e.killed <= 0){
    selectNextPendingEvent();
  }
  render();
}

/* ============================= RENDER ============================= */
function selectEvent(id){
  S.selectedEventId = id;
  render();
}

function render(){
  document.getElementById('stepVal').textContent = String(S.step).padStart(3,'0');
  document.getElementById('humansVal').textContent = S.humans;

  const killedEl = document.getElementById('humansKilledVal');
  if(killedEl) killedEl.textContent = S.humansKilled;

  document.getElementById('insectsVal').textContent = totalAdultInsectsAll();
  document.getElementById('pointsVal').textContent = S.points;
  document.getElementById('maxPointsVal').textContent = S.maxPoints;


  const aliveForts = S.forts.filter(f => f.alive);
  const activeFortEvent = S.events.find(e => e.type === 'fort' && e.status === 'pending');
  const targetFort = activeFortEvent ? S.forts.find(f => f.id === activeFortEvent.targetFortId) : null;



  renderPhaseBanner();
  renderGlobalActions();
  renderQueue();
  renderMap();
  renderLog();
  renderChart();
  renderOverlay();
  refreshFortResourcesOverlay();
}


function renderGlobalActions(){
  const scanBtn = document.getElementById('scan-btn');
  if(scanBtn){
    const costLbl = document.getElementById('scanCostLbl');
    if(costLbl) costLbl.textContent = S.settings.costScan;
    scanBtn.disabled = S.gameOver || S.phase!=='active' || S.points<S.settings.costScan;
    scanBtn.classList.toggle('placing', scanPlacementMode);
    scanBtn.title = scanPlacementMode
      ? 'Kliknite na mapu a vyberte miesto skenovania.'
      : 'Skenovať skryté skautky v označenej oblasti.';
  }

  // The old global "Hire" button/DOM sync lived here - hiring is now a
  // per-fort action button built inside each fort's own controls (see
  // renderMap()'s fort-panel button block, next to reinforce/capacity/
  // evacuate/scavenge), so there's nothing to sync at the header level
  // anymore. See hireAtFort().

  const buildFortBtn = document.getElementById('build-fort-btn');
  if(buildFortBtn){
    const costLbl = document.getElementById('buildFortCostLbl');
    if(costLbl) costLbl.textContent = BUILD_FORT_COST;
    buildFortBtn.disabled = S.gameOver || S.phase!=='active' || (S.points<BUILD_FORT_COST && !fortPlacementMode);
    buildFortBtn.classList.toggle('placing', fortPlacementMode);
    buildFortBtn.title = fortPlacementMode ? t('map.build_fort_placing_tooltip') : t('map.build_fort_tooltip');
  }
}

function renderQueue(){
  const list = document.getElementById('queueList');
  const tag = document.getElementById('queueTag');
  if(!list || !tag) return;
  list.innerHTML = '';
  if(S.events.length===0){
    const li = document.createElement('li');
    li.className = 'empty-note';
    li.textContent = S.step===0 ? t('ui.no_transmissions') : t('ui.no_active_events');
    list.appendChild(li);
    tag.textContent = t('ui.pending_count', { count: 0 });
    return;
  }
  const pendingCount = S.events.filter(e => {
    if(e.status !== 'pending') return false;
    if(e.type === 'search' && e.outcome) return false;
    return true;
  }).length;
  tag.textContent = t('ui.pending_count', { count: pendingCount });

  const ordered = [...S.events].sort((a,b)=>{
    const aFailed = (a.type==='search' && (a.outcome==='distracted'||a.outcome==='killed'||a.outcome==='failed')) || a.status==='resolved';
    const bFailed = (b.type==='search' && (b.outcome==='distracted'||b.outcome==='killed'||b.outcome==='failed')) || b.status==='resolved';
    
    if (aFailed !== bFailed) {
      return aFailed ? 1 : -1;
    }
    return a.id - b.id;
  });

  ordered.forEach(e=>{
    const isFailedSearch = e.type==='search' && (e.outcome==='distracted' || e.outcome==='killed' || e.outcome==='failed');
    const li = document.createElement('li');
    
    let classes = [];
    if (e.status === 'resolved') classes.push('resolved');
    if (isFailedSearch) classes.push('failed-search');
    if (e.id === S.selectedEventId) classes.push('selected');
    
    li.className = classes.join(' ');
    li.onclick = ()=>selectEvent(e.id);

    const eventDescription = e.type==='search'
      ? t(e.routeSearch ? 'event.route_search_title' : 'event.search_title')
      : (e.type==='hunt'
        ? t(e.routeHunt ? 'event.route_hunt_title' : 'event.hunt_title')
        : t('event.fort_title', { id: e.targetFortId }));

    li.title = eventDescription;

    const badge = document.createElement('span');
    // 'route' modifier class alongside the base type class gives a CSS hook
    // to style merchant-route search/hunt badges distinctly (e.g. a
    // different accent color) without touching the normal search/hunt look.
    badge.className = 'badge ' + e.type + (e.routeSearch || e.routeHunt ? ' route' : '');
    badge.textContent = e.type==='search'
      ? t(e.routeSearch ? 'badge.route_search' : 'badge.search')
      : (e.type==='hunt' ? t(e.routeHunt ? 'badge.route_hunt' : 'badge.hunt') : t('badge.fort'));

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'q-actions';

    if (e.status === 'pending') {
      if (e.type === 'search' && e.fortMarkScout) {
        const remaining = (e.groupSize || 1) - (e.killed || 0);
        if (remaining > 0) {
          const killBtn = document.createElement('button');
          killBtn.className = 'act-mini danger';
          killBtn.textContent = t('actions.kill');
          killBtn.title = t('actions.kill_scout_tooltip', { cost: S.settings.costKillScout });
          killBtn.disabled = S.points < S.settings.costKillScout;
          killBtn.onclick = (ev) => { ev.stopPropagation(); killMarkingScout(e.id); };

          actionsWrap.appendChild(killBtn);
        }

      } else if (e.type === 'search' && !e.outcome) {
        const distractBtn = document.createElement('button');
        distractBtn.className = 'act-mini';
        distractBtn.textContent = t('actions.distract');
        distractBtn.title = t('actions.distract_tooltip', { cost: S.settings.costDistractScout });
        distractBtn.disabled = S.points < S.settings.costDistractScout;
        distractBtn.onclick = (ev) => { ev.stopPropagation(); distractScout(e.id); };

        const killBtn = document.createElement('button');
        killBtn.className = 'act-mini danger';
        killBtn.textContent = t('actions.kill');
        killBtn.title = t('actions.kill_scout_tooltip', { cost: S.settings.costKillScout });
        killBtn.disabled = S.points < S.settings.costKillScout;
        killBtn.onclick = (ev) => { ev.stopPropagation(); killScout(e.id); };

        actionsWrap.appendChild(distractBtn);
        actionsWrap.appendChild(killBtn);

      } else if (e.type === 'hunt') {
        const active = e.groupSize - (e.neutralized + e.killed);
        if (active > 0) {
          const humansAlreadySaved = e.routeHunt && (e.neutralized || 0) >= MERCHANT_PAIR_SIZE;

          const rescueBtn = document.createElement('button');
          rescueBtn.className = 'act-mini';
          rescueBtn.textContent = t('actions.rescue');
          rescueBtn.title = humansAlreadySaved
            ? (t('actions.rescue_all_saved_tooltip') !== 'actions.rescue_all_saved_tooltip'
                ? t('actions.rescue_all_saved_tooltip')
                : 'Obaja ľudia z tejto karavány sú už v bezpečí.')
            : t('actions.rescue_tooltip', { cost: S.settings.costEscapePredator });
          rescueBtn.disabled = S.points < S.settings.costEscapePredator || humansAlreadySaved;
          rescueBtn.onclick = (ev) => { ev.stopPropagation(); escapePredator(e.id); };

          const killBtn = document.createElement('button');
          killBtn.className = 'act-mini danger';
          killBtn.textContent = t('actions.kill');
          killBtn.title = t('actions.kill_predator_tooltip', { cost: S.settings.costKillPredator });
          killBtn.disabled = S.points < S.settings.costKillPredator;
          killBtn.onclick = (ev) => { ev.stopPropagation(); killPredatorAction(e.id); };

          actionsWrap.appendChild(rescueBtn);
          actionsWrap.appendChild(killBtn);
        }
      } else if (e.type === 'fort') {
        const remaining = e.originalAttackers - e.killed;
        if (remaining > 0) {
          const defendBtn = document.createElement('button');
          defendBtn.className = 'act-mini danger';
          defendBtn.textContent = t('actions.defend');
          defendBtn.title = t('actions.defend_fort_tooltip', { id: e.targetFortId, cost: S.settings.costKillFortAttacker });
          defendBtn.disabled = S.points < S.settings.costKillFortAttacker;
          defendBtn.onclick = (ev) => { ev.stopPropagation(); killFortAttacker(e.id); };

          actionsWrap.appendChild(defendBtn);
        }
      }
    }

    const status = document.createElement('span');
    status.className = 'q-status';
    if(e.status==='pending' && !isFailedSearch){
      status.textContent = t('status.pending');
    } else if(e.type==='search'){
      if(e.outcome==='distracted'){ status.textContent=t('status.distracted'); status.classList.add('good'); }
      else if(e.outcome==='killed'){ status.textContent=t('status.scout_killed'); status.classList.add('good'); }
      else if(e.outcome==='failed'){ status.textContent=t('status.found_nothing'); status.classList.add('good'); }
      else if(e.outcome==='route_marked'){ status.textContent=t('status.route_marked'); status.classList.add('bad'); }
      else { status.textContent=t('status.succeeded'); status.classList.add('bad'); }
    } else if(e.type==='hunt'){
      const stopped = e.neutralized+e.killed;
      status.textContent = stopped>=e.groupSize ? t('status.fully_stopped') : (stopped>0 ? t('status.partially_stopped', { stopped, total: e.groupSize }) : t('status.resolved'));
      status.classList.add(stopped>=e.groupSize ? 'good' : (stopped>0?'good':'bad'));
    } else {
      if(e.outcome==='defended'){ status.textContent=t('status.defended'); status.classList.add('good'); }
      else { status.textContent=t('status.fort_conquered'); status.classList.add('bad'); }
    }

    const infoBtn = document.createElement('button');
    infoBtn.className = 'q-info-btn';
    infoBtn.textContent = 'i';
    infoBtn.title = t('ui.view_details');
    infoBtn.onclick = (ev) => {
      ev.stopPropagation();
      openEventDetails(e.id);
    };

    li.appendChild(badge);
    li.appendChild(actionsWrap);
    li.appendChild(status);
    li.appendChild(infoBtn);
    list.appendChild(li);
  });
}

function getEventDetailsHTML(eid){
  const e = findEvent(eid);
  if(!e) return '<div class="detail-desc">Event not found.</div>';

  if(e.type==='fort'){
    const s = S.settings;
    const remaining = Math.max(0, e.originalAttackers - e.killed);
    const targetFort = S.forts.find(f => f.id === e.targetFortId);
    // Same shared projection resolution itself uses (estimateFortAssaultOutcome,
    // nest-core.js) - MUST pass the actual attacking nest (e.nestId), not
    // whatever nest the player currently has focused in the UI (S.nest),
    // since distance-to-fort is what predator strength is computed from and
    // those can easily be two very different nests.
    const attackingNest = S.nests.find(n => n.id === e.nestId) || null;
    const outcome = targetFort ? estimateFortAssaultOutcome(e, targetFort, attackingNest) : null;
    const predStrength = outcome ? outcome.predStrength : 3;
    const totalDamage = outcome ? outcome.totalDamage : 0;
    const currentDef = targetFort ? targetFort.defense : 0;
    const maxDef = targetFort ? targetFort.maxDefense : 50;

    let html = `<h3 class="detail-title">${t('event.fort_title', { id: targetFort ? targetFort.id : '' })}</h3>`;
    html += `<div class="detail-desc">${t('event.fort_desc', { attackers: e.originalAttackers, id: targetFort ? targetFort.id : '', strength: predStrength, damage: totalDamage, defense: currentDef, maxDefense: maxDef })}</div>`;
    html += '<div class="detail-meta">';
    html += `<div>${t('event.fort_orig_attackers')}<b>${e.originalAttackers}</b></div>`;
    html += `<div>${t('event.fort_killed')}<b>${e.killed}</b></div>`;
    html += `<div>${t('event.fort_strength')}<b>${predStrength} dmg/pred</b></div>`;
    html += `<div>${t('event.fort_damage')}<b>${totalDamage}</b></div>`;
    html += `<div>${t('event.fort_defense')}<b>${currentDef} / ${maxDef}</b></div>`;
    html += '</div>';
    if(e.status==='pending'){
      html += '<div class="actions">';
      html += `<button class="act danger" ${((S.points<s.costKillFortAttacker || remaining<=0)?'disabled':'')} onclick="killFortAttacker(${e.id}); openEventDetails(${e.id});"><span class="btn-main">${t('actions.defend_fort')}</span>${costBadgeHTML(s.costKillFortAttacker, FORT_ACTION_COSTS.fortDefense, targetFort)}</button>`;
      html += '</div>';
      if(remaining<=0){
        html += `<div class="detail-desc" style="margin-top:8px;">${t('event.fort_safe', { id: e.targetFortId })}</div>`;
      }
    } else {
      html += `<div class="detail-meta"><div>${t('outcome.label')}<b>${(e.outcome==='defended'? t('status.defended') : t('status.fort_conquered'))}</b></div></div>`;
    }
    return html;
  }

  if(e.type==='search' && e.fortMarkScout){
    const targetFort = S.forts.find(f => f.id === e.targetFortId);
    const groupSize = e.groupSize || 1;
    const killed = e.killed || 0;
    const remaining = Math.max(0, groupSize - killed);

    let html = `<h3 class="detail-title">${t('event.search_title')}</h3>`;
    html += `<div class="detail-desc">${t('event.fort_attacker_map', { count: remaining, id: targetFort ? targetFort.id : e.targetFortId })}</div>`;
    html += '<div class="detail-meta">';
    html += `<div>${t('event.fort_orig_attackers')}<b>${groupSize}</b></div>`;
    html += `<div>${t('event.fort_killed')}<b>${killed}</b></div>`;
    html += '</div>';
    if(e.status==='pending' && remaining>0){
      html += '<div class="actions">';
      html += `<button class="act danger" ${(S.points<S.settings.costKillScout?'disabled':'')} onclick="killMarkingScout(${e.id}); openEventDetails(${e.id});"><span class="btn-main">${t('actions.kill_scout')}</span>${costBadgeHTML(S.settings.costKillScout)}</button>`;
      html += '</div>';
    } else if(e.status==='pending'){
      html += `<div class="detail-desc" style="margin-top:8px;">${t('event.fort_safe', { id: e.targetFortId })}</div>`;
    } else {
      html += `<div class="detail-meta"><div>${t('outcome.label')}<b>${outcomeLabel(e)}</b></div></div>`;
    }
    return html;
  }

  if(e.type==='search'){
    const chance = Math.round(searchChanceWithDistance(e)*100);
    // Route-scouting shares the same scout/death-risk mechanics as a normal
    // search, but doesn't hunt for eggs - it's watching a trade route for a
    // merchant to come by, so it gets its own title/description instead of
    // the normal search copy (which would misleadingly mention an egg bonus).
    const isRouteSearch = !!e.routeSearch;
    let html = `<h3 class="detail-title">${t(isRouteSearch ? 'event.route_search_title' : 'event.search_title')}</h3>`;
    html += `<div class="detail-desc">${isRouteSearch ? t('event.route_search_desc', { chance }) : t('event.search_desc', { chance, eggs: S.settings.eggsPerSearch })}</div>`;
    if(e.status==='pending' && !e.outcome){
      html += '<div class="actions">';
      html += `<button class="act" ${(S.points<S.settings.costDistractScout?'disabled':'')} onclick="distractScout(${e.id}); openEventDetails(${e.id});"><span class="btn-main">${t('actions.distract_scout')}</span>${costBadgeHTML(S.settings.costDistractScout)}</button>`;
      html += `<button class="act danger" ${(S.points<S.settings.costKillScout?'disabled':'')} onclick="killScout(${e.id}); openEventDetails(${e.id});"><span class="btn-main">${t('actions.kill_scout')}</span>${costBadgeHTML(S.settings.costKillScout)}</button>`;
      html += '</div>';
    } else {
      html += `<div class="detail-meta"><div>${t('outcome.label')}<b>${outcomeLabel(e)}</b></div></div>`;
    }
    return html;
  } else {
    const stopped = e.neutralized + e.killed;
    const active = e.groupSize - stopped;
    const huntChancePct = Math.round(huntChanceWithDistance(e)*100);
    const deathRiskPct = Math.round(S.settings.huntDeathRisk*100);
    // Route ambushes share the same predator/death-risk mechanics as a
    // normal hunt, but only ever have MERCHANT_PAIR_SIZE (2) humans to
    // actually kill, so it gets its own description calling that out
    // instead of the normal hunt copy (which implies open-ended prey).
    const isRouteHunt = !!e.routeHunt;
    let html = `<h3 class="detail-title">${t(isRouteHunt ? 'event.route_hunt_title' : 'event.hunt_title')}</h3>`;
    html += `<div class="detail-desc">${isRouteHunt ? t('event.route_hunt_desc', { groupSize: e.groupSize, chance: huntChancePct, deathRisk: deathRiskPct }) : t('event.hunt_desc', { groupSize: e.groupSize, chance: huntChancePct, deathRisk: deathRiskPct })}</div>`;
    html += '<div class="detail-meta">';
    html += `<div>${t('event.hunt_pack_size')}<b>${e.groupSize}</b></div>`;
    html += `<div>${t('event.hunt_escaped')}<b>${e.neutralized}</b></div>`;
    html += `<div>${t('event.hunt_killed')}<b>${e.killed}</b></div>`;
    html += `<div>${t('event.hunt_still_hunting')}<b>${active}</b></div>`;
    html += '</div>';
    if(e.status==='pending' && active>0){
      const humansAlreadySaved = isRouteHunt && (e.neutralized || 0) >= MERCHANT_PAIR_SIZE;
      const rescueDisabled = S.points<S.settings.costEscapePredator || humansAlreadySaved;
      html += '<div class="actions">';
      html += `<button class="act" ${(rescueDisabled?'disabled':'')} onclick="escapePredator(${e.id}); openEventDetails(${e.id});"><span class="btn-main">${t('actions.help_escape')}</span>${costBadgeHTML(S.settings.costEscapePredator)}</button>`;
      html += `<button class="act danger" ${(S.points<S.settings.costKillPredator?'disabled':'')} onclick="killPredatorAction(${e.id}); openEventDetails(${e.id});"><span class="btn-main">${t('actions.kill_predator')}</span>${costBadgeHTML(S.settings.costKillPredator)}</button>`;
      html += '</div>';
    } else if(e.status==='pending'){
      html += `<div class="detail-desc" style="margin-top:8px;">${t('event.hunt_neutralized')}</div>`;
    } else {
      html += `<div class="detail-desc" style="margin-top:8px;">${t('event.hunt_resolved')}</div>`;
    }
    return html;
  }
}

function outcomeLabel(e){
  if(e.outcome==='distracted') return t('outcome.distracted');
  if(e.outcome==='killed') return t('outcome.scout_killed');
  if(e.outcome==='failed') return t('outcome.found_nothing');
  if(e.outcome==='succeeded') return t('outcome.succeeded');
  // Merchant-route outcomes (see MERCHANT HUNTING in nest-core.js) - a
  // route search never fails to find anything once dispatched (the
  // eligibility roll already happened before dispatch), so there's no
  // 'failed' case to mirror here, only 'killed'/'distracted' (handled
  // above the same as a normal scout) or a successful mark.
  if(e.outcome==='route_marked') return t('outcome.route_marked');
  if(e.outcome==='ambush_succeeded') return t('outcome.ambush_succeeded');
  if(e.outcome==='ambush_failed') return t('outcome.ambush_failed');
  if(e.outcome==='no_target') return t('outcome.no_target');
  return e.outcome || '—';
}


/* ============================= STEP TRANSITION ANIMATION ============================= */
function curveWaypoints(from, to, count, deviation){
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  const pts = [{ x: from.x, y: from.y }];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    let x = from.x + dx * t;
    let y = from.y + dy * t;
    const off = (Math.random() * 2 - 1) * deviation;
    x += px * off; y += py * off;
    x = Math.max(3, Math.min(97, x));
    y = Math.max(3, Math.min(97, y));
    pts.push({ x, y });
  }
  pts.push({ x: to.x, y: to.y });
  return pts;
}

function catmullRomPoint(p0, p1, p2, p3, t){
  const t2 = t * t, t3 = t2 * t;
  const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return { x, y };
}

function denseSmoothPath(waypoints, samplesPerSeg){
  samplesPerSeg = samplesPerSeg || 10;
  if (waypoints.length < 2) return waypoints.slice();
  const pts = [waypoints[0], ...waypoints, waypoints[waypoints.length - 1]];
  const out = [];
  for (let i = 1; i < pts.length - 2; i++) {
    for (let s = 0; s < samplesPerSeg; s++) {
      out.push(catmullRomPoint(pts[i - 1], pts[i], pts[i + 1], pts[i + 2], s / samplesPerSeg));
    }
  }
  out.push(waypoints[waypoints.length - 1]);
  return out;
}

function pathLength(pts){
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

function pointAtDistance(pts, d){
  if (d <= 0) return pts[0];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + segLen >= d) {
      const t = segLen === 0 ? 0 : (d - acc) / segLen;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    acc += segLen;
  }
  return pts[pts.length - 1];
}

// ---------------------------------------------------------------------------
// ROUTE LAYER (static, non-animated)
//
// Draws S.routes (see regenerateRoutes()/findRouteCurve() in nest-core.js)
// as quadratic-bezier curves between fort pairs. Geometry is fully
// determined by fort/nest positions, so this layer is just rebuilt from
// scratch on every renderMap() call - no per-frame animation loop needed,
// unlike the trail layer below.
// ---------------------------------------------------------------------------
const ROUTE_STROKE_WIDTH = 3.2;
const ROUTE_STROKE_COLOR = '#000000';
const ROUTE_STROKE_DASHARRAY = '3,2.4';

function buildRouteLayer() {
  if (!S.routes || !S.routes.length) return null;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${100 * WORLD_ASPECT_RATIO} 100`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('class', 'route-layer');

  const scaleG = document.createElementNS(svgNS, 'g');
  scaleG.setAttribute('transform', `scale(${WORLD_ASPECT_RATIO}, 1)`);

  function drawRoutePath(pts) {
    if (!pts || pts.length < 2) return;
    const d = `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', ROUTE_STROKE_COLOR);
    path.setAttribute('stroke-width', String(ROUTE_STROKE_WIDTH));
    path.setAttribute('stroke-dasharray', ROUTE_STROKE_DASHARRAY);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    scaleG.appendChild(path);
  }

  let drewAny = false;

  // Triangle-hub trunks (see tryAddTriangleHubEntries in nest-core.js) are
  // drawn ONCE here - each branch that forks off one has already had that
  // same leading stretch trimmed out of its own points by
  // getRouteCurveWorldPoints, so this is the only place it gets drawn.
  (getRouteTrunkSegmentsWorldPoints() || []).forEach(pts => {
    drawRoutePath(pts);
    drewAny = true;
  });

  S.routes.forEach(route => {
    const curve = getRouteCurveWorldPoints(route);
    if (!curve) return;

    // Rendered from the dense sampled polyline (curve.points) rather than
    // the raw p0/c1/c2/p3 bezier - applyFortClusterHubs() (nest-core.js)
    // may have routed this pair via a rectangle/triangle junction, or
    // trimmed off a leading stretch that's drawn separately as a shared
    // trunk, neither of which a single cubic bezier can still represent.
    // A plain "L"-segment polyline at this sample density
    // (ROUTE_MERGE_SAMPLES) still reads as a smooth curve at the route
    // layer's stroke width.
    const pts = curve.points && curve.points.length ? curve.points : [curve.p0, curve.p3];
    drawRoutePath(pts);
    drewAny = true;
  });

  if (!drewAny) return null;
  svg.appendChild(scaleG);
  return svg;
}

const TRAIL_DRAW_MS = 1200;
const TRAIL_FORT_AVOID_RADIUS = 16; // world-space units a trail keeps clear of any alive fort's centre
const TRAIL_STROKE_WIDTH = 6; // width of a pheromone trail line
const TRAIL_BLUR_STD_DEVIATION = 0.9; // softness of the trail's blurred edge

// Clamps every interior point of a (dense) path onto a circle of
// TRAIL_FORT_AVOID_RADIUS around any alive fort it comes too close to, so
// pheromone trails curve around forts instead of cutting through them.
// Endpoints (the scout's spot and the nest) are left untouched.
function bendPathAroundForts(points, avoidRadius){
  if (!S.forts || !S.forts.length || points.length < 3) return points;
  const forts = S.forts.filter(f => f.alive);
  if (!forts.length) return points;

  return points.map((p, idx) => {
    if (idx === 0 || idx === points.length - 1) return p;

    let x = p.x, y = p.y;

    forts.forEach(f => {
      const dxWorld = (x - f.x) * WORLD_ASPECT_RATIO;
      const dyWorld = y - f.y;
      const d = Math.hypot(dxWorld, dyWorld) || 0.0001;
      if (d < avoidRadius) {
        const ux = dxWorld / d, uy = dyWorld / d;
        x = f.x + (ux * avoidRadius) / WORLD_ASPECT_RATIO;
        y = f.y + uy * avoidRadius;
      }
    });

    return {
      x: Math.max(3, Math.min(97, x)),
      y: Math.max(3, Math.min(97, y))
    };
  });
}

// Per-trail cached <line> pools. A trail's geometry (x1/y1/x2/y2) is fixed
// for its whole life, so each segment's line element is created once and
// reused - subsequent animation-frame updates only touch its stroke alpha
// (for the draw-in reveal). This avoids rebuilding the SVG from scratch on
// every rAF tick while a trail is drawing in.
const _trailLineCache = new Map(); // trail.id -> SVGLineElement[]
let _trailSvgEl = null;
let _trailGEl = null;

function createTrailSvgShell(){
  const svgNS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${100 * WORLD_ASPECT_RATIO} 100`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('class', 'trail-layer');

  const defs = document.createElementNS(svgNS, 'defs');
  const blurFilter = document.createElementNS(svgNS, 'filter');
  blurFilter.setAttribute('id', 'trailBlurFilter');
  blurFilter.setAttribute('x', '-50%');
  blurFilter.setAttribute('y', '-50%');
  blurFilter.setAttribute('width', '200%');
  blurFilter.setAttribute('height', '200%');
  const blur = document.createElementNS(svgNS, 'feGaussianBlur');
  blur.setAttribute('stdDeviation', String(TRAIL_BLUR_STD_DEVIATION));
  blurFilter.appendChild(blur);
  defs.appendChild(blurFilter);

  const scaleG = document.createElementNS(svgNS, 'g');
  scaleG.setAttribute('transform', `scale(${WORLD_ASPECT_RATIO}, 1)`);

  const g = document.createElementNS(svgNS, 'g');
  g.setAttribute('filter', 'url(#trailBlurFilter)');

  svg.appendChild(defs);
  scaleG.appendChild(g);
  svg.appendChild(scaleG);

  _trailSvgEl = svg;
  _trailGEl = g;
  _trailLineCache.clear();

  return svg;
}

// Builds a fresh trail layer from scratch. Used right after a full
// wrap.innerHTML wipe (renderMap()), where any previously cached <line>
// elements are already gone with it.
function buildTrailLayer(){
  if (!S.trails || !S.trails.length) {
    _trailSvgEl = null;
    _trailGEl = null;
    _trailLineCache.clear();
    return null;
  }

  const svg = createTrailSvgShell();
  updateTrailLines();
  return svg;
}

// Updates the persistent trail <g> in place: reuses each trail's cached
// <line> pool (geometry set only once) and just refreshes stroke alpha
// every frame. A trail that's no longer in S.trails - i.e. no longer
// usable by predators, whether expired or claimed for a hunt - has its
// line pool torn down immediately here, with no fade: once it's unusable
// it shouldn't leave any visual residue, and skipping the fade also means
// one less thing keeping the animation loop alive.
function updateTrailLines(){
  if (!_trailGEl) return;

  const svgNS = 'http://www.w3.org/2000/svg';
  const now = performance.now();
  const liveIds = new Set();

  S.trails.forEach(trail => {
    liveIds.add(trail.id);

    const pts = trail.waypoints;
    const n = pts.length;
    if (n < 2) return;

    const revealFrac = trail.bornAt != null
      ? easeInOutQuad(
          Math.max(0, Math.min(1, (now - trail.bornAt) / TRAIL_DRAW_MS))
        )
      : 1;

    const baseLifeFactor = Math.max(0, Math.min(1, trail.stepsLeft / 2));

    let lines = _trailLineCache.get(trail.id);

    if (revealFrac <= 0 || baseLifeFactor <= 0) {
      if (lines) lines.forEach(l => l.setAttribute('stroke', 'rgba(168, 85, 247, 0)'));
      return;
    }

    if (!lines) {
      lines = [];
      _trailLineCache.set(trail.id, lines);
    }

    // Fewer segments = much less SVG work.
    const segStep = Math.max(1, Math.floor(n / 14));
    let segIdx = 0;

    for (let i = 0; i < n - segStep; i += segStep) {
      const r = i / (n - 1);
      if (r > revealFrac) break;

      const edgeFade = 0.65 + 0.35 * Math.min(1, r);
      const alpha = Math.max(0, edgeFade * 0.68 * baseLifeFactor);

      let line = lines[segIdx];
      if (!line) {
        const p1 = pts[i];
        const p2 = pts[Math.min(n - 1, i + segStep)];

        line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', p1.x);
        line.setAttribute('y1', p1.y);
        line.setAttribute('x2', p2.x);
        line.setAttribute('y2', p2.y);
        line.setAttribute('stroke-width', String(TRAIL_STROKE_WIDTH));
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        _trailGEl.appendChild(line);
        lines[segIdx] = line;
      }

      line.setAttribute(
        'stroke',
        alpha <= 0.012 ? 'rgba(168, 85, 247, 0)' : `rgba(168, 85, 247, ${alpha.toFixed(3)})`
      );

      segIdx++;
    }
  });

  // Instant, residue-free teardown of any cached pool whose trail is gone.
  for (const [id, lines] of _trailLineCache) {
    if (!liveIds.has(id)) {
      lines.forEach(l => l.remove());
      _trailLineCache.delete(id);
    }
  }
}

// A trail predators can no longer use (claim window expired, or just
// consumed by a returning hunt) is removed immediately - no fade, no
// lingering visual, and one less trail for the animation loop to track.
function retireTrail(id){
  const idx = S.trails.findIndex(tr => tr.id === id);
  if (idx === -1) return;
  S.trails.splice(idx, 1);

  const lines = _trailLineCache.get(id);
  if (lines) {
    lines.forEach(l => l.remove());
    _trailLineCache.delete(id);
  }
}

function trailsNeedAnimationFrame(){
  const now = performance.now();
  return S.trails.some(t => t.bornAt != null && (now - t.bornAt) < TRAIL_DRAW_MS);
}

function refreshTrailLayer(){
  const wrap = document.getElementById('mapWrap');
  if (!wrap) return;

  if (!S.trails || !S.trails.length) {
    if (_trailSvgEl) _trailSvgEl.remove();
    _trailSvgEl = null;
    _trailGEl = null;
    _trailLineCache.clear();
    return;
  }

  // Reuse the existing layer in place when it's still actually mounted -
  // a coarse renderMap() call may have wiped wrap (and built its own fresh
  // layer via buildTrailLayer()) since our last tick.
  const stillMounted = _trailSvgEl && _trailSvgEl.isConnected && _trailSvgEl.parentNode === wrap;
  if (stillMounted) {
    updateTrailLines();
    return;
  }

  const stale = wrap.querySelector('svg.trail-layer');
  if (stale) stale.remove();

  const layer = buildTrailLayer();
  if (layer) wrap.appendChild(layer);
}

let _trailAnimHandle = null;
function tickTrailAnimation(){
  refreshTrailLayer();
  _trailAnimHandle = trailsNeedAnimationFrame() ? requestAnimationFrame(tickTrailAnimation) : null;
}

function ensureTrailAnimationLoop(){
  if (_trailAnimHandle == null) _trailAnimHandle = requestAnimationFrame(tickTrailAnimation);
}

// Elements spawned by spawnTempIcon() have no backing model in S - they're
// pure transient DOM nodes driven by animateAlongPath/fadeOut's own
// requestAnimationFrame/setTimeout loops. A coarse renderMap() call (from
// any unguarded map/action handler) does `wrap.innerHTML = ''`, which
// detaches them from the DOM without stopping their animation loops - they
// keep "running" invisibly and their promises still resolve on schedule.
// This array is how we find and reattach any of them that are still
// in-flight, mirroring refreshTrailLayer's stillMounted self-healing for
// the trail SVG layer.
let _liveTempIcons = [];

function spawnTempIcon(type, x, y){
  const wrap = document.getElementById('mapWrap');
  const el = document.createElement('div');
  el.className = 'map-event transit-icon';
  setWorldPosition(el, wrap, x, y);
  const img = document.createElement('img');
  img.className = 'map-icon event-icon';
  img.src = type === 'search' ? '/nest/assets/scout.png' : '/nest/assets/predator.png';
  el.appendChild(img);
  wrap.appendChild(el);
  _liveTempIcons.push(el);
  return el;
}

// Call once an icon's animation (fadeOut and/or arrival) has actually
// finished, so it stops being tracked/reattached and is removed from the
// DOM - otherwise it would linger and get re-appended by a later,
// unrelated renderMap() wipe.
function retireTempIcon(el){
  const idx = _liveTempIcons.indexOf(el);
  if (idx !== -1) _liveTempIcons.splice(idx, 1);
  if (el.parentNode) el.parentNode.removeChild(el);
}

// Re-appends any temp icons that are still mid-animation (and therefore
// still tracked) but got detached by this renderMap()'s wrap.innerHTML =
// '' wipe. Must run after that wipe (and is safe to run after the rest of
// renderMap()'s normal content is built) so in-flight scout/predator
// icons don't just vanish mid-step.
function reattachLiveTempIcons(wrap){
  _liveTempIcons.forEach(el => {
    if (el.parentNode !== wrap) wrap.appendChild(el);
  });
}

function easeInOutQuad(t){
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function animateAlongPath(el, densePts, duration){
  const wrap = document.getElementById('mapWrap');
  return new Promise(resolve => {
    const total = pathLength(densePts);
    const start = performance.now();
    function frame(now){
      const t = Math.min(1, (now - start) / duration);
      const eased = easeInOutQuad(t);
      const p = pointAtDistance(densePts, total * eased);
      setWorldPosition(el, wrap, p.x, p.y);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

function fadeOut(el, delay){
  return new Promise(resolve => {
    setTimeout(() => {
      el.style.transition = 'opacity 0.35s ease';
      el.style.opacity = '0';
      setTimeout(resolve, 360);
    }, delay || 0);
  });
}

function waitForAnimationAssets() {
  const assets = [
    '/nest/assets/scout.png',
    '/nest/assets/predator.png'
  ];

  return Promise.all(
    assets.map(src => new Promise(resolve => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = resolve; // Don't block the game if an asset fails.
      img.src = src;
      // If the browser already had this cached, .complete can flip to true
      // synchronously right after assigning src, before onload ever fires -
      // check it explicitly instead of relying on onload alone.
      if (img.complete) resolve();
    }))
  );
}

// Looks up the world position of the nest that owns a given event, so
// animations always originate from/return to the correct nest instead of
// whichever nest happens to be S.activeNestIndex at render time. Falls back
// to S.nest for legacy events that predate nestId tagging.
function nestPointFor(nestId) {
  const n = S.nests.find(x => x.id === nestId);
  return n ? { x: n.x, y: n.y } : { x: S.nest.x, y: S.nest.y };
}

function runStepAnimation(outgoing, incoming, onComplete){
  const wrap = document.getElementById('mapWrap');
  if (!wrap || !S.nest) { onComplete(); return; }
  const promises = [];

  // Icons in this batch have different durations (TRAIL_DRAW_MS, 900, 1000,
  // 1100...), so they naturally finish walking/fading at different times.
  // The underlying events stay _hideOnMap until the WHOLE batch's
  // Promise.all below resolves and onComplete()'s render() runs - so every
  // temp icon here must stay in the DOM (fully visible, or faded-but-present
  // via fadeOut) until that same moment, and only then get retired together.
  // Retiring an icon as soon as ITS OWN animation finishes (rather than
  // waiting for the whole batch) is exactly what caused the "icon vanishes
  // then reappears" / "trail with no scout icon" bug: a fast icon would be
  // torn out of the DOM while slower icons in the same batch were still
  // animating and _hideOnMap hadn't been cleared yet, leaving a real gap
  // with nothing shown for that event until the batch's final render().
  const batchEls = [];

  const origSpawnTempIcon = spawnTempIcon;
  function spawnBatchIcon(type, x, y){
    const el = origSpawnTempIcon(type, x, y);
    batchEls.push(el);
    return el;
  }

  S.trails.forEach(t => {
    if (t.claimedByHuntId != null) return;
    t.stepsLeft -= 1;
    if (t.stepsLeft <= 0) retireTrail(t.id);
  });

  outgoing.forEach(e => {
    const nestPt = nestPointFor(e.nestId);
    if (e.type === 'search') {
      if (e.x === undefined || e.y === undefined) return;

      // Fort-marking scout wave:
      // - survived and marked the fort -> return to nest
      // - killed -> disappear at the fort
      // One icon is animated per remaining map icon the wave was showing
      // (see e.iconPositions, set while it was pending), not per scout.
      if (e.fortMarkScout) {
        const positions = (e.iconPositions && e.iconPositions.length)
          ? e.iconPositions
          : [{ x: e.x, y: e.y }];

        if (e.outcome === 'fort_marked') {
          positions.forEach(pos => {
            const wp = curveWaypoints(
              { x: pos.x, y: pos.y },
              nestPt,
              1,
              6
            );

            const dense = denseSmoothPath(wp);

            const el = spawnBatchIcon('search', pos.x, pos.y);

            promises.push(
              animateAlongPath(el, dense, TRAIL_DRAW_MS)
                .then(() => fadeOut(el))
            );
          });

          return;
        }

        // Marking scout wave was wiped out.
        if (e.outcome === 'killed') {
          positions.forEach(pos => {
            const el = spawnBatchIcon('search', pos.x, pos.y);
            promises.push(fadeOut(el));
          });
          return;
        }

        return;
      }

      // Normal scout behaviour stays unchanged.
      if (e.outcome !== 'succeeded') {
        const el = spawnBatchIcon('search', e.x, e.y);
        promises.push(fadeOut(el));
        return;
      }

      // Longer trails get a few more bends instead of one flat curve -
      // roughly one extra control point per 20 world-units of distance.
      const trailSpan = dist({ x: e.x, y: e.y }, nestPt);
      const trailCurveCount = Math.max(1, Math.min(5, Math.round(trailSpan / 20)));

      const wp = curveWaypoints(
        { x: e.x, y: e.y },
        nestPt,
        trailCurveCount,
        6
      );

      const dense = bendPathAroundForts(
        denseSmoothPath(wp),
        TRAIL_FORT_AVOID_RADIUS
      );

      S.trails.push({
        id: 'trail_' + e.id,
        nestId: e.nestId,
        waypoints: dense,
        stepsLeft: 2,
        claimedByHuntId: null,
        bornAt: performance.now()
      });

      ensureTrailAnimationLoop();

      const el = spawnBatchIcon('search', e.x, e.y);

      promises.push(
        animateAlongPath(el, dense, TRAIL_DRAW_MS)
          .then(() => fadeOut(el))
      );

      return;
    }


    if (e.type === 'hunt') {
      if (e.x === undefined || e.y === undefined) return;
      if ((e.survivors || 0) <= 0) {
        if (e._trailId) retireTrail(e._trailId);
        const el = spawnBatchIcon('hunt', e.x, e.y);
        promises.push(fadeOut(el));
        return;
      }
      let dense;
      const trail = e._trailId ? S.trails.find(t => t.id === e._trailId) : null;
      if (trail) {
        const hop = denseSmoothPath(curveWaypoints({ x: e.x, y: e.y }, trail.waypoints[0], 1, 5));
        dense = hop.concat(trail.waypoints.slice(1));
        retireTrail(trail.id);
      } else {
        dense = denseSmoothPath(curveWaypoints({ x: e.x, y: e.y }, nestPt, 1, 6));
      }
      const el = spawnBatchIcon('hunt', e.x, e.y);
      promises.push(animateAlongPath(el, dense, 900).then(() => fadeOut(el)));
      return;
    }

    if (e.type === 'fort') {
      const targetFort = S.forts.find(f => f.id === e.targetFortId);
      if (targetFort) {
        const rem = Math.max(0, e.originalAttackers - e.killed);
        if (rem > 0) {
          const count = Math.max(1, Math.ceil(rem / 10));
          for (let i = 0; i < count; i++) {
            const angle = (2 * Math.PI * i) / count - Math.PI / 2;
            const ATTACKER_SCATTER_DISTANCE = 26;

            const fx = Math.max(
              3,
              Math.min(
                97,
                targetFort.x + (ATTACKER_SCATTER_DISTANCE / WORLD_ASPECT_RATIO) * Math.cos(angle)
              )
            );

            const fy = Math.max(
              3,
              Math.min(
                97,
                targetFort.y + ATTACKER_SCATTER_DISTANCE * Math.sin(angle)
              )
            );            
            const dense = denseSmoothPath(curveWaypoints({ x: fx, y: fy }, nestPt, 1, 6));
            const el = spawnBatchIcon('hunt', fx, fy);
            promises.push(animateAlongPath(el, dense, 900).then(() => fadeOut(el)));
          }
        }
      }
      return;
    }
  });

  incoming.forEach(e => {
    const nestPt = nestPointFor(e.nestId);
    if (e.type === 'search') {
      if (e.x === undefined || e.y === undefined) return;
      const dense = denseSmoothPath(curveWaypoints(nestPt, { x: e.x, y: e.y }, 3, 15));
      const el = spawnBatchIcon('search', nestPt.x, nestPt.y);
      el.style.opacity = '0';
      requestAnimationFrame(() => { el.style.transition = 'opacity 0.3s ease'; el.style.opacity = '1'; });
      promises.push(animateAlongPath(el, dense, 1100));
      return;
    }

    if (e.type === 'hunt') {
      let dense;
      const trail = e._trailId ? S.trails.find(t => t.id === e._trailId) : null;
      // A merchant-route ambush already has its own deliberate x/y (the
      // route's marked point, set at dispatch) - unlike a normal hunt, it
      // must never adopt some unrelated leftover trail from the same nest
      // just because one happens to be free, or it'd silently teleport to
      // wherever that trail was heading instead of the actual route mark.
      if (!trail && !e.routeHunt) {
        const avail = S.trails.find(t => !t.claimedByHuntId && t.stepsLeft > 0 && t.nestId === e.nestId);
        if (avail) {
          avail.claimedByHuntId = e.id;
          e._trailId = avail.id;
          e.x = avail.waypoints[0].x;
          e.y = avail.waypoints[0].y;
        }
      }
      if (e.x === undefined || e.y === undefined) assignEventCoords(e);
      dense = denseSmoothPath(curveWaypoints(nestPt, { x: e.x, y: e.y }, 2, 10));

      const el = spawnBatchIcon('hunt', nestPt.x, nestPt.y);
      el.style.opacity = '0';
      requestAnimationFrame(() => { el.style.transition = 'opacity 0.3s ease'; el.style.opacity = '1'; });
      promises.push(animateAlongPath(el, dense, 1000));
      return;
    }

    if (e.type === 'fort') {
      const targetFort = S.forts.find(f => f.id === e.targetFortId);
      if (targetFort) {
        const rem = Math.max(0, e.originalAttackers - e.killed);
        if (rem > 0) {
        const count = Math.max(1, Math.ceil(rem / 10));

        // If attackers were killed, just remove excess positions.
        // Do NOT regenerate the survivors.
        if (e.iconPositions) {
            while (e.iconPositions.length > count) {
                e.iconPositions.pop();
            }
        }

        // Generate coordinates only once.
        if (!e.iconPositions) {
            e.iconPositions = [];
            for (let i = 0; i < count; i++) {
                const angle = (2 * Math.PI * i) / count - Math.PI / 2;
                const fx = Math.max(
                    3,
                    Math.min(
                        97,
                        targetFort.x + (DIST_FROM_FORT / WORLD_ASPECT_RATIO) * Math.cos(angle)
                    )
                );
                const fy = Math.max(
                    3,
                    Math.min(
                        97,
                        targetFort.y + DIST_FROM_FORT * Math.sin(angle)
                    )
                );
                e.iconPositions.push({ x: fx, y: fy });
            }
        }
          // 2. Animate to the saved positions
          e.iconPositions.forEach((pos) => {
            const dense = denseSmoothPath(curveWaypoints(nestPt, pos, 2, 10));
            const el = spawnBatchIcon('hunt', nestPt.x, nestPt.y);
            el.style.opacity = '0';
            requestAnimationFrame(() => { el.style.transition = 'opacity 0.3s ease'; el.style.opacity = '1'; });
            promises.push(animateAlongPath(el, dense, 1000));
          });
        }
      }
      return;
    }
  });

  Promise.all(promises).then(() => {
    // Now that every icon in this batch has finished walking/fading (so
    // the caller's onComplete -> render() is about to draw the "real"
    // resting icons for these now-non-hidden events), retire them all
    // together - untracking each from _liveTempIcons and removing it from
    // the DOM. Doing this per-batch (not per-icon as each one's own,
    // possibly-shorter animation finished) is what keeps every icon visible
    // right up until the atomic swap, instead of leaving a gap.
    batchEls.forEach(el => retireTempIcon(el));
    onComplete();
  });
}

function reinforceFort(fortId) {
  if (S.gameOver) return;

  if (S.phase !== 'active') {
    log(t('log.reinforce_not_started'));
    render();
    return;
  }

  const fort = S.forts.find(f => f.id === fortId);
  if (!fort || !fort.alive) return;

  if (!Array.isArray(S.reinforcedForts)) S.reinforcedForts = [];
  if (S.reinforcedForts.includes(fort.id)) {
    log(t('log.reinforce_already_done', { id: fort.id }));
    render();
    return;
  }

  const cost = S.settings.fortReinforceCost;
  if (S.points < cost) {
    log(t('log.reinforce_no_ap', { id: fort.id }));
    render();
    return;
  }

  if (!meetsFortActionRequirement(fort, FORT_ACTION_COSTS.reinforceFort)) {
    log(t('log.fort_reinforce_missing_resources', { id: fort.id }));
    render();
    return;
  }

  S.points -= cost;
  applyFortActionCost(fort, FORT_ACTION_COSTS.reinforceFort);
  fort.defense += S.settings.fortReinforceDefenseBonus;
  if (fort.defense > fort.maxDefense) {
    fort.maxDefense = fort.defense;
  }
  S.reinforcedForts.push(fort.id);
  log(t('log.reinforce_success', { id: fort.id, def: fort.defense, maxDef: fort.maxDefense }));
  render();
}

// Free-form resource windfall - see applyFortScavenge() (nest-core.js) for
// the actual pick-3-random-types-and-roll logic. Unlike reinforceFort()/
// increaseFortCapacity() there's no per-fort "already done" gate and no
// resource cost/requirement to check first - just the flat AP cost.
function scavengeFort(fortId) {
  if (S.gameOver) return;

  if (S.phase !== 'active') {
    log(t('log.scavenge_not_started'));
    render();
    return;
  }

  const fort = S.forts.find(f => f.id === fortId);
  if (!fort || !fort.alive) return;

  if (S.points < SCAVENGE_AP_COST) {
    log(t('log.scavenge_no_ap', { id: fort.id }));
    render();
    return;
  }

  S.points -= SCAVENGE_AP_COST;
  const found = applyFortScavenge(fort);
  const summary = found
    .filter(entry => entry.amount > 0)
    .map(entry => `${entry.amount} ${resourceLabel(entry.type)}`)
    .join(', ');

  log(summary
    ? t('log.scavenge_success', { id: fort.id, summary })
    : t('log.scavenge_nothing', { id: fort.id }));
  render();
}

function increaseFortCapacity(fortId) {
  if (S.gameOver) return;

  if (S.phase !== 'active') {
    log(t('log.reinforce_not_started'));
    render();
    return;
  }

  const fort = S.forts.find(f => f.id === fortId);
  if (!fort || !fort.alive) return;

  const cost = S.settings.costIncreaseFortCapacity;
  if (S.points < cost) {
    log(t('log.fort_capacity_no_ap', { id: fort.id }));
    render();
    return;
  }

  if (!meetsFortActionRequirement(fort, FORT_ACTION_COSTS.increaseFortCapacity)) {
    log(t('log.fort_capacity_missing_resources', { id: fort.id }));
    render();
    return;
  }

  S.points -= cost;
  applyFortActionCost(fort, FORT_ACTION_COSTS.increaseFortCapacity);
  const capacityGain = capacityIncreaseAmount(fort.capacity, S.settings.fortCapacityIncreaseAmount);
  fort.capacity += capacityGain;
  log(t('log.fort_capacity_increased', { id: fort.id, capacity: fort.capacity }));
  render();
}

// How much one click of a fort's resource up/down arrow changes that
// resource's desired level by. A flat amount for every type for now -
// tune freely, same spirit as FORT_RESOURCE_CAPS/FORT_DESIRED_RESOURCE_FRACTION.
const RESOURCE_DEMAND_STEP = 5;

// Fallback (Slovak) display labels for FORT_RESOURCE_TYPES, used for the
// icon's alt/title text whenever the 'resources.<type>' translation key
// isn't defined in TRANSLATIONS.
const RESOURCE_LABELS_SK = {
  ammo: 'Munícia',
  food: 'Jedlo',
  materials: 'Materiály',
  fuel: 'Palivo'
};

// Icon filenames (under /nest/assets/) shown for each FORT_RESOURCE_TYPES
// entry in the fort resource panel, in place of a text label.
const RESOURCE_ICONS = {
  ammo: 'ammo_icon.png',
  food: 'food_icon.png',
  materials: 'materials_icon.png',
  fuel: 'fuel_icon.png'
};

// Shared with the fort-resource-panel labeling below: 'resources.<type>'
// translation if defined, else the hardcoded Slovak fallback. Used anywhere
// a resource icon needs a readable name (tooltips, alt text).
function resourceLabel(type){
  const labelKey = 'resources.' + type;
  return t(labelKey) !== labelKey ? t(labelKey) : (RESOURCE_LABELS_SK[type] || type);
}

// ---------------------------------------------------------------------------
// FORT CRITICAL-DEMAND BADGE
//
// The small top-left icon badge on a fort marker (see fortContainer
// construction above) showing whichever resource(s) that fort holds under
// 50% of what it's asking for (getCriticalDemandTypes(), nest-core.js).
// When more than one resource qualifies, rather than picking a single
// "most critical" one, the badge cycles through ALL of them, one per
// second, via a single shared interval below - not a timer per fort
// marker, since fort markers are fully torn down and rebuilt on every
// render() and a per-element setInterval would just leak on every rebuild.
// _demandCycleTick is shared by every fort's badge, so they all advance in
// lockstep rather than independently drifting out of sync with each other.
// ---------------------------------------------------------------------------
let _demandCycleTick = 0;

function updateFortDemandBadge(fort, badgeEl) {
  const types = getCriticalDemandTypes(fort);
  if (!types.length) {
    badgeEl.style.display = 'none';
    return;
  }

  const type = types[_demandCycleTick % types.length];
  const icon = badgeEl.querySelector('img');
  icon.src = `/nest/assets/${RESOURCE_ICONS[type]}`;
  icon.alt = resourceLabel(type);
  badgeEl.title = resourceLabel(type);
  badgeEl.style.display = '';
}

// Advances the shared cycle tick and refreshes every currently-rendered
// demand badge in place (just the icon/visibility - never rebuilds the
// fort marker itself). Looks the fort back up by id rather than closing
// over it, since the badge element handed to updateFortDemandBadge() when
// it was first created could be long gone from the actual game state by
// the time this next fires (fort died, etc.) - querySelectorAll here only
// ever sees whichever badges are actually in the DOM right now.
function tickFortDemandBadges() {
  _demandCycleTick++;
  document.querySelectorAll('.fort-demand-badge').forEach(badgeEl => {
    const fortId = Number(badgeEl.dataset.fortId);
    const fort = S.forts.find(f => f.id === fortId && f.alive);
    if (!fort) { badgeEl.style.display = 'none'; return; }
    updateFortDemandBadge(fort, badgeEl);
  });
}

setInterval(tickFortDemandBadges, 1000);

// Adjusts one resource type's desired level at one fort, up or down, by
// RESOURCE_DEMAND_STEP. This is a FREE action - no AP cost, no S.phase
// check - the player is just telling the fort what it wants, not doing
// anything in the world. Clamped to [0, FORT_RESOURCE_CAPS[type]].
//
// Safe to call mid-step, including while merchants from this fort are
// already out on the road: spawnMerchants()/resolveMerchants() (nest-core.js)
// never re-read desiredResources mid-step - spawnMerchants() only reads it
// once, at the very start of the NEXT advanceStepLogic() call, to decide
// that step's barter matches. So changing this any number of times during
// the current step just leaves whatever the value is when the step actually
// ends/the next one begins - it can't retroactively touch a merchant that's
// already pending, and can't be read twice with two different values by the
// same step.
function adjustFortDesiredResource(fortId, type, delta) {
  if (S.gameOver) return;
  if (!FORT_RESOURCE_TYPES.includes(type)) return;

  const fort = S.forts.find(f => f.id === fortId);
  if (!fort || !fort.alive) return;

  if (!fort.desiredResources) fort.desiredResources = defaultDesiredResourceLevels();

  const cap = FORT_RESOURCE_CAPS[type] || 0;
  const current = fort.desiredResources[type] || 0;
  fort.desiredResources[type] = Math.max(0, Math.min(cap, current + delta));
  render();
}

// Empty (all-zero) per-type bundle, same shape as emptyResourceBundle() -
// used for the two fields below (production, workers) that don't have
// their own dedicated constructor yet.
function emptyFortResourceCounters() {
  return FORT_RESOURCE_TYPES.reduce((acc, type) => { acc[type] = 0; return acc; }, {});
}

// Lazily backfills a fort's resource-panel fields the first time it's
// opened, same pattern as the existing resources/desiredResources
// lazy-init. `production` (per-step output, once the production logic
// exists) and `workers` (humans assigned to producing each type) are new -
// UI only for now, per-type counters that just sit at 0 until that logic
// is wired in.
function ensureFortResourceFieldsInit(fort) {
  if (!fort.resources) fort.resources = emptyResourceBundle();
  if (!fort.desiredResources) fort.desiredResources = defaultDesiredResourceLevels();
  if (!fort.production) fort.production = emptyFortResourceCounters();
  if (!fort.workers) fort.workers = emptyFortResourceCounters();
}

// Adjusts how many of a fort's population are assigned to producing one
// resource type, up or down by 1. FREE action, same spirit as
// adjustFortDesiredResource() - no AP cost, no S.phase check. Clamped to
// [0, fort.population]: a fort obviously can't put more people to work on
// one resource than it actually shelters. This doesn't yet check the
// total assigned across ALL types against population (nothing stops
// over-assigning several resources past what the fort actually has) -
// that, and any actual production math reading this field, is the "logic"
// to add once this UI is in place.
// Manual worker assignment: PERMANENT, "+1 only" - once committed to a
// resource, a worker can never be reassigned or sent back to unemployed
// (matches autoAllocateFortWorkers() in nest-core.js, which is equally
// one-directional for the same reason). `delta` is only ever +1 from the
// UI's single "+" button now, but this still clamps defensively to the
// fort's remaining unemployed headcount either way.
function adjustFortWorkers(fortId, type, delta) {
  if (S.gameOver) return;
  if (!FORT_RESOURCE_TYPES.includes(type)) return;
  if (!(delta > 0)) return; // committed workers only ever increase

  const fort = S.forts.find(f => f.id === fortId);
  if (!fort || !fort.alive) return;

  ensureFortResourceFieldsInit(fort);

  const totalAssigned = FORT_RESOURCE_TYPES.reduce((sum, t) => sum + (fort.workers[t] || 0), 0);
  const room = Math.max(0, (fort.population || 0) - totalAssigned);
  const toAdd = Math.min(delta, room);
  if (toAdd <= 0) return;

  fort.workers[type] = (fort.workers[type] || 0) + toAdd;

  // Update production immediately when worker allocation changes.
  fort.production[type] = roundResource(resourceProductionForWorkers(fort.workers[type]));

  render();
}

// Flips fort.autoWorkers and, when switching it ON, immediately re-plans
// this fort's workers (autoAllocateFortWorkers(), nest-core.js) rather
// than waiting for the next step - so the overlay reflects the new plan
// right away instead of showing the old manual split until the game's own
// per-step re-allocation has had a chance to run once.
function toggleFortAutoWorkers(fortId) {
  if (S.gameOver) return;
  const fort = S.forts.find(f => f.id === fortId);
  if (!fort || !fort.alive) return;

  ensureFortResourceFieldsInit(fort);
  fort.autoWorkers = !fort.autoWorkers;
  if (fort.autoWorkers) autoAllocateFortWorkers(fort);

  render();
}

// ---------------------------------------------------------------------------
// FORT RESOURCES OVERLAY
//
// The resource panel used to be built inline in the bottom control bar
// (a cramped 3-column grid - see the .fort-resources rule in style.css history)
// but there isn't room there for two more columns (production, workers), so
// it now lives in its own overlay, opened via a single "RESOURCES" button in
// the bottom bar. activeResourcesOverlayFortId tracks which fort it's
// currently showing so render() (called after every arrow click, and every
// simulation step) can keep it in sync without the player having to
// close/reopen it - see refreshFortResourcesOverlay() below.
// ---------------------------------------------------------------------------
let activeResourcesOverlayFortId = null;

function openFortResourcesOverlay(fortId) {
  activeResourcesOverlayFortId = fortId;
  renderFortResourcesOverlayContent(fortId);
  const overlay = document.getElementById('fortResourcesOverlay');
  if (overlay) overlay.classList.remove('hidden');
}

function closeFortResourcesOverlay() {
  activeResourcesOverlayFortId = null;
  const overlay = document.getElementById('fortResourcesOverlay');
  if (overlay) overlay.classList.add('hidden');
}

// Called at the end of render() - re-renders the overlay's content in
// place if it's currently open, so worker/desired-amount arrow clicks (and
// ordinary step advancement, once production is wired in) update the
// numbers immediately without needing to close and reopen it. If the fort
// it was showing died or vanished, closes it instead of showing stale data.
function refreshFortResourcesOverlay() {
  const overlay = document.getElementById('fortResourcesOverlay');
  if (!overlay || overlay.classList.contains('hidden') || activeResourcesOverlayFortId == null) return;

  const fort = S.forts.find(f => f.id === activeResourcesOverlayFortId && f.alive);
  if (!fort) { closeFortResourcesOverlay(); return; }

  renderFortResourcesOverlayContent(activeResourcesOverlayFortId);
}

// Builds the actual resource list: one row per FORT_RESOURCE_TYPES entry,
// stacked in a single column (unlike the old 3-column grid), each with -
// left to right - the icon+label, current stock / desired goal with its
// existing up/down control, this-step production (read-only display for
// now), and assigned workers with its own up/down control.
function renderFortResourcesOverlayContent(fortId) {
  const container = document.getElementById('fortResourcesContent');
  if (!container) return;
  container.innerHTML = '';

  const fort = S.forts.find(f => f.id === fortId);
  if (!fort) return;
  ensureFortResourceFieldsInit(fort);

  const title = document.createElement('h3');
  title.className = 'detail-title';
  title.textContent = t('map.fort_resources_title') + ' #' + fort.id;
  container.appendChild(title);

  const table = document.createElement('div');
  table.className = 'fort-resources';

  const header = document.createElement('div');
  header.className = 'fort-resource-row fort-resource-header';
  header.appendChild(document.createElement('span')); // empty cell above the icon column
  const stockHeader = document.createElement('span');
  stockHeader.textContent = t('map.fort_resources_stock_header');
  header.appendChild(stockHeader);
  const productionHeader = document.createElement('span');
  productionHeader.textContent = t('map.fort_resources_production_header');
  header.appendChild(productionHeader);
  const workersHeader = document.createElement('span');
  workersHeader.className = 'fort-resource-workers-header';
  const workersHeaderLabel = document.createElement('span');
  workersHeaderLabel.textContent = t('map.fort_resources_workers_header');
  workersHeader.appendChild(workersHeaderLabel);

  // AUTO toggle - not localized on purpose (same "AUTO" text either
  // language), same visual language as the auto-trade toggle in Options
  // (nest-btn toggle-btn, data-enabled driving its ✓/✗ + color). Unlike
  // that one this is per-FORT state (fort.autoWorkers), so it's built here
  // fresh every render rather than being a single static button with a
  // fixed id.
  const autoWorkersBtn = document.createElement('button');
  autoWorkersBtn.type = 'button';
  autoWorkersBtn.className = 'nest-btn toggle-btn fort-auto-workers-btn';
  autoWorkersBtn.dataset.enabled = fort.autoWorkers ? 'true' : 'false';
  autoWorkersBtn.setAttribute('aria-pressed', fort.autoWorkers ? 'true' : 'false');
  autoWorkersBtn.textContent = 'AUTO ' + (fort.autoWorkers ? '✓' : '✗');
  autoWorkersBtn.title = 'AUTO';
  autoWorkersBtn.onclick = (ev) => { ev.stopPropagation(); toggleFortAutoWorkers(fort.id); };
  workersHeader.appendChild(autoWorkersBtn);

  header.appendChild(workersHeader);
  table.appendChild(header);

  // Total headcount already assigned across every resource type - the "up"
  // arrow for any one type must respect the fort's population as a WHOLE,
  // not just that type's own count (a fort with population 100 shouldn't
  const totalAssignedWorkers = FORT_RESOURCE_TYPES.reduce((sum, t) => sum + (fort.workers[t] || 0), 0);

  FORT_RESOURCE_TYPES.forEach(type => {
    const row = document.createElement('div');
    row.className = 'fort-resource-row';

    const label = document.createElement('img');
    label.className = 'fort-resource-icon';
    const labelKey = 'resources.' + type;
    const labelText = t(labelKey) !== labelKey ? t(labelKey) : RESOURCE_LABELS_SK[type];
    label.src = `/nest/assets/${RESOURCE_ICONS[type]}`;
    label.alt = labelText;
    label.title = labelText;
    row.appendChild(label);

    // Stock / desired goal, with the existing free up/down control.
    const stockCell = document.createElement('span');
    stockCell.className = 'fort-resource-cell';

    const stockValue = document.createElement('span');
    stockValue.className = 'fort-resource-value';
    // Defensive display-side rounding to 1 decimal - the underlying value
    // should already be clean (see roundResource() in nest-core.js), but
    // this is what actually stops a stray float like 194.60000000000002
    // from ever reaching the player even if some future code path forgets
    // to round after mutating it.
    stockValue.textContent = `${roundResource(fort.resources[type])} / ${fort.desiredResources[type] || 0}`;
    stockCell.appendChild(stockValue);

    const stockArrows = document.createElement('span');
    stockArrows.className = 'fort-resource-arrows';

    const stockDown = document.createElement('button');
    stockDown.type = 'button';
    stockDown.className = 'fort-resource-arrow';
    stockDown.textContent = '▼';
    stockDown.title = t('map.fort_resource_decrease');
    stockDown.disabled = (fort.desiredResources[type] || 0) <= 0;
    stockDown.onclick = (ev) => { ev.stopPropagation(); adjustFortDesiredResource(fort.id, type, -RESOURCE_DEMAND_STEP); };
    stockArrows.appendChild(stockDown);

    const stockUp = document.createElement('button');
    stockUp.type = 'button';
    stockUp.className = 'fort-resource-arrow';
    stockUp.textContent = '▲';
    stockUp.title = t('map.fort_resource_increase');
    stockUp.disabled = (fort.desiredResources[type] || 0) >= (FORT_RESOURCE_CAPS[type] || 0);
    stockUp.onclick = (ev) => { ev.stopPropagation(); adjustFortDesiredResource(fort.id, type, RESOURCE_DEMAND_STEP); };
    stockArrows.appendChild(stockUp);

    stockCell.appendChild(stockArrows);
    row.appendChild(stockCell);

    // Production is calculated live from the current worker assignment.
    // This means opening the overlay or changing workers with ▲ / ▼
    // immediately shows the correct production value.
    const productionCell = document.createElement('span');
    productionCell.className = 'fort-resource-cell fort-resource-production';
    const liveProduction = resourceProductionForWorkers(fort.workers[type] || 0);
    productionCell.textContent = Number(liveProduction).toFixed(1);
    row.appendChild(productionCell);

    // Workers assigned to this resource - PERMANENT once committed (see
    // adjustFortWorkers()/autoAllocateFortWorkers()), so there's only ever
    // a single "+" here, no "-" - a worker can never be moved back off a
    // job once assigned.
    const workersCell = document.createElement('span');
    workersCell.className = 'fort-resource-cell';

    const workersValue = document.createElement('span');
    workersValue.className = 'fort-resource-value';
    workersValue.textContent = String(fort.workers[type] || 0);
    workersCell.appendChild(workersValue);

    const workersAdd = document.createElement('button');
    workersAdd.type = 'button';
    workersAdd.className = 'fort-resource-arrow fort-resource-add';
    workersAdd.textContent = '+';
    workersAdd.title = t('map.fort_worker_increase');
    workersAdd.disabled = fort.autoWorkers || totalAssignedWorkers >= Math.max(0, fort.population || 0);
    workersAdd.onclick = (ev) => { ev.stopPropagation(); adjustFortWorkers(fort.id, type, 1); };
    workersCell.appendChild(workersAdd);

    row.appendChild(workersCell);

    table.appendChild(row);
  });

  // Summary footer row: how much of this fort's population is NOT
  // currently assigned to any resource job - the pool unemployedPopulation()
  // (nest-core.js) draws merchants from. Shown once, under the workers
  // column specifically (rather than as its own per-resource row), since
  // it's a fort-wide total rather than a per-type value.
  const availableRow = document.createElement('div');
  availableRow.className = 'fort-resource-row fort-resource-summary';

  const availableLabel = document.createElement('span');
  availableLabel.className = 'fort-resource-summary-label';
  availableLabel.textContent = t('stats.available') + ':  ' + String(unemployedPopulation(fort));
  availableRow.appendChild(availableLabel);

  table.appendChild(availableRow);

    const hybridsRow = document.createElement('div');
  hybridsRow.className = 'fort-resource-row fort-resource-summary';

  const hybridsLabel = document.createElement('span');
  hybridsLabel.className = 'fort-resource-summary-label';
  hybridsLabel.textContent = t('stats.hybrids') + ':  ' + String(fort.hybrids || 0);
  hybridsRow.appendChild(hybridsLabel);

  table.appendChild(hybridsRow);

  // Fourth summary footer row: what sustaining ALL of this fort's current
  // hybrids actually costs, per step - FORT_ACTION_COSTS.sustainHybrid
  // (nest-core.js) is a PER-HYBRID cost, so this is that multiplied by
  // fort.hybrids, one icon+value pair per resource type it touches. Purely
  // informational (mirrors what sustainHybrids() will actually charge this
  // fort next step) - never touches fort state itself.

  const hybridCostValues = document.createElement('span');
  hybridCostValues.className = 'fort-resource-summary-values';

  const hybridCostLabel = document.createElement('span');
  hybridCostLabel.className = 'fort-resource-summary-label';
  hybridCostLabel.textContent = t('stats.hybrid_cost') + ':';
  hybridCostValues.appendChild(hybridCostLabel);

  const hybridCount = fort.hybrids || 0;
  FORT_RESOURCE_TYPES.forEach(type => {
    const perHybrid = FORT_ACTION_COSTS.sustainHybrid[type];
    if (!perHybrid) return;

    const pair = document.createElement('span');
    pair.className = 'fort-resource-summary-value-pair';

    const icon = document.createElement('img');
    icon.className = 'fort-resource-icon';
    icon.src = `/nest/assets/${RESOURCE_ICONS[type]}`;
    icon.alt = resourceLabel(type);
    pair.appendChild(icon);

    const value = document.createElement('span');
    value.textContent = String(roundResource(perHybrid * hybridCount));
    pair.appendChild(value);

    hybridCostValues.appendChild(pair);
  });
  hybridsRow.appendChild(hybridCostValues);


  // Third summary footer row: how many of this fort's population are
  // committed merchantWorkers - a permanent vocation (see MERCHANT AS A
  // FIXED VOCATION, nest-core.js) already excluded from the AVAILABLE row
  // above and from every per-type WORKERS count, so this is the only place
  // in the panel that headcount is visible at all.
  const merchantsRow = document.createElement('div');
  merchantsRow.className = 'fort-resource-row fort-resource-summary';

  const merchantsLabel = document.createElement('span');
  merchantsLabel.className = 'fort-resource-summary-label';
  merchantsLabel.textContent = t('stats.merchants') + ':  ' + String(fort.merchantWorkers || 0);
  merchantsRow.appendChild(merchantsLabel);

  table.appendChild(merchantsRow);

  container.appendChild(table);
}

let activeOpenMapKey = null;

function toggleMapSelection(key, ev) {
  if (ev) ev.stopPropagation();
  activeOpenMapKey = (activeOpenMapKey === key) ? null : key;
  renderMap();
}

/* ============================= MAP FULLSCREEN ============================= */

const MAP_FULLSCREEN_CLASS = 'map-fullscreen-active';
let mapFullscreenActive = false;

const MAP_FULLSCREEN_ENTER_ICON =
  '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/>' +
  '<path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const MAP_FULLSCREEN_EXIT_ICON =
  '<svg viewBox="0 0 24 24"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>' +
  '<path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/></svg>';

function injectMapFullscreenStyles() {
  if (document.getElementById('mapFullscreenStyles')) return;
  const style = document.createElement('style');
  style.id = 'mapFullscreenStyles';
  // Note: #mapWrap's *normal* aspect-ratio still lives in style.css. In
  // fullscreen we deliberately drop it and just fill the viewport - the
  // existing getMapLetterbox()/worldToScreenPx() math already letterboxes
  // the 2:1 world inside whatever box #mapWrap actually has, so this is
  // safe without touching style.css.
  style.textContent = `
#mapWrap.${MAP_FULLSCREEN_CLASS} {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: 100vw !important;
  max-height: 100vh !important;
  aspect-ratio: unset !important;
  margin: 0 !important;
  border-radius: 0 !important;
  z-index: 10000;
}
body.map-fullscreen-lock {
  overflow: hidden !important;
}
.map-fullscreen-btn {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 36px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  z-index: 20;
  transition: background 0.15s ease;
}
.map-fullscreen-btn:hover { background: rgba(0, 0, 0, 0.8); }
.map-fullscreen-btn.map-fullscreen-pinned { position: fixed; z-index: 10001; }
.map-fullscreen-btn svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
`;
  document.head.appendChild(style);
}

function setMapFullscreen(active) {
  const wrap = document.getElementById('mapWrap');
  const btn = document.getElementById('mapFullscreenBtn');
  if (!wrap) return;

  mapFullscreenActive = active;
  wrap.classList.toggle(MAP_FULLSCREEN_CLASS, active);
  document.body.classList.toggle('map-fullscreen-lock', active);

  if (btn) {
    btn.classList.toggle('map-fullscreen-pinned', active);
    btn.innerHTML = active ? MAP_FULLSCREEN_EXIT_ICON : MAP_FULLSCREEN_ENTER_ICON;
    btn.title = active
      ? (t('ui.exit_fullscreen_map') || 'Exit fullscreen')
      : (t('ui.fullscreen_map') || 'Fullscreen map');
  }

  // Best-effort: also ask the browser for real fullscreen, so it hides its
  // own chrome where that's allowed (e.g. not inside a sandboxed iframe
  // without the "fullscreen" permission). The CSS above already makes the
  // map fill the viewport either way, so this is a bonus, not a dependency.
  try {
    if (active && document.fullscreenEnabled && !document.fullscreenElement) {
      const req = wrap.requestFullscreen && wrap.requestFullscreen();
      if (req && req.catch) req.catch(() => {});
    } else if (!active && document.fullscreenElement === wrap) {
      const ext = document.exitFullscreen && document.exitFullscreen();
      if (ext && ext.catch) ext.catch(() => {});
    }
  } catch (err) { /* Fullscreen API unavailable/blocked - CSS fallback still applies */ }

  // #mapWrap's on-screen box just changed size without a window 'resize'
  // event, so the px-positioned icons (see worldToScreenPx) need a redraw.
  if (typeof renderMap === 'function') renderMap();
}

function toggleMapFullscreen() {
  setMapFullscreen(!mapFullscreenActive);
}

function initMapFullscreenToggle() {
  const wrap = document.getElementById('mapWrap');
  const host = wrap && wrap.parentElement;
  if (!wrap || !host || document.getElementById('mapFullscreenBtn')) return;

  injectMapFullscreenStyles();
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const btn = document.createElement('button');
  btn.id = 'mapFullscreenBtn';
  btn.type = 'button';
  btn.className = 'map-fullscreen-btn';
  btn.title = t('ui.fullscreen_map') || 'Fullscreen map';
  btn.innerHTML = MAP_FULLSCREEN_ENTER_ICON;
  btn.onclick = (ev) => {
    ev.stopPropagation();
    toggleMapFullscreen();
  };
  host.appendChild(btn);

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && mapFullscreenActive) setMapFullscreen(false);
  });

  // Keep our state/button in sync if the user leaves real fullscreen via
  // the browser's own UI (F11, the escape hint bar, etc.).
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(evt => {
    document.addEventListener(evt, () => {
      if (mapFullscreenActive && document.fullscreenElement !== wrap) {
        setMapFullscreen(false);
      }
    });
  });
}

// Icon+value list (no headers, no net info) for one fort's side of a
// merchant tooltip column - only the resource types actually being carried
// this step, since an empty "0" row for everything NOT being traded would
// just be noise here (unlike the fort peek, which always lists every type).
function cargoToTooltipItems(cargo) {
  return FORT_RESOURCE_TYPES
    .filter(type => (cargo[type] || 0) > 0)
    .map(type => ({
      icon: `/nest/assets/${RESOURCE_ICONS[type]}`,
      alt: resourceLabel(type),
      value: String(roundResource(cargo[type]))
    }));
}

// One merchant icon per fort pair that just traded THIS step (at least one
// resolved 'merchant' event on that route, either direction), planted at
// the route's own curve midpoint (routeFarthestPointFromForts(), nest-core.js -
// a cheap stand-in for "the middle of the route" that already accounts for
// hub/bifurcated routing). Deliberately checks status === 'resolved', not
// 'pending': a merchant event is spawned AND resolved within the same
// synchronous advanceStepLogic() call (unlike search/hunt/fort, which stay
// pending across a render boundary), so 'pending' never actually occurs by
// the time anything outside that call gets to look at S.events. The
// resolved event sticks around in S.events (and so keeps rendering here)
// until the next advanceStepLogic() call purges it at the start of the
// following step. Hovering it shows a two-column breakdown of what each
// fort actually sent this step - each column headed by that fort's own
// label (the only text in this tooltip - see buildTooltipItemEl() for why
// everything else stays icon-only) followed by the same icon+value styling
// as the fort peek tooltip.
function buildMerchantIcons(wrap) {
  const eventsByRoute = new Map(); // routeKey -> this step's resolved merchant events on it
  (S.events || []).forEach(e => {
    if (e.type !== 'merchant' || e.status !== 'resolved') return;
    if (!eventsByRoute.has(e.routeKey)) eventsByRoute.set(e.routeKey, []);
    eventsByRoute.get(e.routeKey).push(e);
  });
  if (eventsByRoute.size === 0) return;

  eventsByRoute.forEach((events, rKey) => {
    const route = (S.routes || []).find(r => routeKey(r.fortIdA, r.fortIdB) === rKey);
    if (!route) return; // the route itself is gone (e.g. a fort died) - nothing to anchor the icon to

    const fortA = S.forts.find(f => f.id === route.fortIdA && f.alive);
    const fortB = S.forts.find(f => f.id === route.fortIdB && f.alive);
    if (!fortA || !fortB) return;

    const point = routeFarthestPointFromForts(route);
    if (!point) return;

    const cargoA = emptyResourceBundle();
    const cargoB = emptyResourceBundle();
    events.forEach(e => {
      const bucket = e.fromFortId === fortA.id ? cargoA : (e.fromFortId === fortB.id ? cargoB : null);
      if (!bucket) return;
      FORT_RESOURCE_TYPES.forEach(type => { bucket[type] = (bucket[type] || 0) + (e.cargo[type] || 0); });
    });

    const columns = [
      { title: t('map.fort_label', { id: fortA.id }), items: cargoToTooltipItems(cargoA) },
      { title: t('map.fort_label', { id: fortB.id }), items: cargoToTooltipItems(cargoB) }
    ];

    const merchantContainer = document.createElement('div');
    // Deliberately NOT relying on .map-icon's own absolute-position/self-
    // centering behavior for this container - that class is pointer-events:
    // none (see fortContainer's own comment on this same trick above), and
    // with no intrinsic size of its own an absolutely-positioned child
    // wouldn't give it one either, so hover would never register on it.
    // This container does the positioning/centering/sizing itself (exactly
    // like fortContainer does), and the actual icon inside is simplified to
    // just fill it, same override fortImg uses when nested this way.
    merchantContainer.style.position = 'absolute';
    merchantContainer.style.transform = 'translate(-50%, -50%)';
    merchantContainer.style.width = '3%';
    merchantContainer.style.minWidth = '20px';
    merchantContainer.style.aspectRatio = '1';
    merchantContainer.style.zIndex = '4';
    setWorldPosition(merchantContainer, wrap, point.x, point.y);
    merchantContainer.setAttribute('data-tooltip-columns', encodeTooltipItems(columns));

    const icon = document.createElement('img');
    icon.className = 'map-icon merchant-icon';
    icon.src = '/nest/assets/merchant_icon.png';
    icon.alt = t('map.fort_label', { id: fortA.id }) + ' \u2194 ' + t('map.fort_label', { id: fortB.id });
    // Exact same override set fortImg uses (see there) - position/zIndex/
    // transform/width/height/display all have to match, not just most of
    // them: .map-icon's own base rule sets its own z-index as part of its
    // absolute-positioning defaults, and position:relative alone doesn't
    // clear that - without this explicit zIndex override too, the icon
    // silently inherits whatever stacking .map-icon's default gives it
    // instead, which can bury it behind an earlier-painted layer (the
    // route/trail SVG, the map background) while everything else about it
    // - position, size - still looks perfectly correct.
    icon.style.position = 'relative';
    icon.style.zIndex = '1';
    icon.style.transform = 'none';
    icon.style.width = '100%';
    icon.style.height = 'auto';
    icon.style.display = 'block';
    merchantContainer.appendChild(icon);

    wrap.appendChild(merchantContainer);
  });
}

function renderMap() {
  const wrap = document.getElementById('mapWrap');
  const fortsTag = document.getElementById('fortsTag');
  const controlsContainer = document.getElementById('controls-containter');
  if (!wrap) return;

  initMapFullscreenToggle();

  wrap.classList.toggle('fort-placement-active', fortPlacementMode);
  wrap.classList.toggle('scan-placement-active', scanPlacementMode);

  const aliveForts = S.forts.filter(f => f.alive);
  if (fortsTag) {
    fortsTag.textContent = t('ui.forts_standing', { alive: aliveForts.length, total: S.forts.length });
  }

  wrap.innerHTML = '';
  if (controlsContainer) controlsContainer.innerHTML = '';

  ensureRoutesUpToDate();
  const routeLayer = buildRouteLayer();
  if (routeLayer) wrap.appendChild(routeLayer);

  const trailLayer = buildTrailLayer();
  if (trailLayer) wrap.appendChild(trailLayer);

  buildMerchantIcons(wrap);

  // Render icons for alive nests only
  S.nests.forEach((nest, idx) => {
    if (!nest.alive) return; // Skip and remove collapsed nests from the map

    const nestKey = 'nest_' + nest.id;
    const nestContainer = document.createElement('div');
    nestContainer.className = 'map-event nest-event' + (activeOpenMapKey === nestKey ? ' open' : '');
    nestContainer.dataset.nestId = nest.id;
    nestContainer.style.position = 'absolute';
    setWorldPosition(nestContainer, wrap, nest.x, nest.y);
    nestContainer.style.zIndex = '5';
    nestContainer.style.cursor = 'pointer';

    const nestImg = document.createElement('img');
    nestImg.src = '/nest/assets/nest_icon.png';
    nestImg.className = 'map-icon nest-icon';
    nestImg.title = t('map.nest_title') + ' ' + nest.id;
    nestContainer.appendChild(nestImg);

    nestContainer.onclick = (ev) => {
      toggleMapSelection(nestKey, ev);
    };
    wrap.appendChild(nestContainer);

    if (activeOpenMapKey === nestKey && controlsContainer && S.phase === 'active') {
      const analyticsBtn = document.createElement('img');
      analyticsBtn.className = 'plain-icon';
      analyticsBtn.src = '/nest/assets/inspect_nest_icon.png'
      analyticsBtn.title = t('map.nest_analytics_btn', { cost: S.settings.costNestAnalytics }) !== 'map.nest_analytics_btn'
        ? t('map.nest_analytics_btn', { cost: S.settings.costNestAnalytics })
        : `Analytika hniezda (${S.settings.costNestAnalytics} AP)`;
      analyticsBtn.disabled = S.gameOver || S.points < S.settings.costNestAnalytics;
      analyticsBtn.onclick = (ev) => {
        ev.stopPropagation();
        activeOpenMapKey = nestKey;
        openNestAnalyticsAction(idx);
      };

      const target = nestAttackTargetInfo(nest);
      const attackBtn = document.createElement('img');
      attackBtn.className = 'plain-icon';
      attackBtn.src = '/nest/assets/attack_nest_icon.png'
      const attackCost = target ? target.cost : 0;
      if (target) {
        const targetLabel = nestAttackTargetLabel(target.type);
        attackBtn.title = t('map.attack_nest_btn', { target: targetLabel, cost: attackCost }) !== 'map.attack_nest_btn'
          ? t('map.attack_nest_btn', { target: targetLabel, cost: attackCost })
          : `Zabiť ${targetLabel} (${attackCost} AP)`;
      } else {
        attackBtn.title = t('map.attack_nest_empty') !== 'map.attack_nest_empty'
          ? t('map.attack_nest_empty')
          : 'Niet koho zabiť';
      }
      attackBtn.disabled = S.gameOver || !target || S.points < target.cost;
      attackBtn.onclick = (ev) => {
        ev.stopPropagation();
        activeOpenMapKey = nestKey;
        attackNest(nest.id);
      };

      controlsContainer.appendChild(wrapButtonWithCostAbove(analyticsBtn, S.settings.costNestAnalytics));
      controlsContainer.appendChild(wrapButtonWithCostAbove(attackBtn, attackCost));
    }
  });

  const locationIcon = document.createElement('btn');
  locationIcon.className = 'map-icon location-icon';
  locationIcon.id = 'sandbox-location-icon';
  setWorldPosition(locationIcon, wrap, S.locationIcon.x, S.locationIcon.y);
  if (currentGameMode === 'sandbox') wrap.appendChild(locationIcon);

  if (DEBUG) debugRenderFortStrengthZones(wrap); // DEBUG - remove this line to disable fort-strength zone rings

  // Multiple nests can have a fort assault in flight at once, so collect
  // every targeted fort id rather than just the first pending 'fort' event.
  const activeTargetIds = new Set(
    S.events.filter(e => e.type === 'fort' && e.status === 'pending').map(e => e.targetFortId)
  );

  S.forts.forEach(f => {
    const fortKey = 'fort_' + f.id;
    const fortContainer = document.createElement('div');
    fortContainer.className = 'map-event fort-event' + (activeOpenMapKey === fortKey ? ' open' : '');
    fortContainer.dataset.fortId = f.id;
    fortContainer.style.position = 'absolute';
    setWorldPosition(fortContainer, wrap, f.x, f.y);
    fortContainer.style.transform = 'translate(-50%, -50%)';
    fortContainer.style.width = '4%';
    fortContainer.style.minWidth = '42px';
    fortContainer.style.display = 'inline-block';
    fortContainer.style.zIndex = '5';

    const fortImg = document.createElement('img');
    fortImg.src = '/nest/assets/fort_icon.png';
    let cls = 'map-icon fort-icon';

    const isUnderAssault = activeTargetIds.has(f.id);

    if (!f.alive) {
      cls += ' fallen';
      // Same pointer-events:none issue as the alive-fort peek tooltip
      // below - fortImg never actually receives the hover, so the title
      // has to live on fortContainer (the element that does) instead.
      fortContainer.title = t('map.fort_fallen', { id: f.id });
    } else {
      if (isUnderAssault) {
        cls += ' under-attack';
      }
      // Set on fortContainer, NOT fortImg: the base .map-icon CSS rule is
      // pointer-events:none (fort icons only opt back into pointer-events
      // for the .under-attack state - see style.css), so fortImg itself
      // never actually receives the hover in the normal case - the mouse
      // event passes straight through it to fortContainer underneath,
      // which is what carries the click handler/pointer cursor too. The
      // delegated listener's ev.target.closest('[data-tooltip-items], [data-tooltip-columns]')
      // only searches upward from wherever the event actually landed, so
      // an attribute sitting on a pointer-events:none descendant is
      // unreachable - this replaces the plain "Fort #ID (Defense: X/Y)"
      // native title entirely (this tooltip covers stock, not defense)
      // rather than risking both a native title AND this custom one
      // showing at once - same icons-only form as the cost-badge tooltip,
      // see buildFortPeekItems().
      ensureFortResourceFieldsInit(f);
      fortContainer.setAttribute('data-tooltip-items', encodeTooltipItems(buildFortPeekItems(f)));
      fortContainer.setAttribute('data-tooltip-stacked', '1'); // one resource per row - see showCustomTooltip()
      fortContainer.style.cursor = 'pointer';

      fortContainer.onclick = (ev) => {
        toggleMapSelection(fortKey, ev);
      };

      if (activeOpenMapKey === fortKey && controlsContainer) {
        if (S.phase === 'active') {
          const alreadyReinforced = Array.isArray(S.reinforcedForts) && S.reinforcedForts.includes(f.id);
          const reinforceBtn = document.createElement('img');
          reinforceBtn.src = '/nest/assets/increase_defense_icon.png'
          reinforceBtn.className = 'plain-icon';
          reinforceBtn.title = alreadyReinforced
            ? t('map.fort_reinforce_done_btn', { id: f.id })
            : t('map.fort_reinforce_btn', { cost: S.settings.fortReinforceCost, amount: S.settings.fortReinforceDefenseBonus });
          reinforceBtn.disabled = S.points < S.settings.fortReinforceCost || alreadyReinforced || !meetsFortActionRequirement(f, FORT_ACTION_COSTS.reinforceFort);
          reinforceBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = fortKey;
            reinforceFort(f.id);
          };

          const capacityBtn = document.createElement('img');
          capacityBtn.className = 'plain-icon';
          capacityBtn.src = '/nest/assets/expand_fort_icon.png'
          capacityBtn.title = t('map.fort_capacity_btn', { cost: S.settings.costIncreaseFortCapacity, amount: capacityIncreaseAmount(f.capacity, S.settings.fortCapacityIncreaseAmount) });
          capacityBtn.disabled = S.points < S.settings.costIncreaseFortCapacity || !meetsFortActionRequirement(f, FORT_ACTION_COSTS.increaseFortCapacity);
          capacityBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = fortKey;
            increaseFortCapacity(f.id);
          };

          const evacuateBtn = document.createElement('img');
          evacuateBtn.className = 'plain-icon';
          evacuateBtn.src = '/nest/assets/save_humans.png';
          evacuateBtn.title = t('map.evacuate_tooltip', { cost: S.settings.costSaveHumans, amount: S.settings.saveHumansAmount });
          evacuateBtn.disabled = S.gameOver || S.phase !== 'active' || S.points < S.settings.costSaveHumans || S.humans <= 0;
          evacuateBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = fortKey;
            saveHumans(f.id);
          };

          const scavengeBtn = document.createElement('img');
          scavengeBtn.className = 'plain-icon';
          scavengeBtn.src = '/nest/assets/scavenge_icon.PNG';
          scavengeBtn.title = t('map.fort_scavenge_btn', { cost: SCAVENGE_AP_COST });
          scavengeBtn.disabled = S.gameOver || S.points < SCAVENGE_AP_COST;
          scavengeBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = fortKey;
            scavengeFort(f.id);
          };

          // Free (no AP cost) - capped instead by canSustainOneMoreHybrid(),
          // so the button is just disabled outright rather than showing a
          // cost the player could conceivably pay but the fort can't back up.
          // See hireAtFort() for why the once-per-step throttle still exists
          // even though there's no cost to naturally rate-limit it.
          const hireBtn = document.createElement('img');
          hireBtn.className = 'plain-icon';
          hireBtn.src = '/nest/assets/logo_icon.png';
          const canHireHere = canSustainOneMoreHybrid(f);
          hireBtn.title = canHireHere
            ? t('map.fort_hire_btn', { count: f.hybrids || 0 })
            : t('map.fort_hire_unaffordable_btn', { count: f.hybrids || 0 });
          hireBtn.disabled = S.gameOver || S.phase !== 'active' || !canHireHere;
          hireBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = fortKey;
            hireAtFort(f.id);
          };

          controlsContainer.appendChild(wrapButtonWithCostAbove(reinforceBtn, S.settings.fortReinforceCost, false, FORT_ACTION_COSTS.reinforceFort, f));
          controlsContainer.appendChild(wrapButtonWithCostAbove(capacityBtn, S.settings.costIncreaseFortCapacity, false, FORT_ACTION_COSTS.increaseFortCapacity, f));
          controlsContainer.appendChild(wrapButtonWithCostAbove(evacuateBtn, S.settings.costSaveHumans));
          controlsContainer.appendChild(wrapButtonWithCostAbove(scavengeBtn, SCAVENGE_AP_COST));
          controlsContainer.appendChild(hireBtn);
        }

        const fortCapacity = Math.max(0, f.capacity || 0);
        const popField = document.createElement('div');
        popField.className = 'btn-container';
        const popLabelWrap = document.createElement('div');
        const popLabel = document.createElement('label');
        popLabel.className = 'sb-defense-label';
        popLabel.htmlFor = 'fortPopulationInput';
        const popLabelSpan = document.createElement('span');
        popLabelSpan.setAttribute('data-i18n', 'sandbox.lbl_population');
        popLabelSpan.textContent = t('sandbox.lbl_population');
        popLabel.appendChild(popLabelSpan);
        popLabelWrap.appendChild(popLabel);
        const popValueWrap = document.createElement('div');
        popValueWrap.className = 'sb-stat-value-wrap';
        const popInput = document.createElement('input');
        popInput.type = 'number';
        popInput.id = 'fortPopulationInput';
        popInput.min = '0';
        popInput.max = String(fortCapacity);
        popInput.value = String(Math.max(0, Math.min(Math.round(f.population || 0), fortCapacity)));
        popInput.readOnly = true;
        popInput.disabled = true;

        const popCapacitySuffix = document.createElement('span');
        popCapacitySuffix.id = 'fortPopulationCapacity';
        popCapacitySuffix.className = 'sb-stat-capacity';
        if (currentGameMode === 'sandbox') {
          const popCapacitySlash = document.createElement('span');
          popCapacitySlash.textContent = '/';
          const capacityInput = document.createElement('input');
          capacityInput.type = 'number';
          capacityInput.id = 'fortCapacityInput';
          capacityInput.className = 'sb-stat-capacity-input';
          capacityInput.min = '0';
          capacityInput.value = String(fortCapacity);
          capacityInput.readOnly = true;
          capacityInput.disabled = true;
          popCapacitySuffix.appendChild(popCapacitySlash);
          popCapacitySuffix.appendChild(capacityInput);
        } else {
          popCapacitySuffix.textContent = '/' + String(fortCapacity);
        }
        popValueWrap.appendChild(popInput);
        popValueWrap.appendChild(popCapacitySuffix);
        popField.appendChild(popLabelWrap);
        popField.appendChild(popValueWrap);
        controlsContainer.appendChild(popField);

        // Resources used to be shown inline here as a 3-column grid, but
        // the bottom bar doesn't have room for that plus a production and
        // a workers column too - see openFortResourcesOverlay() and
        // renderFortResourcesOverlayContent() further down for the actual
        // resource list, now in its own overlay.
        ensureFortResourceFieldsInit(f);

        const resourcesBtn = document.createElement('button');
        resourcesBtn.type = 'button';
        resourcesBtn.className = 'nest-btn control-btn';
        resourcesBtn.textContent = t('map.fort_resources_btn');
        resourcesBtn.onclick = (ev) => {
          ev.stopPropagation();
          openFortResourcesOverlay(f.id);
        };
        controlsContainer.appendChild(resourcesBtn);

        if (f.alive && f.marked) {
          const markNote = document.createElement('div');
          markNote.className = 'sb-fort-marked-note';
          markNote.textContent = '⚑ Skauti ju označili ako cieľ na dobytie';
          markNote.style.color = '#ff5252';
          markNote.style.fontSize = '0.8rem';
          markNote.style.marginTop = '2px';
          controlsContainer.appendChild(markNote);
        }

        if (currentGameMode === 'sandbox') {
          const defField = document.createElement('div');
          defField.className = 'btn-container';
          const defLabelWrap = document.createElement('div');
          const defLabel = document.createElement('label');
          defLabel.className = 'sb-defense-label';
          defLabel.htmlFor = 'fortDefenseInput';
          const defLabelSpan = document.createElement('span');
          defLabelSpan.setAttribute('data-i18n', 'sandbox.lbl_defense');
          defLabelSpan.textContent = t('sandbox.lbl_defense');
          defLabel.appendChild(defLabelSpan);
          defLabelWrap.appendChild(defLabel);
          const defInput = document.createElement('input');
          defInput.type = 'number';
          defInput.id = 'fortDefenseInput';
          defInput.min = '0';
          defInput.value = String(Math.max(0, f.defense || 0));
          defInput.readOnly = true;
          defInput.disabled = true;
          defField.appendChild(defLabelWrap);
          defField.appendChild(defInput);
          controlsContainer.appendChild(defField);
        }
      }
    }

    fortImg.className = cls;
    fortImg.style.position = 'relative';
    fortImg.style.zIndex = '1';
    fortImg.style.transform = 'none';
    fortImg.style.width = '100%';
    fortImg.style.height = 'auto';
    fortImg.style.display = 'block';

    const defBadge = document.createElement('span');
    defBadge.className = 'fort-def-badge';
    defBadge.textContent = f.alive ? f.defense : 0;
    defBadge.style.position = 'absolute';
    defBadge.style.top = '-2px';
    defBadge.style.right = '-4px';
    defBadge.style.background = 'rgba(0,0,0,0.85)';
    defBadge.style.color = f.alive ? '#ffb74d' : '#888888';
    defBadge.style.border = `1px solid ${f.alive ? '#ffb74d' : '#555555'}`;
    defBadge.style.fontSize = '0.7rem';
    defBadge.style.fontFamily = 'IBM Plex Mono, monospace';
    defBadge.style.fontWeight = 'bold';
    defBadge.style.padding = '1px 4px';
    defBadge.style.borderRadius = '3px';
    defBadge.style.pointerEvents = 'none';
    defBadge.style.zIndex = '6';
    defBadge.style.lineHeight = '1';

    fortContainer.appendChild(fortImg);
    fortContainer.appendChild(defBadge);

    // Critical-demand badge: top-left counterpart to defBadge above,
    // shows an icon (not text - see getCriticalDemandTypes(), nest-core.js)
    // for whichever resource(s) this fort holds under 50% of what it's
    // asking for. Hidden entirely (updateFortDemandBadge, below) when
    // nothing qualifies. When more than one resource qualifies at once, it
    // cycles through all of them a second at a time rather than picking
    // just one - see tickFortDemandBadges()'s setInterval further down.
    const demandBadge = document.createElement('span');
    demandBadge.className = 'fort-demand-badge';
    demandBadge.dataset.fortId = f.id;
    demandBadge.style.position = 'absolute';
    demandBadge.style.top = '-2px';
    demandBadge.style.left = '-4px';
    demandBadge.style.background = '#ffffff';
    demandBadge.style.border = '1px solid #e02020';
    demandBadge.style.padding = '1px 3px';
    demandBadge.style.borderRadius = '3px';
    demandBadge.style.pointerEvents = 'none';
    demandBadge.style.zIndex = '6';
    demandBadge.style.lineHeight = '1';
    demandBadge.style.display = 'none'; // shown by updateFortDemandBadge() below, only if something actually qualifies

    const demandIcon = document.createElement('img');
    demandIcon.style.display = 'block';
    demandIcon.style.width = '11px';
    demandIcon.style.height = '11px';
    demandIcon.style.objectFit = 'contain';
    demandBadge.appendChild(demandIcon);

    fortContainer.appendChild(demandBadge);
    if (f.alive) updateFortDemandBadge(f, demandBadge);

    if (f.alive && f.marked) {
      const glow = document.createElement('div');
      glow.className = 'fort-pheromone-glow';
      glow.style.position = 'absolute';
      glow.style.left = '-45%';
      glow.style.top = '-45%';
      glow.style.width = '190%';
      glow.style.height = '190%';
      glow.style.borderRadius = '50%';
      glow.style.pointerEvents = 'none';
      glow.style.zIndex = '0';
      glow.style.background =
        'radial-gradient(circle, ' +
        'rgba(180, 70, 255, 0.72) 0%, ' +
        'rgba(150, 40, 255, 0.42) 32%, ' +
        'rgba(120, 0, 255, 0.18) 52%, ' +
        'rgba(100, 0, 255, 0) 75%)';
      glow.style.filter = 'blur(5px)';
      glow.style.opacity = '0.9';

      fortContainer.insertBefore(glow, fortContainer.firstChild);
    }

    const capacity = Math.max(0, f.capacity || 0);
    // Population is always a whole number of people (see the comment on
    // fort.population in consumeFortFood(), nest-core.js) - Math.round here
    // is defensive display-side insurance, same spirit as the resource
    // panel's roundResource() call, so a stray drifted value never reaches
    // the player even if some future code path forgets to keep it clean.
    const population = Math.max(0, Math.min(Math.round(f.population || 0), capacity));
    const popPct = capacity > 0 ? (population / capacity) * 100 : 0;

    const popBarTrack = document.createElement('div');
    popBarTrack.className = 'fort-pop-bar';
    popBarTrack.title = t('map.fort_population', { pop: population, cap: capacity });

    const popBarFill = document.createElement('div');
    popBarFill.className = 'fort-pop-bar-fill';
    popBarFill.style.width = popPct + '%';
    popBarTrack.appendChild(popBarFill);

    fortContainer.appendChild(popBarTrack);
    wrap.appendChild(fortContainer);
  });

  const activeMapEvents = S.events.filter(e => {
    if (e.status !== 'pending') return false;
    if (e._hideOnMap) return false;
    if (isHiddenFortMarkScout(e)) return false;
    if (e.type === 'search' && e.fortMarkScout && (e.groupSize || 1) - (e.killed || 0) <= 0) return false;
    if (e.type === 'search' && !e.fortMarkScout && e.outcome) return false;
    if (e.type === 'hunt' && (e.neutralized + e.killed >= e.groupSize)) return false;
    if (e.type === 'fort' && (e.originalAttackers - e.killed <= 0)) return false;
    return e.type === 'search' || e.type === 'hunt' || e.type === 'fort';
  });

  activeMapEvents.forEach(e => {
    const eventKey = 'event_' + e.id;

    if (e.type === 'search' && e.fortMarkScout) {
      const targetFort = S.forts.find(f => f.id === e.targetFortId);
      // Destroyed forts stay in S.forts (alive:false) rather than being
      // removed, so a lookup by id alone still succeeds after the fort is
      // gone - without the alive check, a marking scout keeps rendering as
      // if it's still en route to a fort that's already been conquered,
      // right up until its event actually resolves next step (which does
      // correctly check .alive and simply drops the mark).
      if (!targetFort || !targetFort.alive) return;

      const remaining = Math.max(0, (e.groupSize || 1) - (e.killed || 0));
      if (remaining <= 0) return;

      // One icon per occupied ring position, not per scout - several
      // revealed scouts can share a bucket once there are more than
      // MARKING_RING_SIZE of them (see markingScoutRingBucket in
      // script.js / MARKING_RING_SIZE in nest-core.js), which is what caps
      // the display at MARKING_RING_SIZE icons no matter how large the
      // wave gets.
      const revealedSlots = Array.isArray(e.scoutSlots)
        ? e.scoutSlots.filter(s => !s.hidden)
        : [];

      const occupiedBuckets = [...new Set(revealedSlots.map(s => markingScoutRingBucket(s.slot)))];

      e.iconPositions = occupiedBuckets.map(bucket => markingScoutSlotPosition(targetFort, bucket));

      if (e.iconPositions.length === 0) return;

      e.iconPositions.forEach((pos) => {
        const container = document.createElement('div');
        container.className =
          'map-event' + (activeOpenMapKey === eventKey ? ' open' : '');

        container.style.position = 'absolute';
        container.dataset.eventId = e.id;
        container.dataset.eventType = e.type;
        setWorldPosition(container, wrap, pos.x, pos.y);
        container.style.zIndex = '12';

        const iconImg = document.createElement('img');
        iconImg.className = 'map-icon event-icon';
        iconImg.src = '/nest/assets/scout.png';
        iconImg.title = t('event.fort_attacker_map', { count: remaining, id: targetFort.id });

        iconImg.onclick = (ev) => {
          toggleMapSelection(eventKey, ev);
        };

        container.appendChild(iconImg);
        wrap.appendChild(container);
      });

      if (activeOpenMapKey === eventKey && controlsContainer) {
        const infoBtn = document.createElement('button');
        infoBtn.className = 'nest-btn control-btn map-action-btn';
        infoBtn.textContent = 'ℹ';
        infoBtn.title = t('ui.info_btn');

        infoBtn.onclick = (ev) => {
          ev.stopPropagation();
          activeOpenMapKey = null;
          openEventDetails(e.id);
        };

        const killBtn = document.createElement('img');
        killBtn.className = 'btn-icon';
        killBtn.src = '../sim/assets/THREAT.png';
        killBtn.title = t('actions.kill_scout_tooltip', {
          cost: S.settings.costKillScout
        });

        if (S.points < S.settings.costKillScout) {
          killBtn.style.opacity = '0.5';
          killBtn.style.pointerEvents = 'none';
        } else {
          killBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = eventKey;
            killMarkingScout(e.id);
          };
        }

        controlsContainer.appendChild(
          wrapButtonWithCostAbove(
            killBtn,
            S.settings.costKillScout,
            true
          )
        );

        controlsContainer.appendChild(infoBtn);
      }

      return;
    }

    if (e.type === 'fort') {
      const targetFort = S.forts.find(f => f.id === e.targetFortId);
      // Same stale-lookup issue as the fortMarkScout case above: a fort
      // conquered by a RIVAL nest's assault this step can still be found
      // here (alive:false, but not removed from S.forts), so without this
      // check an in-flight attack from this nest keeps rendering against a
      // fort that no longer exists.
      if (!targetFort || !targetFort.alive) return;
      const rem = Math.max(0, e.originalAttackers - e.killed);
      if (rem <= 0) return;

      const count = Math.max(1, Math.ceil(rem / 10));

      if (e.iconPositions) {
        while (e.iconPositions.length > count) {
          e.iconPositions.pop();
        }
      }

      if (!e.iconPositions) {
        const originalCount = count;
        e.iconPositions = [];

        for (let i = 0; i < originalCount; i++) {
          const angle = (2 * Math.PI * i) / originalCount - Math.PI / 2;

          e.iconPositions.push({
            x: Math.max(
              3,
              Math.min(
                97,
                targetFort.x + (DIST_FROM_FORT / WORLD_ASPECT_RATIO) * Math.cos(angle)
              )
            ),
            y: Math.max(
              3,
              Math.min(
                97,
                targetFort.y + DIST_FROM_FORT * Math.sin(angle)
              )
            )
          });
        }
      }

      e.iconPositions.forEach((pos) => {
        const container = document.createElement('div');
        container.className = 'map-event' + (activeOpenMapKey === eventKey ? ' open' : '');
        container.style.position = 'absolute';
        setWorldPosition(container, wrap, pos.x, pos.y);
        container.style.zIndex = '10';

        const iconImg = document.createElement('img');
        iconImg.className = 'map-icon event-icon';
        iconImg.src = '/nest/assets/predator.png';
        iconImg.title = t('event.fort_attacker_map', { count: rem, id: targetFort.id });

        iconImg.onclick = (ev) => {
          toggleMapSelection(eventKey, ev);
        };

        container.appendChild(iconImg);
        wrap.appendChild(container);
      });

      if (activeOpenMapKey === eventKey && controlsContainer) {
        const infoBtn = document.createElement('button');
        infoBtn.className = 'nest-btn control-btn map-action-btn';
        infoBtn.textContent = 'ℹ';
        infoBtn.title = t('ui.info_btn');
        infoBtn.onclick = (ev) => {
          ev.stopPropagation();
          activeOpenMapKey = null;
          openEventDetails(e.id);
        };

        const rightBtn = document.createElement('img');
        rightBtn.className = 'btn-icon';
        rightBtn.src = '../sim/assets/THREAT.png';
        rightBtn.title = t('actions.defend_fort_tooltip', { id: targetFort.id, cost: S.settings.costKillFortAttacker });
        
        if (S.points < S.settings.costKillFortAttacker) {
          rightBtn.style.opacity = '0.5';
          rightBtn.style.pointerEvents = 'none';
        } else {
          rightBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = eventKey;
            killFortAttacker(e.id);
          };
        }

        controlsContainer.appendChild(infoBtn);
        controlsContainer.appendChild(wrapButtonWithCostAbove(rightBtn, S.settings.costKillFortAttacker, false, FORT_ACTION_COSTS.fortDefense, targetFort));
      }
      return;
    }

    if (e.x === undefined || e.y === undefined) assignEventCoords(e);

    const container = document.createElement('div');
    container.className = 'map-event' + (activeOpenMapKey === eventKey ? ' open' : '');
    container.style.position = 'absolute';
    container.dataset.eventId = e.id;
    container.dataset.eventType = e.type;
    setWorldPosition(container, wrap, e.x, e.y);
    container.style.zIndex = '10';

    const iconImg = document.createElement('img');
    iconImg.className = 'map-icon event-icon';

    if (e.type === 'search') {
      iconImg.src = '/nest/assets/scout.png';
      iconImg.title = t('event.search_patrol_map');
    } else {
      iconImg.src = '/nest/assets/predator.png';
      const activeHunters = e.groupSize - (e.neutralized + e.killed);
      iconImg.title = t('event.hunt_map_title', { active: activeHunters, groupSize: e.groupSize });
    }

    iconImg.onclick = (ev) => {
      toggleMapSelection(eventKey, ev);
    };

    if (activeOpenMapKey === eventKey && controlsContainer) {
      const infoBtn = document.createElement('button');
      infoBtn.className = 'nest-btn control-btn map-action-btn';
      infoBtn.textContent = 'ℹ';
      infoBtn.title = t('ui.info_btn');

      infoBtn.onclick = (ev) => {
        ev.stopPropagation();
        activeOpenMapKey = null;
        openEventDetails(e.id);
      };

      const leftBtn = document.createElement('button');
      leftBtn.className = 'nest-btn control-btn map-action-btn';

      const rightBtn = document.createElement('img');
      rightBtn.className = 'btn-icon';
      rightBtn.src = '../sim/assets/THREAT.png';

      if (e.type === 'search') {
        const leftButton = document.createElement('img');
        leftButton.title = t('actions.distract_tooltip', {
          cost: S.settings.costDistractScout
        });
        leftButton.disabled = S.points < S.settings.costDistractScout;
        leftButton.className = 'btn-icon';
        leftButton.id = 'distract-scout-icon';
        leftButton.src = '/nest/assets/distract-scout.png';

        leftButton.onclick = (ev) => {
          ev.stopPropagation();
          activeOpenMapKey = eventKey;
          distractScout(e.id);
        };

        rightBtn.title = t('actions.kill_scout_tooltip', {
          cost: S.settings.costKillScout
        });

        if (S.points < S.settings.costKillScout) {
          rightBtn.style.opacity = '0.5';
          rightBtn.style.pointerEvents = 'none';
        } else {
          rightBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = eventKey;
            killScout(e.id);
          };
        }

        controlsContainer.appendChild(
          wrapButtonWithCostAbove(leftButton, S.settings.costDistractScout, true)
        );

        controlsContainer.appendChild(
          wrapButtonWithCostAbove(rightBtn, S.settings.costKillScout, true)
        );

        controlsContainer.appendChild(infoBtn);

      } else {
        const leftButton = document.createElement('img');
        leftButton.className = 'plain-icon';
        leftButton.id = 'save-human-btn';
        leftButton.src = '/nest/assets/save_humans.png';
        const humansAlreadySaved = e.routeHunt && (e.neutralized || 0) >= MERCHANT_PAIR_SIZE;
        leftButton.title = humansAlreadySaved
          ? (t('actions.rescue_all_saved_tooltip') !== 'actions.rescue_all_saved_tooltip'
              ? t('actions.rescue_all_saved_tooltip')
              : 'Obaja ľudia z tejto karavány sú už v bezpečí.')
          : t('actions.rescue_tooltip', { cost: S.settings.costEscapePredator });

        if (S.points < S.settings.costEscapePredator || humansAlreadySaved) {
          leftButton.style.opacity = '0.5';
          leftButton.style.pointerEvents = 'none';
        } else {
          leftButton.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = eventKey;
            escapePredator(e.id);
          };
        }

        rightBtn.title = t('actions.kill_predator_tooltip', {
          cost: S.settings.costKillPredator
        });

        if (S.points < S.settings.costKillPredator) {
          rightBtn.style.opacity = '0.5';
          rightBtn.style.pointerEvents = 'none';
        } else {
          rightBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = eventKey;
            killPredatorAction(e.id);
          };
        }

        controlsContainer.appendChild(
          wrapButtonWithCostAbove(leftButton, S.settings.costEscapePredator)
        );

        controlsContainer.appendChild(
          wrapButtonWithCostAbove(rightBtn, S.settings.costKillPredator, true)
        );

        controlsContainer.appendChild(infoBtn);
      }
    }

    container.appendChild(iconImg);
    wrap.appendChild(container);
  });

  // A step animation may still be in flight (its promises resolve on their
  // own schedule regardless of what the DOM is doing) even though this
  // renderMap() call is happening now - e.g. from a map-icon click or a
  // Kill/Rescue/Distract button firing mid-animation. Put any still-
  // animating scout/predator icons back on top of the nest/fort/trail
  // layers just built above, instead of leaving them wiped by the
  // wrap.innerHTML reset earlier in this function.
  reattachLiveTempIcons(wrap);

  if (typeof window.sandboxOnMapRendered === 'function') window.sandboxOnMapRendered();
}

document.addEventListener('click', (ev) => {
  if (scanPlacementMode) {
    if (ev.target.closest('#scan-btn')) return;

    const wrap = document.getElementById('mapWrap');
    if (wrap && wrap.contains(ev.target)) {
      scanAt(ev.clientX, ev.clientY);
    } else {
      scanPlacementMode = false;
      render();
    }
    return;
  }

  if (fortPlacementMode) {
    if (ev.target.closest('#build-fort-btn')) return; // handled by buildFort()'s own onclick (toggles off)

    const wrap = document.getElementById('mapWrap');
    if (wrap && wrap.contains(ev.target)) {
      placeFortAt(ev.clientX, ev.clientY);
    } else {
      cancelFortPlacement();
    }
    return;
  }

  if (!ev.target.closest('.map-event') && !ev.target.closest('#controls-containter')) {
    if (activeOpenMapKey !== null) {
      activeOpenMapKey = null;
      renderMap();
    }
  }
});

function renderLog(){
  const list = document.getElementById('logList');
  if(!list) return;
  list.innerHTML = '';
  S.log.slice(0,60).forEach(entry=>{
    const li = document.createElement('li');
    li.innerHTML = entry.msg;
    list.appendChild(li);
  });
}

function simulateForecast(numSteps = 10) {
  if (!S || S.gameOver) return { labels: [], humans: [], insects: [], insectsByNest: [], adultInsectsByNest: [] };

  const realState = S;
  const realRender = render;

  const simState = structuredClone(S);

  const forecastHumans = [];
  const forecastInsects = [];
  const forecastLabels = [];
  // Per-step snapshot of every nest's insect count, so the chart can plot a
  // forecast line for each nest, not just whichever nest is selected.
  const forecastInsectsByNest = [];
  // Adult-only counterpart of forecastInsectsByNest, used by the chart
  // (see totalAdultInsectsForNest() in nest-core.js).
  const forecastAdultInsectsByNest = [];

  try {
    S = simState;
    render = function() {}; 

    for (let i = 1; i <= numSteps; i++) {
      if (S.gameOver) break;

      // advanceStepLogic() already advances every nest in S.nests per step
      // (restoring S.activeNestIndex to focusedNestIndex afterwards), so a
      // single forward pass gives us a valid forecast for all nests at once.
      advanceStepLogic();

      forecastLabels.push(`${t('chart.step')} ${S.step}`);
      forecastHumans.push(S.humans);
      forecastInsects.push(totalInsectsAll());
      forecastInsectsByNest.push(insectsByNestSnapshot());
      forecastAdultInsectsByNest.push(adultInsectsByNestSnapshot());
    }
  } finally {
    S = realState;
    render = realRender;
  }

  return {
    labels: forecastLabels,
    humans: forecastHumans,
    insects: forecastInsects,
    insectsByNest: forecastInsectsByNest,
    adultInsectsByNest: forecastAdultInsectsByNest
  };
}

// Color palette cycled across nests for the per-nest insect lines. Kept
// short and high-contrast since MIN_NEST_DIST_FROM_OTHER_NEST-generated
// sandboxes are usually just 2-4 nests; cycles if there are ever more.
const NEST_CHART_COLORS = ['#c62828', '#6a1b9a', '#f57f17', '#00838f', '#ad1457', '#4527a0'];

function renderChart() {
  const ctx = document.getElementById('popChart');
  if (!ctx) return;

  const forecast = simulateForecast(10);

  const actualLabels = S.history.map(h => `${t('chart.step')} ${h.step}`);
  const combinedLabels = [...actualLabels, ...forecast.labels];
  const lastIndex = S.history.length - 1;

  // Humans are a shared pool across all nests (see MULTI-NEST SUPPORT notes
  // above), so there's only ever one humans line - unlike insects below.
  const actualHumans = [...S.history.map(h => h.humans), ...Array(forecast.labels.length).fill(null)];
  const forecastHumansData = Array(combinedLabels.length).fill(null);
  if (lastIndex >= 0) {
    forecastHumansData[lastIndex] = S.humans;
    forecast.humans.forEach((val, i) => {
      forecastHumansData[lastIndex + 1 + i] = val;
    });
  }

  // One actual+forecast dataset pair per nest (including fallen nests, so
  // their line simply stops rather than vanishing from the legend), each
  // continuing from that nest's own last known value - not the combined
  // total across all nests.
  const nestDatasets = [];
  S.nests.forEach((nest, i) => {
    const nestId = nest.id;
    const color = NEST_CHART_COLORS[i % NEST_CHART_COLORS.length];
    const nestLabel = t('analytics.nest_label') !== 'analytics.nest_label'
      ? t('analytics.nest_label', { id: nestId })
      : `Nest ${nestId}`;

    const historyInsectsForNest = h =>
      (h.adultInsectsByNest && Object.prototype.hasOwnProperty.call(h.adultInsectsByNest, nestId))
        ? h.adultInsectsByNest[nestId]
        : (i === 0 ? h.adultInsects : null); // pre-adult-tracking history only had a combined total

    const actualInsects = [...S.history.map(historyInsectsForNest), ...Array(forecast.labels.length).fill(null)];
    const forecastInsectsData = Array(combinedLabels.length).fill(null);

    if (lastIndex >= 0) {
      forecastInsectsData[lastIndex] = nest.alive ? totalAdultInsectsForNest(nest) : 0;
      forecast.adultInsectsByNest.forEach((snapshot, j) => {
        forecastInsectsData[lastIndex + 1 + j] = Object.prototype.hasOwnProperty.call(snapshot, nestId)
          ? snapshot[nestId]
          : null;
      });
    }

    nestDatasets.push({
      label: `${t('chart.insects_actual')} - ${nestLabel}`,
      pairId: 'nest_' + nestId,
      pairLabel: nestLabel,
      data: actualInsects,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      tension: 0.2,
      fill: false
    });
    nestDatasets.push({
      label: `${t('chart.insects_forecast')} - ${nestLabel}`,
      pairId: 'nest_' + nestId,
      pairLabel: nestLabel,
      data: forecastInsectsData,
      borderColor: color,
      backgroundColor: color,
      borderDash: [5, 5],
      pointRadius: 0,
      pointHoverRadius: 0,
      borderWidth: 2,
      tension: 0.2,
      fill: false
    });
  });

  const expectedDatasetCount = 2 + nestDatasets.length;
  if (chart && chart.data.datasets.length !== expectedDatasetCount) {
    chart.destroy();
    chart = null;
  }

  const humansPairLabel = t('chart.humans') !== 'chart.humans' ? t('chart.humans') : 'Ľudia';

  const allDatasets = [
    {
      label: t('chart.humans_actual'),
      pairId: 'humans',
      pairLabel: humansPairLabel,
      data: actualHumans,
      borderColor: '#2e7d32',
      backgroundColor: 'rgba(46, 125, 50, 0.1)',
      borderWidth: 2,
      tension: 0.2,
      fill: false
    },
    {
      label: t('chart.humans_forecast'),
      pairId: 'humans',
      pairLabel: humansPairLabel,
      data: forecastHumansData,
      borderColor: '#2e7d32',
      backgroundColor: '#2e7d32',
      borderDash: [5, 5],
      pointRadius: 0,
      pointHoverRadius: 0,
      borderWidth: 2,
      tension: 0.2,
      fill: false
    },
    ...nestDatasets
  ];

  if (!chart) {
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: combinedLabels,
        datasets: allDatasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: {
            display: true,
            labels: {
              boxWidth: 12,
              font: { size: 9 },
              // Collapse each entity's actual+forecast dataset pair into a
              // single legend entry (one per pairId) instead of Chart.js's
              // default one-entry-per-dataset behaviour, so the legend
              // reads "Humans / Nest 1 / Nest 2 / ..." rather than
              // "Humans (Actual) / Humans (Forecast) / Insects (Actual) -
              // Nest 1 / ...".
              generateLabels(chartInstance) {
                const seen = new Map();
                chartInstance.data.datasets.forEach((ds, idx) => {
                  const pairId = ds.pairId || ds.label;
                  if (!seen.has(pairId)) {
                    seen.set(pairId, {
                      text: ds.pairLabel || ds.label,
                      fillStyle: ds.borderColor,
                      strokeStyle: ds.borderColor,
                      lineWidth: 2,
                      hidden: !chartInstance.isDatasetVisible(idx),
                      datasetIndexes: [idx]
                    });
                  } else {
                    seen.get(pairId).datasetIndexes.push(idx);
                  }
                });
                return Array.from(seen.values());
              }
            },
            // Toggling a merged legend entry hides/shows every dataset in
            // its pair together (both the solid actual line and its dashed
            // forecast continuation), not just whichever one happened to
            // generate the legend entry.
            onClick(evt, legendItem, legend) {
              const chartInstance = legend.chart;
              const idxs = legendItem.datasetIndexes || [legendItem.datasetIndex];
              const nowVisible = !chartInstance.isDatasetVisible(idxs[0]);
              idxs.forEach(i => chartInstance.setDatasetVisibility(i, nowVisible));
              chartInstance.update();
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#000000', font: { family: 'IBM Plex Mono', size: 10 } },
            grid: { color: '#cccccc' },
            title: { display: true, text: t('chart.step'), color: '#000000', font: { size: 10, weight: 'bold' } }
          },
          y: {
            ticks: { color: '#000000', font: { family: 'IBM Plex Mono', size: 10 } },
            grid: { color: '#cccccc' }
          }
        }
      }
    });
  } else {
    chart.data.labels = combinedLabels;
    allDatasets.forEach((ds, i) => {
      chart.data.datasets[i].data = ds.data;
      chart.data.datasets[i].label = ds.label;
      chart.data.datasets[i].pairId = ds.pairId;
      chart.data.datasets[i].pairLabel = ds.pairLabel;
    });
    chart.update();
  }
}

function renderOverlay(){
  const ov = document.getElementById('gameOverOverlay');
  if(S.gameOver){
    const allFortsConquered = S.forts.length === 0 || S.forts.every(f => !f.alive);
    const isVictory = S.lastTriggeredCondition && S.lastTriggeredCondition.outcome === 'victory';
    document.getElementById('overTitle').textContent = isVictory ? 'Víťazstvo' : ((S.humans<=0 && allFortsConquered) ? t('gameover.humanity_fallen') : t('gameover.nest_collapsed'));
    {
      const daysVal = Math.round(S.step*12/24*10)/10;
      document.getElementById('overText').textContent = t('gameover.survived_msg', {
        msg: S.gameOverMsg,
        step: S.step,
        stepWord: wordForm('noun.step', S.step),
        days: daysVal,
        dayWord: wordForm('noun.day', daysVal)
      });
    }
    ov.classList.remove('hidden');
  } else {
    ov.classList.add('hidden');
  }
}

function setupCollapseButtons() {
  document.querySelectorAll('.panel-collapse-btn').forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const panel = btn.closest('.panel');
      if (panel) panel.classList.toggle('collapsed');
    };
  });
}

/* ============================================================================================
 * LEVEL LOADING -- sandbox export & custom levels
 * ============================================================================================ */

let CURRENT_LEVEL = null; // Aktuálne načítaný level (alebo null pre sandbox)

function resolveAssetUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(data:|blob:|https?:)/i.test(trimmed)) return trimmed;

  const normalized = trimmed.replace(/\\/g, '/');

  try {
    if (normalized.startsWith('/')) {
      return new URL(normalized, window.location.href).href;
    }

    if (normalized.includes('/')) {
      return new URL(normalized, window.location.href).href;
    }

    return new URL(`assets/${normalized}`, window.location.href).href;
  } catch (e) {
    return normalized.startsWith('/') ? normalized : `assets/${normalized}`;
  }
}

function normalizeLevelData(rawLevel) {
  if (!rawLevel || typeof rawLevel !== 'object') return null;
  const defLocIcon = {x: 10, y: 10};

  // Supports both the multi-nest `nests: [{x,y,id,population}, ...]` format
  // and the legacy single `nest: {x,y}` format. Both are kept on the
  // returned object: `nests` (array, used by initGame()'s campaign loader
  // when present) and `nest` (first nest's {x,y}, kept for any older code
  // that still only reads the singular field) so neither format silently
  // loses nests.
  const rawNests = rawLevel.nests || (rawLevel.map && rawLevel.map.nests) || null;
  const rawNest = rawLevel.nest || (rawLevel.map && rawLevel.map.nest) || null;
  const nests = Array.isArray(rawNests) && rawNests.length > 0
    ? rawNests.map((n, index) => ({
        id: n.id ?? index + 1,
        x: Number(n.x),
        y: Number(n.y),
        ...(n.population != null ? { population: n.population } : {})
      }))
    : (rawNest ? [{ id: rawNest.id ?? 1, x: Number(rawNest.x), y: Number(rawNest.y) }] : null);
  const nest = rawNest
    ? { x: Number(rawNest.x), y: Number(rawNest.y) }
    : (nests && nests[0] ? { x: nests[0].x, y: nests[0].y } : null);

  const locationIcon = rawLevel.locationIcon || (rawLevel.map && rawLevel.map.locationIcon) || defLocIcon;
  const forts = rawLevel.forts || (rawLevel.map && rawLevel.map.forts) || [];
  const background = rawLevel.background || rawLevel.bg || rawLevel.image || rawLevel.map || null;
  const settings = rawLevel.settings || rawLevel;

  return {
    ...rawLevel,
    id: rawLevel.id || rawLevel.name || 'custom-level',
    name: rawLevel.name || rawLevel.title || 'Custom level',
    title: rawLevel.title || rawLevel.name || 'Custom level',
    description: rawLevel.description || '',
    intro: rawLevel.intro || '',
    background: background ? resolveAssetUrl(background) : null,
    nest,
    nests,
    locationIcon: locationIcon && {
      x: Number(locationIcon.x),
      y: Number(locationIcon.y)
    },
    forts: Array.isArray(forts)
      ? forts.map((f, index) => ({
          ...f,
          id: f.id ?? index + 1,
          x: Number(f.x),
          y: Number(f.y),
          defense: f.defense ?? 50,
          maxDefense: f.maxDefense ?? f.defense ?? 50,
          alive: f.alive ?? true
        }))
      : [],
    conditions: normalizeLevelConditions(rawLevel.conditions || rawLevel.objectives || rawLevel.goals || []),
    settings: settings && typeof settings === 'object' ? { ...settings } : {}
  };
}

function loadCampaignLevelObject(obj) {
  const level = normalizeLevelData(obj);
  if (!level || (!level.nest && !level.nests)) return null;

  CURRENT_LEVEL = level;
  loadedLevelData = level;

  if (level.settings && typeof applyLevelSettingsToInputs === 'function') {
    applyLevelSettingsToInputs(level.settings);
  }

  if (level.background) {
    setMapBackground(level.background);
  }

  return level;
}

async function fetchCampaignLevelData(filePath) {
  if (!filePath) return null;

  try {
    const url = resolveAssetUrl(filePath) || filePath;
    const res = await fetch(url);
    if (!res.ok) return null;
    const rawLevel = await res.json();
    const level = normalizeLevelData(rawLevel);
    if (!level || (!level.nest && !level.nests)) return null;
    return level;
  } catch (e) {
    console.warn(`Nepodarilo sa načítať JSON mapy zo súboru ${filePath}:`, e);
    return null;
  }
}

// Úprava setMapBackground pre podporu lokálnych Blob/Data URL
function setMapBackground(filename) {
  const wrap = document.getElementById('mapWrap');
  if (!wrap) return;

  const resolved = resolveAssetUrl(filename);
  if (!resolved) {
    wrap.style.backgroundImage = '';
    return;
  }

  wrap.style.backgroundImage = `url('${resolved}')`;
  wrap.style.backgroundSize = 'cover';
  wrap.style.backgroundPosition = 'center';
}

/**
 * Pokus o automatické overenie/načítanie obrázka mapy z relatívnej cesty.
 */
function tryAutoLoadMapImage(bgPath) {
  return new Promise((resolve) => {
    const src = resolveAssetUrl(bgPath) || bgPath;

    const img = new Image();
    img.onload = () => {
      if (CURRENT_LEVEL) CURRENT_LEVEL.background = src;
      resolve(true);
    };
    img.onerror = () => {
      resolve(false); // Zlyhalo alebo prehliadač zablokoval prístup
    };
    img.src = src;
  });
}

/**
 * Výzva pre používateľa na samostatné načítanie obrázka mapy.
 */
function promptUserForMapImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const imageUrl = URL.createObjectURL(file);
        if (CURRENT_LEVEL) {
          CURRENT_LEVEL.background = imageUrl;
        }
      }
      resolve();
    };

    // Ošetrenie prípadu, ak používateľ zatvorí dialógové okno bez výberu
    window.addEventListener('focus', function onFocus() {
      window.removeEventListener('focus', onFocus);
      setTimeout(() => resolve(), 300);
    }, { once: true });

    input.click();
  });
}

/**
 * Spracuje načítaný JSON súbor vlastného levelu.
 */
function loadCustomLevelFile(jsonFile) {
  if (!jsonFile) return;

  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const levelData = JSON.parse(e.target.result);

      // Normalizácia dát levelu pre potreby initGame(). Podporuje formát
      // viacerých hniezd `nests: [{x,y,...}]` aj starší formát jedného
      // hniezda `nest: {x,y}` (initGame() vie spracovať oba).
      CURRENT_LEVEL = {
        nest: levelData.nest || (levelData.map && levelData.map.nest) || null,
        nests: levelData.nests || (levelData.map && levelData.map.nests) || null,
        locationIcon: levelData.locationIcon || (levelData.map && levelData.map.locationIcon) || { x: 10, y: 10 },
        forts: levelData.forts || (levelData.map && levelData.map.forts) || [],
        background: levelData.background || null,
        settings: levelData.settings || levelData,
        humans: levelData.humans ?? levelData.startHumans ?? 200,
        food: levelData.food ?? levelData.startFood ?? 200,
        population: levelData.population || (levelData.map && levelData.map.population) || null
      };

      if (!CURRENT_LEVEL.nest && !CURRENT_LEVEL.nests) {
        alert('Chyba: JSON súbor neobsahuje platné súradnice hniezda (nest/nests)!');
        return;
      }

      // Aplikovanie nastavení do HTML formulárových prvkov
      if (CURRENT_LEVEL.settings) {
        applyLevelSettingsToInputs(CURRENT_LEVEL.settings);
      }

      // Pokus o načítanie obrázka pozadia (s ošetrením chýb)
      if (CURRENT_LEVEL.background) {
        try {
          await tryAutoLoadMapImage(CURRENT_LEVEL.background);
        } catch (imgErr) {
          console.warn('Obrázok pozadia sa nepodarilo automaticky načítať:', imgErr);
        }
      }

      // Spustenie načítaného levelu
      startCustomLevel();

    } catch (err) {
      console.error('Chyba pri spracovaní JSON súboru levelu:', err);
      alert('Chyba pri načítavaní levelu. Uistite sa, že súbor má správny formát JSON.');
    }
  };

  reader.readAsText(jsonFile);
}

/**
 * Spustenie pripraveného custom levelu
 */

function startCustomLevel() {
  if (!CURRENT_LEVEL || (!CURRENT_LEVEL.nest && !CURRENT_LEVEL.nests)) {
    console.error('Nemožno spustiť level: CURRENT_LEVEL nie je načítaný alebo chýbajú súradnice nest/nests.');
    alert('Chyba: Level neobsahuje platné dáta hniezda.');
    return;
  }

  // Prepnutie herného režimu na kampaň
  currentGameMode = 'campaign';

  // Spustenie hry s načítaným levelom
  initGame(false);
  if (CURRENT_LEVEL && (CURRENT_LEVEL.intro || (CURRENT_LEVEL.conditions && CURRENT_LEVEL.conditions.length))) {
    showLevelIntro(CURRENT_LEVEL.intro, CURRENT_LEVEL.name || CURRENT_LEVEL.title, CURRENT_LEVEL.conditions || []);
  }

  // Skrytie hlavného menu a prípadných prekrývacích okien
  if (typeof hideMenu === 'function') {
    hideMenu();
  } else {
    const menuOverlay = document.getElementById('menuOverlay');
    if (menuOverlay) menuOverlay.classList.add('hidden');
  }

  const settingsOverlay = document.getElementById('settingsOverlay');
  if (settingsOverlay) settingsOverlay.classList.add('hidden');

  log(t('log.custom_level_started') || 'Vlastný level bol úspešne spustený.');
}

document.addEventListener('DOMContentLoaded', () => {
  const customLevelInput = document.getElementById('customLevelInput');

  if (customLevelInput) {
    customLevelInput.addEventListener('change', handleCustomLevelSelect);
  }
});

/**
 * Hlavná funkcia na obsluhu výberu súboru s vlastným levelom
 */
async function handleCustomLevelSelect(event) {
  const input = event.target;
  const file = input.files?.[0];

  if (!file) return;

  try {
    // 1. Načítanie a parsovanie JSON súboru
    const fileContent = await readFileAsText(file);
    const levelData = JSON.parse(fileContent);

    // 2. Načítanie obrázka, ak v JSON existuje (image / bg / map)
    const imageUrl = levelData.image || levelData.bg || levelData.map;
    if (imageUrl) {
      levelData.loadedImage = await loadImage(imageUrl).catch((err) => {
        console.warn('Obrázok levelu sa nepodarilo načítať, pokračujem bez neho.', err);
        return null;
      });
    }

    // 3. Uloženie globálneho levelu
    CURRENT_LEVEL = normalizeLevelData(levelData);
    loadedLevelData = CURRENT_LEVEL;

    // 4. Aplikovanie nastavení z levelu (ak funkcia existuje a level obsahuje settings)
    if (CURRENT_LEVEL && CURRENT_LEVEL.settings && typeof applyLevelSettingsToInputs === 'function') {
      applyLevelSettingsToInputs(CURRENT_LEVEL.settings);
    }

    // 5. Zatvorenie prípadného menu / modalu
    if (typeof hideMenu === 'function') {
      hideMenu();
    }

    // 6. Spustenie hry
    if (CURRENT_LEVEL && typeof startCampaignLevel === 'function') {
      startCampaignLevel(CURRENT_LEVEL);
    } else if (typeof initGame === 'function') {
      initGame(false);
    }

  } catch (err) {
    console.error('Chyba pri načítaní súboru levelu:', err);
    alert('Nepodarilo sa načítať level. Skontrolujte, či ide o platný JSON súbor.');
  } finally {
    // Garantovaný reset vstupu pre možnosť opätovného načítania rovnakého súboru
    input.value = '';
  }
}

/* ==========================================
   POMOCNÉ PROMISE FUNKCIE (Asynchrónny zápis)
   ========================================== */

/**
 * Prečíta súbor ako text pomocou Promise
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Načíta obrázok z URL/DataURL pomocou Promise
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}


/**
 * Helper na vyplnenie nastavení z JSONu do nastavení v UI
 */
function applyLevelSettingsToInputs(settings) {
  if (!settings) return;

  // Note: starting food and starting queen reserve are read directly from
  // CURRENT_LEVEL.settings in initGame() rather than through an input
  // element — those two values are no longer editable in the Settings
  // overlay (they'd duplicate the Nest Analytics "Edit values" panel).
  const map = {
    startHumans: 'startHumansInput',
    humans: 'startHumansInput',
    lang: 'langSelect',
    ...LEVEL_SETTINGS_INPUT_MAP
  };

  Object.entries(map).forEach(([key, inputId]) => {
    if (settings[key] !== undefined) {
      const el = document.getElementById(inputId);
      if (el) el.value = settings[key];
    }
  });
}

/* ============================= MAP BACKGROUND & IMAGE OVERLAY ============================= */

/**
 * Aplikuje obrázok ako CSS pozadie pre mapu
 */
function setMapBackground(bgUrl) {
  const mapWrap = document.getElementById('mapWrap');
  if (!mapWrap) return;

  const resolved = resolveAssetUrl(bgUrl);
  if (resolved) {
    mapWrap.style.backgroundImage = `url('${resolved}')`;
    mapWrap.style.backgroundSize = 'cover';
    mapWrap.style.backgroundPosition = 'center';
    mapWrap.style.backgroundRepeat = 'no-repeat';
  } else {
    mapWrap.style.backgroundImage = 'none';
  }
}

/**
 * Otvorí overlay modal na načítanie obrázka
 */
function openImageLoadOverlay() {
  const overlay = document.getElementById('imageLoadOverlay');
  const input = document.getElementById('bgImageUrlInput');
  const sbInput = document.getElementById('sbBackgroundInput');
  
  if (!overlay || !input) return;

  // Predvyplnenie zo sandbox vstupu, ak existuje
  input.value = sbInput ? sbInput.value : '';
  overlay.classList.remove('hidden');
  input.focus();
}

/**
 * Zatvorí overlay modal bez vykonania zmien (Cancel / Zrušiť)
 */
function closeImageLoadOverlay() {
  const overlay = document.getElementById('imageLoadOverlay');
  if (overlay) overlay.classList.add('hidden');
}

/**
 * Potvrdí akciu (OK / Načítať), aplikuje obrázok a zatvorí overlay
 */
function confirmImageLoad() {
  const input = document.getElementById('bgImageUrlInput');
  const sbInput = document.getElementById('sbBackgroundInput');
  
  if (input) {
    const url = input.value.trim();
    setMapBackground(url);
    
    // Ak upravujete v Sandbox móde, synchronizuje sa hodnota aj v paneli úprav
    if (sbInput) {
      sbInput.value = url;
    }
  }
  closeImageLoadOverlay();
}

/* Inicializácia event listenerov pre Image Overlay */
document.addEventListener('DOMContentLoaded', () => {
  const closeX = document.getElementById('imageLoadCloseX');
  const cancelBtn = document.getElementById('imageLoadCancelBtn');
  const confirmBtn = document.getElementById('imageLoadConfirmBtn');
  const overlay = document.getElementById('imageLoadOverlay');

  if (closeX) closeX.onclick = closeImageLoadOverlay;
  if (cancelBtn) cancelBtn.onclick = closeImageLoadOverlay;
  if (confirmBtn) confirmBtn.onclick = confirmImageLoad;

  // Zatvorenie kliknutím na tmavé pozadie mimo karty
  if (overlay) {
    overlay.addEventListener('click', (ev) => {
      if (ev.target.id === 'imageLoadOverlay') closeImageLoadOverlay();
    });
  }

  // Prepojenie priameho písania v Sandbox poli na okamžitý náhľad
  const sbBgInput = document.getElementById('sbBackgroundInput');
  if (sbBgInput) {
    sbBgInput.addEventListener('input', (e) => {
      setMapBackground(e.target.value);
    });
  }
});

// Same keys/units the Parametre overlay inputs use (percentages as 0-100, not fractions)
const LEVEL_SETTINGS_INPUT_MAP = {
  groupSize:'groupSizeInput', foodPerHuman:'foodPerHumanInput', startHumans:'startHumansInput',
  maxPoints:'maxPointsInput', eggsPerSearch:'eggsPerSearchInput',
  eggCap:'eggCapInput', eggsPerFood:'eggsPerFoodInput',
  searchBaseChance:'searchBaseChanceInput', searchRatioScale:'searchRatioScaleInput',
  huntBaseChance:'huntBaseChanceInput', huntRatioScale:'huntRatioScaleInput',
  huntDeathRisk:'huntDeathRiskInput', searchDeathRisk:'searchDeathRiskInput', scoutBiasPerFailedSearch:'scoutBiasPerFailedSearchInput',
  fortLimit:'fortLimitInput', defaultFortDefense:'defaultFortDefenseInput',
  fortFoodLow:'fortFoodLowInput', fortFoodHigh:'fortFoodHighInput',
  fortHumanLow:'fortHumanLowInput', fortHumanHigh:'fortHumanHighInput',
  fortDistLow:'fortDistLowInput', fortDistHigh:'fortDistHighInput',
  fortPredatorThreshold:'fortPredatorThresholdInput', fortAttackThreshold:'fortAttackThresholdInput',
  scoutMarkChance:'scoutMarkChanceInput', fortMarkThreshold:'fortMarkThresholdInput',
  costDistractScout:'costDistractScoutInput',
  costKillScout:'costKillScoutInput', costEscapePredator:'costEscapePredatorInput',
  costKillPredator:'costKillPredatorInput', costKillFortAttacker:'costKillFortAttackerInput',
  costSaveHumans:'costSaveHumansInput',
  saveHumansAmount:'saveHumansAmountInput', costScan:'costScanInput',
  costIncreaseFortCapacity:'costIncreaseFortCapacityInput',
  fortCapacityIncreaseAmount:'fortCapacityIncreaseAmountInput',
  queenFoodReserveCap:'queenFoodReserveCapInput',
  minPopulationThreshold:'minPopulationThresholdInput',
  fortReinforceCost:'fortReinforceCostInput',
  fortReinforceDefenseBonus:'fortReinforceDefenseBonusInput'
};

function applySettingsToInputs(overrides) {
  applyDefaultsToInputs();
  if (!overrides) return;
  Object.entries(overrides).forEach(([key, value]) => {
    const inputId = LEVEL_SETTINGS_INPUT_MAP[key];
    const el = inputId && document.getElementById(inputId);
    if (el) el.value = value;
  });
  if (overrides.autoTradeEnabled !== undefined) setAutoTradeToggleUI(!!overrides.autoTradeEnabled);
}

function loadLevelIntoGame(level) {
  CURRENT_LEVEL = level || null;
  if (CURRENT_LEVEL) CURRENT_LEVEL.conditions = normalizeLevelConditions(CURRENT_LEVEL.conditions || CURRENT_LEVEL.objectives || CURRENT_LEVEL.goals || []);
  applySettingsToInputs(level && level.settings);
  initGame();
  if (level && (level.intro || (level.conditions && level.conditions.length))) {
    showLevelIntro(level.intro, level.name, level.conditions || CURRENT_LEVEL.conditions || []);
  }
}

/* ==========================================================================
   LEVEL INTRO & CAMPAIGN MODE (WITH THUMBNAIL & JSON FILE LOADER)
   ========================================================================== */

let currentCampaignLevel = null;

/* ---------- Level intro / briefing overlay ---------- */
function buildLevelIntroOverlay() {
  let overlay = document.getElementById('levelIntroOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'levelIntroOverlay';
  overlay.className = 'overlay hidden';
  overlay.innerHTML =
    '<div class="overlay-card">' +
      '<button class="close-x" id="levelIntroCloseX">✕</button>' +
      '<h2 class="left" id="levelIntroTitle"></h2>' +
      '<p id="levelIntroText" class="card-p"></p>' +
      '<button class="nest-btn primary-btn" id="levelIntroOkBtn">Pokračovať</button>' +
    '</div>';
  document.body.appendChild(overlay);

  const close = () => overlay.classList.add('hidden');
  overlay.querySelector('#levelIntroCloseX').onclick = close;
  overlay.querySelector('#levelIntroOkBtn').onclick = close;
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });

  return overlay;
}

function showLevelIntro(introText, levelName, conditionList = []) {
  const overlay = buildLevelIntroOverlay();
  overlay.querySelector('#levelIntroTitle').textContent = levelName || 'Briefing';
  const summary = Array.isArray(conditionList) && conditionList.length
    ? '\n\nPODMIENKY:\n' + conditionList.map(cond => `- ${cond.outcome === 'victory' ? 'Víťazstvo' : 'Prehra'}: ${describeCondition(cond)}`).join('\n')
    : '';
  const text = `${introText || ''}${summary}`.trim();
  overlay.querySelector('#levelIntroText').textContent = text || 'Bez úvodnej správy.';
  overlay.classList.remove('hidden');
}

/* ============================= CAMPAIGN SYSTEM ============================= */
let CAMPAIGN_INDEX = [];
let selectedCampaignIndex = 0;
let loadedLevelData = null;

/**
 * Otvorí overlay kampane a načíta zoznam misii z index.json.
 */
async function runCampaign() {
  hideMenu();
  const overlay = document.getElementById('campaignOverlay');
  if (overlay) overlay.classList.remove('hidden');

  await loadCampaignIndex();
}

/**
 * Zatvorí overlay kampane.
 */
function closeCampaignMenu() {
  const overlay = document.getElementById('campaignOverlay');
  if (overlay) overlay.classList.add('hidden');
}

/**
 * Načíta index.json z priečinka kampane.
 */
async function loadCampaignIndex() {
  CAMPAIGN_INDEX = [];
  selectedCampaignIndex = 0;

  // Skúsi viacero častých ciest k index.json
  const candidatePaths = ['levels/index.json'];
  let data = null;

  for (const path of candidatePaths) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        data = await res.json();
        break;
      }
    } catch (e) {
      console.warn(`Nepodarilo sa načítať ${path}:`, e);
    }
  }

  if (data) {
    if (Array.isArray(data)) {
      CAMPAIGN_INDEX = data;
    } else if (data.levels && Array.isArray(data.levels)) {
      CAMPAIGN_INDEX = data.levels;
    }
  }

  // Normalize relative campaign file paths against the current document location
  CAMPAIGN_INDEX = CAMPAIGN_INDEX.map((lvl) => ({
    ...lvl,
    file: lvl.file ? resolveAssetUrl(lvl.file) || lvl.file : lvl.file,
    thumbnail: lvl.thumbnail ? resolveAssetUrl(lvl.thumbnail) || lvl.thumbnail : lvl.thumbnail,
    mapPath: lvl.mapPath ? resolveAssetUrl(lvl.mapPath) || lvl.mapPath : lvl.mapPath
  }));

  // Fallback ak index.json chýba alebo je prázdny
  if (!CAMPAIGN_INDEX || CAMPAIGN_INDEX.length === 0) {
    CAMPAIGN_INDEX = [{
      id: 'poludniky',
      title: 'Úroveň 1: Poludníky',
      description: 'Predvolená kampaňová misia v oblasti Poludníky.',
      thumbnail: 'levels/poludniky.png',
      file: 'levels/poludniky.json'
    }];
  }

  renderCampaignLevelList();
}

/**
 * Vykreslí každú úroveň z CAMPAIGN_INDEX ako riadok (náhľad + info + tlačidlo ŠTART)
 * do scrollovateľného zoznamu #campaignLevelList.
 */
function renderCampaignLevelList() {
  const list = document.getElementById('campaignLevelList');
  if (!list) return;

  list.innerHTML = '';

  if (!CAMPAIGN_INDEX || CAMPAIGN_INDEX.length === 0) {
    list.innerHTML = '<span class="thumb-placeholder">Žiadne úrovne nenájdené.</span>';
    return;
  }

  CAMPAIGN_INDEX.forEach((lvl, idx) => {
    const row = document.createElement('div');
    row.className = 'campaign-level-row';

    // Náhľadový obrázok
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'campaign-thumbnail-wrap';
    const thumbSource = lvl.thumbnail || lvl.background || lvl.image || null;
    const resolvedThumb = thumbSource ? resolveAssetUrl(thumbSource) : null;

    if (resolvedThumb) {
      const img = document.createElement('img');
      img.src = resolvedThumb;
      img.alt = lvl.title || `Úroveň ${idx + 1}`;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.onerror = () => {
        thumbWrap.innerHTML = '<span class="thumb-placeholder">Bez náhľadu</span>';
      };
      thumbWrap.appendChild(img);
    } else {
      thumbWrap.innerHTML = '<span class="thumb-placeholder">Bez náhľadu</span>';
    }

    // Tlačidlo ŠTART, hneď vedľa náhľadu
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'nest-btn primary-btn campaign-row-start-btn';
    startBtn.textContent = '▶ ŠTART';
    startBtn.onclick = () => startCampaignLevel(idx);

    // Názov + popis
    const info = document.createElement('div');
    info.className = 'campaign-row-info';
    const h3 = document.createElement('h3');
    h3.textContent = lvl.title || `Úroveň ${idx + 1}`;
    const p = document.createElement('p');
    p.textContent = lvl.description || 'Kampaňová misia.';
    info.appendChild(h3);
    info.appendChild(p);

    row.appendChild(thumbWrap);
    row.appendChild(startBtn);
    row.appendChild(info);

    list.appendChild(row);
  });
}

/**
 * Spustí vybranú misiu a inicializuje hru.
 */
async function startCampaignLevel(indexOrLevel = null) {
  let levelInfo = {};
  let sourceLevel = null;

  if (typeof indexOrLevel === 'number') {
    // Spustené kliknutím na ŠTART pri konkrétnom riadku zoznamu
    selectedCampaignIndex = Math.max(0, Math.min(indexOrLevel, CAMPAIGN_INDEX.length - 1));
    levelInfo = CAMPAIGN_INDEX[selectedCampaignIndex] || {};

    if ((levelInfo.nest || levelInfo.nests) && levelInfo.forts) {
      sourceLevel = levelInfo;
    } else {
      const filePath = levelInfo.file || levelInfo.mapPath || `campaign/${levelInfo.id}.json`;
      sourceLevel = await fetchCampaignLevelData(filePath);
    }
  } else if (indexOrLevel && typeof indexOrLevel === 'object') {
    // Spustené s už načítaným objektom levelu (napr. vlastný nahraný súbor)
    sourceLevel = indexOrLevel;
    levelInfo = indexOrLevel;
  } else {
    // Bez argumentu: skús to, čo je už načítané
    levelInfo = CAMPAIGN_INDEX[selectedCampaignIndex] || {};
    sourceLevel = loadedLevelData || CURRENT_LEVEL || null;
    if (!sourceLevel) {
      const filePath = levelInfo.file || levelInfo.mapPath || `campaign/${levelInfo.id}.json`;
      sourceLevel = await fetchCampaignLevelData(filePath);
    }
  }

  sourceLevel = loadCampaignLevelObject(sourceLevel);
  if (!sourceLevel || (!sourceLevel.nest && !sourceLevel.nests)) {
    const filePath = levelInfo.file || levelInfo.mapPath || 'neznámy súbor';
    alert(`Nepodarilo sa načítať dátový súbor pre úroveň: ${filePath}`);
    return;
  }

  if (!CURRENT_LEVEL.title) CURRENT_LEVEL.title = levelInfo.title;
  if (!CURRENT_LEVEL.description) CURRENT_LEVEL.description = levelInfo.description;

  currentGameMode = 'campaign';

  closeCampaignMenu();
  const menuOverlay = document.getElementById('menuOverlay');
  if (menuOverlay) menuOverlay.classList.add('hidden');

  initGame(false);
  if (CURRENT_LEVEL && (CURRENT_LEVEL.intro || (CURRENT_LEVEL.conditions && CURRENT_LEVEL.conditions.length))) {
    showLevelIntro(CURRENT_LEVEL.intro, CURRENT_LEVEL.name || CURRENT_LEVEL.title, CURRENT_LEVEL.conditions || []);
  }
}

/**
 * Vytvorí objekt levelu s hniezdom a pevnosťami pomocou generateMapElements(),
 * pričom prečíta hodnoty z formulára a nastaví pozadie poludniky.png.
 */
function generateRandomLevel() {
  // 1. Načítanie hodnôt z UI prvkov a uloženie do S.settings pre generateMapElements()
  if (!S.settings) S.settings = {};

  S.settings.fortLimit = clampInt(
    document.getElementById('fortLimitInput')?.value, 1, 30, 10
  );
  S.settings.defaultFortDefense = clampInt(
    document.getElementById('defaultFortDefenseInput')?.value, 1, 1000, 50
  );

  // 2. Vygenerovanie hniezda a pevností pomocou existujúcej funkcie generateMapElements()
  generateMapElements();

  // 3. Vrátenie kompletnej štruktúry levelu
  //
  // IMPORTANT: level.settings is consumed by applySettingsToInputs(), which
  // writes values straight into the setup <input> fields (see the comment
  // above LEVEL_SETTINGS_INPUT_MAP - those inputs hold percentages 0-100,
  // not fractions). S.settings stores these same six keys as 0-1 fractions
  // internally, so they must be converted back to percentage form here or
  // they get silently divided by 100 a second time when settings are next
  // read from the inputs (0.4 -> written as "0.4" -> read back -> 0.004).
  const PERCENT_SETTINGS_KEYS = [
    'searchBaseChance', 'searchRatioScale',
    'huntBaseChance', 'huntRatioScale',
    'huntDeathRisk', 'searchDeathRisk', 'scoutMarkChance'
  ];
  const exportedSettings = { ...S.settings };
  PERCENT_SETTINGS_KEYS.forEach(key => {
    if (typeof exportedSettings[key] === 'number') {
      exportedSettings[key] = Math.round(exportedSettings[key] * 100);
    }
  });

  return {
    id: 'generated-' + Date.now(),
    title: 'Vygenerovaná úroveň',
    description: 'Náhodne vygenerované hniezda a pevnosti.',
    background: 'poludniky.png',
    // Multi-nest export: initGame()'s campaign loader reads level.nests[]
    // (falling back to a legacy single level.nest only if this is absent),
    // so every generated nest's position/id is preserved on reload.
    nests: S.nests.map(n => ({ id: n.id, x: n.x, y: n.y })),
    forts: S.forts,
    settings: exportedSettings
  };
}

/**
 * Tlačidlo "Vygeneruj level": vytvorí náhodný level a hneď ho spustí
 * v kampaňovom režime s čerstvým stavom.
 */
function generateAndStartLevel() {
  const level = generateRandomLevel();
  startCampaignLevel(level);
}

/* ---------- Prepojenie tlačidiel a udalostí ---------- */
function wireCampaignMenu() {
  const campaignBtnEl = document.getElementById('campaignBtn');
  if (campaignBtnEl) campaignBtnEl.onclick = runCampaign;

  const sandboxBtnEl = document.getElementById('sandboxBtn');
  if (sandboxBtnEl) {
    sandboxBtnEl.onclick = () => {
      const menu = document.getElementById('menuOverlay');
      if (menu) menu.classList.add('hidden');
    };
  }

  // Zavretie overlay kliknutím na pozadie
  const overlay = document.getElementById('campaignOverlay');
  if (overlay) {
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) closeCampaignMenu();
    });
  }

  // Tlačidlo zavretia (X)
  const closeX = document.getElementById('campaignCloseX');
  if (closeX) closeX.onclick = closeCampaignMenu;

  // Tlačidlo SPUSTIŤ MISIU (staršie rozhranie, ak niekedy pribudne)
  const startBtn = document.getElementById('campaignStartBtn');
  if (startBtn) startBtn.onclick = () => startCampaignLevel();
}

function showMenu(){
  const menu = document.getElementById('ingameMenu');
  if (!menu) return;

  const menuOverlay = document.getElementById('menuOverlay');
  const introMenuOpen = menuOverlay && !menuOverlay.classList.contains('hidden');
  const restartButton = document.getElementById('ingameRestartBtn');
  const closeButton = document.getElementById('ingameMenuCloseX');
  if (restartButton) restartButton.classList.toggle('hidden', !!introMenuOpen);
  if (closeButton) {
    closeButton.classList.toggle('hidden', !!introMenuOpen);
    if (closeButton.parentElement) {
      closeButton.parentElement.classList.toggle('hidden', !!introMenuOpen);
    }
  }

  menu.classList.remove('hidden');
}


function hideMenu(){
  document.getElementById('ingameMenu').classList.add('hidden');
}

window.showMenu = showMenu;
window.hideMenu = hideMenu;
/**
 * HYBRID Nest Simulator - i18n Localization Engine
 */
// [moved to nest-core.js] let currentLang = 'sk'; ... (12 lines)

// Looks up a bare noun/adjective form, e.g. wordForm('noun.egg', 3) -> "eggs".
// Used to fill secondary counted words (eggWord, attackerWord, stepWord...)
// embedded inside an otherwise-fixed translation template.
// [moved to nest-core.js] function wordForm(prefix, n) { ... (3 lines)

// Helper function to translate keys with parameter substitution.
// If a `count` param is given (or an explicit pluralCount is passed), and a
// `<key>_singular` / `_few` / `_many` variant exists, that variant is used
// instead of the bare key.
// [moved to nest-core.js] function t(key, params = {}, pluralCount = null) { ... (22 lines)

// Replaces all static DOM element texts and titles
function updateLanguage(newLang) {
  if (translations[newLang]) {
    currentLang = newLang;
  }

  // Update elements with [data-i18n] for innerText/innerHTML
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translatedValue = t(key);
    
    // Support HTML content inside translations safely
    if (translatedValue.includes('<') && translatedValue.includes('>')) {
      el.innerHTML = translatedValue;
    } else {
      el.innerText = translatedValue;
    }
  });

  // Update elements with [data-i18n-title] attribute
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.setAttribute('title', t(key));
  });

  // Update page title
  if (translations[currentLang]?.['title.page']) {
    document.title = t('title.page');
  }

  // Dispatch custom event if scripts need to re-render dynamic charts or field logs
  window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: currentLang } }));
}

// Initialization & Event Binding
async function initLocalization() {
  try {
    const response = await fetch('texts.json');
    translations = await response.json();
  } catch (err) {
    console.warn('Could not load translations file, falling back to embedded dictionary.', err);
  }

  const langSelect = document.getElementById('langSelect');
  if (langSelect) {
    langSelect.value = currentLang;
    langSelect.addEventListener('change', (e) => {
      updateLanguage(e.target.value);
    });
  }

  // Initial translation application
  updateLanguage(currentLang);
}

// Run on page DOM content loaded
document.addEventListener('DOMContentLoaded', initLocalization);

// Initialize application
loadTranslations().then(() => {
  setupCollapseButtons();
  applyDefaultsToInputs();
  wireCampaignMenu();
  initGame();
});