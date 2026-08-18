/* ============================= I18N SYSTEM ============================= */
let TRANSLATIONS = {};
const DEBUG = false;
const BUILD_FORT_COST = 8;
const BUILD_FORT_CAPACITY = 10;
const BUILD_FORT_DEFENSE = 10;
const HIRE_COST = 5;
const DIST_FROM_FORT = 10;
const CONQUEST_PRIORITY = 20;

/* ============================= MULTI-NEST SUPPORT ============================= */
// Nests compete for the same shared pool of humans/forts. Each nest keeps its
// own food storage, queen, brood cohorts, scouts and predators. Which nest's
// fields S.food / S.queen / S.eggs / ... (etc) "point at" is controlled by
// S.activeNestIndex - see the accessor properties installed in freshState().
const DEFAULT_NEST_COUNT = 2;
const MIN_NEST_DIST_FROM_OTHER_NEST = 100; // map units kept between two nests when generating a sandbox map

// How much closer-to-an-enemy-nest hunting raises a predator's death risk.
// Within ENEMY_NEST_DEATH_RISK_RADIUS map units of a rival, alive nest, a
// hunting predator's death chance climbs linearly up to
// +ENEMY_NEST_MAX_DEATH_RISK_BONUS at zero distance - nests fight over the
// same humans, so hunting deep in a rival's territory is dangerous.
const ENEMY_NEST_DEATH_RISK_RADIUS = 70;
const ENEMY_NEST_MAX_DEATH_RISK_BONUS = 0.85;

function makeNestState(id, x, y, settings){
  return {
    id, x, y,
    alive: true,
    food: 200,
    queen: { alive: true },
    queenReserve: settings ? settings.startQueenReserve : 230,
    bounceback: null,
    fortCooldown: 0,
    reinforcedForts: [],
    scoutsAvailable: 3,
    scoutsHidden: 2,
    scoutsCooldown: 4,
    predatorsAvailable: 12,
    predatorsCooldown: 12,
    eggs: [{age: 0, count: 1},{age: 1, count: 0}],
    larva: [{age: 0, count: 0},{age: 1, count: 0}],
    cocoon: [{age: 0, count: 1}, {age: 1, count: 1}],
    nymph: [{age: 0, count: 0},{age: 1, count: 1}]
  };
}

// Installs S.nest / S.food / S.queen / ... as accessor properties that
// forward to whichever nest is "active" (S.activeNestIndex). This lets the
// large body of existing single-nest simulation code (processLifecycle,
// searchChanceWithDistance, etc.) keep working completely unchanged - it's
// simply re-run once per alive nest, with the active pointer moved between
// runs. Direct multi-nest code (rendering, generation, save/load) works with
// S.nests directly instead of going through these accessors.
const NEST_SCOPED_FIELDS = [
  'food', 'queenReserve', 'queen', 'eggs', 'larva', 'cocoon', 'nymph',
  'scoutsAvailable', 'scoutsHidden', 'scoutsCooldown',
  'predatorsAvailable', 'predatorsCooldown',
  'fortCooldown', 'bounceback'
];
function installNestAccessors(state){
  Object.defineProperty(state, 'nest', {
    configurable: true, enumerable: true,
    get(){ return this.nests[this.activeNestIndex]; },
    set(v){
      // Legacy single-nest assignment (e.g. `S.nest = {x,y}`): applied to
      // the currently active nest's position only.
      const n = this.nests[this.activeNestIndex];
      if (n) { n.x = v.x; n.y = v.y; }
    }
  });
  NEST_SCOPED_FIELDS.forEach(key => {
    Object.defineProperty(state, key, {
      configurable: true, enumerable: true,
      get(){ return this.nests[this.activeNestIndex][key]; },
      set(v){ this.nests[this.activeNestIndex][key] = v; }
    });
  });
}

function fortMark(fort, nestId){
  if (!fort.marks) fort.marks = {};
  if (!fort.marks[nestId]) {
    fort.marks[nestId] = { marked: false, markedAttackDispatched: false, markingScoutCount: 0, markedUntilStep: null };
  }
  return fort.marks[nestId];
}
function fortAnyMarked(fort){
  return !!(fort.marks && Object.values(fort.marks).some(m => m.marked));
}

function totalInsectsForNest(nest){
  if (!nest) return 0;
  const scouts = nest.scoutsAvailable + nest.scoutsCooldown + nest.scoutsHidden +
    S.events.filter(e=>e.type==='search' && e.status==='pending' && !e.fortMarkScout && e.nestId===nest.id).length;
  const predators = nest.predatorsAvailable + nest.predatorsCooldown +
    S.events.filter(e=>e.type==='hunt' && e.status==='pending' && e.nestId===nest.id).reduce((a,e)=>a + (e.groupSize - e.killed), 0) +
    (() => { const e = S.events.find(e=>e.type==='fort' && e.status==='pending' && e.nestId===nest.id); return e ? Math.max(0, e.originalAttackers - e.killed) : 0; })();
  return (nest.queen.alive?1:0) + scouts + predators +
    sumCohort(nest.eggs) + sumCohort(nest.larva) + sumCohort(nest.cocoon) + sumCohort(nest.nymph);
}
function totalInsectsAll(){
  return S.nests.reduce((a,n)=> a + (n.alive ? totalInsectsForNest(n) : 0), 0);
}
// Per-nest breakdown used by S.history entries, so the Nest Analytics chart
// can plot the historical line for whichever nest is selected (rather than
// the combined total across all nests) - see renderChart().
function insectsByNestSnapshot(){
  const out = {};
  S.nests.forEach(n => { out[n.id] = n.alive ? totalInsectsForNest(n) : 0; });
  return out;
}
function nearestEnemyNestDistance(loc, ownNestId){
  let minD = Infinity;
  S.nests.forEach(n => {
    if (!n.alive || n.id === ownNestId) return;
    const d = dist(loc, n);
    if (d < minD) minD = d;
  });
  return minD;
}
// The closer `loc` (a hunt event's position) is to a rival, alive nest, the
// higher the extra death-risk bonus returned here (0 when no rival is near).
function enemyProximityDeathRisk(loc, ownNestId){
  const d = nearestEnemyNestDistance(loc, ownNestId);
  if (!isFinite(d)) return 0;
  const closeness = Math.max(0, 1 - d / ENEMY_NEST_DEATH_RISK_RADIUS);
  return closeness * ENEMY_NEST_MAX_DEATH_RISK_BONUS;
}
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

