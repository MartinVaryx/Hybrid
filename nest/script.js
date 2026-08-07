/* ============================= I18N SYSTEM ============================= */
let TRANSLATIONS = {};
const DEBUG = false;
const BUILD_FORT_COST = 8;
const BUILD_FORT_CAPACITY = 10;
const BUILD_FORT_DEFENSE = 10;
const HIRE_COST = 5;
const DIST_FROM_FORT = 10;
/* ============================= MODE & RESTART STATE ============================= */
let currentGameMode = 'sandbox'; // 'sandbox' | 'campaign'
let initialSandboxSnapshot = null; // Stores initial layout/params when sandbox starts

/**
 * Saves a snapshot of the initial state right after sandbox generation.
 */
function recordSandboxSnapshot() {
  if (!S) return;
  initialSandboxSnapshot = {
    nest: { ...S.nest },
    forts: JSON.parse(JSON.stringify(S.forts)),
    humans: S.humans,
    food: S.food,
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
      S.nest = { ...initialSandboxSnapshot.nest };
      S.forts = JSON.parse(JSON.stringify(initialSandboxSnapshot.forts));
      initGame(true); // Keep recorded layout intact
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
  renderNestAnalytics(); 
  const el = document.getElementById('nestAnalyticsOverlay');
  if (el) el.classList.remove('hidden');
}

/* ============================= NEST ANALYTICS RENDERER ============================= */
function renderNestAnalytics() {
  const container = document.getElementById('nestAnalyticsContent');
  if (!container || !S) return;

  const totalInsectsCount = typeof totalInsects === 'function' ? totalInsects() : 0;
  const foodPerInsect = totalInsectsCount > 0 ? (S.food / totalInsectsCount) : 0;

  // Spočítanie jednotlivých štádií
  const eggsCount = sumCohort(S.eggs);
  const larvaCount = sumCohort(S.larva);
  const cocoonCount = sumCohort(S.cocoon);
  const nymphCount = sumCohort(S.nymph);

  // Spočítanie kŕmených dospelých jedincov (feeders)
  const feedersCount = (S.queen.alive ? 1 : 0) + scoutsTotal() + predatorsTotal() + nymphCount;

  let html = `
    <!-- 1. Kráľovná & Stav hniezda -->
    <div class="analytics-section">
      <h3>${t('analytics.queen_status_title')}</h3>
      <div class="detail-meta">
        <div>${t('analytics.queen_state')}: <b class="${S.queen.alive ? 'good' : 'bad'}">${S.queen.alive ? t('stats.active') : t('stats.dead')}</b></div>
        <div>${t('analytics.food_storage')}: <b>${S.food}</b> (${foodPerInsect.toFixed(1)} ${t('analytics.per_insect')})</div>
        <div>${t('analytics.queen_reserve')}: <b>${S.queenReserve}</b> / ${S.settings.queenFoodReserveCap}</div>
      </div>
    </div>

    <!-- 2. Vývojové štádiá (Brood Lifecycle) -->
    <div class="analytics-section">
      <h3>${t('analytics.brood_lifecycle_title')}</h3>
      <div class="stage-chips-grid">
        <div class="stage-chip">
          <span class="chip-label">${t('stats.eggs')}</span>
          <span class="chip-val">${eggsCount}</span>
        </div>
        <div class="stage-chip">
          <span class="chip-label">${t('stats.larvae')}</span>
          <span class="chip-val">${larvaCount}</span>
        </div>
        <div class="stage-chip">
          <span class="chip-label">${t('stats.cocoons')}</span>
          <span class="chip-val">${cocoonCount}</span>
        </div>
        <div class="stage-chip">
          <span class="chip-label">${t('stats.nymphs')}</span>
          <span class="chip-val">${nymphCount}</span>
        </div>
      </div>
    </div>

    <!-- 3. Dospelá populácia (Insect Roster) -->
    <div class="analytics-section">
      <h3>${t('analytics.population_title')}</h3>
      <div class="detail-meta">
        <div>${t('stats.scouts')}: <b>${scoutsTotal()}</b> (${t('stats.available')}: ${S.scoutsAvailable}, ${t('stats.working')}: ${scoutsWorking()}, ${t('stats.cooldown')}: ${S.scoutsCooldown}, ${t('stats.hidden')}: ${S.scoutsHidden})</div>
        <div>${t('stats.predators')}: <b>${predatorsTotal()}</b> (${t('stats.available')}: ${S.predatorsAvailable}, ${t('stats.working')}: ${predatorsWorking()}, ${t('stats.cooldown')}: ${S.predatorsCooldown}, ${t('stats.fort_duty')}: ${predatorsFortDuty()})</div>
        <div>${t('analytics.total_population')}: <b>${totalInsectsCount}</b></div>
      </div>
    </div>

    <!-- 4. Spotreba a kŕmenie -->
    <div class="analytics-section">
      <h3>${t('analytics.consumption_title')}</h3>
      <div class="detail-meta">
        <div>${t('analytics.feeders_count')}: <b>${feedersCount}</b></div>
        <div>${t('analytics.food_needed_step')}: <b>${feedersCount}</b> ${t('analytics.food_units')}</div>
        <div>${t('analytics.status')}: 
          <b class="${S.food >= feedersCount ? 'good' : 'bad'}">
            ${S.food >= feedersCount ? t('analytics.food_sufficient') : t('analytics.famine_risk')}
          </b>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
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
  return {
    step: 0,
    points: 10,
    maxPoints: 10,
    phase: 'idle', // idle | active
    humans: 100,
    humansKilled: 0,
    food: 200,
    conditions: [],
    lastTriggeredCondition: null,
    settings: {
      lang: 'sk', // 'en' | 'sk'
      groupSize: 4, foodPerHuman: 5, maxPoints: 10, eggsPerSearch: 0.5,
      eggCap: 20, eggsPerFood: 5,
      searchBaseChance: 0.4, searchRatioScale: 0.25,
      huntBaseChance: 0.9, huntRatioScale: 0.25,
      huntDeathRisk: 0.5,
      scoutBiasPerFailedSearch: 2,
      fortLimit: 10,
      defaultFortDefense: 50,
      fortFoodLow: 2, fortFoodHigh: 5, fortHumanLow: 1, fortHumanHigh: 3,
      fortDistLow: 15, fortDistHigh: 70,
      fortPredatorThreshold: 40, fortAttackThreshold: 4.8, fortConquerThreshold: 0.7,
      scoutMarkChance: 0.2, fortMarkThreshold: 3.0,
      fortDefendCost: 10, fortDefendExtraLoss: 10,
      fortCapacityIncreaseAmount: 5, costIncreaseFortCapacity: 1,
      fortReinforceCost: 4, fortReinforceDefenseBonus: 10,
      costDistractScout: 1, costKillScout: 2, costEscapePredator: 1, costKillPredator: 3,
      costSaveHumans: 1, saveHumansAmount: 2, costScan: 1,
      queenFoodReserveCap: 120,
      minPopulationThreshold: 50
    },
    queen: { alive: true },
    queenReserve: 0,
    bounceback: null, // { active, stepsElapsed } - reserve-funded recovery cycle, see processLifecycle
    fortCooldown: 0,
    reinforcedForts: [], // fort ids already reinforced this step (reset every advanceStepLogic)
    nest: { x: 25, y: 25 },
    forts: [],

    scoutsAvailable: 4,
    scoutsHidden: 2,
    scoutsCooldown: 6,
    predatorsAvailable: 25,
    predatorsCooldown: 25,
    eggs: [{age: 0, count: 4},{age: 1, count: 4}],
    larva: [{age: 0, count: 4},{age: 1, count: 4}],
    cocoon: [{age: 0, count: 4}, {age: 1, count: 4}],
    nymph: [{age: 0, count: 4},{age: 1, count: 4}],    
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

    if (S.nest) {
      const d = dist(cand, S.nest);
      if (d < minDist) minDist = d;
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
  const MIN_NEST_DIST = 18; // Minimum distance between a fort and the nest
  const MIN_FORT_DIST = 30; // Minimum distance between forts

  // 1. Generate Nest position within custom margins
  S.nest = {
    x: Math.floor(MARGIN_X + Math.random() * (100 - 2 * MARGIN_X)),
    y: Math.floor(MARGIN_Y + Math.random() * (100 - 2 * MARGIN_Y))
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
        population: Math.round(50 + Math.random() * 50)
      };

      let valid = true;
      let minDistToAll = Infinity;

      // Distance check: Fort to Nest
      const dNest = dist(cand, S.nest);
      if (dNest < minDistToAll) minDistToAll = dNest;
      if (dNest < MIN_NEST_DIST) valid = false;

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

const FORT_STRENGTH_DISTANCE_DIVISOR = 220; // tune this - overall falloff radius (map units) for fort predator strength
const FORT_STRENGTH_COMPRESSION_POWER = 2; // tune this - >1 shrinks the "2 dmg" band closer to the "3 dmg" edge, WITHOUT changing the size of the "3 dmg" zone. 1 = original linear behavior.

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
  if (!isFinite(ratio) || ratio >= 2) return 0.1;
  if (ratio <= 0.5) return 0.9;
  const frac = (ratio - 0.5) / 1.5;
  return 0.9 - frac * 0.8;
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

function pickTargetFort(distancePower = 3) {
  // Only forts that have survived the scout-marking phase can be conquered.
  const markedForts = S.forts.filter(
    f =>
      f.alive &&
      f.marked &&
      !f.markedAttackDispatched &&
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
function maybeMarkFortsFromSearch(scoutCount) {
  if (scoutCount <= 0) return [];

  const s = S.settings;

  const candidates = S.forts.filter(
    f =>
      f.alive &&
      !f.marked &&
      !f.markingScoutPending &&
      (f.population || 0) > 0
  );

  if (candidates.length === 0) return [];

  const newlyMarked = [];

  for (let i = 0; i < scoutCount; i++) {

    const eligible = candidates.filter(
      f =>
        !f.marked &&
        !f.markingScoutPending &&
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

    // Prevent another scout from selecting the same fort this step.
    picked.markingScoutPending = true;

    // Same positioning convention as predator icons around a fort.
    const SCOUT_FORT_DISTANCE = 5;
    const angle = -Math.PI / 2;

    const scoutEvent = {
      id: nid(),
      type: 'search',
      status: 'pending',
      outcome: null,

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
  return S.events.filter(e=>e.type==='search' && e.status==='pending').length;
}
function predatorsWorking(){
  return S.events.filter(e=>e.type==='hunt' && e.status==='pending')
    .reduce((a,e)=>a + (e.groupSize - e.killed), 0);
}
function predatorsFortDuty(){
  const e = S.events.find(e=>e.type==='fort' && e.status==='pending');
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
  'langSelect','groupSizeInput','foodPerHumanInput','startHumansInput','startFoodInput',
  'maxPointsInput','eggsPerSearchInput','eggCapInput','eggsPerFoodInput',
  'searchBaseChanceInput','searchRatioScaleInput','huntBaseChanceInput','huntRatioScaleInput',
  'huntDeathRiskInput','scoutBiasPerFailedSearchInput','fortLimitInput','defaultFortDefenseInput',
  'fortFoodLowInput','fortFoodHighInput','fortHumanLowInput','fortHumanHighInput',
  'fortDistLowInput','fortDistHighInput',
  'fortPredatorThresholdInput','fortAttackThresholdInput','fortConquerThresholdInput',
  'scoutMarkChanceInput','fortMarkThresholdInput',
  'costDistractScoutInput','costKillScoutInput','costEscapePredatorInput','costKillPredatorInput',
  'costSaveHumansInput','saveHumansAmountInput','costScanInput',
  'costIncreaseFortCapacityInput','fortCapacityIncreaseAmountInput','queenFoodReserveCapInput',
  'minPopulationThresholdInput','fortReinforceCostInput','fortReinforceDefenseBonusInput'
];

function initGame(keepMap = false){
  const existingNest = S ? S.nest : null;
  const existingForts = S ? S.forts : null;

  const D = freshState();
  S = freshState();
  
  const g = id => {
    const el = document.getElementById(id);
    return el ? el.value : null;
  };

  S.settings.lang                 = g('langSelect') || D.settings.lang;
  S.settings.groupSize            = clampInt(g('groupSizeInput'), 1, 20, D.settings.groupSize);
  S.settings.foodPerHuman          = clampInt(g('foodPerHumanInput'), 1, 50, D.settings.foodPerHuman);
  S.humans                         = clampInt(g('startHumansInput'), 1, 5000, D.humans);
  S.food                           = clampInt(g('startFoodInput'), 0, 5000, D.food);
  S.settings.maxPoints             = clampInt(g('maxPointsInput'), 1, 50, D.settings.maxPoints);
  S.settings.eggsPerSearch         = clampFloat(g('eggsPerSearchInput'), 0, 20, D.settings.eggsPerSearch);
  S.settings.eggCap                = clampInt(g('eggCapInput'), 0, 500, D.settings.eggCap);
  S.settings.eggsPerFood           = clampInt(g('eggsPerFoodInput'), 0, 50, D.settings.eggsPerFood);
  S.settings.searchBaseChance      = clampFloat(g('searchBaseChanceInput'), 0, 90, D.settings.searchBaseChance*100) / 100;
  S.settings.searchRatioScale      = clampFloat(g('searchRatioScaleInput'), 0, 100, D.settings.searchRatioScale*100) / 100;
  S.settings.huntBaseChance        = clampFloat(g('huntBaseChanceInput'), 0, 90, D.settings.huntBaseChance*100) / 100;
  S.settings.huntRatioScale        = clampFloat(g('huntRatioScaleInput'), 0, 100, D.settings.huntRatioScale*100) / 100;
  S.settings.huntDeathRisk         = clampFloat(g('huntDeathRiskInput'), 0, 100, D.settings.huntDeathRisk*100) / 100;
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
  S.settings.fortConquerThreshold  = clampFloat(g('fortConquerThresholdInput'), 0, 1, D.settings.fortConquerThreshold);
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
  S.settings.minPopulationThreshold = clampInt(g('minPopulationThresholdInput'), 0, 1000, D.settings.minPopulationThreshold);
  S.settings.fortReinforceCost          = clampInt(g('fortReinforceCostInput'), 0, 50, D.settings.fortReinforceCost);
  S.settings.fortReinforceDefenseBonus  = clampInt(g('fortReinforceDefenseBonusInput'), 0, 500, D.settings.fortReinforceDefenseBonus);

  

  if (keepMap && existingNest && existingForts && existingForts.length > 0) {
    S.nest = existingNest;
    S.forts = existingForts;
  } else if (typeof CURRENT_LEVEL !== 'undefined' && CURRENT_LEVEL && CURRENT_LEVEL.nest) {
    // Campaign level setup
    currentGameMode = 'campaign';
    S.nest = { x: CURRENT_LEVEL.nest.x, y: CURRENT_LEVEL.nest.y };
    S.forts = CURRENT_LEVEL.forts.map(f => {
      const def = (f.defense != null) ? f.defense : S.settings.defaultFortDefense;
      const capacity = (f.capacity != null) ? f.capacity : 100;
      const population = (f.population != null) ? f.population : Math.round(50 + Math.random() * 50);
      return { id: f.id, x: f.x, y: f.y, alive: true, defense: def, maxDefense: def, capacity, population, marked: false };
    });
    setMapBackground(CURRENT_LEVEL.background || null);
  } else {
    // Sandbox setup
    currentGameMode = 'sandbox';
    CURRENT_LEVEL = null;
    setMapBackground(null);
    generateMapElements();
    recordSandboxSnapshot(); // Save initial snapshot
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

  S.history.push({step:0, humans:S.humans, insects: totalInsects()});
  log(t('log.nest_stirs', { insects: totalInsects(), humans: S.humans }));
  document.getElementById('gameOverOverlay').classList.add('hidden');
  setSetupEnabled(currentGameMode === 'sandbox');
  ensureSandboxMode();
  render();
}

let sandboxScriptLoaded = false;
let sandboxScriptLoading = false;

function ensureSandboxMode() {
  const settingsBtnEl = document.getElementById('settingsBtn');
  if (settingsBtnEl) settingsBtnEl.classList.toggle('hidden', currentGameMode !== 'sandbox');

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
    startFoodInput: d.food,
    maxPointsInput: d.settings.maxPoints,
    eggsPerSearchInput: d.settings.eggsPerSearch,
    eggCapInput: d.settings.eggCap,
    eggsPerFoodInput: d.settings.eggsPerFood,
    searchBaseChanceInput: Math.round(d.settings.searchBaseChance*100),
    searchRatioScaleInput: Math.round(d.settings.searchRatioScale*100),
    huntBaseChanceInput: Math.round(d.settings.huntBaseChance*100),
    huntRatioScaleInput: Math.round(d.settings.huntRatioScale*100),
    huntDeathRiskInput: Math.round(d.settings.huntDeathRisk*100),
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
    fortConquerThresholdInput: d.settings.fortConquerThreshold,
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

  const n = S.scoutsAvailable;
  S.scoutsAvailable = 0;
  for (let i = 0; i < n; i++) { 
    const e = { id: nid(), type: 'search', status: 'pending', outcome: null }; 
    assignEventCoords(e);
    S.events.push(e); 
  }

  maybeTriggerFort();
  S.step = 1;
  S.points = S.maxPoints;
  log(t('log.step_begins', { step: S.step, scouts: n }));
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

  // Clear insect population
  S.eggs = []; S.larva = []; S.cocoon = []; S.nymph = [];
  S.scoutsAvailable = 0; S.scoutsCooldown = 0; S.scoutsHidden = 0;
  S.predatorsAvailable = 0; S.predatorsCooldown = 0;

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
  const insects = totalInsects();
  if(insects<=0) return 0;
  return S.humans / insects;
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
      humanPct = 1 + 2 * Math.pow(scarcity, 2); 
    } else {
      humanPct = fortFactorPct(ratio, s.fortHumanLow, s.fortHumanHigh);
    }
  }

  const predatorPct = s.fortPredatorThreshold > 0 ? (predatorsTotal() / s.fortPredatorThreshold) : 0;
  const d = targetFort ? dist(S.nest, targetFort) : 0;
  const distPct = targetFort ? fortFactorPct(d, s.fortDistLow, s.fortDistHigh) : 0;
  const pendingHuntSlots = S.events.filter(e => e.type === 'hunt' && e.status === 'pending').length;
  const idlePredators = Math.max(0, S.predatorsAvailable - pendingHuntSlots);
  const idlePct = Math.min(1, idlePredators / 30);
  
  console.log(humanPct);
  return { foodPct, humanPct, predatorPct, distPct, idlePct, total: foodPct + humanPct + predatorPct + distPct + idlePct };
}

function maybeTriggerFort() {
  if (S.events.some(e => e.type === 'fort' && e.status === 'pending')) return;
  if (S.fortCooldown > 0) { S.fortCooldown -= 1; return; }

  const targetFort = pickTargetFort();
  if (!targetFort) return;

  const readiness = fortReadiness(targetFort);
  const pool = S.predatorsAvailable + predatorsWorking();
  if (pool <= 0) return;

  // Let some predators skip a few hunt slots if humans are scarce relative to
  // the colony size, or if food is already sufficient that a fort conquest is
  // more valuable than a full hunt fill.
  let idlePredators = S.predatorsAvailable;
  const insects = totalInsects();
  const humanToInsectRatio = insects > 0 ? S.humans / insects : 0;
  const humanScarcity = Math.max(0, Math.min(1, 1 - Math.min(2, humanToInsectRatio) / 2));
  const foodPressure = Math.max(0, Math.min(1, readiness.foodPct));
  const huntFillShare = Math.max(0.1, Math.min(0.9, 0.4 + foodPressure * 0.35 - humanScarcity * 1.3));
  const huntAllowance = Math.max(0, Math.min(idlePredators, Math.floor(idlePredators * huntFillShare)));

  let huntUsed = 0;
  for (const e of S.events) {
    if (idlePredators <= 0 || huntUsed >= huntAllowance) break;
    if (e.type !== 'hunt' || e.status !== 'pending') continue;
    const openSlots = Math.max(0, e.groupSize - e.neutralized - e.killed);
    if (openSlots <= 0) continue;
    const fill = Math.min(openSlots, idlePredators, huntAllowance - huntUsed);
    if (fill <= 0) continue;
    e.groupSize += fill;
    idlePredators -= fill;
    huntUsed += fill;
  }

  const remaining = Math.max(0, idlePredators);
  const conquestShare = Math.max(
    0.8,
    Math.min(1, (readiness.humanPct + (1 - readiness.distPct) + readiness.idlePct) / 2.5)
  );
  const attackers = Math.max(0, Math.min(remaining, Math.round(remaining * conquestShare)));
  if (attackers <= 0) return;

  S.predatorsAvailable = remaining - attackers;

  targetFort.markedAttackDispatched = true;

  S.events.push({ 
    id: nid(), 
    type: 'fort', 
    status: 'pending', 
    outcome: null, 
    originalAttackers: attackers, 
    killed: 0, 
    targetFortId: targetFort.id 
  });

  const leftoverHunting = predatorsWorking();
  const reasons = [];
  if (readiness.foodPct >= 1) reasons.push(t('fort_trigger.food_low'));
  if (readiness.humanPct >= 1) reasons.push(t('fort_trigger.humans_plentiful'));
  if (readiness.distPct >= 1) reasons.push(t('fort_trigger.close_proximity'));
  const reasonText = reasons.length ? reasons.join(' & ') : t('fort_trigger.default_reason');
  
  let msg = t('fort_trigger.msg', {
    reason: reasonText.charAt(0).toUpperCase() + reasonText.slice(1),
    readiness: Math.round(readiness.total * 100),
    attackers,
    id: targetFort.id
  });

  if (leftoverHunting > 0) msg += t('fort_trigger.leftover_hunt', { count: leftoverHunting });
  log(msg);
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

function advanceStepLogic(){
  if(S.gameOver) return;
  S.events = S.events.filter(e=>e.status==='pending');
  S.selectedEventId = null;

  const oldScoutsAvailable = S.scoutsAvailable;
  const oldScoutsCooldown = S.scoutsCooldown;
  const oldPredatorsAvailable = S.predatorsAvailable;
  const oldPredatorsCooldown = S.predatorsCooldown;

  /* ---- 1. reveal hidden scouts and resolve the full search batch ---- */
  const humansAreGone = S.humans <= 0;
  if (S.scoutsHidden > 0) {
    const revealedHidden = S.scoutsHidden;
    S.scoutsHidden = 0;
    if (!humansAreGone) {
      for (let i = 0; i < revealedHidden; i++) {
        const e = { id: nid(), type: 'search', status: 'pending', outcome: null };
        assignEventCoords(e);
        S.events.push(e);
      }
      log(t('log.hidden_scouts_revealed', { count: revealedHidden }));
    } else {
      log('Ľudia sú 0: skauti automaticky zlyhávajú a nevyvolávajú hľadanie potravy.');
    }
  }

// Resolve scout sent to mark a fort.
// This scout can be killed, but cannot be distracted.
S.events
  .filter(e => e.type === 'search' && e.fortMarkScout && e.status === 'pending')
  .forEach(e => {
    const targetFort = S.forts.find(f => f.id === e.targetFortId);

    e.status = 'resolved';

    if (e.outcome === 'killed') {
      if (targetFort) {
        targetFort.markingScoutPending = false;
      }

      // Killing the marking scout has no other effect.
      return;
    }

    if (!targetFort || !targetFort.alive) return;

    targetFort.markingScoutPending = false;
    targetFort.marked = true;

    // Visible during steps 2 and 3.
    targetFort.markedUntilStep = S.step + 2;
    targetFort.markedAttackDispatched = false;

    e.outcome = 'fort_marked';

    log(`Skaut označil pevnosť ${targetFort.id} ako cieľ na dobytie.`);
  });

let successfulSearches = 0, naturalFailures = 0, activeSearchers = 0;

S.events
  .filter(e =>
    e.type === 'search' &&
    !e.fortMarkScout &&
    e.status === 'pending'
  )
  .forEach(e=>{
    e.status = 'resolved';
    if (humansAreGone) {
      e.outcome = 'failed';
      naturalFailures++;
      return;
    }
    const searchChance = searchChanceWithDistance(e);
    if (!e.outcome) { 
        activeSearchers++;
        if(0.5 < searchChance){ e.outcome='succeeded'; successfulSearches++; }
        else { e.outcome='failed'; naturalFailures++; }
    } else if (e.outcome === 'distracted' || e.outcome === 'killed') {
        naturalFailures++;
    }
  });

  // There can be at most as many successful searches as humans currently alive;
  // this makes the zero-human edge case redundant while still guarding it.
  successfulSearches = Math.max(0, Math.min(successfulSearches, S.humans));

  const bonusEggs = Math.round(successfulSearches * S.settings.eggsPerSearch);
  let scoutSurvivorsThisTick = S.events.filter(e=>e.type==='search' && e.outcome!=='killed').length;
  if(successfulSearches>0) log(t('log.searches_succeeded', { count: successfulSearches, eggs: bonusEggs }));
  if(naturalFailures>0) log(t('log.searches_failed', { count: naturalFailures }));

  const newlyMarkedForts = maybeMarkFortsFromSearch(activeSearchers);
  newlyMarkedForts.forEach(f => {
    log(`Skaut označil pevnosť ${f.id} ako cieľ na dobytie.`);
  });

  /* ---- 2. resolve hunts ---- */
  let totalHunted = 0, totalHuntDeaths = 0, predatorSurvivorsThisTick = 0;
  const pendingHunts = S.events.filter(e=>e.type==='hunt' && e.status==='pending');
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
      let huntDeaths = 0;
      for(let i=0;i<activeHunters;i++){ if(huntChance<S.settings.huntDeathRisk) huntDeaths++; }
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
  S.events.filter(e => e.type === 'fort' && e.status === 'pending').forEach(e => {
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
        targetFort.marked = false;
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
  const scoutsAliveBefore = oldScoutsAvailable + oldScoutsCooldown + scoutSurvivorsThisTick;
  const predatorsAliveBefore = oldPredatorsAvailable + oldPredatorsCooldown + predatorSurvivorsThisTick;
  const lc = processLifecycle(bonusEggs, { scoutsAlive: scoutsAliveBefore, predatorsAlive: predatorsAliveBefore }, naturalFailures);

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

  S.history.push({step:S.step, humans:S.humans, insects: totalInsects()});
  
  const allFortsConquered = S.forts.length === 0 || S.forts.every(f => !f.alive);
  
  if (S.humans <= 0 && allFortsConquered) {
    S.gameOver = true;
    S.gameOverMsg = t('gameover.all_humans_dead');
    S.lastTriggeredCondition = { outcome: 'defeat', type: 'humans_remaining_below', value: 0 };
  } else if (totalInsects() <= 0) {
    S.gameOver = true;
    S.gameOverMsg = t('gameover.swarm_eliminated');
    S.lastTriggeredCondition = { outcome: 'victory', type: 'nest_collapses', value: 0 };
  }

  if (!S.gameOver) {
    maybeTriggerConditionGameOver();
  }
  if(S.gameOver){ return; }

  /* ---- 7. dispatch NEXT step ---- */
  const scoutsToDispatch = humansAreGone ? 0 : S.scoutsAvailable;
  S.scoutsAvailable = 0;
  for(let i=0;i<scoutsToDispatch;i++){ 
    const e = { id:nid(), type:'search', status:'pending', outcome:null }; 
    assignEventCoords(e);
    S.events.push(e); 
  }
  maybeTriggerFort();
  const groupSize = S.settings.groupSize;
  const numGroups = humansAreGone ? 0 : Math.max(0, Math.min(Math.floor(S.predatorsAvailable/groupSize), successfulSearches));
  const dispatched = numGroups*groupSize;
  S.predatorsAvailable -= dispatched;
  for(let i=0;i<numGroups;i++){ 
    const e = { id:nid(), type:'hunt', status:'pending', outcome:null, groupSize, neutralized:0, killed:0 }; 
    const avail = S.trails.find(t => !t.claimedByHuntId && t.fadingOutSince == null && t.stepsLeft > 0);
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


  S.step += 1;

  S.forts.forEach(f => {
    if (
      f.marked &&
      f.markedUntilStep != null &&
      S.step >= f.markedUntilStep
    ) {
      f.marked = false;
      f.markedUntilStep = null;
      f.markedAttackDispatched = false;
      f.markingScoutPending = false;
    }
  });

  S.points = S.maxPoints;
  S.reinforcedForts = []; // a fort can be reinforced again once the new step begins

  selectNextPendingEvent();
}


function processLifecycle(bonusEggs, pop, naturalFailures){
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

        const recoveryScoutsNeeded =
          Math.max(
            1,
            Math.ceil(c.count / S.settings.groupSize)
          );

        const recoveryScoutsToCreate =
          Math.min(
            recoveryScoutsNeeded,
            c.count
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

          if(scoutsAlive < desiredScouts){

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
  // FEEDER COUNTS
  // ---------------------------------------------------------------------------

  const nymphCount = sumCohort(S.nymph);

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
  // BOUNCEBACK START
  // ---------------------------------------------------------------------------

  let queenLaidBounceback = false;

  if(
    S.queen.alive &&
    (!S.bounceback || (!S.bounceback.active && !S.bounceback.controlledRecovery)) &&
    isLowPopulation &&
    bouncebackTriggerAllowed &&
    (S.food + S.queenReserve) > 0 &&
    S.settings.eggCap > 0
  ){

    const totalAvailableFood =
      S.food + S.queenReserve;

    const emergencyReserve =
      Math.min(10, totalAvailableFood);

    S.queenReserve = emergencyReserve;

    S.food =
      totalAvailableFood - emergencyReserve;

    S.eggs.push({
      age: 0,
      count: S.settings.eggCap,
      recovery: true
    });

    S.bounceback = {
      active: true,
      recoveryScouts: 0,
      recoveryPredatorsMatured:
        recoveryPredatorsMaturedThisStep > 0,
      controlledRecovery: false,
      recoveryTick: 0
    };

    queenLaidBounceback = true;

    log(t('log.bounceback_started', {
      count: S.settings.eggCap
    }));
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
  //
  // Laying switches to the "1 food every other step" controlled pattern
  // starting the step immediately after the bounceback batch itself -
  // it does NOT wait for the recovery cohort to mature. `active` (and the
  // reserve-funded feeding/scout protections tied to it) stays on until
  // the cohort actually matures, handled separately below.
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
      (S.food >= 1 || S.queenReserve >= 1)
    ){

      if(S.food >= 1){

        S.food -= 1;

      } else {

        S.queenReserve -= 1;
      }

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

      const desiredEggs =
        baseEggs + bonusEggs;

      const cappedEggs =
        Math.min(
          S.settings.eggCap,
          desiredEggs
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
  // QUEEN RESERVE REFILL
  //
  // IMPORTANT:
  // The reserve is replenished ONLY when the population is ABOVE
  // minPopulationThreshold.
  //
  // At or below the threshold, ALL surplus food remains in normal storage.
  // This prevents the queen from rebuilding her reserve while the colony is
  // still in a vulnerable state.
  //
  // Bounceback also keeps the reserve locked while active.
  // ---------------------------------------------------------------------------

  let queenReserveTopUp = 0;

  const populationRecovered =
    totalInsects() >
    S.settings.minPopulationThreshold;

  if(
    S.queen.alive &&
    populationRecovered &&
    (!S.bounceback || !S.bounceback.active) &&
    S.food > 0 &&
    S.queenReserve < queenReserveCap
  ){

    queenReserveTopUp = Math.min(
      S.food,
      queenReserveCap - S.queenReserve
    );

    if(queenReserveTopUp > 0){

      S.queenReserve += queenReserveTopUp;
      S.food -= queenReserveTopUp;
    }
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
  [S.eggs, S.larva, S.cocoon].forEach(arr=>{
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

  document.getElementById('insectsVal').textContent = totalInsects();
  document.getElementById('pointsVal').textContent = S.points;
  document.getElementById('maxPointsVal').textContent = S.maxPoints;


  const aliveForts = S.forts.filter(f => f.alive);
  const activeFortEvent = S.events.find(e => e.type === 'fort' && e.status === 'pending');
  const targetFort = activeFortEvent ? S.forts.find(f => f.id === activeFortEvent.targetFortId) : null;



  renderPhaseBanner();
  renderGlobalActions();
  renderQueue();
  renderStats();
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

function renderStats(){
  const row = document.getElementById('stageRow');
  if(!row) return;
  row.innerHTML = '';

  const groups = [
    {
      title: t('stats.core'),
      items: [
        { label: t('stats.food_storage'), count: S.food, cls: 'food' },
        { label: t('stats.queenReserve'), count: S.queenReserve, cls: 'food' },
        { label: t('stats.queen'), count: S.queen.alive ? t('stats.active') : t('stats.dead'), cls: S.queen.alive ? 'good' : 'bad' }
      ]
    },
    {
      title: t('stats.scouts'),
      items: [
        { label: t('stats.total'), count: scoutsTotal(), cls: 'main' },
        { label: t('stats.available'), count: S.scoutsAvailable },
        { label: t('stats.working'), count: scoutsWorking() },
        { label: t('stats.cooldown'), count: S.scoutsCooldown },
        { label: t('stats.hidden'), count: S.scoutsHidden }
      ]
    },
    {
      title: t('stats.predators'),
      items: [
        { label: t('stats.total'), count: predatorsTotal(), cls: 'main' },
        { label: t('stats.available'), count: S.predatorsAvailable },
        { label: t('stats.working'), count: predatorsWorking() },
        { label: t('stats.cooldown'), count: S.predatorsCooldown },
        { label: t('stats.fort_duty'), count: predatorsFortDuty() }
      ]
    },
    {
      title: t('stats.immatures'),
      items: [
        { label: t('stats.eggs'), count: sumCohort(S.eggs) },
        { label: t('stats.larvae'), count: sumCohort(S.larva) },
        { label: t('stats.cocoons'), count: sumCohort(S.cocoon) },
        { label: t('stats.nymphs'), count: sumCohort(S.nymph) }
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
      chip.innerHTML = `<span class="chip-label">${item.label}</span> <span class="chip-val">${item.count}</span>`;
      chipsWrap.appendChild(chip);
    });

    groupEl.appendChild(chipsWrap);
    row.appendChild(groupEl);
  });
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
const TRAIL_FADE_MS = 1400;

function buildTrailLayer(){
  if (!S.trails || !S.trails.length) return null;

  const now = performance.now();
  const svgNS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${100 * WORLD_ASPECT_RATIO} 100`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('class', 'trail-layer');

  const scaleG = document.createElementNS(svgNS, 'g');
  scaleG.setAttribute(
    'transform',
    `scale(${WORLD_ASPECT_RATIO}, 1)`
  );

  const g = document.createElementNS(svgNS, 'g');

  S.trails.forEach(trail => {
    const pts = trail.waypoints;
    const n = pts.length;

    if (n < 2) return;

    const revealFrac = trail.bornAt != null
      ? easeInOutQuad(
          Math.max(
            0,
            Math.min(
              1,
              (now - trail.bornAt) / TRAIL_DRAW_MS
            )
          )
        )
      : 1;

    const baseLifeFactor = trail.fadingOutSince != null
      ? trail.retiredLifeFactor
      : Math.max(
          0,
          Math.min(1, trail.stepsLeft / 2)
        );

    const fadeFactor = trail.fadingOutSince != null
      ? Math.max(
          0,
          1 - (now - trail.fadingOutSince) / TRAIL_FADE_MS
        )
      : 1;

    if (
      revealFrac <= 0 ||
      baseLifeFactor <= 0 ||
      fadeFactor <= 0
    ) {
      return;
    }

    // Fewer segments = much less SVG work.
    const segStep = Math.max(1, Math.floor(n / 14));

    for (let i = 0; i < n - segStep; i += segStep) {
      const r = i / (n - 1);

      if (r > revealFrac) break;

      const edgeFade = 0.65 + 0.35 * Math.min(1, r);

      const alpha = Math.max(
        0,
        edgeFade *
        0.68 *
        baseLifeFactor *
        fadeFactor
      );

      if (alpha <= 0.012) continue;

      const p1 = pts[i];
      const p2 = pts[Math.min(n - 1, i + segStep)];

      const line = document.createElementNS(
        svgNS,
        'line'
      );

      line.setAttribute('x1', p1.x);
      line.setAttribute('y1', p1.y);
      line.setAttribute('x2', p2.x);
      line.setAttribute('y2', p2.y);

      line.setAttribute(
        'stroke',
        `rgba(168, 85, 247, ${alpha.toFixed(3)})`
      );

      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute(
        'vector-effect',
        'non-scaling-stroke'
      );

      g.appendChild(line);
    }
  });

  scaleG.appendChild(g);
  svg.appendChild(scaleG);

  return svg;
}

function retireTrail(id, lifeFactorOverride){
  const t = S.trails.find(tr => tr.id === id);
  if (!t || t.fadingOutSince != null) return;
  t.retiredLifeFactor = lifeFactorOverride != null ? lifeFactorOverride : Math.max(0, Math.min(1, t.stepsLeft / 2));
  t.fadingOutSince = performance.now();
  ensureTrailAnimationLoop();
}

function trailsNeedAnimationFrame(){
  const now = performance.now();
  return S.trails.some(t => {
    if (t.fadingOutSince != null) return true;
    if (t.bornAt != null && (now - t.bornAt) < TRAIL_DRAW_MS) return true;
    return false;
  });
}

function refreshTrailLayer(){
  const wrap = document.getElementById('mapWrap');
  if (!wrap) return;
  const old = wrap.querySelector('svg.trail-layer');
  const layer = buildTrailLayer();
  if (old) {
    if (layer) old.replaceWith(layer); else old.remove();
  } else if (layer) {
    wrap.appendChild(layer);
  }
}

let _trailAnimHandle = null;
function tickTrailAnimation(){
  const now = performance.now();
  S.trails = S.trails.filter(t => !(t.fadingOutSince != null && now - t.fadingOutSince >= TRAIL_FADE_MS));
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

function runStepAnimation(outgoing, incoming, onComplete){
  const wrap = document.getElementById('mapWrap');
  if (!wrap || !S.nest) { onComplete(); return; }
  const nestPt = { x: S.nest.x, y: S.nest.y };
  const promises = [];

  S.trails.forEach(t => {
    if (t.fadingOutSince != null) return;
    if (t.claimedByHuntId != null) return; 
    const preDecrementFactor = Math.max(0, Math.min(1, t.stepsLeft / 2));
    t.stepsLeft -= 1;
    if (t.stepsLeft <= 0) retireTrail(t.id, preDecrementFactor);
  });

  outgoing.forEach(e => {
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

      const wp = curveWaypoints(
        { x: e.x, y: e.y },
        nestPt,
        1,
        6
      );

      const dense = denseSmoothPath(wp);

      S.trails.push({
        id: 'trail_' + e.id,
        waypoints: dense,
        stepsLeft: 2,
        claimedByHuntId: null,
        bornAt: performance.now(),
        fadingOutSince: null,
        retiredLifeFactor: null
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
        const avail = S.trails.find(t => !t.claimedByHuntId && t.fadingOutSince == null && t.stepsLeft > 0);
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

function renderMap() {
  const wrap = document.getElementById('mapWrap');
  const fortsTag = document.getElementById('fortsTag');
  const controlsContainer = document.getElementById('controls-containter');
  if (!wrap) return;

  wrap.classList.toggle('fort-placement-active', fortPlacementMode);

  const aliveForts = S.forts.filter(f => f.alive);
  if (fortsTag) {
    fortsTag.textContent = t('ui.forts_standing', { alive: aliveForts.length, total: S.forts.length });
  }

  wrap.innerHTML = '';
  if (controlsContainer) controlsContainer.innerHTML = '';

  const trailLayer = buildTrailLayer();
  if (trailLayer) wrap.appendChild(trailLayer);

  const nestImg = document.createElement('img');
  nestImg.src = '/nest/assets/nest_icon.png';
  nestImg.className = 'map-icon nest-icon';
  setWorldPosition(nestImg, wrap, S.nest.x, S.nest.y);
  nestImg.title = t('map.nest_title');
  nestImg.onclick = openNestAnalytics;
  wrap.appendChild(nestImg);

  if (DEBUG) debugRenderFortStrengthZones(wrap); // DEBUG - remove this line to disable fort-strength zone rings

  const activeFortEvent = S.events.find(e => e.type === 'fort' && e.status === 'pending');
  const activeTargetId = activeFortEvent ? activeFortEvent.targetFortId : null;


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

    const isUnderAssault = activeTargetId === f.id;

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

        // Fort population - shown whenever a fort is selected, in every mode.
        // Read-only here; sandbox.js re-enables it and wires editing when
        // sandbox edit mode is active (see sandboxWireMapEventExtras).
        // Displayed/edited as "current population", with the fort's capacity
        // shown alongside as a fixed "/capacity" suffix.
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
        // Capacity suffix - a plain "/N" label in campaign mode, but in
        // sandbox mode it's an editable input alongside the slash. Read-only
        // here; sandbox.js re-enables it and wires editing when sandbox
        // edit mode is active (see sandboxWireMapEventExtras).
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

        // Scout-marked indicator - shown whenever a fort is selected and a
        // scout has flagged it as ripe for conquest (see
        // maybeMarkFortsFromSearch). Purely informational, every mode.
        if (f.alive && f.marked) {
          const markNote = document.createElement('div');
          markNote.className = 'sb-fort-marked-note';
          markNote.textContent = '⚑ Skauti ju označili ako cieľ na dobytie';
          markNote.style.color = '#ff5252';
          markNote.style.fontSize = '0.8rem';
          markNote.style.marginTop = '2px';
          controlsContainer.appendChild(markNote);
        }

        // Fort defense - parallel to the population field above, but only
        // ever shown in sandbox mode. Read-only here; sandbox.js re-enables
        // it and wires editing when sandbox edit mode is active (see
        // sandboxWireMapEventExtras).
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
    if (!targetFort) return;

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

    // Controls for the fort-marking scout.
    // It can be KILLED, but it cannot be DISTRACTED.
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

      // Kill only — deliberately NO distract button.
      controlsContainer.appendChild(
        wrapButtonWithCostAbove(
          killBtn,
          S.settings.costKillScout,
          true
        )
      );

      // INFO LAST
      controlsContainer.appendChild(infoBtn);
    }

    return;
  }


    if (e.type === 'fort') {
      const targetFort = S.forts.find(f => f.id === e.targetFortId);
      if (!targetFort) return;
      const rem = Math.max(0, e.originalAttackers - e.killed);
      if (rem <= 0) return;

      const count = Math.max(1, Math.ceil(rem / 10));

      // Remove only the icons that no longer exist.
      // Leave the remaining positions untouched.
      if (e.iconPositions) {
          while (e.iconPositions.length > count) {
              e.iconPositions.pop();
          }
      }

      // Generate the positions only once.
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

      // Render each predator icon using its stored coordinate
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

      const leftBtn = document.createElement('img');
      leftBtn.className = 'btn-icon';
      leftBtn.id = 'distract-scout-icon';
      leftBtn.src = '/nest/assets/distract-scout.png';

      const rightBtn = document.createElement('img');
      rightBtn.className = 'btn-icon';
      rightBtn.src = '../sim/assets/THREAT.png';

      if (e.type === 'search') {
        // SCOUT — distract
        leftBtn.title = t('actions.distract_tooltip', {
          cost: S.settings.costDistractScout
        });
        leftBtn.disabled = S.points < S.settings.costDistractScout;

        leftBtn.onclick = (ev) => {
          ev.stopPropagation();
          activeOpenMapKey = eventKey;
          distractScout(e.id);
        };

        // SCOUT — kill
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

        // Actions first
        controlsContainer.appendChild(
          wrapButtonWithCostAbove(leftBtn, S.settings.costDistractScout, true)
        );

        controlsContainer.appendChild(
          wrapButtonWithCostAbove(rightBtn, S.settings.costKillScout, true)
        );

        // INFO LAST
        controlsContainer.appendChild(infoBtn);

      } else {
        // PREDATOR — help humans escape
        leftBtn.textContent = '🏃';
        leftBtn.title = t('actions.rescue_tooltip', {
          cost: S.settings.costEscapePredator
        });
        leftBtn.disabled = S.points < S.settings.costEscapePredator;

        leftBtn.onclick = (ev) => {
          ev.stopPropagation();
          activeOpenMapKey = eventKey;
          escapePredator(e.id);
        };

        // PREDATOR — kill
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

        // Actions first
        controlsContainer.appendChild(
          wrapButtonWithCostAbove(leftBtn, S.settings.costEscapePredator)
        );

        controlsContainer.appendChild(
          wrapButtonWithCostAbove(rightBtn, S.settings.costKillPredator, true)
        );

        // INFO LAST
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
  if (!S || S.gameOver) return { labels: [], humans: [], insects: [] };

  const realState = S;
  const realRender = render;

  const simState = structuredClone(S);

  const forecastHumans = [];
  const forecastInsects = [];
  const forecastLabels = [];

  try {
    S = simState;
    render = function() {}; 

    for (let i = 1; i <= numSteps; i++) {
      if (S.gameOver) break;

      advanceStepLogic();

      forecastLabels.push(`${t('chart.step')} ${S.step}`);
      forecastHumans.push(S.humans);
      forecastInsects.push(totalInsects());
    }
  } finally {
    S = realState;
    render = realRender;
  }

  return {
    labels: forecastLabels,
    humans: forecastHumans,
    insects: forecastInsects
  };
}

function renderChart() {
  const ctx = document.getElementById('popChart');
  if (!ctx) return;

  const forecast = simulateForecast(10);

  const actualLabels = S.history.map(h => `${t('chart.step')} ${h.step}`);
  const combinedLabels = [...actualLabels, ...forecast.labels];

  const actualHumans = [...S.history.map(h => h.humans), ...Array(forecast.labels.length).fill(null)];
  const actualInsects = [...S.history.map(h => h.insects), ...Array(forecast.labels.length).fill(null)];

  const lastIndex = S.history.length - 1;
  const forecastHumansData = Array(combinedLabels.length).fill(null);
  const forecastInsectsData = Array(combinedLabels.length).fill(null);

  if (lastIndex >= 0) {
    forecastHumansData[lastIndex] = S.humans;
    forecastInsectsData[lastIndex] = typeof totalInsects === 'function' ? totalInsects() : 0;

    forecast.humans.forEach((val, i) => {
      forecastHumansData[lastIndex + 1 + i] = val;
    });

    forecast.insects.forEach((val, i) => {
      forecastInsectsData[lastIndex + 1 + i] = val;
    });
  }

  if (chart && chart.data.datasets.length < 4) {
    chart.destroy();
    chart = null;
  }

  if (!chart) {
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: combinedLabels,
        datasets: [
          {
            label: t('chart.humans_actual'),
            data: actualHumans,
            borderColor: '#2e7d32',
            backgroundColor: 'rgba(46, 125, 50, 0.1)',
            borderWidth: 2,
            tension: 0.2,
            fill: false
          },
          {
            label: t('chart.insects_actual'),
            data: actualInsects,
            borderColor: '#c62828',
            backgroundColor: 'rgba(198, 40, 40, 0.1)',
            borderWidth: 2,
            tension: 0.2,
            fill: false
          },
          {
            label: t('chart.humans_forecast'),
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
          {
            label: t('chart.insects_forecast'),
            data: forecastInsectsData,
            borderColor: '#a8402c',
            backgroundColor: '#a8402c',
            borderDash: [5, 5],
            pointRadius: 0,
            pointHoverRadius: 0,
            borderWidth: 2,
            tension: 0.2,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false }
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
    chart.data.datasets[0].data = actualHumans;
    chart.data.datasets[1].data = actualInsects;
    chart.data.datasets[2].data = forecastHumansData;
    chart.data.datasets[3].data = forecastInsectsData;
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

  const nest = rawLevel.nest || (rawLevel.map && rawLevel.map.nest) || null;
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
    nest: nest && {
      x: Number(nest.x),
      y: Number(nest.y)
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
  if (!level || !level.nest) return null;

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
    if (!level || !level.nest) return null;
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

      // Normalizácia dát levelu pre potreby initGame()
      CURRENT_LEVEL = {
        nest: levelData.nest || (levelData.map && levelData.map.nest) || null,
        forts: levelData.forts || (levelData.map && levelData.map.forts) || [],
        background: levelData.background || null,
        settings: levelData.settings || levelData,
        humans: levelData.humans ?? levelData.startHumans ?? 200,
        food: levelData.food ?? levelData.startFood ?? 200
      };

      if (!CURRENT_LEVEL.nest) {
        alert('Chyba: JSON súbor neobsahuje platné súradnice hniezda (nest)!');
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
  if (!CURRENT_LEVEL || !CURRENT_LEVEL.nest) {
    console.error('Nemožno spustiť level: CURRENT_LEVEL nie je načítaný alebo chýbajú súradnice nest.');
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

  const map = {
    startHumans: 'startHumansInput',
    humans: 'startHumansInput',
    startFood: 'startFoodInput',
    food: 'startFoodInput',
    lang: 'langSelect',
    groupSize: 'groupSizeInput',
    foodPerHuman: 'foodPerHumanInput',
    maxPoints: 'maxPointsInput',
    eggsPerSearch: 'eggsPerSearchInput',
    eggCap: 'eggCapInput',
    eggsPerFood: 'eggsPerFoodInput',
    fortLimit: 'fortLimitInput',
    defaultFortDefense: 'defaultFortDefenseInput'
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
  startFood:'startFoodInput', maxPoints:'maxPointsInput', eggsPerSearch:'eggsPerSearchInput',
  eggCap:'eggCapInput', eggsPerFood:'eggsPerFoodInput',
  searchBaseChance:'searchBaseChanceInput', searchRatioScale:'searchRatioScaleInput',
  huntBaseChance:'huntBaseChanceInput', huntRatioScale:'huntRatioScaleInput',
  huntDeathRisk:'huntDeathRiskInput', scoutBiasPerFailedSearch:'scoutBiasPerFailedSearchInput',
  fortLimit:'fortLimitInput', defaultFortDefense:'defaultFortDefenseInput',
  fortFoodLow:'fortFoodLowInput', fortFoodHigh:'fortFoodHighInput',
  fortHumanLow:'fortHumanLowInput', fortHumanHigh:'fortHumanHighInput',
  fortDistLow:'fortDistLowInput', fortDistHigh:'fortDistHighInput',
  fortPredatorThreshold:'fortPredatorThresholdInput', fortAttackThreshold:'fortAttackThresholdInput',
  fortConquerThreshold:'fortConquerThresholdInput',
  scoutMarkChance:'scoutMarkChanceInput', fortMarkThreshold:'fortMarkThresholdInput',
  costDistractScout:'costDistractScoutInput',
  costKillScout:'costKillScoutInput', costEscapePredator:'costEscapePredatorInput',
  costKillPredator:'costKillPredatorInput', costSaveHumans:'costSaveHumansInput',
  saveHumansAmount:'saveHumansAmountInput', costScan:'costScanInput',
  costIncreaseFortCapacity:'costIncreaseFortCapacityInput',
  fortCapacityIncreaseAmount:'fortCapacityIncreaseAmountInput',
  queenFoodReserveCap:'queenFoodReserveCapInput'
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

    if (levelInfo.nest && levelInfo.forts) {
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
  if (!sourceLevel || !sourceLevel.nest) {
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
  return {
    id: 'generated-' + Date.now(),
    title: 'Vygenerovaná úroveň',
    description: 'Náhodne vygenerované hniezdo a pevnosti.',
    background: 'poludniky.png',
    nest: S.nest,
    forts: S.forts,
    settings: { ...S.settings }
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