function t(key, params = {}) {
  const lang = (S && S.settings && S.settings.lang) ? S.settings.lang : 'en';
  let text = (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) ||
             (TRANSLATIONS['en'] && TRANSLATIONS['en'][key]) || key;

  for (const [pK, pV] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${pK}\\}`, 'g'), pV);
  }
  return text;
}

/* ============================= STATE ============================= */
let S = null;
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
const WORLD_ASPECT_RATIO = 2; // width:height - keep in sync with #mapWrap's CSS aspect-ratio

function dist(p1, p2) {
  const dx = (p1.x - p2.x) * WORLD_ASPECT_RATIO;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

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

function freshState(){
  const state = {
    step: 0,
    points: 10,
    maxPoints: 10,
    phase: 'idle', // idle | active
    humans: 150,
    humansKilled: 0,
    conditions: [],
    lastTriggeredCondition: null,
    settings: {
      lang: 'sk', // 'en' | 'sk'
      groupSize: 5, foodPerHuman: 5, maxPoints: 10, eggsPerSearch: 1,
      eggCap: 20, eggsPerFood: 5,
      searchBaseChance: 0.5, searchRatioScale: 0.25,
      huntBaseChance: 0.9, huntRatioScale: 0.25,
      huntDeathRisk: 0.4, searchDeathRisk: 0.6,
      scoutBiasPerFailedSearch: 0,
      fortLimit: 10,
      defaultFortDefense: 50,
      fortFoodLow: 2, fortFoodHigh: 5, fortHumanLow: 1, fortHumanHigh: 3,
      fortDistLow: 15, fortDistHigh: 70,
      fortPredatorThreshold: 30, fortAttackThreshold: 4.2,
      scoutMarkChance: 0.2, fortMarkThreshold: 3.5,
      fortCapacityIncreaseAmount: 5, costIncreaseFortCapacity: 1,
      fortReinforceCost: 4, fortReinforceDefenseBonus: 10,
      costDistractScout: 1, costKillScout: 2, costEscapePredator: 1, costKillPredator: 3,
      costSaveHumans: 1, saveHumansAmount: 2, costScan: 1,
      costNestAnalytics: 1,
      // Attacking a nest directly is pricier than killing the same unit
      // type mid-event (costKillPredator/costKillScout above), so these are
      // deliberately separate settings rather than reusing those.
      costAttackNestPredator: 4, costAttackNestScout: 3,
      costKillNymph: 3, costAttackQueen: 6,
      queenFoodReserveCap: 130,
      startQueenReserve: 130, // defaults to full reserve (== queenFoodReserveCap above)
      minPopulationThreshold: 30,
      nestCount: DEFAULT_NEST_COUNT // how many rival nests to generate in sandbox/random levels
    },
    forts: [],
    reinforcedForts: [], // fort ids the player reinforced this step (shared - a player action, not per-nest)

    // Multiple nests compete for the same shared `humans`/`forts` above.
    // activeNestIndex selects which nest S.food/S.queen/S.eggs/... (etc,
    // see NEST_SCOPED_FIELDS) currently point at; focusedNestIndex is the
    // nest shown in the Nest Analytics panel and defaults to the first one.
    nests: [ makeNestState(1, 25, 25, null) ],
    activeNestIndex: 0,
    focusedNestIndex: 0,

    events: [],
    trails: [],
    animating: false,
    selectedEventId: null,
    history: [],
    log: [],
    gameOver: false,
    gameOverMsg: '',
    nextEventId: 1
  };
  installNestAccessors(state);
  return state;
}

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
  if (pop.scoutsHidden != null) S.scoutsHidden = Math.max(0, Math.round(Number(pop.scoutsHidden)) || 0);
  if (pop.scoutsCooldown != null) S.scoutsCooldown = Math.max(0, Math.round(Number(pop.scoutsCooldown)) || 0);
  if (pop.predatorsAvailable != null) S.predatorsAvailable = Math.max(0, Math.round(Number(pop.predatorsAvailable)) || 0);
  if (pop.predatorsCooldown != null) S.predatorsCooldown = Math.max(0, Math.round(Number(pop.predatorsCooldown)) || 0);
  if (Array.isArray(pop.eggs)) S.eggs = JSON.parse(JSON.stringify(pop.eggs));
  if (Array.isArray(pop.larva)) S.larva = JSON.parse(JSON.stringify(pop.larva));
  if (Array.isArray(pop.cocoon)) S.cocoon = JSON.parse(JSON.stringify(pop.cocoon));
  if (Array.isArray(pop.nymph)) S.nymph = JSON.parse(JSON.stringify(pop.nymph));
}

function assignEventCoords(e) {
  const MARGIN_X = 3;  // Left/Right side margin (x: 3 to 97)
  const MARGIN_Y = 10; // Top/Bottom edge margin (y: 10 to 90)
  const minDistance = 18; // Minimum percentage distance between map elements
  let bestCand = null;
  let maxMinDist = -1;

  for (let attempt = 0; attempt < 300; attempt++) {
    const cand = {
      x: Math.floor(MARGIN_X + Math.random() * (100 - 2 * MARGIN_X)),
      y: Math.floor(MARGIN_Y + Math.random() * (100 - 2 * MARGIN_Y))
    };

    let minDist = Infinity;

    if (S.nests) {
      S.nests.forEach(n => {
        const d = dist(cand, n);
        if (d < minDist) minDist = d;
      });
    }

    if (S.forts) {
      for (const f of S.forts) {
        const d = dist(cand, f);
        if (d < minDist) minDist = d;
      }
    }

    if (S.events) {
      for (const other of S.events) {
        if (other !== e && other.x !== undefined && other.y !== undefined && other.status === 'pending') {
          const d = dist(cand, other);
          if (d < minDist) minDist = d;
        }
      }
    }

    if (minDist >= minDistance) {
      e.x = cand.x;
      e.y = cand.y;
      return;
    }

    if (minDist > maxMinDist) {
      maxMinDist = minDist;
      bestCand = cand;
    }
  }

  if (bestCand) {
    e.x = bestCand.x;
    e.y = bestCand.y;
  } else {
    e.x = Math.floor(MARGIN_X + Math.random() * (100 - 2 * MARGIN_X));
    e.y = Math.floor(MARGIN_Y + Math.random() * (100 - 2 * MARGIN_Y));
  }
}

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
      
      const cand = {
        id: i + 1,
        x: MARGIN_X + Math.random() * (100 - 2 * MARGIN_X),
        y: MARGIN_Y + Math.random() * (100 - 2 * MARGIN_Y),
        alive: true,
        defense: S.settings.defaultFortDefense || 50,
        maxDefense: S.settings.defaultFortDefense || 50,
        capacity: 100,
        population: Math.round(50 + Math.random() * 50),
        marks: {}
      };

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

    if (!placed && bestCand) {
      S.forts.push(bestCand);
    }
  }
}

function getNearestAliveFortDistance(originLoc) {
  const aliveForts = S.forts.filter(f => f.alive);
  if (aliveForts.length === 0) return Infinity;
  const origin = originLoc || S.nest;
  let minD = Infinity;
  aliveForts.forEach(f => {
    const d = dist(origin, f);
    if (d < minD) minD = d;
  });
  return minD;
}

const FORT_STRENGTH_DISTANCE_DIVISOR = 280; // tune this - overall falloff radius (map units) for fort predator strength
const FORT_STRENGTH_COMPRESSION_POWER = 1.4; // tune this - >1 shrinks the "2 dmg" band closer to the "3 dmg" edge, WITHOUT changing the size of the "3 dmg" zone. 1 = original linear behavior.

function getFortStrengthAtDistance(d) {
  const x = Math.max(0, 1.0 - (d / FORT_STRENGTH_DISTANCE_DIVISOR));
  const zone3Breakpoint = 0.8333; // x value where strength 3 -> 2 begins - untouched by compression, so the 3-dmg zone size stays fixed
  const adjustedX = x >= zone3Breakpoint
    ? x
    : zone3Breakpoint * Math.pow(x / zone3Breakpoint, FORT_STRENGTH_COMPRESSION_POWER);
  return Math.max(1, Math.round(3 * adjustedX));
}

function getFortPredatorStrength(targetFort) {
  if (!targetFort) return 3;
  const d = dist(S.nest, targetFort);
  return getFortStrengthAtDistance(d);
}

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
function conquestDeathPct(ratio){
  if (!isFinite(ratio) || ratio >= 2) return 0.05;
  if (ratio <= 0.5) return 0.7;
  const frac = (ratio - 0.5) / 1.5;
  return 0.8 - frac * 0.7;
}

function searchChanceWithDistance(loc) {
  const base = successChance(S.settings.searchBaseChance, S.settings.searchRatioScale, ratioHumansPerInsect());
  const target = loc || S.nest;

  const dFort = getNearestAliveFortDistance(target);
  const fortBonus = (dFort === Infinity) ? 0 : Math.max(0, (50 - dFort) / 50) * 0.5;

  const adjusted = base * (1 + fortBonus);
  return Math.max(0.01, Math.min(0.90, adjusted));
}

function huntChanceWithDistance(loc) {
  const base = successChance(S.settings.huntBaseChance, S.settings.huntRatioScale, ratioHumansPerInsect());
  const target = loc || S.nest;

  const dFort = getNearestAliveFortDistance(target);
  const fortPenalty = (dFort === Infinity) ? 0 : Math.max(0, (50 - dFort) / 50) * 0.2;

  const dNest = dist(target, S.nest);
  const nestPenalty = Math.min(0.5, (dNest / 100) * 0.2);

  const combinedMultiplier = Math.max(0, (1 - fortPenalty) * (1 - nestPenalty));
  return Math.max(0.01, base * combinedMultiplier);
}

function pickTargetFort(distancePower = 6) {
  // Only forts that have survived the scout-marking phase (for the active
  // nest specifically - each nest tracks its own marks on a fort) can be
  // conquered.
  const nestId = S.nest.id;
  const markedForts = S.forts.filter(
    f =>
      f.alive &&
      fortMark(f, nestId).marked &&
      !fortMark(f, nestId).markedAttackDispatched &&
      (f.population || 0) > 0
  );

  if (markedForts.length === 0) return null;

  const weights = markedForts.map(f => {
    const d = Math.max(1, dist(S.nest, f));
    return 1 / Math.pow(d, distancePower);
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalWeight;

  for (let i = 0; i < markedForts.length; i++) {
    if (rand < weights[i]) return markedForts[i];
    rand -= weights[i];
  }

  return markedForts[0];
}

// Scouts returning from a search have a small chance of spotting a fort
// that looks ripe for conquest and marking it - a cheap early warning that
// fires at a lower readiness bar than the real predator assault
// (fortAttackThreshold). Unlike pickTargetFort (used to actually launch an
// assault), this considers every alive, unmarked, populated fort that
// clears the lower bar, so a single tick can mark more than one fort if
// scout count and threshold both allow it.
//
// Normally only one scout at a time will approach a given fort to mark it.
// But once a fort's readiness climbs to the same level that would trigger
// a full predator assault (fortAttackThreshold), multiple scouts are
// allowed to converge on it at once - a swarm racing to confirm the same
// juicy target. Like the predator icons that ring a fort during an
// assault, these scouts are positioned evenly around the fort instead of
// stacking on the same spot.
const MARKING_SWARM_SIZE = 3; // ring size once a fort's readiness is really high
const SCOUT_FORT_DISTANCE = 5; // same positioning convention as predator icons around a fort

function maxMarkingScoutsForFort(f) {
  return fortReadiness(f).total >= S.settings.fortAttackThreshold ? MARKING_SWARM_SIZE : 1;
}

function maybeMarkFortsFromSearch(scoutCount) {
  if (scoutCount <= 0) return [];

  const s = S.settings;
  const nestId = S.nest.id;

  const candidates = S.forts.filter(
    f =>
      f.alive &&
      (fortMark(f, nestId).markingScoutCount || 0) < maxMarkingScoutsForFort(f) &&
      (f.population || 0) > 0
  );

  if (candidates.length === 0) return [];

  const newlyMarked = [];

  for (let i = 0; i < scoutCount; i++) {

    const eligible = candidates.filter(
      f =>
        (fortMark(f, nestId).markingScoutCount || 0) < maxMarkingScoutsForFort(f) &&
        fortReadiness(f).total >= s.fortMarkThreshold
    );

    if (eligible.length === 0) continue;

    const weights = eligible.map(
      f => 1 / Math.pow(Math.max(1, dist(S.nest, f)), 3)
    );

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalWeight;

    let picked = eligible[eligible.length - 1];

    for (let j = 0; j < eligible.length; j++) {
      if (rand < weights[j]) {
        picked = eligible[j];
        break;
      }
      rand -= weights[j];
    }

    // Fort readiness increases the chance that the scout successfully marks it.
    // At fortMarkThreshold -> base scoutMarkChance.
    // At fortAttackThreshold or above -> 100%.
    const readiness = fortReadiness(picked).total;

    const readinessFactor = Math.max(
      0,
      Math.min(
        1,
        (readiness - s.fortMarkThreshold) /
          Math.max(1, s.fortAttackThreshold - s.fortMarkThreshold)
      )
    );

    const markChance =
      s.scoutMarkChance +
      readinessFactor * (1 - s.scoutMarkChance);

    if (Math.random() >= markChance) continue;

    // Claim a ring slot for this scout. The ring size is fixed for the
    // whole swarm (maxMarkingScoutsForFort), so every scout's angle stays
    // put even as its siblings resolve independently.
    const ringSize = maxMarkingScoutsForFort(picked);
    const pickedMark = fortMark(picked, nestId);
    const slot = pickedMark.markingScoutCount || 0;
    pickedMark.markingScoutCount = slot + 1;

    const angle = (2 * Math.PI * slot) / ringSize - Math.PI / 2;

    const scoutEvent = {
      id: nid(),
      type: 'search',
      status: 'pending',
      outcome: null,
      nestId,

      // Special scout whose only purpose is to mark a fort.
      fortMarkScout: true,
      targetFortId: picked.id,

      x: Math.max(
        3,
        Math.min(
          97,
          picked.x +
            (SCOUT_FORT_DISTANCE / WORLD_ASPECT_RATIO) * Math.cos(angle)
        )
      ),

      y: Math.max(
        3,
        Math.min(
          97,
          picked.y + SCOUT_FORT_DISTANCE * Math.sin(angle)
        )
      )
    };

    S.events.push(scoutEvent);
    newlyMarked.push(picked);
  }

  return newlyMarked;
}

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

function conditionMatchesFort(cond, fort) {
  if (!fort) return false;
  if (!cond || !cond.fortId || cond.fortId === 'any') return true;
  return Number(cond.fortId) === Number(fort.id);
}

function evaluateCustomCondition(cond) {
  if (!cond || cond.active === false) return false;
  const forts = Array.isArray(S.forts) ? S.forts : [];
  switch (cond.type) {
    case 'fort_falls':
      return forts.some(f => conditionMatchesFort(cond, f) && !f.alive);
    case 'fort_defense_below': {
      const target = cond.fortId && cond.fortId !== 'any' ? forts.find(f => Number(f.id) === Number(cond.fortId)) : null;
      if (!target) return false;
      return Number(target.defense) < Number(cond.value || 0);
    }
    case 'fort_attacked': {
      const target = cond.fortId && cond.fortId !== 'any' ? forts.find(f => Number(f.id) === Number(cond.fortId)) : null;
      if (!target) return false;
      return Boolean(target.lastAttackedStep != null && target.lastAttackedStep >= 0);
    }
    case 'forts_fallen_over':
      return forts.filter(f => !f.alive).length > Number(cond.value || 0);
    case 'humans_killed_over':
      return Number(S.humansKilled || 0) > Number(cond.value || 0);
    case 'humans_remaining_below':
      return Number(S.humans || 0) < Number(cond.value || 0);
    case 'nest_collapses':
      return totalInsects() <= 0 || (S.humans <= 0 && (S.forts.length === 0 || S.forts.every(f => !f.alive)));
    default:
      return false;
  }
}

function maybeTriggerConditionGameOver() {
  if (S.gameOver || !Array.isArray(S.conditions)) return false;
  for (const cond of S.conditions) {
    if (!cond || cond.active === false) continue;
    if (!evaluateCustomCondition(cond)) continue;
    S.gameOver = true;
    S.lastTriggeredCondition = cond;
    S.gameOverMsg = `${cond.outcome === 'victory' ? 'Víťazstvo' : 'Prehra'}: ${describeCondition(cond)}`;
    return true;
  }
  return false;
}

/* ============================= HELPER UTILS ============================= */
function scoutsWorking(){
  // fortMarkScout events are a visual stand-in for an already-counted
  // searcher confirming a fort target, not an additional body - excluding
  // them here keeps scoutsTotal()/totalInsects() (and everything derived
  // from them, like ratioHumansPerInsect() and searchChance) from being
  // silently inflated every time a fort attracts confirming scouts.
  const nestId = S.nest.id;
  return S.events.filter(e=>e.type==='search' && e.status==='pending' && !e.fortMarkScout && e.nestId===nestId).length;
}
function predatorsWorking(){
  const nestId = S.nest.id;
  return S.events.filter(e=>e.type==='hunt' && e.status==='pending' && e.nestId===nestId)
    .reduce((a,e)=>a + (e.groupSize - e.killed), 0);
}
function predatorsFortDuty(){
  const nestId = S.nest.id;
  const e = S.events.find(e=>e.type==='fort' && e.status==='pending' && e.nestId===nestId);
  return e ? Math.max(0, e.originalAttackers - e.killed) : 0;
}
function scoutsTotal(){ return S.scoutsAvailable + scoutsWorking() + S.scoutsCooldown + S.scoutsHidden; }
function predatorsTotal(){ return S.predatorsAvailable + predatorsWorking() + S.predatorsCooldown + predatorsFortDuty(); }

function sumCohort(arr){ return arr.reduce((a,c)=>a+c.count,0); }
function totalInsects(){
  return (S.queen.alive?1:0) + scoutsTotal() + predatorsTotal() +
    sumCohort(S.eggs) + sumCohort(S.larva) + sumCohort(S.cocoon) + sumCohort(S.nymph);
}
function nid(){ return S.nextEventId++; }
function log(msg){
  S.log.unshift({step:S.step, msg});
  if(S.log.length>200) S.log.pop();
}

function selectNextPendingEvent(){
  const activeEvents = S.events.filter(e => {
    if (e.status !== 'pending') return false;
    if (e.type === 'search' && (e.outcome === 'distracted' || e.outcome === 'killed' || e.outcome === 'failed')) return false;
    if (e.type === 'hunt' && (e.neutralized + e.killed >= e.groupSize)) return false;
    if (e.type === 'fort' && (e.originalAttackers - e.killed <= 0)) return false;
    return true;
  });
  if (activeEvents.length > 0) {
    S.selectedEventId = activeEvents[0].id;
  }
}

/* ============================= SETUP ============================= */
const SETTINGS_INPUT_IDS = [
  'langSelect','groupSizeInput','foodPerHumanInput','startHumansInput',
  'maxPointsInput','eggsPerSearchInput','eggCapInput','eggsPerFoodInput',
  'searchBaseChanceInput','searchRatioScaleInput','huntBaseChanceInput','huntRatioScaleInput',
  'huntDeathRiskInput','searchDeathRiskInput','scoutBiasPerFailedSearchInput','fortLimitInput','defaultFortDefenseInput',
  'fortFoodLowInput','fortFoodHighInput','fortHumanLowInput','fortHumanHighInput',
  'fortDistLowInput','fortDistHighInput',
  'fortPredatorThresholdInput','fortAttackThresholdInput',
  'scoutMarkChanceInput','fortMarkThresholdInput',
  'costDistractScoutInput','costKillScoutInput','costEscapePredatorInput','costKillPredatorInput',
  'costSaveHumansInput','saveHumansAmountInput','costScanInput',
  'costIncreaseFortCapacityInput','fortCapacityIncreaseAmountInput','queenFoodReserveCapInput',
  'minPopulationThresholdInput','fortReinforceCostInput','fortReinforceDefenseBonusInput'
];

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
  S.settings.costDistractScout     = clampInt(g('costDistractScoutInput'), 0, 50, D.settings.costDistractScout);
  S.settings.costKillScout         = clampInt(g('costKillScoutInput'), 0, 50, D.settings.costKillScout);
  S.settings.costEscapePredator    = clampInt(g('costEscapePredatorInput'), 0, 50, D.settings.costEscapePredator);
  S.settings.costKillPredator      = clampInt(g('costKillPredatorInput'), 0, 50, D.settings.costKillPredator);
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
    S.forts = CURRENT_LEVEL.forts.map(f => {
      const def = (f.defense != null) ? f.defense : S.settings.defaultFortDefense;
      const capacity = (f.capacity != null) ? f.capacity : 100;
      const population = (f.population != null) ? f.population : Math.round(50 + Math.random() * 50);
      return { id: f.id, x: f.x, y: f.y, alive: true, defense: def, maxDefense: def, capacity, population, marks: {} };
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

  S.history.push({step:0, humans:S.humans, insects: totalInsectsAll(), insectsByNest: insectsByNestSnapshot()});
  log(t('log.nest_stirs', { insects: totalInsectsAll(), humans: S.humans }));
  document.getElementById('gameOverOverlay').classList.add('hidden');
  setSetupEnabled(currentGameMode === 'sandbox');
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
function successChance(base, ratioScale, ratio){
  return Math.min(0.9, Math.max(0, base + ratio*ratioScale));
}
function setSetupEnabled(enabled){
  SETTINGS_INPUT_IDS.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.disabled = !enabled;
  });
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
  let totalScouts = 0;
  S.nests.forEach((nest, idx) => {
    if (!nest.alive) return;
    S.activeNestIndex = idx;
    const n = S.scoutsAvailable;
    S.scoutsAvailable = 0;
    totalScouts += n;
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
  log(t('log.step_begins', { step: S.step, scouts: totalScouts }));
  selectNextPendingEvent();

  const incoming = S.events.filter(
    e => e.status === 'pending' &&
        (e.type === 'search' || e.type === 'hunt' || e.type === 'fort')
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
    const searching = scoutsWorking();
    const hunting = predatorsWorking();
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

  postPhaseLog(txt);
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

  const outgoing = S.events.filter(e => e.status === 'resolved' && (e.type === 'search' || e.type === 'hunt' || e.type === 'fort'));
  const incoming = S.events.filter(e => e.status === 'pending' && (e.type === 'search' || e.type === 'hunt' || e.type === 'fort'));

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

function ratioHumansPerInsect(){
  // Uses the GLOBAL insect count (all nests), not just the active nest's -
  // search/hunt success and fort-trigger scarcity depend on how many
  // humans exist per insect across every competing nest, since insects
  // from rival nests can reach prey too.
  const insects = totalInsectsAll();
  if(insects<=0) return 0;
  return S.humans / insects;
}

// Number of nests still in play. Fort-trigger thresholds below were tuned
// assuming a single nest could hoard the colony's whole predator/food
// growth; with more rivals splitting the same humans/food over time, each
// nest structurally ends up smaller, so those thresholds are scaled down
// per alive nest so attacks remain reachable as nestCount grows.
function aliveNestCount(){
  return S.nests ? Math.max(1, S.nests.filter(n => n.alive).length) : 1;
}

function minHuntersForFeeding(){
  const s = S.settings;
  // Hidden scouts aren't part of the fed population yet, so leave them out
  // of the feeder count (mirrors processLifecycle's feederGroups).
  const feeders = (scoutsTotal() - S.scoutsHidden) + predatorsTotal() + sumCohort(S.nymph);
  const queenCost = S.queen.alive ? 1 : 0;
  const deficit = Math.max(0, feeders + queenCost - S.food);
  return s.foodPerHuman > 0 ? Math.ceil(deficit / s.foodPerHuman) : 0;
}

function fortFactorPct(value, low, high){
  if(high <= low) return value <= low ? 1 : 0;
  if(value <= low) return 1;
  if(value >= high) return 0;
  return (high - value) / (high - low);
}

function fortReadiness(targetFort){
  const s = S.settings;
  const insects = totalInsects();
  const foodPerInsect = insects > 0 ? S.food / insects : 0;
  const foodPct = insects > 0 ? fortFactorPct(foodPerInsect, s.fortFoodLow, s.fortFoodHigh) : 0;
  
  // Revised humanPct logic
  let humanPct = 0;
  if (insects > 0) {
    const ratio = ratioHumansPerInsect();
    
    // Check the ratio directly instead of S.humans
    if (ratio < 1.0) {
      // Scarcity ranges from 0 (humans equal insects) to 1 (humans reach 0)
      const scarcity = 1 - ratio; 
      
      // Starts at 1.0 and grows steeply up to 3.0 using a quadratic curve
      humanPct = 1 + 3 * Math.pow(scarcity, 2); 
    } else {
      humanPct = fortFactorPct(ratio, s.fortHumanLow, s.fortHumanHigh);
    }
  }

  const nestCount = aliveNestCount();
  const effectivePredatorThreshold = s.fortPredatorThreshold / nestCount;
  const predatorPct = effectivePredatorThreshold > 0 ? (predatorsTotal() / effectivePredatorThreshold) : 0;
  const d = targetFort ? dist(S.nest, targetFort) : 0;
  const distPct = targetFort ? fortFactorPct(d, s.fortDistLow, s.fortDistHigh) : 0;
  const pendingHuntSlots = S.events.filter(e => e.type === 'hunt' && e.status === 'pending' && e.nestId === S.nest.id).length;
  const idlePredators = Math.max(0, S.predatorsAvailable - pendingHuntSlots);
  const idlePct = Math.min(1, idlePredators / 30);
  
  return { foodPct, humanPct, predatorPct, distPct, idlePct, total: foodPct + humanPct + predatorPct + distPct + idlePct };
}

function maybeTriggerFort() {
  const nestId = S.nest.id;
  if (S.events.some(e => e.type === 'fort' && e.status === 'pending' && e.nestId === nestId)) return;
  if (S.fortCooldown > 0) { S.fortCooldown -= 1; return; }

  const targetFort = pickTargetFort();
  if (!targetFort) return;

  const readiness = fortReadiness(targetFort);
  const effectiveAttackThreshold = S.settings.fortAttackThreshold / aliveNestCount();
  if (readiness.total < effectiveAttackThreshold) return;

  const idlePredators = S.predatorsAvailable;
  if (idlePredators <= 0) return;

  // 1. Calculate Scarcity Factors (0.0 to 1.0 scale)
  const foodScarcity = Math.max(0, Math.min(1, readiness.foodPct));

  const wildHumans = S.humans || 0;
  const targetHumanThreshold = 10;
  const humanScarcity = Math.max(0, Math.min(1, 1 - (wildHumans / targetHumanThreshold)));

  // 2. Derive relative weights, scaled by CONQUEST_PRIORITY
  const huntWeight = 0.1 + foodScarcity;
  const conquestWeight = (0.1 + humanScarcity) * CONQUEST_PRIORITY;
  const totalWeight = huntWeight + conquestWeight;

  const huntShare = totalWeight > 0 ? huntWeight / totalWeight : 0.5;
  const conquestShare = totalWeight > 0 ? conquestWeight / totalWeight : 0.5;

  // 3. Allocate predator pools based on weighted shares
  const huntPool = Math.floor(idlePredators * huntShare);
  const conquestPool = Math.floor(idlePredators * conquestShare);

  // 4. Fill pending hunt slots strictly within the allocated hunt pool
  let huntUsed = 0;
  for (const e of S.events) {
    if (huntUsed >= huntPool) break;
    if (e.type !== 'hunt' || e.status !== 'pending' || e.nestId !== nestId) continue;
    
    const openSlots = Math.max(0, e.groupSize - e.neutralized - e.killed);
    if (openSlots <= 0) continue;
    
    const fill = Math.min(openSlots, huntPool - huntUsed);
    if (fill <= 0) continue;
    
    e.groupSize += fill;
    huntUsed += fill;
  }

  // 5. Assign fort attackers up to the conquest pool limit
  const remainingAfterHunts = idlePredators - huntUsed;
  const attackers = Math.min(remainingAfterHunts, conquestPool);

  if (attackers <= 0) {
    S.predatorsAvailable -= huntUsed;
    return;
  }

  S.predatorsAvailable -= (huntUsed + attackers);

  fortMark(targetFort, nestId).markedAttackDispatched = true;

  S.events.push({ 
    id: nid(), 
    type: 'fort', 
    status: 'pending', 
    outcome: null, 
    nestId,
    originalAttackers: attackers, 
    killed: 0, 
    targetFortId: targetFort.id 
  });

  const reasons = [];
  if (foodScarcity > 0.5) reasons.push(t('fort_trigger.food_low'));
  if (humanScarcity > 0.5) reasons.push(t('fort_trigger.humans_trapped'));
  const reasonText = reasons.length ? reasons.join(' & ') : t('fort_trigger.default_reason');

  log(t('fort_trigger.msg', {
    reason: reasonText,
    readiness: Math.round(readiness.total * 100),
    attackers,
    id: targetFort.id
  }));
}

function removeProportionally(pools, totalToRemove){
  const keys = Object.keys(pools);
  const total = keys.reduce((a,k)=>a+pools[k],0);
  const result = {...pools};
  if(total<=0 || totalToRemove<=0) return result;
  const capped = Math.min(totalToRemove, total);
  const raw = keys.map(k=>(pools[k]/total)*capped);
  const floors = raw.map(Math.floor);
  let assigned = floors.reduce((a,b)=>a+b,0);
  let remainder = capped - assigned;
  const byFrac = raw
    .map((r,i)=>({ i, frac: r-floors[i], capacity: pools[keys[i]]-floors[i] }))
    .filter(x=>x.capacity>0)
    .sort((a,b)=>b.frac-a.frac);
  let idx = 0;
  while(remainder>0 && idx<byFrac.length){ floors[byFrac[idx].i] += 1; remainder--; idx++; }
  keys.forEach((k,i)=>{ result[k] = Math.max(0, pools[k] - Math.min(floors[i], pools[k])); });
  return result;
}

// Runs one simulation step for every alive nest in turn (each drawing on the
// same shared S.humans/S.forts pool - this is how nests "compete" for
// humans), then does the shared end-of-step bookkeeping once.
function advanceStepLogic(){
  if(S.gameOver) return;
  S.events = S.events.filter(e=>e.status==='pending');
  S.selectedEventId = null;

  S.nests.forEach((nest, idx) => {
    if (!nest.alive) return;
    S.activeNestIndex = idx;
    if (totalInsectsForNest(nest) <= 0) {
      nest.alive = false;
      log(t('log.rival_nest_collapsed', { id: nest.id }) !== 'log.rival_nest_collapsed'
        ? t('log.rival_nest_collapsed', { id: nest.id })
        : `Hniezdo ${nest.id} zaniklo.`);
      return;
    }
    advanceNestStepLogic(nest);
  });

  S.activeNestIndex = S.focusedNestIndex || 0;

  S.history.push({step:S.step, humans:S.humans, insects: totalInsectsAll(), insectsByNest: insectsByNestSnapshot()});

  const allFortsConquered = S.forts.length === 0 || S.forts.every(f => !f.alive);
  const allNestsGone = S.nests.every(n => !n.alive);

  if (S.humans <= 0 && allFortsConquered) {
    S.gameOver = true;
    S.gameOverMsg = t('gameover.all_humans_dead');
    S.lastTriggeredCondition = { outcome: 'defeat', type: 'humans_remaining_below', value: 0 };
  } else if (allNestsGone) {
    S.gameOver = true;
    S.gameOverMsg = t('gameover.swarm_eliminated');
    S.lastTriggeredCondition = { outcome: 'victory', type: 'nest_collapses', value: 0 };
  }

  if (!S.gameOver) {
    maybeTriggerConditionGameOver();
  }
  if (S.gameOver) return;

  S.step += 1;
  S.points = S.maxPoints;
  S.reinforcedForts = []; // a fort can be reinforced again once the new step begins

  selectNextPendingEvent();
}

// Per-nest simulation step: search/hunt/fort-assault dispatch & resolution,
// brood lifecycle, and starvation - all scoped to the currently active nest
// (S.activeNestIndex, set by advanceStepLogic above) via the S.food/S.queen/
// S.eggs/... accessor properties. S.humans and S.forts are shared across
// every nest, which is what makes nests compete for the same humans.
function advanceNestStepLogic(nest){
  const nestId = nest.id;
  const oldScoutsAvailable = S.scoutsAvailable;
  const oldScoutsCooldown = S.scoutsCooldown;
  const oldPredatorsAvailable = S.predatorsAvailable;
  const oldPredatorsCooldown = S.predatorsCooldown;

  /* ---- 1. reveal hidden scouts and resolve the full search batch ---- */
  const humansAreGone = S.humans <= 0;
  if (S.scoutsHidden > 0) {
    const revealedHidden = S.scoutsHidden;
    S.scoutsHidden = 0;
    // Push events regardless of humansAreGone so they exist for fort marking
    for (let i = 0; i < revealedHidden; i++) {
      const e = { id: nid(), type: 'search', status: 'pending', outcome: null, nestId };
      assignEventCoords(e);
      S.events.push(e);
    }
    log(t('log.hidden_scouts_revealed', { count: revealedHidden }));
  }

  // Resolve scout sent to mark a fort.
  // This scout can be killed, but cannot be distracted.
  S.events
    .filter(e => e.type === 'search' && e.fortMarkScout && e.status === 'pending' && e.nestId === nestId)
    .forEach(e => {
      const targetFort = S.forts.find(f => f.id === e.targetFortId);

      e.status = 'resolved';

      // Free up this scout's slot in the fort's marking swarm/ring regardless
      // of outcome - siblings from the same swarm may still be in flight.
      if (targetFort) {
        const mark = fortMark(targetFort, nestId);
        mark.markingScoutCount = Math.max(0, (mark.markingScoutCount || 0) - 1);
      }

      // Roll death risk (double the rate of standard search death risk)
      if (!e.outcome) {
        const markDeathRisk = Math.min(1, S.settings.searchDeathRisk * 1.2);
        if (Math.random() < markDeathRisk) {
          e.outcome = 'killed';
        }
      }

      if (e.outcome === 'killed') {
        // Killing the marking scout has no other effect.
        return;
      }

      if (!targetFort || !targetFort.alive) return;

      const mark = fortMark(targetFort, nestId);
      // Another scout from the same swarm may have already marked this fort -
      // only log it the first time, but let every confirming scout refresh
      // the visible timer.
      if (!mark.marked) {
        mark.marked = true;
        log(`Hniezdo ${nestId}: skaut označil pevnosť ${targetFort.id} ako cieľ na dobytie.`);
      }

      mark.markedUntilStep = S.step + 2;
      mark.markedAttackDispatched = false;

      e.outcome = 'fort_marked';
    });

    let successfulSearches = 0, naturalFailures = 0, activeSearchers = 0;

    S.events
      .filter(e =>
        e.type === 'search' &&
        !e.fortMarkScout &&
        e.status === 'pending' &&
        e.nestId === nestId
      )
      .forEach(e => {
        e.status = 'resolved';
        
        // Count every scout as an active searcher for fort marking first
        activeSearchers++;

        if (humansAreGone) {
          e.outcome = 'failed';
          naturalFailures++;
          return; // Skip food search success, but keep activeSearchers count
        }

        const searchChance = searchChanceWithDistance(e);
        if (!e.outcome) { 
          if (0.5 < searchChance) { e.outcome = 'succeeded'; successfulSearches++; }
          else { e.outcome = 'failed'; naturalFailures++; }
        } else if (e.outcome === 'distracted' || e.outcome === 'killed') {
          naturalFailures++;
        }
      });

  // There can be at most as many successful searches as humans currently alive;
  // this makes the zero-human edge case redundant while still guarding it.
  successfulSearches = Math.max(0, Math.min(successfulSearches, S.humans));

  const bonusEggs = Math.round(successfulSearches * S.settings.eggsPerSearch);

  const killedScouts = Math.round(Math.max(0, naturalFailures * S.settings.searchDeathRisk));
  if(killedScouts>0) log(t('log.scouts_died_search', { count: killedScouts }));

  let scoutSurvivorsThisTick = S.events.filter(e=>e.type==='search' && e.outcome!=='killed' && e.nestId===nestId).length;
  if(successfulSearches>0) log(t('log.searches_succeeded', { count: successfulSearches, eggs: bonusEggs }));
  if(naturalFailures>0) log(t('log.searches_failed', { count: naturalFailures }));

  const newlyMarkedForts = maybeMarkFortsFromSearch(activeSearchers);
  newlyMarkedForts.forEach(f => {
    log(`Hniezdo ${nestId}: skaut označil pevnosť ${f.id} ako cieľ na dobytie.`);
  });

  /* ---- 2. resolve hunts ---- */
  let totalHunted = 0, totalHuntDeaths = 0, predatorSurvivorsThisTick = 0;
  const pendingHunts = S.events.filter(e=>e.type==='hunt' && e.status==='pending' && e.nestId===nestId);
  pendingHunts.forEach(e=>{
    const huntChance = huntChanceWithDistance(e);
    const activeHunters = e.groupSize - e.neutralized - e.killed;
    let eventSurvivors = activeHunters;
    if(activeHunters>0){
      let caught = 0;
      for(let i=0;i<activeHunters;i++){
        if(S.humans - totalHunted - caught <= 0) break;
        if(0.5 < huntChance) caught++;
      }
      totalHunted += caught;
      // Nests compete for the same humans: hunting close to a rival, alive
      // nest raises this batch of predators' death risk on top of the base
      // huntDeathRisk setting.
      const deathRisk = Math.min(0.95, S.settings.huntDeathRisk + enemyProximityDeathRisk(e, nestId));
      let huntDeaths = 0;
      for(let i=0;i<activeHunters;i++){ if(huntChance<deathRisk) huntDeaths++; }
      if(huntDeaths>0){ totalHuntDeaths += huntDeaths; eventSurvivors = Math.max(0, activeHunters-huntDeaths); }
    }
    predatorSurvivorsThisTick += eventSurvivors + e.neutralized;
    e.status = 'resolved';
    e.outcome = 'done';
    e.survivors = eventSurvivors + e.neutralized;
  });
  if(totalHunted>0){
    S.humans -= totalHunted;
    S.humansKilled += totalHunted;
    S.food += totalHunted * S.settings.foodPerHuman;
    log(t('log.humans_hunted', { count: totalHunted, food: totalHunted * S.settings.foodPerHuman }));
  } else if(pendingHunts.length>0){
    log(t('log.all_hunts_failed'));
  }
  if(totalHuntDeaths>0) log(t('log.predators_died_hunt', { count: totalHuntDeaths }));

  /* ---- 3. resolve fort assault ---- */
  S.events.filter(e => e.type === 'fort' && e.status === 'pending' && e.nestId === nestId).forEach(e => {
    e.status = 'resolved';
    const remaining = Math.max(0, e.originalAttackers - e.killed);
    const targetFort = S.forts.find(f => f.id === e.targetFortId);

    if (targetFort && targetFort.alive) {
      const s = S.settings;
      const d = dist(S.nest, targetFort);
      // % distance = how far along the close->far scale (fortDistLow..High)
      // the fort sits; farther forts bleed more attackers on the way in.
      const distanceFraction = 1 - fortFactorPct(d, s.fortDistLow, s.fortDistHigh);
      const attritionDeaths = Math.round(remaining * 0.01 * distanceFraction);
      const reaching = Math.max(0, remaining - attritionDeaths);

      const predStrength = getFortPredatorStrength(targetFort);
      const totalDamage = reaching * predStrength;
      const defenseBefore = targetFort.defense;
      const ratio = defenseBefore > 0 ? totalDamage / defenseBefore : Infinity;
      const combatDeaths = Math.round(reaching * conquestDeathPct(ratio));

      const lostInAssault = Math.min(remaining, attritionDeaths + combatDeaths);
      predatorSurvivorsThisTick += remaining - lostInAssault;

      targetFort.defense = Math.max(0, defenseBefore - totalDamage);

      if (targetFort.defense <= 0) {
        e.outcome = 'conquered';
        targetFort.alive = false;
        targetFort.marks = {}; // clear every nest's marking state on this fort
        const releasedHumans = targetFort.population || 0;
        S.humans += releasedHumans;
        targetFort.population = 0;
        S.fortCooldown = 1;
        log(t('log.fort_fallen', {
          id: targetFort.id,
          damage: totalDamage,
          attackers: remaining,
          strength: predStrength,
          lost: lostInAssault,
          humans: releasedHumans
        }));
      } else {
        e.outcome = 'defended';
        log(t('log.fort_held', {
          id: targetFort.id,
          damage: totalDamage,
          defense: targetFort.defense,
          maxDefense: targetFort.maxDefense,
          attackers: remaining,
          strength: predStrength,
          lost: lostInAssault
        }));
      }
    }
  });

  /* ---- 4. lifecycle ---- */
  const scoutsAliveBefore = oldScoutsAvailable + oldScoutsCooldown + scoutSurvivorsThisTick - killedScouts;
  const predatorsAliveBefore = oldPredatorsAvailable + oldPredatorsCooldown + predatorSurvivorsThisTick;
  const lc = processLifecycle(bonusEggs, { scoutsAlive: scoutsAliveBefore, predatorsAlive: predatorsAliveBefore }, naturalFailures, successfulSearches);

  /* ---- 5. starvation deaths ---- */
  const scoutPools = { available: oldScoutsAvailable, cooldown: oldScoutsCooldown, survivors: scoutSurvivorsThisTick, newlyMatured: lc.newlyMaturedScouts };
  const scoutsAfter = removeProportionally(scoutPools, lc.scoutDeaths);
  const predatorPools = { available: oldPredatorsAvailable, cooldown: oldPredatorsCooldown, survivors: predatorSurvivorsThisTick, newlyMatured: lc.newlyMaturedPredators };
  const predatorsAfter = removeProportionally(predatorPools, lc.predatorDeaths);

  /* ---- 6. finalize buckets ---- */
  S.scoutsCooldown = scoutsAfter.survivors;
  // Half of every batch of scouts becoming ready this step starts out hidden
  // (mirrors the initial seed split). This must cover the whole ready pool
  // (cooldown graduates + newly matured), not just newlyMatured: population
  // growth plateaus once scoutsAlive catches up to predatorsAlive/groupSize,
  // so newlyMatured alone permanently hits 0 after a few steps and would
  // starve the hidden pool. Cooldown graduates keep cycling every step, so
  // splitting off of the full pool keeps scanning relevant long-term.
  const readyScouts = scoutsAfter.available + scoutsAfter.cooldown + scoutsAfter.newlyMatured;
  const newlyHiddenScouts = Math.floor(readyScouts * 0.8);
  S.scoutsHidden += newlyHiddenScouts;
  S.scoutsAvailable = readyScouts - newlyHiddenScouts;
  S.predatorsCooldown = predatorsAfter.survivors;
  S.predatorsAvailable = predatorsAfter.available + predatorsAfter.cooldown + predatorsAfter.newlyMatured;

  if (totalInsectsForNest(nest) <= 0) {
    nest.alive = false;
    return;
  }

  /* ---- 7. dispatch NEXT step ---- */
  const scoutsToDispatch = humansAreGone ? 0 : S.scoutsAvailable;
  S.scoutsAvailable = 0;
  for(let i=0;i<scoutsToDispatch;i++){ 
    const e = { id:nid(), type:'search', status:'pending', outcome:null, nestId }; 
    assignEventCoords(e);
    S.events.push(e); 
  }
  maybeTriggerFort();
  const groupSize = S.settings.groupSize;
  const numGroups = humansAreGone ? 0 : Math.max(0, Math.min(Math.floor(S.predatorsAvailable/groupSize), successfulSearches));
  const dispatched = numGroups*groupSize;
  S.predatorsAvailable -= dispatched;
  for(let i=0;i<numGroups;i++){ 
    const e = { id:nid(), type:'hunt', status:'pending', outcome:null, groupSize, neutralized:0, killed:0, nestId }; 
    const avail = S.trails.find(t => !t.claimedByHuntId && t.stepsLeft > 0 && t.nestId === nestId);
    if (avail) {
      avail.claimedByHuntId = e.id;
      e._trailId = avail.id;
      e.x = avail.waypoints[0].x;
      e.y = avail.waypoints[0].y;
    } else {
      assignEventCoords(e);
    }
    S.events.push(e); 
  }
  if(numGroups>0) log(t('log.hunts_dispatched', { count: numGroups }));

  S.forts.forEach(f => {
    const mark = fortMark(f, nestId);
    if (
      mark.marked &&
      mark.markedUntilStep != null &&
      S.step + 1 >= mark.markedUntilStep
    ) {
      mark.marked = false;
      mark.markedUntilStep = null;
      mark.markedAttackDispatched = false;
      mark.markingScoutCount = 0;
    }
  });
}


function processLifecycle(bonusEggs, pop, naturalFailures, successfulSearches = 0){
  let scoutsAlive = pop.scoutsAlive;
  let predatorsAlive = pop.predatorsAlive;
  let newlyMaturedScouts = 0;
  let newlyMaturedPredators = 0;

  // ---------------------------------------------------------------------------
  // POPULATION STATUS
  // ---------------------------------------------------------------------------

  const isLowPopulation =
    totalInsects() < S.settings.minPopulationThreshold;

  const scoutBias = isLowPopulation
    ? 0
    : (naturalFailures || 0) * S.settings.scoutBiasPerFailedSearch;

  const adultPopulationBeforeDevelopment =
    scoutsAlive + predatorsAlive;


  // ---------------------------------------------------------------------------
  // NYMPHS -> PREDATORS
  // ---------------------------------------------------------------------------

  let maturingCount = 0;
  let recoveryPredatorsMaturedThisStep = 0;
  let stillNymph = [];

  S.nymph.forEach(c => {
    c.age += 1;

    if(c.age >= 2){
      maturingCount += c.count;

      if(c.recovery){
        recoveryPredatorsMaturedThisStep += c.count;
      }

    } else {
      stillNymph.push(c);
    }
  });

  S.nymph = stillNymph;

  for(let i = 0; i < maturingCount; i++){
    predatorsAlive += 1;
    newlyMaturedPredators += 1;
  }

  if(maturingCount > 0){
    let matureMsg = t('log.nymphs_matured', {
      count: maturingCount
    });

    if(naturalFailures > 0 && !isLowPopulation){
      matureMsg += t('log.nymphs_bias_note', {
        failures: naturalFailures,
        bias: scoutBias >= 1
          ? t('bias.strongly')
          : t('bias.slightly')
      });
    }

    log(matureMsg);
  }


  // ---------------------------------------------------------------------------
  // COCOONS -> SCOUTS / NYMPHS
  //
  // Recovery cohorts must be internally viable:
  // 1 scout per predator group.
  // ---------------------------------------------------------------------------

  let newNymph = 0;
  let newRecoveryNymph = 0;
  let stillCocoon = [];

  S.cocoon.forEach(c => {
    c.age += 1;

    if(c.age >= 1){

      // -----------------------------------------------------------------------
      // RECOVERY COHORT
      // -----------------------------------------------------------------------

      if(c.recovery){

        // Same ratio cap as the normal-cohort path below - previously this
        // branch created scouts with no ceiling at all, which is exactly
        // why scouts could climb above predators: recovery cohorts fire
        // during S.bounceback, i.e. right when predatorsAlive is at its
        // lowest, so an uncapped recovery scout batch is the most likely
        // way to breach the intended ratio.
        const maxScoutsAllowedRecovery = predatorsAlive < 15 ? Math.round(predatorsAlive / 4) : Math.round(predatorsAlive / 5);

        const recoveryScoutsNeeded =
          Math.max(
            1,
            Math.ceil(c.count / S.settings.groupSize)
          );

        const roomUnderCap = Math.max(0, maxScoutsAllowedRecovery - scoutsAlive);

        // Viability floor: if this nest currently has zero scouts, allow at
        // least 1 through even over the cap, so predators maturing out of
        // recovery aren't left with no scout to lead a hunting group.
        const viabilityFloor = scoutsAlive === 0 ? 1 : 0;

        const recoveryScoutsToCreate =
          Math.min(
            recoveryScoutsNeeded,
            c.count,
            Math.max(roomUnderCap, viabilityFloor)
          );

        const recoveryPredatorsToCreate =
          c.count - recoveryScoutsToCreate;

        for(let i = 0; i < recoveryScoutsToCreate; i++){

          scoutsAlive += 1;
          newlyMaturedScouts += 1;

          if(
            S.bounceback &&
            S.bounceback.active
          ){
            S.bounceback.recoveryScouts =
              (S.bounceback.recoveryScouts || 0) + 1;
          }
        }

        if(recoveryPredatorsToCreate > 0){

          newRecoveryNymph +=
            recoveryPredatorsToCreate;
        }

      } else {

        // ---------------------------------------------------------------------
        // NORMAL COHORT
        // ---------------------------------------------------------------------

        for(let i = 0; i < c.count; i++){

          const ratioScouts = Math.max(
            1,
            Math.ceil(
              predatorsAlive /
              S.settings.groupSize
            )
          );

          const desiredScouts = isLowPopulation
            ? ratioScouts
            : Math.ceil(
                predatorsAlive /
                S.settings.groupSize +
                scoutBias
              );

          // Hard cap scout creation at 2 scouts per 3 predators (2/3 ratio)
          const maxScoutsAllowed = predatorsAlive < 15 ? Math.round(predatorsAlive / 4) : Math.round(predatorsAlive / 5);

          if(scoutsAlive < desiredScouts && scoutsAlive < maxScoutsAllowed){

            scoutsAlive += 1;
            newlyMaturedScouts += 1;

          } else {

            newNymph += 1;
          }
        }
      }

    } else {

      stillCocoon.push(c);
    }
  });

  S.cocoon = stillCocoon;

  if(newNymph > 0){
    S.nymph.push({
      age: 0,
      count: newNymph,
      recovery: false
    });
  }

  if(newRecoveryNymph > 0){
    S.nymph.push({
      age: 0,
      count: newRecoveryNymph,
      recovery: true
    });
  }


  // ---------------------------------------------------------------------------
  // LARVAE -> COCOONS
  // ---------------------------------------------------------------------------

  let newCocoon = 0;
  let newRecoveryCocoon = 0;
  let stillLarva = [];

  S.larva.forEach(c => {
    c.age += 1;

    if(c.age >= 2){

      if(c.recovery){
        newRecoveryCocoon += c.count;
      } else {
        newCocoon += c.count;
      }

    } else {
      stillLarva.push(c);
    }
  });

  S.larva = stillLarva;

  if(newCocoon > 0){
    S.cocoon.push({
      age: 0,
      count: newCocoon,
      recovery: false
    });
  }

  if(newRecoveryCocoon > 0){
    S.cocoon.push({
      age: 0,
      count: newRecoveryCocoon,
      recovery: true
    });
  }


  // ---------------------------------------------------------------------------
  // EGGS -> LARVAE
  // ---------------------------------------------------------------------------

  let newLarva = 0;
  let newRecoveryLarva = 0;
  let stillEggs = [];

  S.eggs.forEach(c => {
    c.age += 1;

    if(c.age >= 1){

      if(c.recovery){
        newRecoveryLarva += c.count;
      } else {
        newLarva += c.count;
      }

    } else {
      stillEggs.push(c);
    }
  });

  S.eggs = stillEggs;

  if(newLarva > 0){
    S.larva.push({
      age: 0,
      count: newLarva,
      recovery: false
    });
  }

  if(newRecoveryLarva > 0){
    S.larva.push({
      age: 0,
      count: newRecoveryLarva,
      recovery: true
    });
  }


  // ---------------------------------------------------------------------------
  // FEEDER COUNTS & CRITICAL RESERVE DUMP
  // ---------------------------------------------------------------------------

  const nymphCount = sumCohort(S.nymph);

  const totalInsectsSum =
    sumCohort(S.eggs) +
    sumCohort(S.larva) +
    sumCohort(S.cocoon) +
    nymphCount +
    scoutsAlive +
    predatorsAlive;

  if (totalInsectsSum < 5 && S.queenReserve > 0) {
    S.food += S.queenReserve;
    log(t('log.queen_dumped_reserve') || `Kráľovná presunula rezervu (${S.queenReserve}) do hlavných zásob potravy.`);
    S.queenReserve = 0;
  }

  const feederGroups = [
    {
      key: 'scouts',
      count: scoutsAlive
    },
    {
      key: 'predators',
      count: predatorsAlive
    },
    {
      key: 'nymphs',
      count: nymphCount
    }
  ];

  const totalFeeders = feederGroups.reduce(
    (a, g) => a + g.count,
    0
  );


  // ---------------------------------------------------------------------------
  // BOUNCEBACK TRIGGER GATE
  // ---------------------------------------------------------------------------

  const queenReserveCap =
    S.settings.queenFoodReserveCap || 0;

  const queenReserveFull =
    S.queenReserve >= queenReserveCap;

  const criticalRecoveryPopulation =
    totalInsects() <=
    S.settings.minPopulationThreshold * 0.5;

  const bouncebackTriggerAllowed =
    queenReserveFull ||
    criticalRecoveryPopulation;


  // ---------------------------------------------------------------------------
  // BOUNCEBACK START (STEP 1 BATCH)
  // ---------------------------------------------------------------------------

  let queenLaidBounceback = false;

  const FOOD_PER_RECOVERY_INSECT = 6;
  const totalBouncebackEggs = Math.floor(S.queenReserve / FOOD_PER_RECOVERY_INSECT);

  if(
    S.queen.alive &&
    (!S.bounceback || (!S.bounceback.active && !S.bounceback.controlledRecovery)) &&
    isLowPopulation &&
    bouncebackTriggerAllowed &&
    totalBouncebackEggs > 0
  ){

    const batch1 = Math.ceil(totalBouncebackEggs / 2);
    const batch2 = totalBouncebackEggs - batch1;

    S.eggs.push({
      age: 0,
      count: batch1,
      recovery: true
    });

    S.bounceback = {
      active: true,
      recoveryScouts: 0,
      recoveryPredatorsMatured:
        recoveryPredatorsMaturedThisStep > 0,
      controlledRecovery: false,
      recoveryTick: 0,
      stepsElapsed: 0,
      reserveDumped: false,
      pendingBatch2: batch2
    };

    queenLaidBounceback = true;

    log(t('log.bounceback_started', {
      count: batch1
    }));
  }


  // ---------------------------------------------------------------------------
  // BOUNCEBACK STEP 2 BATCH
  // ---------------------------------------------------------------------------

  if(
    S.bounceback &&
    S.bounceback.active &&
    S.bounceback.pendingBatch2 > 0 &&
    !queenLaidBounceback
  ){
    S.eggs.push({
      age: 0,
      count: S.bounceback.pendingBatch2,
      recovery: true
    });

    log(t('log.bounceback_started', {
      count: S.bounceback.pendingBatch2
    }));

    S.bounceback.pendingBatch2 = 0;
  }


  // ---------------------------------------------------------------------------
  // BOUNCEBACK PROGRESS
  // ---------------------------------------------------------------------------

  if(
    S.bounceback &&
    S.bounceback.active &&
    recoveryPredatorsMaturedThisStep > 0
  ){
    S.bounceback.recoveryPredatorsMatured = true;
  }


  // ---------------------------------------------------------------------------
  // BOUNCEBACK CONTROLLED-RECOVERY LAYING UNLOCK
  // ---------------------------------------------------------------------------

  if(
    S.bounceback &&
    S.bounceback.active &&
    !S.bounceback.controlledRecovery &&
    !queenLaidBounceback
  ){
    S.bounceback.controlledRecovery = true;
    S.bounceback.recoveryTick = 0;
  }


  // ---------------------------------------------------------------------------
  // QUEEN FEEDING
  // ---------------------------------------------------------------------------

  let queenStarved = false;

  if(S.queen.alive){

    if(S.food >= 1){

      S.food -= 1;

    } else if(
      S.bounceback &&
      S.bounceback.active &&
      S.queenReserve >= 1
    ){

      S.queenReserve -= 1;

    } else if(S.queenReserve >= 1){

      S.queenReserve -= 1;

    } else {

      S.queen.alive = false;
      queenStarved = true;
    }
  }


  // ---------------------------------------------------------------------------
  // RECOVERY SCOUT PROTECTION
  // ---------------------------------------------------------------------------

  let protectedRecoveryScouts = 0;

  if(
    S.bounceback &&
    S.bounceback.active &&
    S.bounceback.recoveryScouts > 0
  ){

    const recoveryScouts = Math.min(
      S.bounceback.recoveryScouts,
      scoutsAlive
    );

    const fromFood = Math.min(
      recoveryScouts,
      S.food
    );

    S.food -= fromFood;
    protectedRecoveryScouts += fromFood;

    const stillNeeded =
      recoveryScouts - protectedRecoveryScouts;

    if(
      stillNeeded > 0 &&
      S.queenReserve > 0
    ){

      const fromReserve = Math.min(
        stillNeeded,
        S.queenReserve
      );

      S.queenReserve -= fromReserve;
      protectedRecoveryScouts += fromReserve;
    }
  }


  // ---------------------------------------------------------------------------
  // NORMAL FEEDING
  // ---------------------------------------------------------------------------

  const normalScouts =
    Math.max(
      0,
      scoutsAlive - protectedRecoveryScouts
    );

  const normalFeederGroups = [
    {
      key: 'scouts',
      count: normalScouts
    },
    {
      key: 'predators',
      count: predatorsAlive
    },
    {
      key: 'nymphs',
      count: nymphCount
    }
  ];

  const normalFeeders =
    normalFeederGroups.reduce(
      (a, g) => a + g.count,
      0
    );

  const shortage =
    S.food < normalFeeders;

  let unfed = 0;

  if(shortage){

    unfed =
      normalFeeders - S.food;

    S.food = 0;

  } else {

    S.food -= normalFeeders;
  }


  // ---------------------------------------------------------------------------
  // RECOVERY STEP COUNTER
  // ---------------------------------------------------------------------------

  const RESERVE_DUMP_DELAY_STEPS = 3;

  if(
    S.bounceback &&
    S.bounceback.active &&
    !queenLaidBounceback
  ){
    S.bounceback.stepsElapsed =
      (S.bounceback.stepsElapsed || 0) + 1;
  }


  // ---------------------------------------------------------------------------
  // RECOVERY LARVA FEEDING / RESERVE DUMP
  // ---------------------------------------------------------------------------

  const reserveWindowOpen =
    S.bounceback &&
    S.bounceback.active &&
    !S.bounceback.reserveDumped;

  const recoveryLarvaCount =
    S.larva.reduce(
      (a, c) => a + (c.recovery ? c.count : 0),
      0
    );

  let unfedRecoveryLarvae = 0;

  if(recoveryLarvaCount > 0 && reserveWindowOpen){

    let recoveryLarvaCost =
      recoveryLarvaCount;

    const paidFromFood =
      Math.min(S.food, recoveryLarvaCost);

    S.food -= paidFromFood;
    recoveryLarvaCost -= paidFromFood;

    const paidFromReserve =
      Math.min(S.queenReserve, recoveryLarvaCost);

    S.queenReserve -= paidFromReserve;
    recoveryLarvaCost -= paidFromReserve;

    if(recoveryLarvaCost > 0){

      unfedRecoveryLarvae = recoveryLarvaCost;

      removeFromRecoveryLarvaCohorts(unfedRecoveryLarvae);
    }
  }

  let queenReserveDumped = 0;

  if(
    reserveWindowOpen &&
    S.bounceback.stepsElapsed >= RESERVE_DUMP_DELAY_STEPS
  ){

    S.bounceback.reserveDumped = true;

    if(S.queenReserve > 0){

      queenReserveDumped = S.queenReserve;

      S.food += S.queenReserve;
      S.queenReserve = 0;
    }
  }


  // ---------------------------------------------------------------------------
  // BOUNCEBACK COMPLETION
  // ---------------------------------------------------------------------------

  let bouncebackJustFinished = false;

  if(
    S.bounceback &&
    S.bounceback.active &&
    S.bounceback.recoveryPredatorsMatured
  ){

    const recoveryStillDeveloping =
      S.eggs.some(c => c.recovery) ||
      S.larva.some(c => c.recovery) ||
      S.cocoon.some(c => c.recovery) ||
      S.nymph.some(c => c.recovery);

    if(!recoveryStillDeveloping){

      if(S.queenReserve > 0){

        S.food += S.queenReserve;
        S.queenReserve = 0;
      }

      S.bounceback.active = false;

      bouncebackJustFinished = true;

      log(t('log.bounceback_wave'));
    }
  }


  // ---------------------------------------------------------------------------
  // QUEEN RESERVE REFILL
  // ---------------------------------------------------------------------------

  const QUEEN_RESERVE_REFILL_PER_STEP = 50;

  if(
    S.queen.alive &&
    (!S.bounceback || !S.bounceback.active) &&
    !isLowPopulation &&
    S.queenReserve < queenReserveCap &&
    S.food > 0
  ){

    const refillAmount = Math.min(
      QUEEN_RESERVE_REFILL_PER_STEP,
      S.food,
      queenReserveCap - S.queenReserve
    );

    S.food -= refillAmount;
    S.queenReserve += refillAmount;
  }


  // ---------------------------------------------------------------------------
  // QUEEN EGG LAYING
  // ---------------------------------------------------------------------------

  let eggsLaid = 0;
  let eggFoodCost = 0;
  let eggsWereCapped = false;
  let baseEggs = 0;

  if(
    S.queen.alive &&
    (!S.bounceback || !S.bounceback.active || S.bounceback.controlledRecovery)
  ){

    const controlledRecovery =
      S.bounceback &&
      S.bounceback.controlledRecovery;

    if(controlledRecovery){

      S.bounceback.recoveryTick =
        (S.bounceback.recoveryTick || 0) + 1;

      const recoveryEggs =
        Math.min(
          S.settings.eggsPerFood,
          S.settings.eggCap
        );

      const recoveryLayStep =
        S.bounceback.recoveryTick % 2 === 0;

      if(
        recoveryLayStep &&
        recoveryEggs > 0 &&
        S.food >= 1
      ){

        S.food -= 1;

        eggsLaid = recoveryEggs;
        eggFoodCost = 1;

        S.eggs.push({
          age: 0,
          count: recoveryEggs,
          recovery: false
        });
      }

      const adultPopulation =
        scoutsAlive + predatorsAlive;

      if(
        adultPopulation >=
        S.settings.minPopulationThreshold
      ){
        S.bounceback.controlledRecovery = false;
      }

    } else if(
      isLowPopulation &&
      S.food >= 1
    ){

      S.food -= 1;

      const countToLay = Math.min(
        S.settings.eggCap,
        S.settings.eggsPerFood + bonusEggs 
      );

      if(countToLay > 0){

        eggsLaid = countToLay;
        eggFoodCost = 1;

        S.eggs.push({
          age: 0,
          count: eggsLaid,
          recovery: false
        });
      }

    } else if(!shortage){

      const insectCount =
        Math.max(1, totalInsects());

      const foodRatio =
        S.food / insectCount;

      if(foodRatio >= 5){

        baseEggs =
          S.settings.eggCap;

      } else {

        baseEggs = Math.round(
          S.settings.eggCap *
          (foodRatio - 1) / 3
        );
      }
      let minimalEggs = 0;
      if (insectCount < 5) {
        minimalEggs = 2;
      }
      const FreeNestCapacity = Math.max(0.1, Math.min(1, 1-(predatorsAlive + scoutsAlive) / 50));
      const desiredEggs =
        Math.max(0,baseEggs) + bonusEggs + minimalEggs;

      const cappedEggs =
        Math.min(
          S.settings.eggCap,
          Math.round(desiredEggs * FreeNestCapacity)
        );
      eggsWereCapped =
        cappedEggs < desiredEggs;
    
      const foodRemaining =
        S.food;

      const eggsPerFood =
        S.settings.eggsPerFood;

      let affordableEggs =
        cappedEggs;

      if(eggsPerFood > 0){

        const foodBudget =
          Math.max(0, foodRemaining);

        const maxAffordable =
          foodBudget * eggsPerFood +
          (eggsPerFood - 1);

        affordableEggs =
          Math.min(
            cappedEggs,
            maxAffordable
          );
      }

      eggsLaid =
        affordableEggs;

      eggFoodCost =
        eggsPerFood > 0
          ? Math.floor(
              eggsLaid / eggsPerFood
            )
          : 0;

      if(eggsLaid > 0){

        S.eggs.push({
          age: 0,
          count: eggsLaid,
          recovery: false
        });

        S.food -= eggFoodCost;
      }
    }
  }


  // ---------------------------------------------------------------------------
  // EGG-LAYING LOG
  // ---------------------------------------------------------------------------

  if(eggsLaid > 0){

    let eggMsg =
      t('log.queen_laid_eggs', {
        count: eggsLaid
      });

    if(eggFoodCost > 0){

      eggMsg +=
        t('log.cost_food', {
          cost: eggFoodCost
        });
    }

    if(eggsWereCapped){

      eggMsg +=
        t('log.capped_at', {
          cap: S.settings.eggCap
        });
    }

    log(eggMsg + '.');

  } else if(
    S.queen.alive &&
    !shortage &&
    !(
      S.bounceback &&
      (
        S.bounceback.active ||
        S.bounceback.controlledRecovery
      )
    ) &&
    (baseEggs + bonusEggs) > 0 &&
    S.settings.eggCap > 0
  ){

    log(t('log.queen_withheld_food'));
  }


  // ---------------------------------------------------------------------------
  // IMMATURE CANNIBALISM
  // ---------------------------------------------------------------------------

  let eatenImmature = 0;

  if(
    unfed > 0 &&
    !isLowPopulation &&
    (!S.bounceback || !S.bounceback.active)
  ){

    eatenImmature =
      eatFromCohorts(unfed);

    unfed -= eatenImmature;
  }


  // ---------------------------------------------------------------------------
  // STARVATION
  // ---------------------------------------------------------------------------

  let deaths = {
    queen: 0,
    scouts: 0,
    predators: 0,
    nymphs: 0
  };

  if(unfed > 0){

    deaths =
      distributeDeaths(
        normalFeederGroups,
        unfed
      );


    // -------------------------------------------------------------------------
    // QUEEN RESERVE BAILOUT (future-food protection)
    // -------------------------------------------------------------------------
    // distributeDeaths() above doesn't distinguish insects that are truly
    // doomed from ones with a concrete shot at bringing food home very soon.
    // If the queen still holds reserve food, she'll spend it to pull two
    // groups out of the death toll:
    //   - up to 1 scout per successful search THIS step - it just found
    //     food; starving it the instant before delivery makes no sense.
    //   - a full hunting group's worth of predators, but only if the nest
    //     currently has at least groupSize predators alive (cooldown +
    //     available) to form one - a partial group has no hunt to look
    //     forward to, so it isn't protected.
    // This only pulls FROM the death counts already assigned above, so it
    // never protects more insects than distributeDeaths actually condemned.
    let queenBailoutScouts = 0;
    let queenBailoutPredators = 0;

    // Queen's survival is an absolute priority over this bailout: her own
    // feeding step above already runs first and is never touched here, but
    // that only guarantees THIS step - if the bailout drained the reserve
    // to 0, she could still starve next step should S.food happen to be
    // empty then too. Reserve 1 unit (exactly what her own feeding costs
    // per step) as an untouchable floor before the bailout may spend
    // anything, so she's always covered one step ahead regardless.
    const queenReserveFloor = S.queen.alive ? 1 : 0;
    const availableForBailout = Math.max(0, S.queenReserve - queenReserveFloor);

    if(availableForBailout > 0){

      const groupSize = S.settings.groupSize;

      queenBailoutScouts =
        Math.min(
          deaths.scouts,
          successfulSearches,
          availableForBailout
        );

      if(queenBailoutScouts > 0){
        deaths.scouts -= queenBailoutScouts;
        S.queenReserve -= queenBailoutScouts;
      }

      const stillAvailableForBailout = availableForBailout - queenBailoutScouts;

      if(predatorsAlive >= groupSize && stillAvailableForBailout > 0){

        queenBailoutPredators =
          Math.min(
            deaths.predators,
            groupSize,
            stillAvailableForBailout
          );

        if(queenBailoutPredators > 0){
          deaths.predators -= queenBailoutPredators;
          S.queenReserve -= queenBailoutPredators;
        }
      }

      if(queenBailoutScouts > 0 || queenBailoutPredators > 0){
        const bailoutMsg = t('log.queen_reserve_bailout', {
          scouts: queenBailoutScouts,
          predators: queenBailoutPredators
        });
        log(
          bailoutMsg !== 'log.queen_reserve_bailout'
            ? bailoutMsg
            : `Kráľovná zachránila z rezervy ${queenBailoutScouts} skautov a ${queenBailoutPredators} predátorov pred hladom.`
        );
      }
    }


    scoutsAlive -= deaths.scouts;
    predatorsAlive -= deaths.predators;

    if(deaths.nymphs > 0){

      removeFromNymphCohorts(
        deaths.nymphs
      );
    }
  }


  // ---------------------------------------------------------------------------
  // QUEEN STARVATION LOG
  // ---------------------------------------------------------------------------

  if(queenStarved){
    log(t('log.queen_starved'));
  }


  // ---------------------------------------------------------------------------
  // FAMINE LOG
  // ---------------------------------------------------------------------------

  if(shortage){

    let msg =
      t('log.famine', {
        feeders: totalFeeders
      });

    if(eatenImmature > 0){

      msg +=
        t('log.devoured_immature', {
          count: eatenImmature
        });
    }

    if(unfed > 0){

      const parts = [];

      if(deaths.scouts){

        parts.push(
          deaths.scouts +
          ' ' +
          t('stats.scouts').toLowerCase()
        );
      }

      if(deaths.predators){

        parts.push(
          deaths.predators +
          ' ' +
          t('stats.predators').toLowerCase()
        );
      }

      if(deaths.nymphs){

        parts.push(
          deaths.nymphs +
          ' ' +
          t('stats.nymphs').toLowerCase()
        );
      }

      if(parts.length > 0){

        msg +=
          t('log.starved_breakdown', {
            parts: parts.join(', ')
          });
      }
    }

    if(S.queen.alive){

      msg +=
        t('log.queen_withheld_famine');
    }

    log(msg);
  }


  // ---------------------------------------------------------------------------
  // RETURN
  // ---------------------------------------------------------------------------

  return {
    newlyMaturedScouts,
    newlyMaturedPredators,
    scoutDeaths: deaths.scouts,
    predatorDeaths: deaths.predators,
  };
}



function eatFromCohorts(n){
  let remaining = n;
  [S.eggs].forEach(arr=>{
    for(let i=0;i<arr.length && remaining>0;i++){
      const take = Math.min(arr[i].count, remaining);
      arr[i].count -= take;
      remaining -= take;
    }
    for(let i=arr.length-1;i>=0;i--){ if(arr[i].count<=0) arr.splice(i,1); }
  });
  return n - remaining;
}

function removeFromNymphCohorts(n){
  let remaining = n;
  for(let i=0;i<S.nymph.length && remaining>0;i++){
    const take = Math.min(S.nymph[i].count, remaining);
    S.nymph[i].count -= take;
    remaining -= take;
  }
  for(let i=S.nymph.length-1;i>=0;i--){ if(S.nymph[i].count<=0) S.nymph.splice(i,1); }
}

function removeFromRecoveryLarvaCohorts(n){
  let remaining = n;
  for(let i=0;i<S.larva.length && remaining>0;i++){
    if(!S.larva[i].recovery) continue;
    const take = Math.min(S.larva[i].count, remaining);
    S.larva[i].count -= take;
    remaining -= take;
  }
  for(let i=S.larva.length-1;i>=0;i--){ if(S.larva[i].count<=0) S.larva.splice(i,1); }
}

function distributeDeaths(groups, unfed){
  const result = { queen:0, scouts:0, predators:0, nymphs:0 };
  const total = groups.reduce((a,g)=>a+g.count,0);
  if(total<=0) return result;
  const capped = Math.min(unfed, total);
  const raw = groups.map(g => (g.count/total) * capped);
  const floors = raw.map(Math.floor);
  let assigned = floors.reduce((a,b)=>a+b,0);
  let remainder = capped - assigned;
  const byFrac = raw
    .map((r,i)=>({ i, frac: r-floors[i], capacity: groups[i].count-floors[i] }))
    .filter(x=>x.capacity>0)
    .sort((a,b)=>b.frac-a.frac);
  let idx = 0;
  while(remainder>0 && idx<byFrac.length){
    floors[byFrac[idx].i] += 1;
    remainder--; idx++;
  }
  groups.forEach((g,i)=>{ result[g.key] = Math.min(floors[i], g.count); });
  return result;
}

/* ============================= PLAYER ACTIONS ============================= */
function findEvent(id){ return S.events.find(e=>e.id===id); }

function distractScout(eid){
  const e = findEvent(eid);

  if (e && e.fortMarkScout) return;

  const cost = S.settings.costDistractScout;
  if(!e || e.status!=='pending' || e.outcome || S.points<cost) return;
  
  S.points -= cost; 
  e.outcome='distracted';
  log(t('log.scout_distracted'));
  selectNextPendingEvent();
  render();
}

function killScout(eid){
  const e = findEvent(eid);
  const cost = S.settings.costKillScout;
  if(!e || e.status!=='pending' || e.outcome || S.points<cost) return;
  
  S.points -= cost; 
  e.outcome='killed';
  log(t('log.scout_killed'));
  selectNextPendingEvent();
  render();
}

function escapePredator(eid){
  const e = findEvent(eid);
  const cost = S.settings.costEscapePredator;
  if(!e || e.status!=='pending') return;
  if(e.neutralized+e.killed >= e.groupSize) return;
  if(S.points<cost) return;
  S.points -= cost; e.neutralized += 1;
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
  if (nest.predatorsCooldown > 0) return { type: 'predator', cost: S.settings.costAttackNestPredator };
  if (sumCohort(nest.nymph) > 0) return { type: 'nymph', cost: S.settings.costKillNymph };
  if (nest.scoutsCooldown > 0) return { type: 'scout', cost: S.settings.costAttackNestScout };
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

  // Route through the S.food/S.queen/S.nymph/... accessor shim so the
  // existing cohort helpers (removeFromNymphCohorts) act on THIS nest,
  // regardless of which nest is currently "active" for the simulation.
  const prevActiveIndex = S.activeNestIndex;
  S.activeNestIndex = S.nests.indexOf(nest);

  if (target.type === 'predator') {
    nest.predatorsCooldown -= 1;
    log(t('log.nest_predator_killed', { id: nest.id }) !== 'log.nest_predator_killed'
      ? t('log.nest_predator_killed', { id: nest.id })
      : `Predátor v hniezde ${nest.id} bol zabitý útokom na hniezdo.`);
  } else if (target.type === 'nymph') {
    removeFromNymphCohorts(1);
    log(t('log.nest_nymph_killed', { id: nest.id }) !== 'log.nest_nymph_killed'
      ? t('log.nest_nymph_killed', { id: nest.id })
      : `Nymfa v hniezde ${nest.id} bola zabitá útokom na hniezdo.`);
  } else if (target.type === 'scout') {
    nest.scoutsCooldown -= 1;
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

  log(t('log.humans_evacuated', { count: amount }));
  render();
}

function scanForHidden(){
  const cost = S.settings.costScan;
  if(S.phase!=='active' || S.gameOver) return;
  if(S.points<cost) return;
  S.points -= cost;
  if(S.scoutsHidden>0){
    const revealed = Math.ceil(S.scoutsHidden / 3);
    S.scoutsHidden -= revealed;
    // Dispatch revealed scouts as pending search events right away so their
    // icons show up on the map immediately, instead of parking them in
    // scoutsAvailable where they'd stay invisible until the next step dispatch.
    for (let i = 0; i < revealed; i++) {
      const e = { id: nid(), type: 'search', status: 'pending', outcome: null };
      assignEventCoords(e);
      S.events.push(e);
    }
    log(t('log.scan_revealed', { count: revealed, remaining: S.scoutsHidden }));
  }
  render();
}

function Hire(){
  const cost = HIRE_COST;
  if(S.phase!=='active' || S.gameOver) return;
  if(S.points<cost) return;
  S.points -= cost;
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
    marked: false
  };

  S.forts.push(fort);
  log(t('log.fort_built', { id: fort.id, capacity: fort.capacity, defense: fort.defense }));
  render();
}

function costBadgeHTML(cost){
  return `<span class="btn-cost"><span class="btn-cost-val"><strong>${cost}</strong></span><img src="../assets/logo_icon.png" alt="ap-icon" class="ap-icon"></span>`;
}

function buildCostBadgeEl(cost){
  const span = document.createElement('span');
  span.className = 'btn-cost';
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
// rather than inside it.
function wrapButtonWithCostAbove(button, cost, alignRight = false){
  const container = document.createElement('div');
  container.className = 'btn-container';

  const costHolder = document.createElement('div');
  costHolder.appendChild(buildCostBadgeEl(cost));

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
  const cost = S.settings.costKillPredator;
  if(S.points<cost) return;
  S.points -= cost;
  e.killed += 1;
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

  document.getElementById('insectsVal').textContent = totalInsectsAll();
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
}


function renderGlobalActions(){
  const scanBtn = document.getElementById('scan-btn');
  if(scanBtn){
    const costLbl = document.getElementById('scanCostLbl');
    if(costLbl) costLbl.textContent = S.settings.costScan;
    scanBtn.disabled = S.gameOver || S.phase!=='active' || S.points<S.settings.costScan;
  }

  const hireBtn = document.getElementById('hire-btn');
  if(hireBtn){
    const costLbl = document.getElementById('hireCostLbl');
    if(costLbl) costLbl.textContent = HIRE_COST;
  }

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
      ? t('event.search_title')
      : (e.type==='hunt'
        ? t('event.hunt_title')
        : t('event.fort_title', { id: e.targetFortId }));

    li.title = eventDescription;

    const badge = document.createElement('span');
    badge.className = 'badge ' + e.type;
    badge.textContent = e.type==='search' ? t('badge.search') : (e.type==='hunt' ? t('badge.hunt') : t('badge.fort'));

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'q-actions';

    if (e.status === 'pending') {
      if (e.type === 'search' && !e.outcome) {
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
          const rescueBtn = document.createElement('button');
          rescueBtn.className = 'act-mini';
          rescueBtn.textContent = t('actions.rescue');
          rescueBtn.title = t('actions.rescue_tooltip', { cost: S.settings.costEscapePredator });
          rescueBtn.disabled = S.points < S.settings.costEscapePredator;
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
          defendBtn.title = t('actions.defend_fort_tooltip', { id: e.targetFortId, cost: S.settings.costKillPredator });
          defendBtn.disabled = S.points < S.settings.costKillPredator;
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
    const predStrength = targetFort ? getFortPredatorStrength(targetFort) : 3;
    const totalDamage = remaining * predStrength;
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
      html += `<button class="act danger" ${((S.points<s.costKillPredator || remaining<=0)?'disabled':'')} onclick="killFortAttacker(${e.id}); openEventDetails(${e.id});"><span class="btn-main">${t('actions.defend_fort')}</span>${costBadgeHTML(s.costKillPredator)}</button>`;
      html += '</div>';
      if(remaining<=0){
        html += `<div class="detail-desc" style="margin-top:8px;">${t('event.fort_safe', { id: e.targetFortId })}</div>`;
      }
    } else {
      html += `<div class="detail-meta"><div>${t('outcome.label')}<b>${(e.outcome==='defended'? t('status.defended') : t('status.fort_conquered'))}</b></div></div>`;
    }
    return html;
  }

  if(e.type==='search'){
    const chance = Math.round(searchChanceWithDistance(e)*100);
    let html = `<h3 class="detail-title">${t('event.search_title')}</h3>`;
    html += `<div class="detail-desc">${t('event.search_desc', { chance, eggs: S.settings.eggsPerSearch })}</div>`;
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
    let html = `<h3 class="detail-title">${t('event.hunt_title')}</h3>`;
    html += `<div class="detail-desc">${t('event.hunt_desc', { groupSize: e.groupSize, chance: huntChancePct, deathRisk: deathRiskPct })}</div>`;
    html += '<div class="detail-meta">';
    html += `<div>${t('event.hunt_pack_size')}<b>${e.groupSize}</b></div>`;
    html += `<div>${t('event.hunt_escaped')}<b>${e.neutralized}</b></div>`;
    html += `<div>${t('event.hunt_killed')}<b>${e.killed}</b></div>`;
    html += `<div>${t('event.hunt_still_hunting')}<b>${active}</b></div>`;
    html += '</div>';
    if(e.status==='pending' && active>0){
      html += '<div class="actions">';
      html += `<button class="act" ${(S.points<S.settings.costEscapePredator?'disabled':'')} onclick="escapePredator(${e.id}); openEventDetails(${e.id});"><span class="btn-main">${t('actions.help_escape')}</span>${costBadgeHTML(S.settings.costEscapePredator)}</button>`;
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
  return el;
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

      if (img.complete) {
        resolve();
        return;
      }

      img.onload = resolve;
      img.onerror = resolve; // Don't block the game if an asset fails.

      img.src = src;
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

  S.trails.forEach(t => {
    if (t.claimedByHuntId != null) return;
    t.stepsLeft -= 1;
    if (t.stepsLeft <= 0) retireTrail(t.id);
  });

  outgoing.forEach(e => {
    const nestPt = nestPointFor(e.nestId);
    if (e.type === 'search') {
      if (e.x === undefined || e.y === undefined) return;

      // Fort-marking scout:
      // - survived and marked the fort -> return to nest
      // - killed -> disappear at the fort
      if (e.fortMarkScout) {
        if (e.outcome === 'fort_marked') {
          const wp = curveWaypoints(
            { x: e.x, y: e.y },
            nestPt,
            1,
            6
          );

          const dense = denseSmoothPath(wp);

          const el = spawnTempIcon('search', e.x, e.y);

          promises.push(
            animateAlongPath(el, dense, TRAIL_DRAW_MS)
              .then(() => fadeOut(el))
          );

          return;
        }

        // Marking scout was killed.
        if (e.outcome === 'killed') {
          const el = spawnTempIcon('search', e.x, e.y);
          promises.push(fadeOut(el));
          return;
        }

        return;
      }

      // Normal scout behaviour stays unchanged.
      if (e.outcome !== 'succeeded') {
        const el = spawnTempIcon('search', e.x, e.y);
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

      const el = spawnTempIcon('search', e.x, e.y);

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
        const el = spawnTempIcon('hunt', e.x, e.y);
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
      const el = spawnTempIcon('hunt', e.x, e.y);
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
            const el = spawnTempIcon('hunt', fx, fy);
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
      const el = spawnTempIcon('search', nestPt.x, nestPt.y);
      el.style.opacity = '0';
      requestAnimationFrame(() => { el.style.transition = 'opacity 0.3s ease'; el.style.opacity = '1'; });
      promises.push(animateAlongPath(el, dense, 1100));
      return;
    }

    if (e.type === 'hunt') {
      let dense;
      const trail = e._trailId ? S.trails.find(t => t.id === e._trailId) : null;
      if (!trail) {
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

      const el = spawnTempIcon('hunt', nestPt.x, nestPt.y);
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
            const el = spawnTempIcon('hunt', nestPt.x, nestPt.y);
            el.style.opacity = '0';
            requestAnimationFrame(() => { el.style.transition = 'opacity 0.3s ease'; el.style.opacity = '1'; });
            promises.push(animateAlongPath(el, dense, 1000));
          });
        }
      }
      return;
    }
  });

  Promise.all(promises).then(() => onComplete());
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

  S.points -= cost;
  fort.defense += S.settings.fortReinforceDefenseBonus;
  if (fort.defense > fort.maxDefense) {
    fort.maxDefense = fort.defense;
  }
  S.reinforcedForts.push(fort.id);
  log(t('log.reinforce_success', { id: fort.id, def: fort.defense, maxDef: fort.maxDefense }));
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

  S.points -= cost;
  fort.capacity += S.settings.fortCapacityIncreaseAmount;
  log(t('log.fort_capacity_increased', { id: fort.id, capacity: fort.capacity }));
  render();
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

function renderMap() {
  const wrap = document.getElementById('mapWrap');
  const fortsTag = document.getElementById('fortsTag');
  const controlsContainer = document.getElementById('controls-containter');
  if (!wrap) return;

  initMapFullscreenToggle();

  wrap.classList.toggle('fort-placement-active', fortPlacementMode);

  const aliveForts = S.forts.filter(f => f.alive);
  if (fortsTag) {
    fortsTag.textContent = t('ui.forts_standing', { alive: aliveForts.length, total: S.forts.length });
  }

  wrap.innerHTML = '';
  if (controlsContainer) controlsContainer.innerHTML = '';

  const trailLayer = buildTrailLayer();
  if (trailLayer) wrap.appendChild(trailLayer);

  // Render icons for alive nests only
  S.nests.forEach((nest, idx) => {
    if (!nest.alive) return; // Skip and remove collapsed nests from the map

    const nestKey = 'nest_' + nest.id;
    const nestContainer = document.createElement('div');
    nestContainer.className = 'map-event nest-event' + (activeOpenMapKey === nestKey ? ' open' : '');
    nestContainer.dataset.nestId = nest.id;
    nestContainer.style.position = 'absolute';
    setWorldPosition(nestContainer, wrap, nest.x, nest.y);
    nestContainer.style.transform = 'translate(-50%, -50%)';
    nestContainer.style.transform = 'scale(3)';
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
      const analyticsBtn = document.createElement('button');
      analyticsBtn.className = 'nest-btn control-btn map-action-btn';
      const analyticsMain = document.createElement('span');
      analyticsMain.className = 'btn-main';
      analyticsMain.textContent = '📊';
      analyticsBtn.appendChild(analyticsMain);
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
      const attackBtn = document.createElement('button');
      attackBtn.className = 'nest-btn control-btn danger map-action-btn';
      const attackMain = document.createElement('span');
      attackMain.className = 'btn-main';
      attackMain.textContent = '⚔️';
      attackBtn.appendChild(attackMain);
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
      fortImg.title = t('map.fort_fallen', { id: f.id });
    } else {
      if (isUnderAssault) {
        cls += ' under-attack';
      }
      fortImg.title = t('map.fort_active', { id: f.id, def: f.defense, maxDef: f.maxDefense });
      fortContainer.style.cursor = 'pointer';

      fortContainer.onclick = (ev) => {
        toggleMapSelection(fortKey, ev);
      };

      if (activeOpenMapKey === fortKey && controlsContainer) {
        if (S.phase === 'active') {
          const alreadyReinforced = Array.isArray(S.reinforcedForts) && S.reinforcedForts.includes(f.id);
          const reinforceBtn = document.createElement('button');
          reinforceBtn.className = 'nest-btn control-btn map-action-btn';
          const reinforceMain = document.createElement('span');
          reinforceMain.className = 'btn-main';
          reinforceMain.textContent = '🛡️';
          reinforceBtn.appendChild(reinforceMain);
          reinforceBtn.title = alreadyReinforced
            ? t('map.fort_reinforce_done_btn', { id: f.id })
            : t('map.fort_reinforce_btn', { cost: S.settings.fortReinforceCost, amount: S.settings.fortReinforceDefenseBonus });
          reinforceBtn.disabled = S.points < S.settings.fortReinforceCost || alreadyReinforced;
          reinforceBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = fortKey;
            reinforceFort(f.id);
          };

          const capacityBtn = document.createElement('button');
          capacityBtn.className = 'nest-btn control-btn map-action-btn';
          const capacityMain = document.createElement('span');
          capacityMain.className = 'btn-main';
          capacityMain.textContent = '📦';
          capacityBtn.appendChild(capacityMain);
          capacityBtn.title = t('map.fort_capacity_btn', { cost: S.settings.costIncreaseFortCapacity, amount: S.settings.fortCapacityIncreaseAmount });
          capacityBtn.disabled = S.points < S.settings.costIncreaseFortCapacity;
          capacityBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = fortKey;
            increaseFortCapacity(f.id);
          };

          const evacuateBtn = document.createElement('button');
          evacuateBtn.className = 'nest-btn control-btn map-action-btn';
          const evacuateMain = document.createElement('span');
          evacuateMain.className = 'btn-main';
          evacuateMain.textContent = '🚑';
          evacuateBtn.appendChild(evacuateMain);
          evacuateBtn.title = t('map.evacuate_tooltip', { cost: S.settings.costSaveHumans, amount: S.settings.saveHumansAmount });
          evacuateBtn.disabled = S.gameOver || S.phase !== 'active' || S.points < S.settings.costSaveHumans || S.humans <= 0;
          evacuateBtn.onclick = (ev) => {
            ev.stopPropagation();
            activeOpenMapKey = fortKey;
            saveHumans(f.id);
          };

          controlsContainer.appendChild(wrapButtonWithCostAbove(reinforceBtn, S.settings.fortReinforceCost));
          controlsContainer.appendChild(wrapButtonWithCostAbove(capacityBtn, S.settings.costIncreaseFortCapacity));
          controlsContainer.appendChild(wrapButtonWithCostAbove(evacuateBtn, S.settings.costSaveHumans));
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
        popInput.value = String(Math.max(0, Math.min(f.population || 0, fortCapacity)));
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
    const population = Math.max(0, Math.min(f.population || 0, capacity));
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
    if (e.type === 'search' && e.outcome) return false;
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

      const container = document.createElement('div');
      container.className =
        'map-event' + (activeOpenMapKey === eventKey ? ' open' : '');

      container.style.position = 'absolute';
      container.dataset.eventId = e.id;
      container.dataset.eventType = e.type;
      setWorldPosition(container, wrap, e.x, e.y);
      container.style.zIndex = '12';

      const iconImg = document.createElement('img');
      iconImg.className = 'map-icon event-icon';
      iconImg.src = '/nest/assets/scout.png';
      iconImg.title = `Skaut označuje pevnosť ${targetFort.id}`;

      iconImg.onclick = (ev) => {
        toggleMapSelection(eventKey, ev);
      };

      container.appendChild(iconImg);
      wrap.appendChild(container);

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
            killScout(e.id);
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
        rightBtn.title = t('actions.defend_fort_tooltip', { id: targetFort.id, cost: S.settings.costKillPredator });
        
        if (S.points < S.settings.costKillPredator) {
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
        controlsContainer.appendChild(rightBtn);
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
        leftBtn.textContent = '🏃';
        leftBtn.id = 'save-human-btn';
        leftBtn.title = t('actions.rescue_tooltip', {
          cost: S.settings.costEscapePredator
        });
        leftBtn.disabled = S.points < S.settings.costEscapePredator;

        leftBtn.onclick = (ev) => {
          ev.stopPropagation();
          activeOpenMapKey = eventKey;
          escapePredator(e.id);
        };

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
          wrapButtonWithCostAbove(leftBtn, S.settings.costEscapePredator)
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

  if (typeof window.sandboxOnMapRendered === 'function') window.sandboxOnMapRendered();
}

document.addEventListener('click', (ev) => {
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
  if (!S || S.gameOver) return { labels: [], humans: [], insects: [], insectsByNest: [] };

  const realState = S;
  const realRender = render;

  const simState = structuredClone(S);

  const forecastHumans = [];
  const forecastInsects = [];
  const forecastLabels = [];
  // Per-step snapshot of every nest's insect count, so the chart can plot a
  // forecast line for each nest, not just whichever nest is selected.
  const forecastInsectsByNest = [];

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
    }
  } finally {
    S = realState;
    render = realRender;
  }

  return {
    labels: forecastLabels,
    humans: forecastHumans,
    insects: forecastInsects,
    insectsByNest: forecastInsectsByNest
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
      (h.insectsByNest && Object.prototype.hasOwnProperty.call(h.insectsByNest, nestId))
        ? h.insectsByNest[nestId]
        : (i === 0 ? h.insects : null); // pre-multi-nest history only had a combined total

    const actualInsects = [...S.history.map(historyInsectsForNest), ...Array(forecast.labels.length).fill(null)];
    const forecastInsectsData = Array(combinedLabels.length).fill(null);

    if (lastIndex >= 0) {
      forecastInsectsData[lastIndex] = nest.alive ? totalInsectsForNest(nest) : 0;
      forecast.insectsByNest.forEach((snapshot, j) => {
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
    document.getElementById('overText').textContent = t('gameover.survived_msg', {
      msg: S.gameOverMsg,
      step: S.step,
      days: Math.round(S.step*12/24*10)/10
    });
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
  costKillPredator:'costKillPredatorInput', costSaveHumans:'costSaveHumansInput',
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
  document.getElementById('ingameMenu').classList.remove('hidden');
}


function hideMenu(){
  document.getElementById('ingameMenu').classList.add('hidden');
}

window.showMenu = showMenu;
window.hideMenu = hideMenu;
/**
 * HYBRID Nest Simulator - i18n Localization Engine
 */
let currentLang = 'sk';
let translations = {};

// Helper function to translate keys with parameter substitution
function t(key, params = {}) {
  let text = translations[currentLang]?.[key] || translations['en']?.[key] || key;
  
  // Replace placeholders like {step}, {count}, etc.
  Object.keys(params).forEach(param => {
    text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
  });
  
  return text;
}

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