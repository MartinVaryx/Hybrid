/*
 * nest-core.js
 *
 * Dependency-free simulation core for the nest-defense game.
 *
 * This file contains ONLY pure simulation logic: it reads and writes the
 * shared `S` state object (and, for search/mark/fort targeting, calls
 * Math.random()) but it never touches the DOM, never calls
 * getElementById/querySelector, and never renders anything. `log()` just
 * pushes onto S.log (an array) and `t()` falls back to the raw key string
 * if TRANSLATIONS haven't been loaded, so both are safe to call with no
 * document present.
 *
 * Consumers:
 *   - index.html / script.js: load this file BEFORE script.js. script.js's
 *     DOM-wiring/render layer keeps using the same S / advanceStepLogic /
 *     etc. — they are ordinary top-level `let`/`function` bindings shared
 *     across <script> tags on one page, not exports of a module.
 *   - nest_defense_dqn.html: load this file BEFORE the training harness's
 *     own <script>, and drive the simulation by calling freshState() /
 *     makeNestState() / advanceStepLogic() / advanceNestStepLogic()
 *     directly, in memory, with no <canvas>/DOM and no render() calls.
 *
 * This is a plain classic script (no import/export) on purpose, to match
 * the rest of the codebase and avoid needing a bundler or a local server
 * with CORS-friendly module loading for the DQN harness to open as a
 * plain file:// page.
 *
 * IMPORTANT: keep this file exactly in sync with the extraction notes in
 * REFACTOR_NOTES.md if you pull more logic out of script.js later — the
 * whole point of this split is that there is only ONE copy of the sim math.
 */

/* ============================= MULTI-NEST SUPPORT ============================= */
// Nests compete for the same shared pool of humans/forts. Each nest keeps its
// own food storage, queen, brood cohorts, scouts and predators. Which nest's
// fields S.food / S.queen / S.eggs / ... (etc) "point at" is controlled by
// S.activeNestIndex - see the accessor properties installed in freshState().
const DEFAULT_NEST_COUNT = 2;

const ENEMY_NEST_DEATH_RISK_RADIUS = 99;
// Bonus death risk (added on top of the base huntDeathRisk/searchDeathRisk
// setting) for operating close to an enemy nest - see enemyProximityDeathRisk()
// below. ENEMY_NEST_MAX_DEATH_RISK_BONUS is the bonus at maximum closeness
// against a nest of exactly ENEMY_NEST_SIZE_REFERENCE total insects (see
// totalInsectsForNest()) - a bigger enemy nest scales this up further, with
// NO upper limit here (a genuinely massive nest right next door can push
// this bonus well past the old flat 0.99 ceiling). The various
// Math.min(0.95, ...) clamps at each call site are what keep the final
// combined death risk sane, not this constant.
const ENEMY_NEST_MAX_DEATH_RISK_BONUS = 0.5;
const ENEMY_NEST_SIZE_REFERENCE = 30; // insects - the nest size the bonus above is calibrated at
// Being close to an enemy nest is dangerous, but being close to an enemy
// nest AND far from your own nest (no home-turf backup nearby) is worse
// still - see ownNestDistanceAmplifier() below. ENEMY_NEST_OWN_DISTANCE_REFERENCE
// is the distance from your own nest at which this amplifier reaches its
// max; ENEMY_NEST_OWN_DISTANCE_MAX_AMPLIFIER is that max (1x = no amplification
// right at your own nest's doorstep, scaling up linearly to this far away).
const ENEMY_NEST_OWN_DISTANCE_REFERENCE = 99;
const ENEMY_NEST_OWN_DISTANCE_MAX_AMPLIFIER = 2;

function makeNestState(id, x, y, settings){
  return {
    id, x, y,
    alive: true,
    food: 300,
    queen: { alive: true },
    queenReserve: settings ? settings.startQueenReserve : 160,
    bounceback: null,
    reinforcedForts: [],
    scoutsAvailable: 4,
    scoutsHidden: 8,
    hiddenScoutPositions: [],
    scoutsCooldown: 12,
    lastNonDeathFailures: 0,
    lastUnoccupiedHuntingSlots: 0,
    starvation: {
      scouts: 0,
      predators: 0,
      nymphs: 0
    },
    predatorsAvailable: 0,
    predatorsCooldown: 25,
    eggs: [{age: 0, count: 3},{age: 1, count: 3}],
    larva: [{age: 0, count: 3},{age: 1, count: 3}],
    cocoon: [{age: 0, count: 3}, {age: 1, count: 3}],
    nymph: [{age: 1, count: 3},{age: 2, count: 25}]
  };
}

const NEST_SCOPED_FIELDS = [
  'food', 'queenReserve', 'queen', 'eggs', 'larva', 'cocoon', 'nymph',
  'scoutsAvailable', 'scoutsHidden', 'scoutsCooldown',
  'predatorsAvailable', 'predatorsCooldown',
  'bounceback', 'lastNonDeathFailures', 'lastUnoccupiedHuntingSlots', 'starvation'
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

// Adult-only version of totalInsectsForNest()/totalInsectsAll() above - the
// queen plus scouts and predators (including ones out on pending
// search/hunt/fort events), but WITHOUT the developing cohorts (eggs,
// larva, cocoon, nymph - nymphs only mature into predators once they hit
// age 4, see the NYMPHS -> PREDATORS step in processLifecycle()). This is
// what the player sees in the header/graph (see totalAdultInsectsAll()'s
// call sites in script.js) - it is NOT used for any internal simulation
// math (mobility bias, enemy-proximity death risk, nest-collapse checks,
// etc.), which all still care about the colony's full population.
function totalAdultInsectsForNest(nest){
  if (!nest) return 0;
  const scouts = nest.scoutsAvailable + nest.scoutsCooldown + nest.scoutsHidden +
    S.events.filter(e=>e.type==='search' && e.status==='pending' && !e.fortMarkScout && e.nestId===nest.id).length;
  const predators = nest.predatorsAvailable + nest.predatorsCooldown +
    S.events.filter(e=>e.type==='hunt' && e.status==='pending' && e.nestId===nest.id).reduce((a,e)=>a + (e.groupSize - e.killed), 0) +
    (() => { const e = S.events.find(e=>e.type==='fort' && e.status==='pending' && e.nestId===nest.id); return e ? Math.max(0, e.originalAttackers - e.killed) : 0; })();
  return (nest.queen.alive?1:0) + scouts + predators;
}
function totalAdultInsectsAll(){
  return S.nests.reduce((a,n)=> a + (n.alive ? totalAdultInsectsForNest(n) : 0), 0);
}

function insectsByNestSnapshot(){
  const out = {};
  S.nests.forEach(n => { out[n.id] = n.alive ? totalInsectsForNest(n) : 0; });
  return out;
}

// Adult-only per-nest breakdown, mirroring insectsByNestSnapshot() above -
// used for the player-facing header/graph, see totalAdultInsectsForNest().
function adultInsectsByNestSnapshot(){
  const out = {};
  S.nests.forEach(n => { out[n.id] = n.alive ? totalAdultInsectsForNest(n) : 0; });
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

// Nearest ALIVE enemy nest to `loc` (excluding ownNestId), with its
// distance - shared by nearestEnemyNestDistance() and
// enemyProximityDeathRisk() below so both agree on which nest is "nearest"
// without finding it twice.
function nearestEnemyNest(loc, ownNestId){
  let best = null, minD = Infinity;
  S.nests.forEach(n => {
    if (!n.alive || n.id === ownNestId) return;
    const d = dist(loc, n);
    if (d < minD) { minD = d; best = n; }
  });
  return best ? { nest: best, distance: minD } : null;
}

function nearestEnemyNestDistance(loc, ownNestId){
  const found = nearestEnemyNest(loc, ownNestId);
  return found ? found.distance : Infinity;
}

// How much farther-from-home amplifies the enemy-proximity bonus below:
// 1x right at your own nest, scaling linearly up to
// ENEMY_NEST_OWN_DISTANCE_MAX_AMPLIFIER at/beyond ENEMY_NEST_OWN_DISTANCE_REFERENCE
// away from it. If your own nest can't be found (shouldn't normally happen),
// no amplification is applied.
function ownNestDistanceAmplifier(loc, ownNestId){
  const ownNest = S.nests.find(n => n.id === ownNestId);
  if (!ownNest) return 1;
  const homeFrac = Math.max(0, Math.min(1, dist(loc, ownNest) / ENEMY_NEST_OWN_DISTANCE_REFERENCE));
  return 1 + homeFrac * (ENEMY_NEST_OWN_DISTANCE_MAX_AMPLIFIER - 1);
}

// Closeness to the nearest enemy nest, scaled by that nest's OWN size
// (totalInsectsForNest()) - a huge enemy nest right next door is a much
// bigger threat than a tiny one at the same distance, so the bonus grows
// with size beyond the reference point ENEMY_NEST_SIZE_REFERENCE, with no
// upper bound of its own (see the constants above) - then further amplified
// by how far from your own nest you are (ownNestDistanceAmplifier()): the
// same closeness to an enemy nest is worse when you're operating far from
// home than right on your own doorstep.
function enemyProximityDeathRisk(loc, ownNestId){
  const found = nearestEnemyNest(loc, ownNestId);
  if (!found) return 0;
  const closeness = Math.max(0, 1 - found.distance / ENEMY_NEST_DEATH_RISK_RADIUS);
  if (closeness <= 0) return 0;
  const sizeMultiplier = totalInsectsForNest(found.nest) / ENEMY_NEST_SIZE_REFERENCE;
  const homeDistanceAmplifier = ownNestDistanceAmplifier(loc, ownNestId);
  return closeness * ENEMY_NEST_MAX_DEATH_RISK_BONUS * sizeMultiplier * homeDistanceAmplifier;
}

let S = null;

const WORLD_ASPECT_RATIO = 2; // width:height - keep in sync with #mapWrap's CSS aspect-ratio

function dist(p1, p2) {
  const dx = (p1.x - p2.x) * WORLD_ASPECT_RATIO;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// ROUTE FRAMEWORK
//
// A "route" is a curved path connecting two forts, drawn on the map so
// players can read which forts are linked (future gameplay hooks - troop
// movement, supply, etc. - build on top of this). Routes are PURE, DERIVED
// data: never hand-authored or saved with a level, always rebuilt from the
// current fort/nest positions by regenerateRoutes() (see script.js for the
// rendering side, and ensureRoutesUpToDate()'s call site in renderMap()).
//
// Every fort pair gets at most one route, and only if BOTH of these hold:
//   1) a curve between them can be found no longer than MAX_ROUTE_LIMIT
//   2) that curve stays at least MIN_NEST_DISTANCE away from every alive
//      nest at all points along it
// If no such curve exists, the pair simply gets no route - it is skipped,
// not forced straight through a nest.
//
// Every route is a cubic bezier (p0, c1, c2, p3) so it never renders as a
// dead-straight line: c1/c2 always get a slight perpendicular offset, drawn
// from a seed derived from the two fort ids so the wiggle is stable across
// re-renders/regenerates rather than reshuffling every time something else
// on the map changes. When a straight-ish wiggle would pass too close to a
// nest, the same two control points get pushed further out to the same
// side until the curve clears every nest (or the route is skipped if it
// can't, within MAX_ROUTE_LIMIT).
//
// All the geometry below works in "real" (aspect-corrected) space - i.e.
// x already multiplied by WORLD_ASPECT_RATIO - matching dist()'s own
// correction, so bend distances/lengths are true map distances rather than
// raw world-coordinate units. Points are converted back to world space
// (dividing x back down) only at the very end, for storage/rendering.
// ---------------------------------------------------------------------------

// Tunable limits. MAX_ROUTE_LIMIT starts at 40% of the map's diagonal
// (real-space) - swap the multiplier below for a flat width-based cap
// (`100 * WORLD_ASPECT_RATIO * 0.4`) if that reads better once forts are
// laid out and routes are visible in practice.
const MAP_DIAGONAL_REAL = Math.hypot(100 * WORLD_ASPECT_RATIO, 100);
const MAX_ROUTE_LIMIT = 0.25 * MAP_DIAGONAL_REAL; // ~89.4 real units - max allowed route (curve) length
const MIN_NEST_DISTANCE = 25; // real units a route must stay clear of every alive nest
// Points sampled per route curve, for rendering AND for the joint-smoothing
// passes below (ROUTE_JOINT_SMOOTH_RADIUS). This has to stay comfortably
// larger than that radius: a triangle-hub branch/rectangle-side leg is
// sampled at this same density, and if the count were too low, smoothing a
// radius-3 window around the joint would swallow most or all of a short
// branch's points instead of being a small local effect - forcing the
// branch to keep heading in the trunk's incoming direction for most of its
// own length before snapping back to its actual destination fort at the
// last moment. That's what an oversized-relative-to-sample-count smoothing
// window looks like: a big unnecessary arc bulging toward the joint that
// then has to cut back sharply, easily swinging wide enough to cross a
// neighboring route. 40 points keeps that radius a small (~7%), genuinely
// local fraction of any branch/leg regardless of its own length.
const ROUTE_MERGE_SAMPLES = 40;
// How much the default (nest-unaffected) curve wiggles, as a fraction of
// the straight-line fort-to-fort distance, capped at an absolute max so
// long routes don't get an exaggerated bulge.
const ROUTE_WIGGLE_FRACTION = 0.3;
const ROUTE_WIGGLE_MAX = 10; // real units

// Floor on the same wiggle: the old (rng()*2-1)*wiggleMag draw could land
// anywhere in [-wiggleMag, wiggleMag], including right next to 0, which
// rendered as a visually dead-straight route despite the "never a straight
// line" intent above. ROUTE_WIGGLE_MIN guarantees every control-point
// offset has at least this much magnitude (sign still random), while
// ROUTE_WIGGLE_MIN_FRACTION keeps very short fort-to-fort hops from
// getting a floor larger than their own wiggleMag cap.
const ROUTE_WIGGLE_MIN = 2; // real units
const ROUTE_WIGGLE_MIN_FRACTION = 0.2; // of straightLen, whichever is smaller wins

function routeKey(idA, idB) {
  return idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
}

function canonicalizeEntriesByRoutePair(entries) {
  if (!entries || entries.length < 2) return;

  const bestByPair = new Map();
  entries.forEach(entry => {
    if (!entry || !entry.fortIdA || !entry.fortIdB) return;
    // Direct and hub-routed variants of the SAME fort pair are kept as
    // separate candidates here - collapsing them together by routeKey
    // alone would let this run ahead of pruneRedundantRoutes()'s own
    // 30%-shorter comparison and silently decide the winner by raw length
    // instead, which is what made that comparison a no-op in practice.
    const key = routeKey(entry.fortIdA, entry.fortIdB) + (entry.useHub ? ':hub' : ':direct');
    const existing = bestByPair.get(key);
    if (!existing) {
      bestByPair.set(key, entry);
      return;
    }

    const existingLen = routeEntryLength(existing);
    const incomingLen = routeEntryLength(entry);
    if (!Number.isFinite(existingLen) || (Number.isFinite(incomingLen) && incomingLen < existingLen)) {
      bestByPair.set(key, entry);
    }
  });

  entries.length = 0;
  entries.push(...bestByPair.values());
}

function toRealPoint(p) {
  return { x: p.x * WORLD_ASPECT_RATIO, y: p.y };
}

function toWorldPoint(p) {
  return { x: p.x / WORLD_ASPECT_RATIO, y: p.y };
}

// Small deterministic PRNG (mulberry32) seeded from the two fort ids, so a
// route's wiggle/bend is reproducible across regenerates instead of
// reshuffling every time some unrelated fort or nest changes.
function seededRandom(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function routeSeed(idA, idB) {
  const lo = Math.min(idA, idB), hi = Math.max(idA, idB);
  return (lo * 73856093) ^ (hi * 19349663);
}

// Draws a signed offset whose magnitude is never below `min` (but never
// above `max` either) - used so the default wiggle can't roll a
// near-zero offset and read as a straight line. `min` is clamped to `max`
// first so it's always a valid (possibly degenerate) [min,max] range.
function signedWiggleOffset(rng, min, max) {
  const lo = Math.min(min, max);
  const sign = rng() < 0.5 ? -1 : 1;
  const mag = lo + rng() * Math.max(0, max - lo);
  return sign * mag;
}

function cubicBezierPoint(p0, c1, c2, p3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y
  };
}

function sampleCubicBezier(p0, c1, c2, p3, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) pts.push(cubicBezierPoint(p0, c1, c2, p3, i / segments));
  return pts;
}

function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

// Actual on-map length of a route entry (real-space units), used by
// canonicalizeEntriesByRoutePair/pruneRedundantRoutes/the shortcut-graph
// helpers below to compare a direct route against a hub-routed alternative
// (or against a multi-hop path through other routes). Prefers the dense
// sampled polyline (`points`) - which is what's actually drawn, and what a
// rectangle/triangle hub route's length really is once bent through its
// junction - falling back to sampling the plain bezier (`curve`) for any
// entry that only has that. Infinity for anything with neither, so a
// broken/incomplete entry always loses a length comparison rather than
// winning one by accident.
function routeEntryLength(entry) {
  if (!entry) return Infinity;
  if (entry.points && entry.points.length >= 2) return polylineLength(entry.points);
  if (entry.curve) {
    return polylineLength(sampleCubicBezier(entry.curve.p0, entry.curve.c1, entry.curve.c2, entry.curve.p3, ROUTE_MERGE_SAMPLES));
  }
  return Infinity;
}

function minDistanceToPoints(pts, others) {
  let min = Infinity;
  pts.forEach(p => {
    others.forEach(o => {
      const d = Math.hypot(p.x - o.x, p.y - o.y);
      if (d < min) min = d;
    });
  });
  return min;
}

// Builds the two control points a third and two-thirds of the way along
// the p0->p3 line, each pushed out along `perp` by its own offset.
function buildRouteControls(p0, p3, perp, offset1, offset2) {
  const c1 = {
    x: p0.x + (p3.x - p0.x) / 3 + perp.x * offset1,
    y: p0.y + (p3.y - p0.y) / 3 + perp.y * offset1
  };
  const c2 = {
    x: p0.x + (p3.x - p0.x) * 2 / 3 + perp.x * offset2,
    y: p0.y + (p3.y - p0.y) * 2 / 3 + perp.y * offset2
  };
  return [c1, c2];
}

function clampRoutePoint(p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return { x: 0, y: 0 };
  return {
    x: Math.max(0, Math.min(100 * WORLD_ASPECT_RATIO, p.x)),
    y: Math.max(0, Math.min(100, p.y))
  };
}

function clampRoutePoints(points) {
  if (!points || !points.length) return points;
  return points.map(clampRoutePoint);
}

function clampRouteCurve(curve) {
  if (!curve) return curve;
  curve.p0 = clampRoutePoint(curve.p0);
  curve.c1 = clampRoutePoint(curve.c1);
  curve.c2 = clampRoutePoint(curve.c2);
  curve.p3 = clampRoutePoint(curve.p3);
  return curve;
}

// Searches for a cubic-bezier curve between two forts (given in world
// coordinates) that satisfies both MAX_ROUTE_LIMIT and MIN_NEST_DISTANCE.
// Returns { p0, c1, c2, p3 } in REAL space on success, or null if no such
// curve exists (route should be skipped).
const ROUTE_BEND_SEARCH_STEPS = 40; // resolution of the bend-magnitude search below

function findRouteCurve(fortA, fortB, aliveNests) {
  const p0 = toRealPoint(fortA);
  const p3 = toRealPoint(fortB);
  const straightLen = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (straightLen > MAX_ROUTE_LIMIT) return null; // even a straight line is already too long

  const nestPts = (aliveNests || []).map(toRealPoint);
  const dx = p3.x - p0.x, dy = p3.y - p0.y;
  const norm = Math.hypot(dx, dy) || 1;
  const perp = { x: -dy / norm, y: dx / norm }; // unit vector perpendicular to the fort-fort line
  const rng = seededRandom(routeSeed(fortA.id, fortB.id));

  // Default case: a gentle, slightly-random wiggle so the route never reads
  // as a dead-straight line. Used as-is whenever it doesn't run afoul of
  // MAX_ROUTE_LIMIT or come too close to a nest.
  const wiggleMag = Math.min(ROUTE_WIGGLE_MAX, straightLen * ROUTE_WIGGLE_FRACTION);
  const wiggleMin = Math.min(ROUTE_WIGGLE_MIN, straightLen * ROUTE_WIGGLE_MIN_FRACTION, wiggleMag);
  const [wc1, wc2] = buildRouteControls(
    p0, p3, perp,
    signedWiggleOffset(rng, wiggleMin, wiggleMag),
    signedWiggleOffset(rng, wiggleMin, wiggleMag)
  );
  const wigglePts = sampleCubicBezier(p0, wc1, wc2, p3, 24);
  if (
    polylineLength(wigglePts) <= MAX_ROUTE_LIMIT &&
    (!nestPts.length || minDistanceToPoints(wigglePts, nestPts) >= MIN_NEST_DISTANCE)
  ) {
    return clampRouteCurve({ p0, c1: wc1, c2: wc2, p3 });
  }

  // The gentle wiggle either got too long or clipped a nest - grow a
  // one-sided bend outward (alternating sides) until the curve clears
  // every nest while staying within MAX_ROUTE_LIMIT. Whichever side/
  // magnitude satisfies both constraints first wins; if neither side ever
  // manages it before the curve would exceed MAX_ROUTE_LIMIT, the route is
  // skipped entirely.
  const maxBend = MAX_ROUTE_LIMIT; // upper bound for the search; the length check below is the real limiter
  const step = maxBend / ROUTE_BEND_SEARCH_STEPS;
  for (let bend = step; bend <= maxBend; bend += step) {
    for (const sign of [1, -1]) {
      const offset1 = bend * sign * (0.85 + rng() * 0.3);
      const offset2 = bend * sign * (0.85 + rng() * 0.3);
      const [c1, c2] = buildRouteControls(p0, p3, perp, offset1, offset2);
      const pts = sampleCubicBezier(p0, c1, c2, p3, 24);
      if (polylineLength(pts) > MAX_ROUTE_LIMIT) continue;
      if (!nestPts.length || minDistanceToPoints(pts, nestPts) >= MIN_NEST_DISTANCE) {
        return clampRouteCurve({ p0, c1, c2, p3 });
      }
    }
  }
  return null;
}

function routeGraphKeySet(entries) {
  const set = new Set();
  (entries || []).forEach(e => set.add(routeKey(e.fortIdA, e.fortIdB)));
  return set;
}

function findFortById(forts, fortId) {
  return forts.find(f => f.id === fortId) || null;
}

// ---------------------------------------------------------------------------
// FORT-CLUSTER ROAD NETWORKS (rectangles & triangles)
//
// Independently wiggling every valid fort pair looks fine for two forts on
// their own, but once 3-4 forts are all mutually reachable, drawing every
// pair as its own curve makes a tangle. Real road networks resolve that
// with actual junctions, so two shapes get special treatment:
//
//  - RECTANGLE (4 forts in convex position): the two diagonals (opposite
//    corners) are already ordinary direct routes from the plain per-pair
//    pass above, and letting them cross each other IS the "true
//    crossroad" - no extra geometry needed. The four SIDES each get an
//    additional hub-routed alternative (through the diagonals' crossing
//    point) pushed into `entries` alongside their existing direct route,
//    so pruneRedundantRoutes()'s existing 30%-shorter rule can pick
//    whichever is actually better instead of every side always drawing
//    its own independent curve straight through the middle.
//
//  - TRIANGLE (3 forts): the fort furthest from the other two (by summed
//    distance) is the "apex". A trunk route runs from the apex to the
//    triangle's centroid, then forks into two branches, one toward each
//    of the other two forts - trunk and branches all built with the same
//    findRouteCurve() used everywhere else (the centroid stands in as a
//    pseudo-fort), so they wiggle/avoid nests normally and each branch
//    naturally curves toward its own destination right out of the fork.
//    Both apex-to-leaf pairs, plus the triangle's base pair (routed leaf-
//    to-leaf via the same centroid), get hub-routed alternatives pushed
//    into `entries` the same way, again left to pruneRedundantRoutes() to
//    arbitrate against the plain direct route for that pair.
//
// Either way, a fort that's already part of an accepted rectangle isn't
// also considered for a triangle - each fort takes part in at most one
// cluster shape per regenerate.
// ---------------------------------------------------------------------------
const ROUTE_BIFURCATION_TRUNK_SAMPLES = 6; // points along a triangle hub's shared trunk segment (apex -> centroid)
const ROUTE_HUB_DIRECT_SHORTCUT_FRACTION = 0.3; // a direct route only replaces a hub-routed (crossroad/bifurcation) pair once it's at least this much shorter

// Deterministic, collides-with-nothing-real synthetic id for a junction/
// centroid pseudo-fort used only so findRouteCurve()'s routeSeed(a.id,b.id)
// (which does Math.min/max on the ids) has real numbers to work with for a
// leg that doesn't start or end at an actual fort. Assumes real fort ids
// stay under 1000 - comfortably true for any fort count this game reaches.
function pseudoFortId(...ids) {
  let h = 5000000;
  ids.forEach((id, i) => { h += (Number(id) % 1000) * Math.pow(1000, i); });
  return h;
}

// Infinite-line intersection of line(p1,p2) and line(p3,p4) - used to find
// where a rectangle's two diagonals actually cross, rather than settling
// for the (slightly different) centroid. Returns null for parallel lines.
function lineIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  return { x: p1.x + d1x * t, y: p1.y + d1y * t };
}

// True if point `p` lies inside (or on) triangle (a,b,c) - used to test
// whether 4 forts are in genuine convex position (a real quadrilateral)
// rather than one sitting inside the triangle of the other three.
function pointInTriangle(p, a, b, c) {
  const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// Returns `points` (each { x, y, fort }) reordered around their perimeter
// if they form a proper convex quadrilateral, or null if one point sits
// inside the triangle of the other three (not a "rectangle" shape for our
// purposes - the diagonals wouldn't cross inside the shape at all).
function convexQuadOrder(points) {
  for (let i = 0; i < 4; i++) {
    const rest = points.filter((_, idx) => idx !== i);
    if (pointInTriangle(points[i], rest[0], rest[1], rest[2])) return null;
  }
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  return points.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

// ---------------------------------------------------------------------------
// JOINT SMOOTHING
//
// Every two-leg route below (a rectangle side routed fort->crossing->fort,
// or a triangle's leaf-to-leaf base routed leaf->centroid->leaf) is built by
// calling findRouteCurve() TWICE independently and concatenating the two
// resulting polylines. Each call picks its own wiggle/bend direction with
// no knowledge of the other leg, so the incoming tangent at the junction and
// the outgoing tangent can point in completely different directions -
// visually a sharp fork or even a near-total reversal right at the
// junction, which is what reads as a "loop" forming out of nowhere. These
// two smoothing passes soften that seam by Laplacian-averaging a small
// window of points around the joint; neither ever touches the route's own
// two fort endpoints (index 0 or the last index), so the route still lands
// exactly on the forts it connects.
// ---------------------------------------------------------------------------
const ROUTE_JOINT_SMOOTH_RADIUS = 3; // points smoothed on each affected side of a joint
const ROUTE_JOINT_SMOOTH_ITERATIONS = 3;

// Naive neighbor-averaging (Laplacian) smoothing turned out NOT to fix
// this: with one side of the window fixed, the joint's own two segments
// (fixed-side-in, free-side-out) still meet at whatever angle they started
// at - averaging only softens curvature further ALONG the free side, it
// never rotates that very first outgoing segment to actually align with
// the fixed incoming one. What actually removes the fork is explicit
// tangent-easing: force the segment(s) right at the joint to continue in a
// (blended) tangent direction, fading back to each leg's own original path
// over `radius` points.

// Both sides of the joint are free to move (used for a rectangle side,
// where the whole two-leg path belongs to a single route with nothing else
// depending on either leg's exact original geometry). The two original
// tangents either side of the joint are averaged into one shared tangent,
// and each side is eased to leave the joint along that shared direction,
// fading back to its own original path by `radius` points out. The joint
// point itself is never moved (it's a well-defined geometric point - a
// rectangle's diagonal intersection - not something to blur).
function smoothRouteJointSymmetric(points, jointIndex, radius = ROUTE_JOINT_SMOOTH_RADIUS) {
  if (!points || points.length < 3 || jointIndex < 1 || jointIndex > points.length - 2) return points;

  const pts = points.map(p => ({ x: p.x, y: p.y }));
  const dirBefore = { x: pts[jointIndex].x - pts[jointIndex - 1].x, y: pts[jointIndex].y - pts[jointIndex - 1].y };
  const dirAfter = { x: pts[jointIndex + 1].x - pts[jointIndex].x, y: pts[jointIndex + 1].y - pts[jointIndex].y };
  const lenBefore = Math.hypot(dirBefore.x, dirBefore.y) || 1;
  const lenAfter = Math.hypot(dirAfter.x, dirAfter.y) || 1;
  const unitBefore = { x: dirBefore.x / lenBefore, y: dirBefore.y / lenBefore };
  const unitAfter = { x: dirAfter.x / lenAfter, y: dirAfter.y / lenAfter };
  const avg = { x: unitBefore.x + unitAfter.x, y: unitBefore.y + unitAfter.y };
  const avgLen = Math.hypot(avg.x, avg.y);
  // If the two tangents are almost exactly opposite, their average is ~zero
  // length and gives no useful direction - fall back to the incoming one
  // rather than dividing by ~0.
  const sharedTangent = avgLen > 1e-6 ? { x: avg.x / avgLen, y: avg.y / avgLen } : unitBefore;

  const lo = Math.max(1, jointIndex - radius);
  const hi = Math.min(points.length - 2, jointIndex + radius);

  let anchor = pts[jointIndex];
  for (let i = jointIndex + 1; i <= hi; i++) {
    const stepLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const straightContinuation = { x: anchor.x + sharedTangent.x * stepLen, y: anchor.y + sharedTangent.y * stepLen };
    const t = (i - jointIndex) / (hi - jointIndex + 1); // ~0 right after the joint, fading toward 1 by `hi`
    pts[i] = { x: straightContinuation.x * (1 - t) + pts[i].x * t, y: straightContinuation.y * (1 - t) + pts[i].y * t };
    anchor = pts[i];
  }
  anchor = pts[jointIndex];
  for (let i = jointIndex - 1; i >= lo; i--) {
    const stepLen = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    const straightContinuation = { x: anchor.x - sharedTangent.x * stepLen, y: anchor.y - sharedTangent.y * stepLen };
    const t = (jointIndex - i) / (jointIndex - lo + 1);
    pts[i] = { x: straightContinuation.x * (1 - t) + pts[i].x * t, y: straightContinuation.y * (1 - t) + pts[i].y * t };
    anchor = pts[i];
  }
  return pts;
}

// Only the side AFTER jointIndex is free to move; jointIndex itself (and
// everything before it) is kept exactly as given. Used for a triangle
// branch grafted onto its shared trunk: the trunk is rendered once,
// separately, from its own (unsmoothed) points, so the branch's very first
// rendered point - the trunk's true last point AND the direction leading
// into it - must stay exactly as they are, or the trunk and branch would
// visibly stop meeting/aligning. The branch is eased to leave the joint
// continuing the trunk's own incoming direction, fading back to the
// branch's own original path by `radius` points out.
function smoothRouteJointOneSided(points, jointIndex, radius = ROUTE_JOINT_SMOOTH_RADIUS) {
  if (!points || jointIndex < 1 || jointIndex >= points.length - 2) return points;
  const hi = Math.min(points.length - 1, jointIndex + radius); // never touch the route's own final endpoint (points.length-1 stays out of range here since hi<=jointIndex+radius and we only assign up to hi below, but the final point is excluded by construction of hi's cap one line below)
  const cappedHi = Math.min(points.length - 2, hi);
  if (cappedHi <= jointIndex) return points;

  const pts = points.map(p => ({ x: p.x, y: p.y }));
  const inDir = { x: pts[jointIndex].x - pts[jointIndex - 1].x, y: pts[jointIndex].y - pts[jointIndex - 1].y };
  const inLen = Math.hypot(inDir.x, inDir.y) || 1;
  const inUnit = { x: inDir.x / inLen, y: inDir.y / inLen };

  let anchor = pts[jointIndex];
  for (let i = jointIndex + 1; i <= cappedHi; i++) {
    const stepLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const straightContinuation = { x: anchor.x + inUnit.x * stepLen, y: anchor.y + inUnit.y * stepLen };
    const t = (i - jointIndex) / (cappedHi - jointIndex + 1);
    pts[i] = { x: straightContinuation.x * (1 - t) + pts[i].x * t, y: straightContinuation.y * (1 - t) + pts[i].y * t };
    anchor = pts[i];
  }
  return pts;
}

function entryFor(entries, idA, idB) {
  const key = routeKey(idA, idB);
  return entries.find(e => routeKey(e.fortIdA, e.fortIdB) === key) || null;
}

function combinations(arr, size) {
  const out = [];
  function walk(start, chosen) {
    if (chosen.length === size) { out.push(chosen.slice()); return; }
    for (let i = start; i < arr.length; i++) { chosen.push(arr[i]); walk(i + 1, chosen); chosen.pop(); }
  }
  walk(0, []);
  return out;
}

// Builds a route from fortA to fortB via an intermediate point (given in
// PERCENT space, matching S.forts), using findRouteCurve for each leg so
// it gets the same wiggle/MAX_ROUTE_LIMIT/nest-avoidance treatment as any
// ordinary route. Returns { points, leg1Pts, leg2Pts } or null if either
// leg isn't possible (too long, or can't clear a nest).
function buildTwoLegRoute(fortA, viaPointPercent, fortB, viaId, aliveNests) {
  const viaFort = { id: viaId, x: viaPointPercent.x, y: viaPointPercent.y };
  const leg1 = findRouteCurve(fortA, viaFort, aliveNests);
  if (!leg1) return null;
  const leg2 = findRouteCurve(viaFort, fortB, aliveNests);
  if (!leg2) return null;

  const leg1Pts = sampleCubicBezier(leg1.p0, leg1.c1, leg1.c2, leg1.p3, ROUTE_MERGE_SAMPLES);
  const leg2Pts = sampleCubicBezier(leg2.p0, leg2.c1, leg2.c2, leg2.p3, ROUTE_MERGE_SAMPLES);
  const rawPoints = leg1Pts.concat(leg2Pts.slice(1));
  // leg1 and leg2 were wiggled/bent completely independently of each other
  // (see JOINT SMOOTHING above) - smooth the seam where they meet so it
  // reads as one bending road through the junction rather than two
  // mismatched curves forced together.
  const points = smoothRouteJointSymmetric(rawPoints, leg1Pts.length - 1);
  return { points, leg1Pts, leg2Pts };
}

// Rectangle case (see header comment). Returns true and pushes hub-routed
// alternatives for the 4 sides into `entries` if this combo forms a valid
// crossroad; false (no changes) otherwise.
function tryAddRectangleHubEntries(entries, combo, aliveNests) {
  const real = combo.map(f => ({ ...toRealPoint(f), fort: f }));
  const order = convexQuadOrder(real);
  if (!order) return false; // not in convex position - one fort sits "inside" the other three

  const [a, b, c, d] = order; // perimeter order; diagonals are a-c and b-d

  // The crossroad IS the two diagonals crossing - they're already ordinary
  // direct routes from the initial per-pair pass as long as each is within
  // MAX_ROUTE_LIMIT (findRouteCurve already enforced that when building
  // them). If either diagonal didn't make it into `entries` at all, this
  // rectangle can't form a real crossroad.
  if (!entryFor(entries, a.fort.id, c.fort.id) || !entryFor(entries, b.fort.id, d.fort.id)) return false;

  const crossing = lineIntersection(a, c, b, d) || {
    x: (a.x + b.x + c.x + d.x) / 4,
    y: (a.y + b.y + c.y + d.y) / 4
  };
  const crossingPercent = { x: crossing.x / WORLD_ASPECT_RATIO, y: crossing.y };
  const viaIdBase = pseudoFortId(a.fort.id, b.fort.id, c.fort.id, d.fort.id);

  let addedAny = false;
  [[a, b], [b, c], [c, d], [d, a]].forEach(([p1, p2], idx) => {
    const built = buildTwoLegRoute(p1.fort, crossingPercent, p2.fort, viaIdBase + 100 + idx, aliveNests);
    if (!built) return;
    entries.push({
      fortIdA: p1.fort.id,
      fortIdB: p2.fort.id,
      curve: { p0: toRealPoint(p1.fort), c1: built.leg1Pts[1], c2: built.leg2Pts[built.leg2Pts.length - 2], p3: toRealPoint(p2.fort) },
      points: built.points,
      useHub: true
    });
    addedAny = true;
  });
  return addedAny;
}

// Triangle case (see header comment). Returns true and pushes hub-routed
// alternatives (both apex legs + the base, all via the shared centroid)
// into `entries` if this combo forms a valid bifurcation; false (no
// changes) otherwise. `pendingTrunks` collects the shared trunk geometry,
// keyed by its pseudo-fort id, so regenerateRoutes() can render it exactly
// once (only for trunks a surviving entry still actually uses - see
// there).
function tryAddTriangleHubEntries(entries, combo, aliveNests, pendingTrunks) {
  const real = combo.map(toRealPoint);
  const dist = (i, j) => Math.hypot(real[i].x - real[j].x, real[i].y - real[j].y);
  const sums = [dist(0, 1) + dist(0, 2), dist(0, 1) + dist(1, 2), dist(0, 2) + dist(1, 2)];
  const apexIdx = sums.indexOf(Math.max(...sums)); // furthest from the other two, combined
  const apex = combo[apexIdx];
  const [p1, p2] = combo.filter((_, i) => i !== apexIdx);

  const centroidReal = {
    x: (real[0].x + real[1].x + real[2].x) / 3,
    y: (real[0].y + real[1].y + real[2].y) / 3
  };
  const viaId = pseudoFortId(combo[0].id, combo[1].id, combo[2].id);
  const centroidFort = { id: viaId, x: centroidReal.x / WORLD_ASPECT_RATIO, y: centroidReal.y };

  const trunk = findRouteCurve(apex, centroidFort, aliveNests);
  if (!trunk) return false;
  const branch1 = findRouteCurve(centroidFort, p1, aliveNests);
  const branch2 = findRouteCurve(centroidFort, p2, aliveNests);
  if (!branch1 || !branch2) return false;

  // Both trunk and branches start/end exactly at the same computed
  // centroid point (not a blended approximation), so the trunk's own last
  // sample and each branch's own first sample are numerically identical -
  // positionally continuous. Their TANGENTS at that shared point are not,
  // though: trunk and each branch each got their own independent
  // findRouteCurve() wiggle/bend, so the direction the trunk arrives from
  // and the direction a branch leaves in can differ sharply - see JOINT
  // SMOOTHING above.
  const trunkPts = sampleCubicBezier(trunk.p0, trunk.c1, trunk.c2, trunk.p3, ROUTE_BIFURCATION_TRUNK_SAMPLES);
  const branch1Pts = sampleCubicBezier(branch1.p0, branch1.c1, branch1.c2, branch1.p3, ROUTE_MERGE_SAMPLES);
  const branch2Pts = sampleCubicBezier(branch2.p0, branch2.c1, branch2.c2, branch2.p3, ROUTE_MERGE_SAMPLES);

  pendingTrunks.set(viaId, trunkPts.map(p => ({ x: p.x, y: p.y })));

  // One-sided: the trunk itself is rendered separately from `pendingTrunks`
  // exactly as sampled above, so the joint point (trunkPts' last point /
  // this array's index trunkPts.length-1) must stay fixed here too, or the
  // branch's rendered line would visibly stop meeting the trunk's rendered
  // line. Only the branch side of the seam gets smoothed.
  entries.push({
    fortIdA: apex.id, fortIdB: p1.id,
    curve: { p0: toRealPoint(apex), c1: trunk.c1, c2: branch1.c2, p3: toRealPoint(p1) },
    points: smoothRouteJointOneSided(trunkPts.concat(branch1Pts.slice(1)), trunkPts.length - 1),
    headTrunkCount: trunkPts.length,
    trunkId: viaId,
    useHub: true
  });
  entries.push({
    fortIdA: apex.id, fortIdB: p2.id,
    curve: { p0: toRealPoint(apex), c1: trunk.c1, c2: branch2.c2, p3: toRealPoint(p2) },
    points: smoothRouteJointOneSided(trunkPts.concat(branch2Pts.slice(1)), trunkPts.length - 1),
    headTrunkCount: trunkPts.length,
    trunkId: viaId,
    useHub: true
  });
  // Base pair (leaf to leaf), routed leaf -> centroid -> leaf by reusing
  // the two branches already built above (reversing the first one) rather
  // than through the apex/trunk at all. This one doesn't share its
  // geometry with anything else rendered separately, so both sides of its
  // centroid joint are free to smooth.
  entries.push({
    fortIdA: p1.id, fortIdB: p2.id,
    curve: { p0: toRealPoint(p1), c1: branch1.c2, c2: branch2.c2, p3: toRealPoint(p2) },
    points: smoothRouteJointSymmetric(branch1Pts.slice().reverse().concat(branch2Pts.slice(1)), branch1Pts.length - 1),
    useHub: true
  });
  return true;
}

// Orchestrates both shapes across every fort still available: rectangles
// first (they resolve more pairs at once), then triangles among whatever
// forts a rectangle didn't already claim. Mutates `entries` in place
// (appending hub-routed alternatives) and `pendingTrunks`.
function applyFortClusterHubs(entries, forts, aliveNests, pendingTrunks) {
  const consumedForts = new Set();

  const allPairsPresent = combo => combo.every((fa, i) => combo.slice(i + 1).every(fb => entryFor(entries, fa.id, fb.id)));

  combinations(forts, 4).forEach(combo => {
    if (combo.some(f => consumedForts.has(f.id))) return;
    if (!allPairsPresent(combo)) return;
    if (tryAddRectangleHubEntries(entries, combo, aliveNests)) {
      combo.forEach(f => consumedForts.add(f.id));
    }
  });

  combinations(forts.filter(f => !consumedForts.has(f.id)), 3).forEach(combo => {
    if (!allPairsPresent(combo)) return;
    if (tryAddTriangleHubEntries(entries, combo, aliveNests, pendingTrunks)) {
      combo.forEach(f => consumedForts.add(f.id));
    }
  });
}


function findShortcutPathViaEntries(fromFortId, toFortId, entriesToTry, skipEntryKey) {
  const adj = new Map();
  entriesToTry.forEach(entry => {
    if (entry === skipEntryKey) return;
    const a = entry.fortIdA, b = entry.fortIdB;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ id: b, entry });
    adj.get(b).push({ id: a, entry });
  });

  const seen = new Set([fromFortId]);
  const queue = [{ id: fromFortId, length: 0, path: [] }];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.id === toFortId) return { length: cur.length, path: cur.path };

    const neighbors = adj.get(cur.id) || [];
    for (const n of neighbors) {
      if (seen.has(n.id)) continue;
      const nextLen = cur.length + routeEntryLength(n.entry);
      if (nextLen <= MAX_ROUTE_LIMIT + 8) {
        seen.add(n.id);
        queue.push({ id: n.id, length: nextLen, path: cur.path.concat(n.entry) });
      }
    }
  }
  return null;
}

function buildRouteGraph(entries) {
  const graph = new Map();
  entries.forEach(entry => {
    const a = entry.fortIdA;
    const b = entry.fortIdB;
    const len = Math.max(1, routeEntryLength(entry));
    if (!graph.has(a)) graph.set(a, []);
    if (!graph.has(b)) graph.set(b, []);
    graph.get(a).push({ to: b, cost: len, entry });
    graph.get(b).push({ to: a, cost: len, entry });
  });
  return graph;
}

function shortestRouteLengthViaEntries(entries, startId, targetId, skipEntry) {
  const graph = buildRouteGraph(entries.filter(e => e !== skipEntry));
  const dist = new Map([[startId, 0]]);
  const settled = new Set();
  const queue = [{ id: startId, d: 0 }];

  while (queue.length) {
    queue.sort((a, b) => a.d - b.d);
    const cur = queue.shift();
    if (settled.has(cur.id)) continue;
    settled.add(cur.id);
    if (cur.id === targetId) return cur.d;

    const neighbors = graph.get(cur.id) || [];
    for (const n of neighbors) {
      if (settled.has(n.to)) continue;
      const next = cur.d + n.cost;
      if (!dist.has(n.to) || next < dist.get(n.to)) {
        dist.set(n.to, next);
        queue.push({ id: n.to, d: next });
      }
    }
  }

  return null;
}

function pruneRedundantRoutes(entries) {
  if (!entries || entries.length < 2) return;

  // Canonicalize the pair identity before every comparison. This is the
  // final guard against duplicate hub/fan artifacts that keep writing the
  // same routeKey across overlapping cluster interpretations.
  canonicalizeEntriesByRoutePair(entries);

  const directByKey = new Map();
  const viaHubByKey = new Map();

  entries.forEach(entry => {
    const key = routeKey(entry.fortIdA, entry.fortIdB);
    if (entry.useHub) {
      viaHubByKey.set(key, entry);
    } else {
      directByKey.set(key, entry);
    }
  });

  const kept = [];

  // For the same pair of forts, prefer the direct route only when it is
  // clearly at least 30% shorter than the route already forced through a
  // helper point. Otherwise remove the direct variant and let the hub-backed
  // route survive as the canonical geometry.
  const keys = new Set([...directByKey.keys(), ...viaHubByKey.keys()]);
  keys.forEach(key => {
    const direct = directByKey.get(key);
    const viaHub = viaHubByKey.get(key);

    if (!direct && viaHub) {
      kept.push(viaHub);
      return;
    }

    if (direct && !viaHub) {
      kept.push(direct);
      return;
    }

    if (!direct || !viaHub) return;

    const directLen = routeEntryLength(direct);
    const hubLen = routeEntryLength(viaHub);
    if (!Number.isFinite(directLen) || !Number.isFinite(hubLen)) {
      kept.push(direct);
      return;
    }

    if (directLen <= hubLen * (1 - ROUTE_HUB_DIRECT_SHORTCUT_FRACTION)) {
      kept.push(direct);
      return;
    }

    kept.push(viaHub);
  });

  // Keep the old chain-based pruning rule after the duplicate route pair
  // arbitration, so helper-point geometry is only allowed to survive when
  // it is not merely a route-level duplicate of a shorter direct edge.
  const rivalKept = [];
  kept.forEach(entry => {
    const directLen = routeEntryLength(entry);
    if (!Number.isFinite(directLen)) {
      rivalKept.push(entry);
      return;
    }

    const altLen = shortestRouteLengthViaEntries(kept, entry.fortIdA, entry.fortIdB, entry);
    if (altLen !== null && altLen < directLen * 0.88) {
      return;
    }

    rivalKept.push(entry);
  });

  entries.length = 0;
  entries.push(...rivalKept);
}

// Module-level (non-state) cache: route pair key -> curve in REAL space.
// Kept separate from S.routes on purpose - S.routes entries only carry the
// two fort ids they connect (per the route object's spec), while this cache
// holds the derived rendering geometry so it isn't recomputed on every
// render call.
const _routeCurveCache = new Map();

// Triangle-hub trunks (see tryAddTriangleHubEntries), each a dense
// REAL-space polyline. Rebuilt alongside _routeCurveCache and rendered as
// its own path exactly once per cluster - the routes that fork off a
// trunk have that same leading stretch trimmed out of their OWN rendered
// points (see getRouteCurveWorldPoints) so it's never drawn twice.
const _routeTrunkCache = [];

function getRouteTrunkSegmentsWorldPoints() {
  return _routeTrunkCache.map(pts => pts.map(toWorldPoint));
}

// Per-fort/per-nest signature tracking now lives directly in
// ensureRoutesUpToDate() (as Maps, so individual fort changes can be
// detected without restringifying everything) - this whole-map string
// signature predates that and is no longer called anywhere.

// Computes routes for every (a, b) pair in `aliveForts` where at least one
// side's id is in `newFortIds`, skipping any pair that already has a route
// (there shouldn't be one, for a genuinely new fort, but this stays
// defensive rather than ever overwrite an existing entry). Deliberately
// uses only the same PLAIN per-pair curve regenerateRoutes() computes as
// its own baseline (findRouteCurve + sampleCubicBezier) - no
// applyFortClusterHubs/pruneRedundantRoutes pass - since those consider
// the whole current route graph together and could just as easily decide
// to bend an unrelated EXISTING pair through a new rectangle/triangle the
// new fort happens to complete. A new fort's routes come in a little less
// optimized (never hub-routed) in exchange for a hard guarantee that nothing
// already on the map ever visibly changes just because a fort was built.
function addIncrementalRoutes(newFortIds, aliveForts, aliveNests) {
  const newIdSet = new Set(newFortIds);
  const existingKeys = new Set(S.routes.map(r => routeKey(r.fortIdA, r.fortIdB)));
  const added = [];

  for (let i = 0; i < aliveForts.length; i++) {
    for (let j = i + 1; j < aliveForts.length; j++) {
      const a = aliveForts[i], b = aliveForts[j];
      if (!newIdSet.has(a.id) && !newIdSet.has(b.id)) continue; // pair of two pre-existing forts - not this function's business
      const key = routeKey(a.id, b.id);
      if (existingKeys.has(key)) continue;

      const curve = findRouteCurve(a, b, aliveNests);
      if (!curve) continue; // MAX_ROUTE_LIMIT or MIN_NEST_DISTANCE couldn't be satisfied - skip this pair, same as regenerateRoutes() would

      const points = sampleCubicBezier(curve.p0, curve.c1, curve.c2, curve.p3, ROUTE_MERGE_SAMPLES);
      _routeCurveCache.set(key, { ...curve, points, headTrunkCount: 0, tailTrunkCount: 0 });
      added.push({ fortIdA: a.id, fortIdB: b.id });
    }
  }

  S.routes = S.routes.concat(added);
}

// Rebuilds S.routes (one entry per fort pair that has a valid curve) and the
// matching _routeCurveCache. Call whenever forts or nests may have changed;
// ensureRoutesUpToDate() below skips the rebuild when nothing actually did.
function regenerateRoutes() {
  const forts = (S.forts || []).filter(f => f.alive);
  const aliveNests = (S.nests || []).filter(n => n.alive);

  const entries = []; // { fortIdA, fortIdB, curve, points, useHub? } - see FORT-CLUSTER ROAD NETWORKS above
  const pendingTrunks = new Map(); // triangle-hub pseudo-fort id -> trunk points, resolved into _routeTrunkCache only for trunks a surviving entry still references
  _routeCurveCache.clear();
  _routeTrunkCache.length = 0;

  // 1) Ordinary per-pair curve for every valid fort pair - the baseline
  // that a rectangle's diagonals already satisfy as-is, and that every
  // hub-routed alternative below gets compared against.
  for (let i = 0; i < forts.length; i++) {
    for (let j = i + 1; j < forts.length; j++) {
      const a = forts[i], b = forts[j];
      const curve = findRouteCurve(a, b, aliveNests);
      if (!curve) continue; // MAX_ROUTE_LIMIT or MIN_NEST_DISTANCE couldn't be satisfied - skip this pair
      entries.push({
        fortIdA: a.id,
        fortIdB: b.id,
        curve,
        points: sampleCubicBezier(curve.p0, curve.c1, curve.c2, curve.p3, ROUTE_MERGE_SAMPLES)
      });
    }
  }

  applyFortClusterHubs(entries, forts, aliveNests, pendingTrunks); // adds hub-routed alternatives for rectangle sides / triangle apex-legs+base
  pruneRedundantRoutes(entries); // per pair, keeps the direct route only if it beats any hub-routed alternative by ROUTE_HUB_DIRECT_SHORTCUT_FRACTION; also runs its existing shortcut-chain pruning
  // (a further "applyRouteJoins" pass for stray crossings outside any
  // rectangle/triangle was called here but never implemented - see the
  // description above this function for why it's been left out rather
  // than added back in)

  // Only render a triangle-hub's trunk once at least one of the branches
  // that forked off it actually survived pruning above - otherwise it'd be
  // an orphaned line to nowhere nobody's route uses anymore.
  const usedTrunkIds = new Set(entries.filter(e => e.trunkId != null).map(e => e.trunkId));
  usedTrunkIds.forEach(id => {
    const pts = pendingTrunks.get(id);
    if (pts) _routeTrunkCache.push(pts);
  });

  entries.forEach(entry => {
    _routeCurveCache.set(routeKey(entry.fortIdA, entry.fortIdB), {
      ...entry.curve,
      points: entry.points,
      headTrunkCount: entry.headTrunkCount || 0,
      tailTrunkCount: entry.tailTrunkCount || 0
    });
  });

  S.routes = entries.map(entry => ({ fortIdA: entry.fortIdA, fortIdB: entry.fortIdB }));
}

// The "already up to date" signature is stashed directly ON the state
// object (S._routeFortSignatures/S._routeNestSignature) rather than in a
// module-level variable. initGame()/beginSimulation() replace S wholesale
// with a fresh object (S = freshState()) whenever the game (re)starts, and
// a module-level signature would have kept comparing against that OLD
// state - matching by coincidence whenever positions were carried over
// into the new state (see initGame's keepMap path) and, on that false
// match, leaving the brand-new S.routes stuck at freshState()'s empty []
// forever. Keying off S itself means a new state always misses on its
// first check and rebuilds.
//
// Beyond that basic staleness check, this also decides HOW to update:
// if every fort that existed the last time routes were built still exists,
// unchanged, and only brand-new fort ids have been added (a fort was
// built) - and nests haven't changed either - only those new forts' routes
// get computed, via addIncrementalRoutes() above, leaving every existing
// route exactly as it was. Anything else (a fort died or moved, a nest
// changed) falls back to the full regenerateRoutes() rebuild, since those
// can legitimately change how ANY route on the map should be routed
// (nest-avoidance, hub clusters) and can't be safely reasoned about
// incrementally.
function ensureRoutesUpToDate() {
  if (!S) return;

  const aliveForts = (S.forts || []).filter(f => f.alive);
  const aliveNests = (S.nests || []).filter(n => n.alive);
  const nestSig = aliveNests.map(n => `${n.id}:${n.x.toFixed(2)}:${n.y.toFixed(2)}`).join('|');
  const currFortSig = new Map(aliveForts.map(f => [f.id, `${f.x.toFixed(2)}:${f.y.toFixed(2)}`]));

  const prevFortSig = S._routeFortSignatures;
  let onlyAdditions = !!prevFortSig && S._routeNestSignature === nestSig;
  if (onlyAdditions) {
    for (const [id, sig] of prevFortSig) {
      if (currFortSig.get(id) !== sig) { onlyAdditions = false; break; } // that fort died, moved, or is otherwise not exactly as it was
    }
  }

  if (currFortSig.size === (prevFortSig ? prevFortSig.size : -1) && onlyAdditions) {
    // Nothing actually changed (same forts, same nests) - a caller asking
    // to check anyway shouldn't pay for even the incremental path.
  } else if (onlyAdditions) {
    const newFortIds = [];
    currFortSig.forEach((sig, id) => { if (!prevFortSig.has(id)) newFortIds.push(id); });
    addIncrementalRoutes(newFortIds, aliveForts, aliveNests);
  } else {
    regenerateRoutes();
  }

  S._routeFortSignatures = currFortSig;
  S._routeNestSignature = nestSig;
}

// Rendering-time helper: given a route object ({fortIdA, fortIdB}), returns
// its cached curve as world-space points ready for an SVG path (c1/c2 are
// the cubic-bezier control points), or null if the route/curve is gone
// (e.g. one of its forts fell since the last regenerate).
// `points` is the dense (possibly merge-adjusted) polyline used for actual
// rendering; p0/c1/c2/p3 are kept alongside it for anything that still
// wants the plain unmerged bezier (e.g. future length/geometry checks).
// If this route was grafted onto a shared bifurcation trunk at either end
// (headTrunkCount/tailTrunkCount), that overlapping stretch is trimmed out
// of `points` here - it's rendered once as its own trunk segment (see
// getRouteTrunkSegmentsWorldPoints) instead of once per route sharing it.
function getRouteCurveWorldPoints(route) {
  const curve = _routeCurveCache.get(routeKey(route.fortIdA, route.fortIdB));
  if (!curve) return null;

  const headSkip = Math.max(0, (curve.headTrunkCount || 0) - 1);
  const tailSkip = Math.max(0, (curve.tailTrunkCount || 0) - 1);
  let renderPts = curve.points.slice(headSkip, curve.points.length - tailSkip);
  if (renderPts.length < 2) renderPts = curve.points; // trims would have eaten the whole route - fall back rather than draw nothing

  return {
    p0: toWorldPoint(curve.p0),
    c1: toWorldPoint(curve.c1),
    c2: toWorldPoint(curve.c2),
    p3: toWorldPoint(curve.p3),
    points: renderPts.map(toWorldPoint)
  };
}

// ---------------------------------------------------------------------------
// FORT RESOURCES
//
// Every fort stocks some amount of each resource type below. These stocks
// are what merchants (see MERCHANT FRAMEWORK, further down) move between
// forts along routes. FORT_RESOURCE_CAPS are placeholder upper bounds for
// the *random initial level* rolled per fort/type - purely arbitrary for
// now, tune freely once the resource economy is actually being balanced.
// They are NOT (yet) a hard storage ceiling: nothing currently stops a
// fort's stock from exceeding its cap once merchants start depositing
// cargo, since delivery/overflow rules haven't been decided yet either.
//
// Separately from its actual stock, every fort also has a `desiredResources`
// bundle - the level it wants to hold of each type. Stock above that level
// is "surplus" and is what spawnMerchants() (below) looks to barter away.
// FORT_DESIRED_RESOURCE_FRACTION is the starting desired level, as a
// fraction of FORT_RESOURCE_CAPS - also just a placeholder to tune later.
// ---------------------------------------------------------------------------
const FORT_RESOURCE_TYPES = [ 'ammo', 'food', 'materials', 'fuel'];

// Rounds a resource amount to 1 decimal place via Math.round(x*10)/10,
// which lands on the SAME double a literal like 194.6 would parse to -
// unlike chained raw float addition/subtraction, which can drift onto a
// neighboring double that stringifies as "194.60000000000002". Every
// mutation of fort.resources[type] (production, consumption, costs,
// cargo) should route through this so that drift can never accumulate
// silently across many steps.
function roundResource(value) {
  return Math.round((value || 0) * 10) / 10;
}

const FORT_RESOURCE_CAPS = {
  ammo: 500,
  food: 400,
  materials: 800,
  fuel: 600
};

const FORT_DESIRED_RESOURCE_FRACTION = 0.5; // starting desired level, as a fraction of FORT_RESOURCE_CAPS

// Builds a resource bundle with every FORT_RESOURCE_TYPES key present
// (defaulting to 0) - used for a fort's starting stock, a fort's desired
// levels, and a merchant's cargo manifest, so all three always share the
// same shape.
function emptyResourceBundle() {
  const bundle = {};
  FORT_RESOURCE_TYPES.forEach(type => { bundle[type] = 0; });
  return bundle;
}

// Rolls a random starting stock for one fort: each resource type
// independently uniform between 0 and its cap (inclusive), rounded to a
// whole unit. Pass a partial `caps` override to reroll just a few types
// against different limits; anything not in FORT_RESOURCE_CAPS defaults to 0.
function randomFortResourceLevels(caps) {
  const c = caps || FORT_RESOURCE_CAPS;
  const bundle = emptyResourceBundle();
  FORT_RESOURCE_TYPES.forEach(type => {
    const cap = c[type] || 0;
    bundle[type] = Math.round(Math.random() * cap);
  });
  return bundle;
}

// A fort's starting desired level for every resource type: a flat fraction
// of FORT_RESOURCE_CAPS, the same for every fort for now (no per-fort
// variation yet - e.g. a fort with a garrison wanting more ammo/food isn't
// modeled here, just a single global starting point).
function defaultDesiredResourceLevels() {
  const bundle = emptyResourceBundle();
  FORT_RESOURCE_TYPES.forEach(type => {
    bundle[type] = Math.round((FORT_RESOURCE_CAPS[type] || 0) * FORT_DESIRED_RESOURCE_FRACTION);
  });
  return bundle;
}

// How much of one resource type a fort holds above its own desired level
// (0 if at/below desired, or if the fort has no resources/desiredResources
// set up at all - e.g. an older save from before this field existed).
function fortSurplus(fort, type) {
  if (!fort || !fort.resources || !fort.desiredResources) return 0;
  return Math.max(0, (fort.resources[type] || 0) - (fort.desiredResources[type] || 0));
}

// ---------------------------------------------------------------------------
// RESOURCE PRODUCTION (passive, per-fort)
//
// fort.workers (see adjustFortWorkers()/ensureFortResourceFieldsInit() in
// script.js, which already back the fort resources overlay's editable
// "workers" column) holds how many of a fort's population are currently
// assigned to producing each FORT_RESOURCE_TYPES entry. Every step, each
// type's assigned workers passively add to that type's own stock on their
// own - no route/merchant/human-mobility involvement, just the fort
// working what it's got - and this step's output is also written into
// fort.production, the field the overlay's (until now always-0) read-only
// production column already displays.
//
// Production isn't linear in headcount: putting more people on the same
// resource lets them specialize, so each additional worker on a type is a
// little more productive than the last, compounding rather than adding up
// 1-for-1 - RESOURCE_WORKER_SPECIALIZATION_GROWTH is that per-additional-
// worker multiplier (1 worker -> 1 unit, 2 workers -> 2 * growth = 2.1
// units, 3 workers -> 3 * growth^2, and so on).
// ---------------------------------------------------------------------------
const RESOURCE_WORKER_SPECIALIZATION_GROWTH = 1.02; // +5% output per additional worker on the same resource, compounding

// Total production from `workers` people all assigned to the same resource
// type this step: 0 workers makes nothing, otherwise
// workers * growth^(workers - 1) (so 1 -> 1, 2 -> 2.1, 3 -> 3.3075, ...).
function resourceProductionForWorkers(workers) {
  const w = Math.max(0, workers || 0);
  if (w <= 0) return 0;
  return w * Math.pow(RESOURCE_WORKER_SPECIALIZATION_GROWTH, w - 1);
}

// Runs once per step (see advanceStepLogic()): every alive fort's assigned
// workers passively add to that type's stock, per
// resourceProductionForWorkers() above, and this step's per-type output is
// (re)written into fort.production so the fort resources overlay's
// production column reflects it live. A fort with no resources/workers
// bundle yet (e.g. an older save from before this system existed) simply
// produces nothing until ensureFortResourceFieldsInit() backfills one.
function produceFortResources() {
  S.forts.forEach(fort => {
    if (!fort.alive || !fort.resources || !fort.workers) return;
    if (!fort.production) fort.production = emptyFortResourceCounters();
    FORT_RESOURCE_TYPES.forEach(type => {
      const produced = roundResource(resourceProductionForWorkers(fort.workers[type]));

      fort.production[type] = produced;

      if (produced > 0) {
        fort.resources[type] = roundResource((fort.resources[type] || 0) + produced);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// MERCHANT FRAMEWORK
//
// A "merchant" is an event (alongside 'search'/'hunt'/'fort') tied to one of
// the routes built in the ROUTE FRAMEWORK above: it travels from one fort to
// another, carrying a cargo of the resources above. Unlike search/hunt
// events, merchants aren't scoped to a nest - they're a human-side fort-to-
// fort exchange, so `nestId` is intentionally absent from the event shape.
//
// Lifecycle for a single step (mirrors the "beginning of step" / "end of
// step" split requested for this framework):
//   1. spawnMerchants() runs at the very start of advanceStepLogic(). For
//      every route with a genuine barter match (see below), it dispatches a
//      merchant from EACH end, straight away deducting that merchant's cargo
//      from its origin fort's stock and knocking 1 off the origin fort's
//      population (the merchant leaving). If the merchant is later found to
//      have been killed, that cargo and that population point are simply
//      gone - nothing ever gets refunded to the origin.
//   2. Over the course of the step, a merchant just sits there as a pending
//      event (available to be selected/rendered like any other), same as a
//      search/hunt in flight.
//   3. resolveMerchants() runs at the end of advanceStepLogic() and decides,
//      per pending merchant, whether it reached its destination (outcome
//      'delivered': cargo added to the destination fort's resources, and
//      the merchant itself joins the destination fort's population - it
//      never returns home either way) or was hunted down en route (outcome
//      'hunted': cargo and merchant are simply lost, no further effect) -
//      then marks the event 'resolved', so the filter at the top of the
//      next advanceStepLogic() call clears it out.
//
// BARTER MATCHING (the current spawnMerchants() rule): for every route
// connecting two alive forts that can each spare a population point, look
// for a resource type A has surplus of that B does NOT (something B could
// use) and a resource type B has surplus of that A does NOT. These two
// lists can never share a type - "A surplus of X" requires "B has zero
// surplus of X", and "B surplus of X" requires "A has zero surplus of X",
// so both can't hold for the same X at once - meaning any match is always a
// genuine two-different-goods trade, never a fort just re-importing its own
// surplus. When both sides have at least one offer, each fort trades away
// its single BIGGEST surplus type in full, in one merchant each way.
//
// What's NOT decided yet (see the TODO on determineMerchantOutcome below):
// the actual hunted-vs-delivered odds. Everything currently just delivers.
// ---------------------------------------------------------------------------

const MERCHANT_RESOURCE_TYPES = FORT_RESOURCE_TYPES; // a merchant can carry any subset of these
const MERCHANT_CAPACITY = 50;
const MERCHANT_PAIR_SIZE = 2; // a merchant event always represents this many humans travelling together

// A trip carrying less than this fraction of MERCHANT_CAPACITY isn't worth
// sending at all - an almost-empty wagon still ties up a pair of humans and
// an AP cost for barely any goods. Checked BEFORE a trip is dispatched (see
// every dispatch loop below), not capped after the fact.
const MERCHANT_MIN_CARGO_FRACTION = 0.8;
const MERCHANT_MIN_CARGO = MERCHANT_CAPACITY * MERCHANT_MIN_CARGO_FRACTION;

// How many of a fort's population are actually free to send out as
// merchants - population currently assigned to a production job (see
// fort.workers/adjustFortWorkers()) doesn't stop producing just because a
// trade opportunity came up, so only the remainder (population minus every
// assigned worker, INCLUDING existing merchant-vocation workers - see
// fort.merchantWorkers/draftMerchantPair() below) is available to dispatch.
// AUTO WORKER ALLOCATION (see autoAllocateFortWorkers(), on by default)
// deliberately holds some of this back for exactly that purpose via its own
// MERCHANT WORKER RESERVATION step further down - a fort with autoWorkers
// off, or one the player has manually assigned every last body on, still
// won't trade until some population is freed up by hand, but that's the
// intended trade-off there, not a bug.
function unemployedPopulation(fort) {
  if (!fort) return 0;
  const assigned = fort.workers
    ? FORT_RESOURCE_TYPES.reduce((sum, type) => sum + (fort.workers[type] || 0), 0)
    : 0;
  return Math.max(0, (fort.population || 0) - assigned - (fort.merchantWorkers || 0));
}

// ---------------------------------------------------------------------------
// MERCHANT AS A FIXED VOCATION (fort.merchantWorkers)
//
// A merchant is a permanent commitment, same as any production vocation
// (fort.workers[type]) - once someone becomes a merchant, they never go
// back to being unemployed OR to a production job. What CAN feed into it:
// unlike production vocations, merchant duty isn't drafted only from
// unemployedPopulation() - if a fort has no unemployed body to spare (or
// not enough) but a trade is otherwise ready to go, it will permanently
// pull workers off an existing production job instead, converting them.
// draftMerchantPair() below is the single place this happens; every
// dispatch site (spawnMerchants()'s primary A->B/B->A, sendRouteMerchants(),
// autoTradeDirection(), attemptDiffusionTrade()) calls it instead of
// checking unemployedPopulation() and decrementing fort.population by hand.
//
// Draw order for the MERCHANT_PAIR_SIZE bodies a trip needs:
//   1. fort.merchantWorkers already sitting idle at this fort (arrived from
//      an earlier trip elsewhere and settled here - see resolveMerchants()
//      below) - re-dispatching them costs this fort no production capacity
//      at all, so they're always drawn first.
//   2. unemployedPopulation(fort) - never committed to anything, so drawing
//      from here doesn't touch production either.
//   3. Only once neither of those covers the full pair: convert bodies off
//      whichever PRODUCTION vocation currently holds the most people,
//      largest first - spreading the one-time disruption across the
//      biggest pool rather than gutting a small one down to nothing.
//
// A pair sourced this way is deducted from fort.population immediately
// (they're leaving, same as any merchant dispatch) - fort.merchantWorkers
// only ever reflects merchants CURRENTLY AT a fort, not ones in transit.
// ---------------------------------------------------------------------------

// Read-only "would draftMerchantPair(fort) succeed right now" check - same
// draw order/logic as draftMerchantPair() below, just without mutating
// anything. Used to confirm BOTH legs of a paired trade (goods + payment
// in autoTradeDirection(), giver + receiver in attemptDiffusionTrade())
// can actually be crewed before committing to EITHER of them - committing
// the first leg (deducting resources, pushing its merchant event) and
// only THEN discovering the second leg can't be crewed used to leave that
// first leg's shipment stranded with no reciprocal trip: exactly what a
// one-sided "sent for nothing" trade looks like in the merchant icon's
// hover tooltip.
function canDraftMerchantPair(fort) {
  if (!fort) return false;
  const fromMerchants = Math.min(MERCHANT_PAIR_SIZE, fort.merchantWorkers || 0);
  const fromUnemployed = Math.min(MERCHANT_PAIR_SIZE - fromMerchants, unemployedPopulation(fort));
  const remaining = MERCHANT_PAIR_SIZE - fromMerchants - fromUnemployed;
  if (remaining <= 0) return true;
  if (!fort.workers) return false;
  const totalWorkers = FORT_RESOURCE_TYPES.reduce((sum, type) => sum + (fort.workers[type] || 0), 0);
  return totalWorkers >= remaining;
}

// Drafts MERCHANT_PAIR_SIZE bodies from `fort` to dispatch as one merchant
// pair - see the header comment above for the draw order. Mutates `fort`
// (population, merchantWorkers, and/or whichever production vocation(s)
// got raided) and returns true only if a FULL pair was actually found;
// returns false (fort left completely untouched) if fort's total population
// can't cover MERCHANT_PAIR_SIZE even added up across every source.
function draftMerchantPair(fort) {
  if (!fort) return false;

  const fromMerchants = Math.min(MERCHANT_PAIR_SIZE, fort.merchantWorkers || 0);
  const fromUnemployed = Math.min(MERCHANT_PAIR_SIZE - fromMerchants, unemployedPopulation(fort));

  let remaining = MERCHANT_PAIR_SIZE - fromMerchants - fromUnemployed;
  const donations = []; // [{type, amount}] - production vocations raided to cover the shortfall

  if (remaining > 0 && fort.workers) {
    const pools = FORT_RESOURCE_TYPES
      .map(type => ({ type, count: fort.workers[type] || 0 }))
      .filter(p => p.count > 0)
      .sort((a, b) => b.count - a.count); // biggest pool first

    for (const pool of pools) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, pool.count);
      donations.push({ type: pool.type, amount: take });
      remaining -= take;
    }
  }

  if (remaining > 0) return false; // fort's whole population still isn't enough

  if (fromMerchants > 0) fort.merchantWorkers -= fromMerchants;
  donations.forEach(({ type, amount }) => { fort.workers[type] -= amount; });
  fort.population -= MERCHANT_PAIR_SIZE;
  return true;
}

// Creates a pending 'merchant' event travelling fromFortId -> toFortId
// (direction matters, even though the underlying route in S.routes is
// undirected) with the given cargo. `cargo` is a partial resource bundle,
// e.g. { food: 20, fuel: 5 } - any type left out defaults to 0. Does NOT
// touch either fort's resources/population itself - callers (spawnMerchants
// below) own that side-effect, since exactly when/how much to deduct is
// part of the spawning rules.
//
// `humans` is always MERCHANT_PAIR_SIZE (2) - every merchant event is a pair
// travelling together, never a lone traveller. `survivors` stays null until
// a route-hunt ambush (see MERCHANT HUNTING further down) or resolveMerchants()
// decide how many of the pair make it.
function makeMerchantEvent(fromFortId, toFortId, cargo) {
  const fullCargo = emptyResourceBundle();
  Object.assign(fullCargo, cargo || {});
  return {
    id: nid(),
    type: 'merchant',
    status: 'pending',
    outcome: null, // set by resolveMerchants(): 'delivered' | 'hunted'
    fromFortId,
    toFortId,
    routeKey: routeKey(fromFortId, toFortId),
    cargo: fullCargo,
    humans: MERCHANT_PAIR_SIZE,
    survivors: null
  };
}

function getLargestDemandType(fort) {
  if (!fort || !fort.alive || !fort.resources || !fort.desiredResources) return null;

  let best = null;
  FORT_RESOURCE_TYPES.forEach(type => {
    const owned = fort.resources[type] || 0;
    const desired = fort.desiredResources[type] || 0;
    const gap = Math.max(0, desired - owned);
    if (!best || gap > best.gap) {
      best = { type, gap };
    }
  });

  if (!best || best.gap <= 0) return null;
  return best;
}

// Biggest surplus a fort holds above its own desired level - used by AUTO
// TRADE (further down) as what a critically short fort pays WITH.
function getLargestSurplusType(fort) {
  if (!fort || !fort.alive || !fort.resources || !fort.desiredResources) return null;
  let best = null;
  FORT_RESOURCE_TYPES.forEach(type => {
    const surplus = fortSurplus(fort, type);
    if (surplus > 0 && (!best || surplus > best.surplus)) {
      best = { type, surplus };
    }
  });
  return best;
}

// True if `fort` owns less than AUTO_TRADE_CRITICAL_FRACTION of its own
// desired level for `type` - AUTO TRADE's threshold for "critically" short,
// stricter than the plain "below desired" gap getLargestDemandType() above
// already uses.
const AUTO_TRADE_CRITICAL_FRACTION = 0.7;
function isCriticallyLowOn(fort, type) {
  if (!fort || !fort.resources || !fort.desiredResources) return false;
  const desired = fort.desiredResources[type] || 0;
  if (desired <= 0) return false;
  return (fort.resources[type] || 0) < desired * AUTO_TRADE_CRITICAL_FRACTION;
}

// How much of `type` `fort` can part with as an AUTO TRADE seller. Relaxed
// on purpose from fortSurplus()'s "must be literal surplus above its own
// 100% desired level": here the floor is AUTO_TRADE_SELLER_FLOOR_FRACTION
// (80%) of desired, so a fort sitting right at (or even a little under)
// its own desired level can still sell a slice of it to a neighbor that's
// critically short, rather than only ever trading away genuine excess.
// That's what makes chained relief possible - fort B at exactly 100% ammo
// has zero fortSurplus() to give, but can still sell down to 80% here; B
// then buys itself back up from whoever it's connected to that DOES have
// genuine surplus (fort C at 150%), via the regular barter pass or another
// auto-trade leg, and the whole thing can repeat over several steps as a
// slow relay from a distant surplus fort to a distant shortage fort with
// no direct route between them.
const AUTO_TRADE_SELLER_FLOOR_FRACTION = 0.8;
function autoTradeSellable(fort, type) {
  if (!fort || !fort.resources || !fort.desiredResources) return 0;
  const desired = fort.desiredResources[type] || 0;
  return Math.max(0, (fort.resources[type] || 0) - desired * AUTO_TRADE_SELLER_FLOOR_FRACTION);
}

// UI-only: which resource types a fort is critically short on, for the
// small badge shown on its map marker (see updateFortDemandBadge(),
// script.js). NOT the same threshold as isCriticallyLowOn() above, which
// drives actual auto-trade behavior - this is purely a "below half of what
// you asked for" warning shown to the player. Only counts a type where the
// fort has actually asked for some of it (desired > 0): a resource left at
// 0 desired was never being demanded in the first place, so 0 stock isn't
// "critical" for it. Returns every qualifying type, worst (lowest
// stock/desired ratio) first, then by higher desired amount - the map
// marker cycles through ALL of them rather than picking one, so this order
// is just a sensible display order, not a decision that needs a
// tie-breaker beyond "something deterministic".
const FORT_DEMAND_BADGE_FRACTION = 0.3;
function getCriticalDemandTypes(fort) {
  if (!fort || !fort.alive || !fort.resources || !fort.desiredResources) return [];

  const qualifying = [];
  FORT_RESOURCE_TYPES.forEach(type => {
    const desired = fort.desiredResources[type] || 0;
    if (desired <= 0) return;
    const ratio = (fort.resources[type] || 0) / desired;
    if (ratio < FORT_DEMAND_BADGE_FRACTION) qualifying.push({ type, ratio, desired });
  });

  qualifying.sort((a, b) => (a.ratio - b.ratio) || (b.desired - a.desired));
  return qualifying.map(q => q.type);
}

// Dispatches merchant PAIRS (MERCHANT_PAIR_SIZE humans each) from `origin`
// to `destination`, carrying `cargoType`, until either the surplus runs out,
// `routeLimit` pairs have been sent, or the origin can no longer spare a
// full pair of population. Currently dead code (nothing calls this -
// spawnMerchants() below has its own inlined copy of the same loop for both
// directions of a route) but kept in sync with it since it's the more
// readable single-direction version.
function sendRouteMerchants(origin, destination, cargoType, routeLimit) {
  if (!origin || !destination || !cargoType || !routeLimit) return;
  if (!origin.alive || !destination.alive) return;
  if (!origin.resources || !origin.desiredResources || !destination.resources || !destination.desiredResources) return;

  let remaining = Math.max(0, fortSurplus(origin, cargoType));
  let sent = 0;
  const perFortMax = Math.max(1, Number(S.settings?.merchantLimit || 3));

  while (remaining > 0 && sent < perFortMax) {
    const cargo = Math.min(MERCHANT_CAPACITY, remaining);
    if (cargo < MERCHANT_MIN_CARGO) break; // not worth a trip - see MERCHANT_MIN_CARGO_FRACTION
    if (!draftMerchantPair(origin)) break; // origin can't crew another pair from any source - see draftMerchantPair()
    origin.resources[cargoType] = roundResource(Math.max(0, (origin.resources[cargoType] || 0) - cargo));
    S.events.push(makeMerchantEvent(origin.id, destination.id, { [cargoType]: cargo }));
    sent += 1;
    remaining -= cargo;
  }
}

// Finds this step's barter matches and dispatches merchants from each side
// of every route, using a simpler weight-based rule: each fort asks for the
// resource with the largest (desired - owned) gap, and each merchant carries
// at most 50 weight units. The player limit is controlled through the static
// UI field and kept in S.settings.merchantLimit (default 3). Runs once at
// the very start of advanceStepLogic().
function spawnMerchants() {
  const routeLimit = Math.max(0, Math.min(99, Number(S.settings?.merchantLimit || 3)));
  if (routeLimit <= 0) return;

  (S.routes || []).forEach(route => {
    const fortA = S.forts.find(f => f.id === route.fortIdA);
    const fortB = S.forts.find(f => f.id === route.fortIdB);
    if (!fortA || !fortB || !fortA.alive || !fortB.alive) return;
    // A cheap pre-filter, not the real feasibility check anymore - a fort
    // with zero unemployed can still crew a pair by converting a production
    // worker (see draftMerchantPair()), so the only thing that truly rules
    // a fort out is not having MERCHANT_PAIR_SIZE population at all.
    if (fortA.population < MERCHANT_PAIR_SIZE || fortB.population < MERCHANT_PAIR_SIZE) return;

    const wantB = getLargestDemandType(fortB);
    const wantA = getLargestDemandType(fortA);

    // Primary barter is strictly mutual: A only ships to B if B ALSO has
    // surplus of what A wants most, and vice versa. The two directions
    // used to be checked and dispatched completely independently, so a
    // fort sitting on a surplus of the other's top demand would ship it
    // out even when the other fort had nothing of its OWN top demand to
    // send back - a one-sided "trade". If either side can't currently
    // offer the other's biggest want, this pass ships nothing at all for
    // this route this step; the trade just waits until both sides
    // actually have something to offer, rather than firing one-sided.
    // (AUTO TRADE / DIFFUSION TRADE below are unaffected by this and can
    // still independently find a trade this same step.)
    //
    // The threshold here is MERCHANT_MIN_CARGO, not just "greater than
    // zero": each dispatch loop below only actually ships once its cargo
    // clears that 80%-of-capacity floor (`if (cargo < MERCHANT_MIN_CARGO)
    // break`), so a side sitting on some smaller, technically-positive
    // surplus - not enough to ever fill a wagon - would still pass a bare
    // "> 0" gate and let the OTHER side ship alone once its own loop hit
    // that same floor and broke out immediately. Matching the gate to the
    // loops' real threshold is what actually closes that gap.
    const aCanSupplyB = wantB && wantB.type && fortSurplus(fortA, wantB.type) >= MERCHANT_MIN_CARGO;
    const bCanSupplyA = wantA && wantA.type && fortSurplus(fortB, wantA.type) >= MERCHANT_MIN_CARGO;

    let dispatchedAtoB = null;
    let dispatchedBtoA = null;

    if (aCanSupplyB && bCanSupplyA) {
      // A -> B: origin A ships its surplus of B's top demanded resource.
      // Remembers the type below (only if a shipment actually went out) so
      // AUTO TRADE knows not to double it up - matching by type alone
      // isn't enough, since this whole block can match but ship nothing
      // (draftMerchantPair failing, or cargo under MERCHANT_MIN_CARGO),
      // and that's exactly the gap AUTO TRADE's looser seller floor exists
      // to fill.
      const sendCountAtoB = Math.min(routeLimit, Math.max(1, routeLimit));
      let sentAtoB = 0;
      let remainingAtoB = Math.max(0, fortSurplus(fortA, wantB.type));
      while (remainingAtoB > 0 && sentAtoB < sendCountAtoB) {
        const cargo = Math.min(MERCHANT_CAPACITY, remainingAtoB);
        if (cargo < MERCHANT_MIN_CARGO) break; // not worth a trip - see MERCHANT_MIN_CARGO_FRACTION
        if (!draftMerchantPair(fortA)) break; // fortA can't crew another pair from any source
        fortA.resources[wantB.type] = roundResource(Math.max(0, (fortA.resources[wantB.type] || 0) - cargo));
        applyFortActionCost(fortA, FORT_ACTION_COSTS.merchantEvent);
        S.events.push(makeMerchantEvent(fortA.id, fortB.id, { [wantB.type]: cargo }));
        sentAtoB += 1;
        remainingAtoB -= cargo;
      }
      if (sentAtoB > 0) dispatchedAtoB = wantB.type;

      // B -> A: the mirrored shipment back, matching A's own top demand -
      // this is what makes the pass above actually mutual rather than a
      // one-off gift.
      const sendCountBtoA = Math.min(routeLimit, Math.max(1, routeLimit));
      let sentBtoA = 0;
      let remainingBtoA = Math.max(0, fortSurplus(fortB, wantA.type));
      while (remainingBtoA > 0 && sentBtoA < sendCountBtoA) {
        const cargo = Math.min(MERCHANT_CAPACITY, remainingBtoA);
        if (cargo < MERCHANT_MIN_CARGO) break; // not worth a trip - see MERCHANT_MIN_CARGO_FRACTION
        if (!draftMerchantPair(fortB)) break; // fortB can't crew another pair from any source
        fortB.resources[wantA.type] = roundResource(Math.max(0, (fortB.resources[wantA.type] || 0) - cargo));
        applyFortActionCost(fortB, FORT_ACTION_COSTS.merchantEvent);
        S.events.push(makeMerchantEvent(fortB.id, fortA.id, { [wantA.type]: cargo }));
        sentBtoA += 1;
        remainingBtoA -= cargo;
      }
      if (sentBtoA > 0) dispatchedBtoA = wantA.type;
    }

    // AUTO TRADE (opt-in, S.settings.autoTradeEnabled - see the header
    // comment above autoTradeDirection() below): catches critical shortages
    // the two matches above miss, since those only ever look at each fort's
    // single BIGGEST demand. Skip whichever type each side's primary match
    // above actually shipped this step, so the same shipment never gets
    // doubled up.
    if (S.settings.autoTradeEnabled) {
      const autoDispatchedBtoA = autoTradeDirection(fortB, fortA, routeLimit, dispatchedAtoB); // B buys from A
      const autoDispatchedAtoB = autoTradeDirection(fortA, fortB, routeLimit, dispatchedBtoA); // A buys from B

      // DIFFUSION TRADE (see its own header comment above) - strictly the
      // lowest priority of the three: only even considered once NOTHING
      // above moved anything for this route this step, deficiency-driven
      // trade always wins when there's an actual deficiency to fix.
      if (!dispatchedAtoB && !dispatchedBtoA && !autoDispatchedAtoB && !autoDispatchedBtoA) {
        attemptDiffusionTrade(fortA, fortB, routeLimit);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// AUTO TRADE (S.settings.autoTradeEnabled, off by default)
//
// The regular barter pass above only ever looks at each fort's SINGLE
// biggest demand (getLargestDemandType) - so if fort B is critically low on
// food but food isn't its #1 gap, or fort A simply has nothing fort B's #1
// gap needs, an obviously-useful trade never happens (e.g. fort A sitting
// on 150/100 food while fort B is starving at 40/100, but B has nothing
// A's own top demand wants).
//
// Auto trade relaxes this: for EVERY resource type (not just the biggest
// gap), if `buyer` is critically short (<70% of its own desired level -
// AUTO_TRADE_CRITICAL_FRACTION) of something `seller` can spare, `buyer`
// "buys" it - paying 2 units of ITS OWN biggest surplus resource for every
// 1 unit received, regardless of whether `seller` has any actual use for
// that payment. `seller` never sells below AUTO_TRADE_SELLER_FLOOR_FRACTION
// (80%) of its own desired level (autoTradeSellable - deliberately looser
// than fortSurplus()'s literal-surplus-above-100% bar, see its own comment
// above), and only ever gets paid in something `buyer` holds above ITS OWN
// desired level - so the buyer's payment is still genuine surplus, it's
// just the seller's side that's allowed to dip a little below 100% to help
// a neighbor in real trouble, rather than needing headroom above 100% first.
// ---------------------------------------------------------------------------
function autoTradeDirection(buyer, seller, routeLimit, skipType) {
  if (buyer.population < MERCHANT_PAIR_SIZE || seller.population < MERCHANT_PAIR_SIZE) return false;

  const neededType = FORT_RESOURCE_TYPES.find(type =>
    type !== skipType && isCriticallyLowOn(buyer, type) && autoTradeSellable(seller, type) > 0
  );
  if (!neededType) return false;

  const paymentInfo = getLargestSurplusType(buyer);
  if (!paymentInfo) return false; // buyer has nothing of its own to pay with

  let sent = 0;
  while (sent < routeLimit && buyer.population >= MERCHANT_PAIR_SIZE && seller.population >= MERCHANT_PAIR_SIZE) {
    const availableGoods = Math.min(MERCHANT_CAPACITY, autoTradeSellable(seller, neededType));
    const availablePayment = Math.min(MERCHANT_CAPACITY, fortSurplus(buyer, paymentInfo.type));
    if (availableGoods <= 0 || availablePayment <= 0) break;

    // Keep the 2:1 ratio exact - whichever side is the tighter constraint
    // decides how much actually moves this trip.
    const goodsThisTrip = Math.min(availableGoods, Math.floor(availablePayment / 2));
    if (goodsThisTrip <= 0) break;
    const paymentThisTrip = goodsThisTrip * 2;
    // The payment leg is the one that actually scales up to a full
    // MERCHANT_CAPACITY wagon (goods are structurally capped at half that,
    // by the 2:1 ratio above) - so it's what the 80% floor is checked
    // against, not the smaller goods amount. See MERCHANT_MIN_CARGO_FRACTION.
    if (paymentThisTrip < MERCHANT_MIN_CARGO) break;

    if (!canDraftMerchantPair(seller) || !canDraftMerchantPair(buyer)) break; // confirm BOTH legs can be crewed before committing to either - see canDraftMerchantPair()'s comment

    draftMerchantPair(seller);
    seller.resources[neededType] = roundResource(Math.max(0, (seller.resources[neededType] || 0) - goodsThisTrip));
    applyFortActionCost(seller, FORT_ACTION_COSTS.merchantEvent);
    S.events.push(makeMerchantEvent(seller.id, buyer.id, { [neededType]: goodsThisTrip }));

    draftMerchantPair(buyer);
    buyer.resources[paymentInfo.type] = roundResource(Math.max(0, (buyer.resources[paymentInfo.type] || 0) - paymentThisTrip));
    applyFortActionCost(buyer, FORT_ACTION_COSTS.merchantEvent);
    S.events.push(makeMerchantEvent(buyer.id, seller.id, { [paymentInfo.type]: paymentThisTrip }));

    sent += 1;
  }
  return sent > 0;
}

// ---------------------------------------------------------------------------
// DIFFUSION TRADE (folded into spawnMerchants() above - lowest priority)
//
// Both the primary barter pass and AUTO TRADE only ever move goods toward a
// genuine DEFICIT (getLargestDemandType / isCriticallyLowOn) - so two forts
// that are both fully stocked, just unevenly so (one sitting on a much
// bigger surplus of X than the other has of Y), never trade at all, even
// though evening that out is still a perfectly reasonable use of a
// merchant. Diffusion fills that gap: it only ever runs for a route where
// NEITHER of the two passes above dispatched anything this step (see the
// header comment on spawnMerchants()'s dispatchedAtoB/dispatchedBtoA/
// autoDispatchedBtoA/autoDispatchedAtoB), and only ever moves goods that
// were ALREADY surplus, never anything either fort still needs -
// deliberately the lowest priority of the three mechanisms.
//
// A pair (giveType from `giver`, receiveType from `receiver`) is a genuine
// diffusion opportunity if giver's RELATIVE surplus of giveType exceeds
// receiver's relative surplus of receiveType by at least
// DIFFUSION_RATIO_THRESHOLD (30%) - see relativeSurplus() below for why
// "relative" (100/50 counts as more surplus than 210/120, even though 210/
// 120 is bigger in absolute terms). Trading away the side with the bigger
// relative glut for the side with the smaller one is what actually evens
// the network out over repeated steps.
//
// Unlike the other two mechanisms, a diffusion trade requires a full
// MERCHANT_CAPACITY wagon on BOTH legs (not just MERCHANT_MIN_CARGO's 80%) -
// this is genuinely optional cargo shuffling, not urgent, so it only makes
// sense to bother once there's enough of a glut on both sides to fill the
// wagons completely.
// ---------------------------------------------------------------------------
const DIFFUSION_RATIO_THRESHOLD = 1.3;

// owned/desired for `type` at `fort`, but only when that's a genuine
// surplus (owned > desired) - 0 otherwise (no desired baseline, or no
// surplus at all), so a 0 result never accidentally wins a ratio
// comparison. Deliberately a ratio, not the absolute (owned - desired) gap
// fortSurplus() returns: 100/50 (2.0) counts as MORE surplus than 210/120
// (1.75), even though 210/120 has the bigger absolute cushion (90 vs 50).
function relativeSurplus(fort, type) {
  const desired = fort?.desiredResources?.[type] || 0;
  const owned = fort?.resources?.[type] || 0;
  if (desired <= 0 || owned <= desired) return 0;
  return owned / desired;
}

// The strongest diffusion opportunity where `giver` gives something and
// `receiver` gives something back - every (giveType, receiveType) pair
// across their respective surplus types, ranked by how far giveType's
// relative surplus at `giver` exceeds receiveType's at `receiver`. Returns
// null if nothing clears DIFFUSION_RATIO_THRESHOLD.
function findBestDiffusionPair(giver, receiver) {
  let best = null;
  FORT_RESOURCE_TYPES.forEach(giveType => {
    const giverRel = relativeSurplus(giver, giveType);
    if (giverRel <= 0) return;

    FORT_RESOURCE_TYPES.forEach(receiveType => {
      if (receiveType === giveType) return;
      const receiverRel = relativeSurplus(receiver, receiveType);
      if (receiverRel <= 0) return;

      const ratio = giverRel / receiverRel;
      if (ratio >= DIFFUSION_RATIO_THRESHOLD && (!best || ratio > best.ratio)) {
        best = { giveType, receiveType, ratio };
      }
    });
  });
  return best;
}

// Dispatches diffusion trade(s) for a route, lowest priority - see the
// header comment above. Tries both directions (fortX's glut for fortY's
// lesser one, and vice versa) and runs with whichever is the stronger
// match; loops up to routeLimit trips, same as the other two mechanisms,
// stopping the moment either side can no longer fill a full
// MERCHANT_CAPACITY wagon.
function attemptDiffusionTrade(fortX, fortY, routeLimit) {
  const xGivesToY = findBestDiffusionPair(fortX, fortY);
  const yGivesToX = findBestDiffusionPair(fortY, fortX);

  let giver, receiver, pair;
  if (xGivesToY && (!yGivesToX || xGivesToY.ratio >= yGivesToX.ratio)) {
    giver = fortX; receiver = fortY; pair = xGivesToY;
  } else if (yGivesToX) {
    giver = fortY; receiver = fortX; pair = yGivesToX;
  } else {
    return;
  }

  let sent = 0;
  while (sent < routeLimit && giver.population >= MERCHANT_PAIR_SIZE && receiver.population >= MERCHANT_PAIR_SIZE) {
    // Full wagons only, both ways - see the header comment above.
    if (fortSurplus(giver, pair.giveType) < MERCHANT_CAPACITY || fortSurplus(receiver, pair.receiveType) < MERCHANT_CAPACITY) break;

    if (!canDraftMerchantPair(giver) || !canDraftMerchantPair(receiver)) break; // confirm BOTH legs can be crewed before committing to either - see canDraftMerchantPair()'s comment

    draftMerchantPair(giver);
    giver.resources[pair.giveType] = roundResource(Math.max(0, (giver.resources[pair.giveType] || 0) - MERCHANT_CAPACITY));
    applyFortActionCost(giver, FORT_ACTION_COSTS.merchantEvent);
    S.events.push(makeMerchantEvent(giver.id, receiver.id, { [pair.giveType]: MERCHANT_CAPACITY }));

    draftMerchantPair(receiver);
    receiver.resources[pair.receiveType] = roundResource(Math.max(0, (receiver.resources[pair.receiveType] || 0) - MERCHANT_CAPACITY));
    applyFortActionCost(receiver, FORT_ACTION_COSTS.merchantEvent);
    S.events.push(makeMerchantEvent(receiver.id, giver.id, { [pair.receiveType]: MERCHANT_CAPACITY }));

    sent += 1;
  }
}

// ---------------------------------------------------------------------------
// MERCHANT HUNTING
//
// Real scouts and predators from a nest's own pools, just tasked against
// trade routes instead of the area around the nest. On purpose these reuse
// the actual 'search'/'hunt' event types (flagged `routeSearch`/`routeHunt`)
// with a real `nestId` - they DO count in scoutsWorking()/predatorsWorking()/
// totalInsects() while pending, DO get pulled out of S.scoutsAvailable/
// S.predatorsAvailable at dispatch (competing with normal search/hunt
// dispatch for the same pool), and DO carry the same death risk, subtracted
// from that same nest same as any other mission. The only things that
// differ are the target and, for the ambush, a hard cap on how many kills
// can matter. Both dispatch functions below are called from inside
// advanceNestStepLogic() (step 7, "dispatch NEXT step"), so `nest`/`nestId`
// there is always the real nest whose pools get drawn from; their matching
// resolution logic lives inline in advanceNestStepLogic() itself (not as
// standalone functions here) since it needs that function's own running
// per-step totals (killedScoutsThisStep, totalHuntDeaths, etc.) to fold into
// correctly instead of keeping a second, disconnected set of counters.
//
//   STEP N   - dispatchMerchantRouteScouts(nest), called right where normal
//              scout dispatch happens, rolls merchantRouteSearchChance() for
//              every route currently carrying a pending merchant; each win
//              pulls one real scout out of S.scoutsAvailable and sends it
//              out as a pending 'search' event (routeSearch: true,
//              targetRouteKey). No mark is placed yet - the scout has to
//              survive and report back first.
//
//   STEP N+1 - at the top of this nest's advanceNestStepLogic() call, that
//              pending routeSearch event resolves: same searchDeathRisk
//              roll as any other scout. Die, and that's it (counted into
//              killedScoutsThisStep like any other scout death). Survive,
//              and the route is marked, unconditionally - the eligibility
//              roll already happened at dispatch, there's no second
//              on-site success chance. The mark (a point at the route's
//              midpoint, farthest from both forts) is stored in
//              S.merchantRouteMarks - NOT as an event - so it survives the
//              per-step event purge and carries the dispatching nest's id
//              forward to whichever step its ambush comes due.
//
//              Also at this same step, dispatchMerchantRouteAmbushes(nest)
//              (called where normal hunt-group dispatch happens) consumes
//              any of THIS nest's marks whose ambush is due now, and - if
//              the nest can spare a full S.settings.groupSize predator
//              group from S.predatorsAvailable - sends it out as a pending
//              'hunt' event (routeHunt: true) against a random *currently
//              pending* merchant on that route (or against nothing, if the
//              route's empty this step; the mark is spent either way).
//
//   STEP N+2 - that pending routeHunt event resolves alongside this nest's
//              normal hunts: each of its groupSize predators rolls the same
//              huntChanceWithDistance()/huntDeathRisk as a normal hunt, but
//              successful kills stop counting past MERCHANT_PAIR_SIZE (2) -
//              there are only 2 humans on that merchant run to kill, so
//              further raider successes just have nothing left to hit.
//              Predator deaths still fold into this step's normal
//              totalHuntDeaths/predatorSurvivorsThisTick, same pool
//              accounting as any other hunt. The result (how many of the
//              pair survived) is written straight onto the targeted
//              merchant event; resolveMerchants() (below, unchanged) reads
//              it from there instead of defaulting to 'delivered'.
// ---------------------------------------------------------------------------

const MERCHANT_SEARCH_MIN_HUMANS_PER_MERCHANT = 10; // below this ratio, routes aren't searched for merchants at all
const MERCHANT_SEARCH_BASE_CHANCE = 0.30;
// Outside-fort human count (S.humans) the scarcity ramp is measured
// between - arbitrary bounds, tune freely. At/above PLENTIFUL the chance
// stays at the 30% base; at/below SCARCE it ramps up to 100%.
const MERCHANT_SEARCH_HUMANS_PLENTIFUL = 400;
const MERCHANT_SEARCH_HUMANS_SCARCE = 50;

// 0 if fewer than MERCHANT_SEARCH_MIN_HUMANS_PER_MERCHANT humans exist per
// currently-pending merchant pair; otherwise MERCHANT_SEARCH_BASE_CHANCE,
// ramping up toward 1 as S.humans (non-merchant humans outside forts) falls
// from PLENTIFUL toward SCARCE - fewer ordinary targets outside means more
// pressure gets redirected at the trade routes instead.
function merchantRouteSearchChance(pendingMerchantCount) {
  if (pendingMerchantCount <= 0) return 0;

  // When there are no ordinary humans outside forts, redirect
  // scout activity heavily toward road marking / ambush preparation.
  if (S.humans <= 0) return 1;

  if ((S.humans / pendingMerchantCount) < MERCHANT_SEARCH_MIN_HUMANS_PER_MERCHANT) return 0;

  const scarcity = Math.max(0, Math.min(1,
    (MERCHANT_SEARCH_HUMANS_PLENTIFUL - S.humans) /
    (MERCHANT_SEARCH_HUMANS_PLENTIFUL - MERCHANT_SEARCH_HUMANS_SCARCE)
  ));

  return Math.min(1, MERCHANT_SEARCH_BASE_CHANCE + scarcity * (1 - MERCHANT_SEARCH_BASE_CHANCE));
}

// The route's own curve midpoint - a simple, cheap stand-in for "as far from
// both forts as possible" (the two forts sit at the curve's two ends, so its
// middle sample point is where they're both farthest away).
function routeFarthestPointFromForts(route) {
  const curvePts = getRouteCurveWorldPoints(route);
  if (!curvePts || !curvePts.points || curvePts.points.length === 0) return null;
  const mid = curvePts.points[Math.floor(curvePts.points.length / 2)];
  return { x: mid.x, y: mid.y };
}

// True if `rKey` already has a claim on it from ANY nest - a scout
// currently en route to search it, a mark already sitting in
// S.merchantRouteMarks awaiting its ambush, or an ambush hunt group already
// out on it. Used by both dispatch functions below so only one nest is
// ever working a given route at a time: without this, two different nests
// could each independently mark and then ambush the SAME pending merchant
// in the same step, and since each ambush computes survivors from only its
// own kill count (see the routeHunt resolution block further down), a
// second ambush on an already-hit merchant would overwrite the first
// ambush's outcome instead of compounding with it - e.g. nest A kills 1
// (outcome 'delivered', 1 survivor), then nest B independently kills 1 more
// but recomputes from scratch and again sets 1 survivor, when the merchant
// should actually have 0 left. Not checking nestId here is intentional:
// this also stops a nest from re-marking/re-scouting a route it's already
// claimed itself, not just routes other nests hold.
function routeClaimedByAnyNest(rKey) {
  const scouting = S.events.some(e => e.type === 'search' && e.status === 'pending' && e.routeSearch && e.targetRouteKey === rKey);
  if (scouting) return true;

  const marked = (S.merchantRouteMarks || []).some(m => m.routeKey === rKey);
  if (marked) return true;

  return S.events.some(e => e.type === 'hunt' && e.status === 'pending' && e.routeHunt && e.routeKey === rKey);
}

// Dispatches this nest's merchant-route scouts for the step about to begin -
// see the header comment above. Draws from the SAME S.scoutsAvailable pool
// as the normal scout dispatch right after this call, so call this BEFORE
// that so the two genuinely compete for the same bodies.
function dispatchMerchantRouteScouts(nest) {
  const nestId = nest.id;
  const pendingMerchants = S.events.filter(e => e.type === 'merchant' && e.status === 'pending');
  if (pendingMerchants.length === 0) return;

  const chance = merchantRouteSearchChance(pendingMerchants.length);
  if (chance <= 0) return;

  // Every route currently carrying a merchant gets its own independent roll -
  // more than one scout can go out in the same step.
  const candidateRouteKeys = new Set(pendingMerchants.map(m => m.routeKey));

  candidateRouteKeys.forEach(rKey => {
    if (routeClaimedByAnyNest(rKey)) return; // another nest's scout/mark/hunt already has this route - leave it alone
    if (Math.random() >= chance) return;
    if ((S.scoutsAvailable || 0) < 1) return; // this nest has no scout to spare this step

    const route = (S.routes || []).find(r => routeKey(r.fortIdA, r.fortIdB) === rKey);
    if (!route) return;

    S.scoutsAvailable -= 1;

    const e = { id: nid(), type: 'search', status: 'pending', outcome: null, nestId, routeSearch: true, targetRouteKey: rKey };
    assignEventCoords(e);
    S.events.push(e);
  });
}

// Dispatches this nest's merchant-route ambushes for the step about to
// begin - consumes every one of THIS nest's route marks whose ambush is due
// now (see the header comment above). Draws a full S.settings.groupSize
// predator group from S.predatorsAvailable, same pool as a normal hunt
// group - call this alongside that dispatch (after the garrison reserve is
// already taken out), so the two compete fairly for what's left.
function dispatchMerchantRouteAmbushes(nest) {
  const nestId = nest.id;
  if (!S.merchantRouteMarks || S.merchantRouteMarks.length === 0) return;

  const dueMarks = S.merchantRouteMarks.filter(m => m.triggerStep === S.step && m.nestId === nestId);
  if (dueMarks.length === 0) return;
  // Consumed either way, whether or not this nest can actually spare a
  // group below - a mark only ever gets one shot at an ambush.
  S.merchantRouteMarks = S.merchantRouteMarks.filter(m => !(m.triggerStep === S.step && m.nestId === nestId));

  const groupSize = S.settings.groupSize;

  dueMarks.forEach(mark => {
    // The scout-stage guard (routeClaimedByAnyNest, above) should mean this
    // never actually happens - only one nest can ever hold a mark on a
    // given route - but this stays as a defensive last check per-route
    // right before spending predators on it, in case marks from a route
    // that no longer exists (e.g. a fort fell, routes were rebuilt) or
    // some other future caller ever bypasses that guard.
    const alreadyHunted = S.events.some(e => e.type === 'hunt' && e.status === 'pending' && e.routeHunt && e.routeKey === mark.routeKey);
    if (alreadyHunted) return;

    if ((S.predatorsAvailable || 0) < groupSize) return;
    S.predatorsAvailable -= groupSize;

    const candidates = S.events.filter(e => e.type === 'merchant' && e.status === 'pending' && e.routeKey === mark.routeKey);
    const target = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;

    S.events.push({
      id: nid(),
      type: 'hunt',
      status: 'pending',
      outcome: null,
      groupSize,
      neutralized: 0,
      killed: 0,
      nestId,
      routeHunt: true,
      routeKey: mark.routeKey,
      targetMerchantId: target ? target.id : null,
      x: mark.x,
      y: mark.y
    });
  });
}

// A merchant not targeted by any ambush this step never has its
// outcome/survivors touched (see the routeHunt resolution block inside
// advanceNestStepLogic), so it's still null by the time resolveMerchants()
// runs - this is what fills that in.
function determineMerchantOutcome(merchantEvent) {
  return 'delivered';
}

// Resolves every pending merchant: 'delivered' lands its cargo (in full,
// regardless of how many of the pair survived) and its survivors (1 or 2 -
// see MERCHANT HUNTING above for how less than the full pair can still get
// through) as population at the destination fort; 'hunted' (both of the
// pair killed) does nothing further - the cargo and the population were
// already spent at the origin fort back in spawnMerchants(), so a fully-
// hunted merchant simply vanishes with no additional bookkeeping. Runs once
// at the end of advanceStepLogic(), after every nest's route-hunt ambushes
// have already resolved.
function resolveMerchants() {
  S.events
    .filter(e => e.type === 'merchant' && e.status === 'pending')
    .forEach(e => {
      if (e.outcome == null) {
        e.outcome = determineMerchantOutcome(e);
        e.survivors = MERCHANT_PAIR_SIZE;
      }
      e.status = 'resolved';

      if (e.outcome === 'delivered') {
        const destFort = S.forts.find(f => f.id === e.toFortId);
        if (destFort) {
          if (!destFort.resources) destFort.resources = emptyResourceBundle();
          MERCHANT_RESOURCE_TYPES.forEach(type => {
            destFort.resources[type] = roundResource((destFort.resources[type] || 0) + (e.cargo[type] || 0));
          });
          const survivors = e.survivors != null ? e.survivors : MERCHANT_PAIR_SIZE;
          destFort.population = (destFort.population || 0) + survivors;
          // Arriving merchants settle in as merchantWorkers, not generic
          // population - they're a permanent vocation (see MERCHANT AS A
          // FIXED VOCATION above) and must stay re-dispatchable as
          // merchants for free (draftMerchantPair()'s draw order #1)
          // instead of being swept into a production job or counted as
          // idle by the next autoAllocateFortWorkers() pass.
          destFort.merchantWorkers = (destFort.merchantWorkers || 0) + survivors;
        }
      }
    });
}

// ---------------------------------------------------------------------------
// FOOD CONSUMPTION & STARVATION
//
// Every fort's population eats 1 food/person/step, drawn from that fort's
// own resources.food (topped up this same step by produceFortResources(),
// if the fort has enough food workers staffed - see
// autoAllocateFortWorkers() below). A fort that can't fully feed
// everyone spends what food it has and tracks fort.unfedStreak, the number
// of CONSECUTIVE steps it's come up short; once that streak reaches
// STARVATION_THRESHOLD_STEPS, this step's hungry headcount (population minus
// however many the available food could actually feed) starts dying off,
// for as long as the shortfall keeps going.
// ---------------------------------------------------------------------------
const STARVATION_THRESHOLD_STEPS = 3;

// Runs once per step (see advanceStepLogic()), after produceFortResources().
function consumeFortFood() {
  S.forts.forEach(fort => {
    if (!fort.alive) return;

    // Population is always a whole number of people. Rounding it and
    // writing the clean value straight BACK to fort.population (not just
    // reading a rounded local copy) matters - previously a fractional
    // `unfed` shortfall (see below) could get subtracted straight from
    // fort.population and leave it permanently non-integer, which is
    // exactly how a displayed population (or food total) ends up looking
    // like "194.60000000000002" and can even appear to inconsistently
    // rise step to step, purely from where Math.round happens to land on
    // a drifted value - not from any actual growth.
    fort.population = Math.max(0, Math.round(fort.population || 0));
    const population = fort.population;
    if (population <= 0) { fort.unfedStreak = 0; return; }
    if (!fort.resources) fort.resources = emptyResourceBundle();

    // Food only feeds WHOLE people - floor it before comparing/consuming
    // so the shortfall below (`unfed`) is always a clean integer, never a
    // fraction of a person.
    const available = Math.floor(fort.resources.food || 0);

    if (available >= population) {
      fort.resources.food = roundResource((fort.resources.food || 0) - population);
      fort.unfedStreak = 0;
      return;
    }

    // Not enough to go around - eat what there is, the rest goes hungry.
    const unfed = population - available;
    fort.resources.food = 0;
    fort.unfedStreak = (fort.unfedStreak || 0) + 1;

    if (fort.unfedStreak >= STARVATION_THRESHOLD_STEPS) {
      const deaths = Math.min(population, unfed);
      if (deaths > 0) {
        fort.population = Math.max(0, population - deaths);
        log(t('log.fort_starvation_deaths', { id: fort.id, count: deaths }) !== 'log.fort_starvation_deaths'
          ? t('log.fort_starvation_deaths', { id: fort.id, count: deaths })
          : `Pevnosť ${fort.id}: ${deaths} ľudí zomrelo od hladu.`);
      }
    }
  });
}

// The smallest number of food workers whose resourceProductionForWorkers()
// output covers a population of this size (1 food/person/step) - used by
// autoAllocateFortWorkers() so a fort always breaks even on food first,
// before anything else. Capped at `population` itself (never assign more
// food workers than there are people).
function minWorkersForFoodBalance(population) {
  const pop = Math.max(0, Math.round(population || 0));
  if (pop <= 0) return 0;
  let workers = 0;
  while (workers < pop && resourceProductionForWorkers(workers) < pop) workers++;
  return workers;
}

function minWorkersForFoodBalanceWithHybrids(fort) {
  const population = Math.max(0, Math.round(fort?.population || 0));
  const hybridFood =
    (fort?.hybrids || 0) *
    (FORT_ACTION_COSTS.sustainHybrid?.food || 0);

  return minWorkersForFoodBalance(population + hybridFood);
}

// ---------------------------------------------------------------------------
// AUTO WORKER ALLOCATION (fort.autoWorkers, ON by default - this IS the
// default worker allocation now, not just an opt-in extra)
//
// A one-shot re-plan of fort.workers across at most 3 resource types,
// triggered by autoAllocateFortWorkers() below - every fort creation site
// (script.js) that doesn't have an explicitly-authored split, the AUTO
// toggle in the fort resources overlay, and once per step for every fort
// with it enabled (see applyAutoWorkerAllocations(), called from
// advanceStepLogic() right after produceFortResources()/consumeFortFood(),
// so each re-plan reacts to what this step's production/consumption just
// did to the fort's stock). It always starts from a clean slate (every
// type zeroed first) rather than nudging the existing split - a genuine
// re-plan each time, not an incremental adjustment.
//
// The whole point is to only ever assign workers to something SOMEBODY
// genuinely lacks - either this fort itself, or a fort it could trade
// with - never to whichever type happens to sort first when nobody
// reachable actually needs it:
//
//   1. FOOD gets minWorkersForFoodBalance(population) workers - just
//      enough to cover this fort's own population.
//   2. Whatever's left (population - food workers) goes toward up to two
//      more resource types, chosen from GENUINE deficits only (desired >
//      owned - see sortedDeficitTypes()) at every step below, never
//      falling back to "whichever type is least in surplus":
//        a) If this fort has its own deficit, X (the biggest one): a
//           DIRECTLY connected fort (S.routes - the actual trade
//           neighborhood merchants travel along) with genuine surplus of
//           X is a real trade partner for it. If that partner ALSO has a
//           genuine deficit somewhere, Y, this fort produces Y instead of
//           X - the thing it can actually trade back for X. Otherwise
//           (no such partner, or the partner that has X doesn't need
//           anything back) this fort just produces X itself. Either way,
//           the fort's own SECOND-highest genuine deficit (if it has one)
//           takes the other half of the remaining workers.
//        b) If this fort has no deficit of its own beyond food, there's
//           nothing to search a trade partner for - instead it looks at
//           what its connected neighbors need most in aggregate
//           (mostWantedTypeAcrossNeighbors()) and produces that, so the
//           extra hands still build toward a future trade instead of
//           idling or stocking something nobody around can use.
//        c) If nothing anywhere reachable has a genuine deficit, the
//           remaining workers just go to food as a safe, always-useful
//           fallback rather than being assigned to a resource nobody
//           needs.
//   3. Finally, MERCHANT WORKER RESERVATION (see its own header comment
//      just below sortedDeficitTypes()/mostWantedTypeAcrossNeighbors()
//      further down) pulls some of step 2's non-food workers back into
//      unemployed, sized to next step's estimated trade opportunities and
//      capped by food surplus - otherwise every worker stays on a job
//      forever and unemployedPopulation() (what spawnMerchants() actually
//      draws merchants from) never has anyone in it.
// ---------------------------------------------------------------------------

// Every FORT_RESOURCE_TYPES entry `fort` genuinely lacks (desired > owned)
// other than `exclude`, sorted by biggest gap first. A type `fort` already
// has enough of (or more) never appears here - that's what keeps this from
// ever pointing at "whichever resource happens to be least in surplus".
// Pass exclude=null to consider every type (used for a trade partner's own
// need, where food isn't off the table).
function sortedDeficitTypes(fort, exclude) {
  const hybridCount = fort?.hybrids || 0;

  return FORT_RESOURCE_TYPES
    .filter(type => type !== exclude)
    .map(type => {
      const hybridUpkeep =
        hybridCount * (FORT_ACTION_COSTS.sustainHybrid?.[type] || 0);

      const target =
        (fort.desiredResources?.[type] || 0) + hybridUpkeep;

      return {
        type,
        deficit: target - (fort.resources?.[type] || 0)
      };
    })
    .filter(entry => entry.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit)
    .map(entry => entry.type);
}



// Alive forts directly connected to `fort` by an existing route - the same
// trade neighborhood spawnMerchants() draws from.
function connectedForts(fort) {
  if (!fort) return [];
  return (S.routes || [])
    .filter(route => route.fortIdA === fort.id || route.fortIdB === fort.id)
    .map(route => S.forts.find(f => f.id === (route.fortIdA === fort.id ? route.fortIdB : route.fortIdA)))
    .filter(other => other && other.alive);
}

// Among `fort`'s directly connected forts, whichever has the biggest
// surplus (fortSurplus) of `type`, or null if none has any.
function bestConnectedSurplusSource(fort, type) {
  let best = null;
  connectedForts(fort).forEach(other => {
    const surplus = fortSurplus(other, type);
    if (surplus > 0 && (!best || surplus > best.surplus)) best = { fort: other, surplus };
  });
  return best ? best.fort : null;
}

// The single resource type most in demand among `fort`'s directly
// connected neighbors - summed genuine (desired > owned) deficit across
// all of them, highest total wins - or null if none of them need
// anything. Used when `fort` has no deficit of its own to chase: producing
// whatever a neighbor could actually use is still useful groundwork for a
// future trade, unlike producing something nobody around has any use for.
function mostWantedTypeAcrossNeighbors(fort) {
  const totals = {};
  connectedForts(fort).forEach(other => {
    FORT_RESOURCE_TYPES.forEach(type => {
      const deficit = (other.desiredResources?.[type] || 0) - (other.resources?.[type] || 0);
      if (deficit > 0) totals[type] = (totals[type] || 0) + deficit;
    });
  });
  let best = null;
  Object.keys(totals).forEach(type => {
    if (!best || totals[type] > totals[best]) best = type;
  });
  return best;
}

// ---------------------------------------------------------------------------
// MERCHANT WORKER RESERVATION (folded into autoAllocateFortWorkers() below)
//
// autoAllocateFortWorkers() commits workers PERMANENTLY (see its own header
// comment below) - so instead of a job it can later pull workers back from,
// this reservation just means: don't commit every last newly-available body
// this call, hold some of them back as unemployed so spawnMerchants() has
// someone to actually send next step, no matter how good a trade
// opportunity looks (see unemployedPopulation()'s own header comment
// above).
//
// DEMAND ESTIMATE (estimateMerchantWorkerDemand/fortWouldSendMerchantTo):
// for every directly connected fort (S.routes - the same trade neighborhood
// spawnMerchants() itself draws from), a genuine match where THIS fort
// would be the one sending (spending its own population) counts - either
// this fort's surplus is the neighbor's single biggest demand
// (getLargestDemandType, spawnMerchants()'s primary match), or - if AUTO
// TRADE is on - the neighbor is critically short of something this fort
// can spare (autoTradeDirection()'s rule). Only the SENDING direction is
// counted (never the receiving one), so the same route isn't double-counted
// once from each fort's own reservation pass. Each matched neighbor reserves
// exactly one merchant pair (MERCHANT_PAIR_SIZE workers) - just enough to
// get that trade relationship moving at all next step, not an attempt to
// size toward spawnMerchants()'s full per-route ceiling
// (S.settings.merchantLimit); next step's real spawnMerchants() decides how
// much actually moves once workers are there to send.
//
// MIN_INITIAL_MERCHANT_RESERVE: a fort's very first allocation (fort
// creation - see autoAllocateFortWorkers()'s `isInitial` option) happens
// before S.routes even exists, so the demand estimate above is always 0 at
// that point - there's nothing to match against yet. isInitial writes this
// onto fort.minUnemployedReserve ONCE, as a PERMANENT standing floor from
// then on (not just a one-time nudge) - every later auto-allocation call
// keeps enforcing it too, alongside whatever the demand estimate currently
// wants. Without it, a fort could commit its way down past this floor over
// time as it re-plans newly-grown population, right when a real trade match
// finally shows up and there's nobody left free to send.
// ---------------------------------------------------------------------------
const MIN_INITIAL_MERCHANT_RESERVE = 4;

// True if `fort` would be the ORIGIN of at least one merchant trip to
// `neighbor` next step, under either the primary barter match or (if
// enabled) AUTO TRADE - mirrors spawnMerchants()'s/autoTradeDirection()'s
// own match conditions, but only checks whether a trip is possible in
// principle (a genuine surplus/demand pairing exists), not how many units
// would actually move.
function fortWouldSendMerchantTo(fort, neighbor) {
  const neighborWant = getLargestDemandType(neighbor);
  if (neighborWant && neighborWant.type && fortSurplus(fort, neighborWant.type) > 0) return true;

  if (S.settings.autoTradeEnabled) {
    const autoTradeType = FORT_RESOURCE_TYPES.find(type =>
      isCriticallyLowOn(neighbor, type) && autoTradeSellable(fort, type) > 0
    );
    if (autoTradeType) return true;
  }

  return false;
}

// Estimated merchant PAIRS `fort` could plausibly need to send next step -
// see the header comment above. One pair per connected neighbor `fort`
// would genuinely be the origin for. Returns a worker headcount (pairs *
// MERCHANT_PAIR_SIZE), ready to compare directly against a worker pool.
function estimateMerchantWorkerDemand(fort) {
  let matchedNeighbors = 0;
  connectedForts(fort).forEach(neighbor => {
    if (fortWouldSendMerchantTo(fort, neighbor)) matchedNeighbors += 1;
  });
  return matchedNeighbors * MERCHANT_PAIR_SIZE;
}

// Commits any of `fort`'s population not already assigned to a job -
// WORKERS ARE PERMANENT once committed: this only ever ADDS to
// fort.workers[type], never reduces or moves an existing assignment
// (matches adjustFortWorkers() in script.js, which is "+1 only" for the
// same reason). So each call only has newly-available bodies to place -
// population growth (a merchant pair delivered, a fort just built) is what
// creates something for a later call to actually do; a fort at 100%
// committed simply does nothing here until its population grows again.
//
// Precedence for those newly-available bodies:
//   1. Top up food, if this fort's (possibly grown) population now needs
//      more than what's already committed there (minWorkersForFoodBalance) -
//      existing food workers are never touched, only ever added to.
//   2. MERCHANT WORKER RESERVATION - see the header comment above. Held
//      back as unemployed, not committed to anything.
//   3. Whatever's left goes toward this fort's own biggest and (if any)
//      second-biggest genuine deficit - or, lacking any deficit of its own,
//      toward producing whatever a directly-connected neighbor could
//      actually use (mostWantedTypeAcrossNeighbors) - or, lacking either,
//      towards whatever THAT trade partner itself needs in return, so the
//      new production is something tradeable rather than a dead end
//      (bestConnectedSurplusSource). If truly nothing is needed anywhere
//      reachable, the remainder just stays unemployed - a permanently-
//      committed worker sitting idle forever with nothing useful to
//      produce isn't better than one that's simply available (and a future
//      trade opportunity can still put an unemployed body to work; a
//      committed one no longer can).
//
// `options.isInitial` (fort creation only - see MIN_INITIAL_MERCHANT_RESERVE
// above) establishes fort.minUnemployedReserve as a PERMANENT standing
// floor from then on, not just a one-time nudge for this call.
function autoAllocateFortWorkers(fort, options) {
  if (!fort || !fort.alive) return;
  if (!fort.resources) fort.resources = emptyResourceBundle();
  if (!fort.desiredResources) fort.desiredResources = defaultDesiredResourceLevels();
  if (!fort.workers) fort.workers = emptyFortResourceCounters();
  if (!fort.production) fort.production = emptyFortResourceCounters();

  const population = Math.max(0, Math.round(fort.population || 0));
  // merchantWorkers is a separate, permanent vocation (see MERCHANT AS A
  // FIXED VOCATION above) - excluded here for the same reason
  // unemployedPopulation() excludes it, so this function's own notion of
  // "how many bodies are actually free to plan with" stays consistent with
  // that: without this, a fort with committed merchants would look like it
  // has MORE free population than it really does, and could over-assign
  // production jobs on top of bodies that have already permanently left.
  const alreadyCommitted = FORT_RESOURCE_TYPES.reduce((sum, type) => sum + (fort.workers[type] || 0), 0) + (fort.merchantWorkers || 0);
  let available = Math.max(0, population - alreadyCommitted);

  // Establishes fort.minUnemployedReserve ONCE, at creation - a PERMANENT
  // standing floor from then on (see MIN_INITIAL_MERCHANT_RESERVE), not
  // just a one-time nudge on this call. Every later call (isInitial unset)
  // still enforces it below, alongside whatever estimateMerchantWorkerDemand()
  // currently wants - so a fort can never auto-commit its way down past this
  // floor, no matter how many times it re-plans as population grows.
  if (options && options.isInitial) {
    fort.minUnemployedReserve = MIN_INITIAL_MERCHANT_RESERVE;
  }

  if (available > 0) {
    const foodTarget = Math.min(
      population,
      minWorkersForFoodBalanceWithHybrids(fort)
    );
    const additionalFood = Math.max(0, foodTarget - (fort.workers.food || 0));
    const foodToCommit = Math.min(additionalFood, available);
    if (foodToCommit > 0) {
      fort.workers.food += foodToCommit;
      available -= foodToCommit;
    }
  }

  if (available > 0) {
    const reserve = Math.min(available, Math.max(estimateMerchantWorkerDemand(fort), fort.minUnemployedReserve || 0));
    available -= reserve;
  }

  if (available > 0) {
    const ownNeeds = sortedDeficitTypes(fort, 'food'); // genuine deficits only, biggest first
    const top1 = ownNeeds[0] || null;
    const top2 = ownNeeds[1] || null;

    let targetA = null;
    let targetB = null;

    if (top1) {
      const partner = bestConnectedSurplusSource(fort, top1);
      const partnerNeed = partner ? (sortedDeficitTypes(partner, null)[0] || null) : null;
      // Produce what the partner genuinely needs (tradeable back for X) if
      // such a partner exists; otherwise just produce X itself.
      targetA = partnerNeed || top1;
      targetB = top2; // this fort's own second-biggest genuine need, if it has one
    } else {
      // Nothing of its own to chase - fall back to a neighbor's need.
      targetA = mostWantedTypeAcrossNeighbors(fort);
    }

    if (targetA && targetB && targetA !== targetB) {
      const halfA = Math.floor(available / 2);
      fort.workers[targetA] = (fort.workers[targetA] || 0) + halfA;
      fort.workers[targetB] = (fort.workers[targetB] || 0) + (available - halfA);
    } else if (targetA) {
      fort.workers[targetA] = (fort.workers[targetA] || 0) + available;
    }
    // Nothing needed anywhere reachable - the remainder stays unemployed,
    // see the header comment above for why that's fine now.
  }

  FORT_RESOURCE_TYPES.forEach(type => {
    fort.production[type] = roundResource(resourceProductionForWorkers(fort.workers[type] || 0));
  });
}

// Runs once per step (see advanceStepLogic()), after produceFortResources()
// has already applied THIS step's output from the PREVIOUS allocation -
// autoAllocateFortWorkers() commits any newly-available workers (population
// growth since last time - see its own header comment) for every
// fort.autoWorkers=true fort, ready for next step's production. Existing
// commitments are never touched.
function applyAutoWorkerAllocations() {
  S.forts.forEach(fort => {
    if (fort.alive && fort.autoWorkers) autoAllocateFortWorkers(fort);
  });
}

// ---------------------------------------------------------------------------
// FORT ACTION RESOURCE COSTS
//
// Flat resource costs (on top of whatever AP cost the action already has),
// attached to specific fort actions/events. A couple also carry a minimum-
// BEFORE the action is attempted, not deducted) and/or a `lossRisk` (an
// extra chance, on top of the flat cost, of losing one more unit of some
// resource - `count` independent rolls when more than one is at risk, e.g.
// a merchant pair each separately risking their weapon). All arbitrary
// starting numbers - tune freely.
// ---------------------------------------------------------------------------
const FORT_ACTION_COSTS = {
  reinforceFort: {materials: 50, fuel: 10, food: 20 },
  increaseFortCapacity: { materials: 40, fuel: 20, food: 30},
  merchantEvent: { fuel: 5, food: 3, ammo: 20},
  sustainHybrid: { ammo: 10, fuel: 5, food: 4}
};

// Deducts costDef's flat FORT_RESOURCE_TYPES amounts from fort.resources
// (floored at 0 - a fort that can't fully afford the flat cost still pays
// what it has, same "spend what's there" spirit as food consumption above),
// - that's a precondition callers check first, via
// meetsFortActionRequirement(), not something this deducts.
function applyFortActionCost(fort, costDef) {
  if (!fort || !costDef) return;
  if (!fort.resources) fort.resources = emptyResourceBundle();

  FORT_RESOURCE_TYPES.forEach(type => {
    const amount = costDef[type];
    if (!amount) return;
    fort.resources[type] = roundResource(Math.max(0, (fort.resources[type] || 0) - amount));
  });

  if (costDef.lossRisk) {
    const { type, chance, count } = costDef.lossRisk;
    const rolls = Math.max(1, count || 1);
    for (let i = 0; i < rolls; i++) {
      if (Math.random() < chance) {
        fort.resources[type] = roundResource(Math.max(0, (fort.resources[type] || 0) - 1));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SCAVENGE
//
// A cheap (SCAVENGE_AP_COST AP), no-resource-cost fort action - unlike
// every FORT_ACTION_COSTS entry above, this one only ever GIVES resources,
// never spends them, so it doesn't belong in that table and has no
// meetsFortActionRequirement() precondition to check. Picks
// SCAVENGE_RESOURCE_COUNT distinct resource types at random and adds a
// random 0-SCAVENGE_MAX_AMOUNT of each straight into the fort's reserves.
// ---------------------------------------------------------------------------
const SCAVENGE_AP_COST = 1;
const SCAVENGE_RESOURCE_COUNT = 3;
const SCAVENGE_MAX_AMOUNT = 20; // inclusive - each picked type gets a random 0-20

// Mutates fort.resources in place and returns [{type, amount}, ...] - the
// amount ACTUALLY added per picked type, after clamping to
// FORT_RESOURCE_CAPS (so scavenging can't push a resource over its cap;
// a type that was already full or nearly full can legitimately come back
// with amount: 0 or a small leftover). Picks without replacement, so the
// same type is never rolled twice in one scavenge.
function applyFortScavenge(fort) {
  if (!fort) return [];
  if (!fort.resources) fort.resources = emptyResourceBundle();

  const pool = FORT_RESOURCE_TYPES.slice();
  const pickCount = Math.min(SCAVENGE_RESOURCE_COUNT, pool.length);
  const pickedTypes = [];
  for (let i = 0; i < pickCount; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    pickedTypes.push(pool.splice(idx, 1)[0]);
  }

  return pickedTypes.map(type => {
    const roll = Math.floor(Math.random() * (SCAVENGE_MAX_AMOUNT + 1));
    const cap = FORT_RESOURCE_CAPS[type] || 0;
    const before = fort.resources[type] || 0;
    const after = Math.min(cap, roundResource(before + roll));
    fort.resources[type] = after;
    return { type, amount: roundResource(after - before) };
  });
}

// Pure, read-only estimate of this step's NET production for `type` at
// `fort` - this step's production minus only the fully deterministic,
// always-recurring drains: food eaten by the fort's own population (1/
// person/step - the only exactly-known case), and ammo/fuel eaten by
// hosted hybrids' sustainHybrid upkeep. Deliberately does NOT account for
// merchant departures, action costs, or lossRisk rolls - those are
// conditional/one-off, not a guaranteed per-step drain, so folding them in
// would turn a simple "here's the trend" figure into a guess dressed up as
// a number. Used by the fort marker's hover "peek" tooltip (script.js) so
// the player can gauge a fort's trajectory at a glance without opening the
// full resources overlay - never mutates state, safe to call every render/
// hover.
function estimateFortResourceNet(fort, type) {
  if (!fort) return 0;
  const production = (fort.production && fort.production[type]) || 0;

  if (type === 'food') {
    return roundResource(production - Math.max(0, fort.population || 0));
  }
  if (type === 'ammo' || type === 'fuel') {
    const perHybrid = (FORT_ACTION_COSTS.sustainHybrid && FORT_ACTION_COSTS.sustainHybrid[type]) || 0;
    return roundResource(production - (fort.hybrids || 0) * perHybrid);
  }
  return roundResource(production);
}

// True if `fort` currently satisfies costDef's requirements to actually go
// through with the action: every flat FORT_RESOURCE_TYPES amount the
// action would charge must actually be on hand (applyFortActionCost()
// itself only floors at 0 and doesn't check this - "spend what's there" is
// fine for a cost that's already been committed to, but not good enough to
// let the player trigger the action in the first place). A fort with no
// resources bundle yet, or missing entirely, never meets a requirement
// that needs one.
function meetsFortActionRequirement(fort, costDef) {
  if (!costDef) return true;
  if (!fort || !fort.resources) return false;

  for (let i = 0; i < FORT_RESOURCE_TYPES.length; i++) {
    const type = FORT_RESOURCE_TYPES[i];
    const amount = costDef[type];
    if (amount && (fort.resources[type] || 0) < amount) return false;
  }

  return true;
}

// Per-fort weight for distributeHybridsAcrossForts() below: how many
// consecutive sustainHybrid upkeep cycles the fort's CURRENT resources
// could cover on their own (the tightest resource type wins, same
// "worst case" logic as meetsFortActionRequirement), plus its total
// assigned workers - a fort that's actually staffed and producing is a
// better place to station hybrids than a barely-populated one, even if
// its current stockpile happens to be larger right now.
function hybridHostingWeight(fort) {
  if (!fort || !fort.resources) return 0.0001; // never fully zero - every alive fort still gets some share

  let sustainCycles = Infinity;
  FORT_RESOURCE_TYPES.forEach(type => {
    const perHybrid = FORT_ACTION_COSTS.sustainHybrid[type];
    if (!perHybrid) return;
    sustainCycles = Math.min(sustainCycles, (fort.resources[type] || 0) / perHybrid);
  });
  if (!Number.isFinite(sustainCycles)) sustainCycles = 0;

  const workers = fort.workers
    ? FORT_RESOURCE_TYPES.reduce((sum, type) => sum + (fort.workers[type] || 0), 0)
    : 0;

  return Math.max(0.0001, sustainCycles + workers);
}

// Spreads `totalCount` hybrids across every alive fort, weighted by
// hybridHostingWeight() above - forts better equipped to sustain them (more
// spare resources relative to sustainHybrid's cost, more workers) end up
// hosting proportionally more. Called once at game setup (see
// initGame()/generateMapElements() in script.js) to place a level's
// starting hybrid count, if any - hybrids hired afterward go straight to
// whichever fort the player picks (see hireAtFort() in script.js), no
// redistribution involved. Uses the largest-remainder method so the total
// assigned always matches `totalCount` exactly rather than drifting from
// repeated flooring.
function distributeHybridsAcrossForts(totalCount) {
  const forts = (S.forts || []).filter(f => f.alive);
  forts.forEach(f => { f.hybrids = 0; });
  if (totalCount <= 0 || forts.length === 0) return;

  const weights = forts.map(hybridHostingWeight);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;

  const raw = weights.map(w => totalCount * (w / totalWeight));
  const shares = raw.map(Math.floor);
  let remaining = totalCount - shares.reduce((sum, s) => sum + s, 0);

  const byRemainder = raw
    .map((value, i) => ({ i, frac: value - shares[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remaining; k++) {
    shares[byRemainder[k % byRemainder.length].i] += 1;
  }

  forts.forEach((fort, i) => { fort.hybrids = shares[i]; });
}

// Whether `fort` could still afford sustainHybrids() for every hybrid it
// currently hosts PLUS one more, against its resources right now - the cap
// hireAtFort() (script.js) uses to decide whether hiring another hybrid at
// this fort is even offered. A snapshot check against current stock, same
// spirit as meetsFortActionRequirement() - it doesn't try to project next
// step's production, just "can you cover this many, right now".
function canSustainOneMoreHybrid(fort) {
  if (!fort || !fort.resources) return false;
  const projectedCount = (fort.hybrids || 0) + 1;
  return FORT_RESOURCE_TYPES.every(type => {
    const perHybrid = FORT_ACTION_COSTS.sustainHybrid[type];
    if (!perHybrid) return true;
    return (fort.resources[type] || 0) >= perHybrid * projectedCount;
  });
}

// Per-step upkeep for every hybrid the player has hired, now tied to
// whichever fort they're actually stationed at (fort.hybrids - see
// distributeHybridsAcrossForts()/hireAtFort()) rather than one lump sum
// charged to a single "capital". Each fort pays FORT_ACTION_COSTS.
// sustainHybrid once per hybrid IT hosts; a hybrid whose fort can't afford
// its share when its turn comes up leaves (fort.hybrids -1, same as if it
// had died) and costs the player 1 AP as well - it does NOT relocate or
// return to any pool. A fort with 0 hybrids, or a dead fort, is skipped.
function sustainHybrids() {
  (S.forts || []).forEach(fort => {
    if (!fort.alive) return;
    const count = fort.hybrids || 0;
    if (count <= 0) return;

    for (let i = 0; i < count; i++) {
      if (fort.hybrids <= 0) break; // every hybrid this fort started the step with has already left

      if (!meetsFortActionRequirement(fort, FORT_ACTION_COSTS.sustainHybrid)) {
        fort.hybrids = Math.max(0, (fort.hybrids || 0) - 1);
        // This has to hit maxPoints, not points: advanceStepLogic() resets
        // S.points = S.maxPoints a few lines after sustainHybrids() runs,
        // in this SAME step - a plain S.points decrement here would be
        // wiped out before the player ever sees it, making a hybrid
        // starving to death a silent, consequence-free event instead of
        // the permanent AP loss it's supposed to be (the exact inverse of
        // what hireAtFort() grants - see its own S.maxPoints += 1).
        S.maxPoints = Math.max(1, (S.maxPoints || 1) - 1);
        S.points = Math.min(S.points, S.maxPoints);
        log(t('log.hybrid_starved', { id: fort.id }) !== 'log.hybrid_starved'
          ? t('log.hybrid_starved', { id: fort.id })
          : `Pevnosť ${fort.id}: hybrid odišiel, nedostatok zásob (-1 AP).`);
        continue;
      }

      applyFortActionCost(fort, FORT_ACTION_COSTS.sustainHybrid);
    }
  });
}

function freshState(){
  const state = {
    step: 0,
    points: 10,
    maxPoints: 10,
    phase: 'idle', // idle | active
    humans: 200,
    humansKilled: 0,
    conditions: [],
    lastTriggeredCondition: null,
    settings: {
      lang: 'sk', // 'en' | 'sk'
      // Lowered from 5: with a smaller hunt group, predatorsAvailable/groupSize stops
    // being the usual bottleneck on how many hunt parties get dispatched each turn,
    // which pushes successfulSearches (i.e. how many scouts the defender let through)
    // to be the binding constraint far more often. That's the point - killing or
    // distracting scouts should visibly shrink the number of hunts that go out, not
    // get absorbed by slack in the predator-side cap.
    groupSize: 5, foodPerHuman: 7, maxPoints: 10, eggsPerSearch: 2,
      // How many hybrids exist (see distributeHybridsAcrossForts(), called
      // from script.js's fort setup) before the player hires any more -
      // defaults to matching maxPoints, i.e. the whole starting AP pool is
      // hybrids already stationed across the map on day one, weighted by
      // which forts can best sustain them (hybridHostingWeight()). A
      // campaign level can override this (or hand-author each fort's own
      // f.hybrids directly) independently of maxPoints.
      startingHybrids: 10,
      eggCap: 20, eggsPerFood: 1,
      searchBaseChance: 0.9, searchRatioScale: 0.25,
      huntBaseChance: 0.9, huntRatioScale: 0.25,
      huntDeathRisk: 0.3, searchDeathRisk: 0.4,
      scoutBiasPerFailedSearch: 1,
      predatorBiasPerFailedSearch: 1, predatorBiasPerUnoccupiedHuntingSlot: 1,
      fortLimit: 10,
      defaultFortDefense: 50,
      fortFoodLow: 2, fortFoodHigh: 5, fortHumanLow: 1, fortHumanHigh: 3,
      fortDistLow: 15, fortDistHigh: 70,
      fortPredatorThreshold: 50, fortAttackThreshold: 5,
      scoutMarkChance: 0.8, fortMarkThreshold: 3,
      fortCapacityIncreaseAmount: 5, costIncreaseFortCapacity: 1,
      fortReinforceCost: 4, fortReinforceDefenseBonus: 10,
      costDistractScout: 1, costKillScout: 2, costEscapePredator: 2, costKillPredator: 3,
      // Killing a predator that's already committed to attacking a fort is
      // cheaper than killing one out in the open (costKillPredator above) -
      // it's cornered against the fort's own defenses rather than free to
      // maneuver, so it's deliberately a separate, lower-cost setting.
      costKillFortAttacker: 2,
      costSaveHumans: 1, saveHumansAmount: 2, costScan: 1,
      merchantLimit: 3,
      // See AUTO TRADE further down: relaxes barter to one-sided trades
      // when a fort is critically short (<70%) of something a neighbor has
      // surplus of, even if that neighbor doesn't need anything back.
      // Off by default - opt-in via the Settings panel toggle.
      autoTradeEnabled: false,
      costNestAnalytics: 1,
      // Attacking a nest directly is pricier than killing the same unit
      // type mid-event (costKillPredator/costKillScout above), so these are
      // deliberately separate settings rather than reusing those.
      costAttackNestPredator: 4, costAttackNestScout: 3,
      costKillNymph: 3, costAttackQueen: 6,
      queenFoodReserveCap: 300,
      startQueenReserve: 300, // defaults to full reserve (== queenFoodReserveCap above)
      minPopulationThreshold: 70,
      nestCount: DEFAULT_NEST_COUNT, // how many rival nests to generate in sandbox/random levels
      // Chance that a combat/field action ALSO costs an extra 1 AP beyond its normal
      // cost - "your soldier gets killed" doing it. Deliberately does not cover
      // Scan/Hire/Build fort/Reinforce fort/Increase fort capacity: those aren't
      // combat, nobody's exposed to a counterattack doing them. See
      // rollSoldierLoss() for how these get applied.
      apLossRiskAttackNest: 0.20,
      apLossRiskKillPredator: 0.15,
      apLossRiskSaveHumans: 0.12,
      apLossRiskEscapeHunt: 0.10,
      apLossRiskDefendFort: 0.08,
      apLossRiskDistractScout: 0.04,
      apLossRiskKillScout: 0.04,
      apLossRiskKillMarkingScout: 0.02
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
    merchantRouteMarks: [], // pending route-search results awaiting next step's ambush - see MERCHANT HUNTING
    routes: [], // derived/rebuilt by regenerateRoutes() - see ROUTE FRAMEWORK below; not hand-authored, not saved
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

const SEARCH_MIN_DIST_FROM_NEST = 20; // >= the general anti-overlap minDistance below, so this ring's inner edge isn't fighting the overlap check
const SEARCH_NEAR_MAX_DIST = 36;
const SEARCH_FAR_MAX_DIST = 210;
const SEARCH_LOW_HUMANS_THRESHOLD = 1;
const SEARCH_HIGH_HUMANS_THRESHOLD = 250;

function searchRingMaxDist(humans) {
  const h = Number(humans) || 0;
  if (h <= SEARCH_LOW_HUMANS_THRESHOLD) return SEARCH_FAR_MAX_DIST;
  if (h >= SEARCH_HIGH_HUMANS_THRESHOLD) return SEARCH_NEAR_MAX_DIST;
  const t = (h - SEARCH_LOW_HUMANS_THRESHOLD) / (SEARCH_HIGH_HUMANS_THRESHOLD - SEARCH_LOW_HUMANS_THRESHOLD);
  return SEARCH_FAR_MAX_DIST + (SEARCH_NEAR_MAX_DIST - SEARCH_FAR_MAX_DIST) * t;
}

function assignEventCoords(e) {
  const MARGIN_X = 3;  // Left/Right side margin (x: 3 to 97)
  const MARGIN_Y = 10; // Top/Bottom edge margin (y: 10 to 90)
  const minDistance = 18; // Minimum percentage distance between map elements
  let bestCand = null;
  let maxMinDist = -1;

  // Search events are ringed around their own nest; everything else (hunt
  // fallback, etc.) keeps the old map-wide placement.
  const searchNest = (e.type === 'search' && e.nestId && S.nests)
    ? S.nests.find(n => n.id === e.nestId)
    : null;
  const searchMaxDist = searchNest ? Math.max(SEARCH_MIN_DIST_FROM_NEST, searchRingMaxDist(S.humans || 0)) : null;

  for (let attempt = 0; attempt < 300; attempt++) {
    let cand;
    if (searchNest) {
      const minR = SEARCH_MIN_DIST_FROM_NEST;
      const maxR = searchMaxDist;
      const r = Math.sqrt(minR * minR + Math.random() * (maxR * maxR - minR * minR));
      const theta = Math.random() * Math.PI * 2;
      // Convert the real-unit offset back into x/y percentages, undoing the
      // same WORLD_ASPECT_RATIO correction dist() applies.
      const x = searchNest.x + (r * Math.cos(theta)) / WORLD_ASPECT_RATIO;
      const y = searchNest.y + r * Math.sin(theta);
      cand = {
        x: Math.floor(Math.min(100 - MARGIN_X, Math.max(MARGIN_X, x))),
        y: Math.floor(Math.min(100 - MARGIN_Y, Math.max(MARGIN_Y, y)))
      };
    } else {
      cand = {
        x: Math.floor(MARGIN_X + Math.random() * (100 - 2 * MARGIN_X)),
        y: Math.floor(MARGIN_Y + Math.random() * (100 - 2 * MARGIN_Y))
      };
    }

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

function getFortPredatorStrength(targetFort, fromNest) {
  if (!targetFort) return 3;
  const d = dist(fromNest || S.nest, targetFort);
  return getFortStrengthAtDistance(d);
}

function conquestDeathPct(ratio){
  if (!isFinite(ratio) || ratio >= 2) return 0.1;
  if (ratio <= 0.5) return 0.7;
  const frac = (ratio - 0.5) / 1.5;
  return 0.8 - frac * 0.7;
}

// ---------------------------------------------------------------------------
// CONQUEST KILL RATE
//
// How many attacking insects a fort actually kills during an assault used
// to be driven entirely by the damage/defense ratio (conquestDeathPct()
// above), with the fort's ammo stock only acting as a hard CAP on top of
// that result (availableAmmo, in the assault-resolution block further
// down) - a fort with plenty of defense but little ammo could still be
// credited with a kill rate its ammo could never have actually funded.
// Ammo is now the PRIMARY driver instead: conquestAmmoKillFraction() below
// turns ammo-per-attacking-insect directly into a kill fraction (5% at 1
// ammo/insect or less, up to 80% at 20 ammo/insect or more). Defense still
// matters, via defenseAmplifier() below, but only as a secondary nudge on
// top of that - a much narrower swing than ammo's own ~16x range between
// its floor and ceiling.
// ---------------------------------------------------------------------------
const CONQUEST_AMMO_MIN_RATIO = 1;   // ammo/insect at or below this -> the floor kill fraction
const CONQUEST_AMMO_MAX_RATIO = 20;  // ammo/insect at or above this -> the ceiling kill fraction; also the most ammo/insect a fort ever plans to spend - see the assault block further down
const CONQUEST_AMMO_MIN_KILL_FRACTION = 0.05;
const CONQUEST_AMMO_MAX_KILL_FRACTION = 0.80;

function conquestAmmoKillFraction(ammoPerInsect) {
  if (!isFinite(ammoPerInsect) || ammoPerInsect <= CONQUEST_AMMO_MIN_RATIO) return CONQUEST_AMMO_MIN_KILL_FRACTION;
  if (ammoPerInsect >= CONQUEST_AMMO_MAX_RATIO) return CONQUEST_AMMO_MAX_KILL_FRACTION;
  const frac = (ammoPerInsect - CONQUEST_AMMO_MIN_RATIO) / (CONQUEST_AMMO_MAX_RATIO - CONQUEST_AMMO_MIN_RATIO);
  return CONQUEST_AMMO_MIN_KILL_FRACTION + frac * (CONQUEST_AMMO_MAX_KILL_FRACTION - CONQUEST_AMMO_MIN_KILL_FRACTION);
}

// A multiplier centered on 1 (not a standalone percentage the way
// conquestDeathPct() reads on its own), so defense can only nudge the
// ammo-driven kill fraction above up or down by
// CONQUEST_DEFENSE_AMPLIFIER_SWING - never dominate it the way the old
// damage/defense ratio used to by itself. Reuses conquestDeathPct()'s
// existing 0.1 (defense overwhelmed) .. 0.8 (defense dominant) curve as
// the underlying signal for "how favorably is this fight going for the
// defense", just rescaled into that narrower band.
const CONQUEST_DEFENSE_AMPLIFIER_SWING = 0.15; // +-15%
function defenseAmplifier(ratio) {
  const raw = conquestDeathPct(ratio); // 0.1..0.8
  const normalized = (raw - 0.1) / 0.7; // 0..1
  return (1 - CONQUEST_DEFENSE_AMPLIFIER_SWING) + normalized * (2 * CONQUEST_DEFENSE_AMPLIFIER_SWING);
}

// Pure, read-only projection of what resolving `e` (a pending 'fort'
// assault event) against `targetFort` would compute right now, as seen
// from `fromNest`'s position - the exact same formula the actual
// resolution below applies, factored out into one place so the "predicted
// damage" shown when the player opens the assault's event details
// (getEventDetailsHTML, script.js) can never silently drift out of sync
// with it again the way it previously did: that preview used to call
// getFortPredatorStrength(targetFort) bare, which read distance from
// whichever nest the PLAYER currently has active in the UI rather than
// the nest actually making THIS attack (e.nestId) - two easily different
// nests at very different distances from the fort, and distance is what
// drives predator strength, so a mismatch there could make the preview
// wildly mis-state the damage about to land, in either direction.
// Returns null if there's nothing meaningful to project (fort already
// gone/fallen). Still only an ESTIMATE beyond that fix, same as any
// preview of a live simulation: ammo/defense/remaining attackers can all
// still change between viewing this and the event actually resolving
// (other assaults, player actions, worker reallocation, ...).
function estimateFortAssaultOutcome(e, targetFort, fromNest) {
  if (!targetFort || !targetFort.alive) return null;
  const s = S.settings;
  const remaining = Math.max(0, e.originalAttackers - e.killed);
  const d = dist(fromNest || S.nest, targetFort);

  // % distance = how far along the close->far scale (fortDistLow..High)
  // the fort sits; farther forts bleed more attackers on the way in.
  const distanceFraction = 1 - fortFactorPct(d, s.fortDistLow, s.fortDistHigh);
  const attritionDeaths = Math.round(remaining * 0.01 * distanceFraction);
  const reaching = Math.max(0, remaining - attritionDeaths);

  const predStrength = getFortStrengthAtDistance(d);
  const defenseBefore = targetFort.defense;

  // First pass: how threatening this assault looks BEFORE accounting for
  // how many attackers die mid-fight - used only to size the kill
  // fraction below (ratio -> defenseAmplifier()). The ACTUAL damage
  // applied to defense further down deliberately does NOT use this raw
  // figure - see effectiveAttackers.
  const rawDamage = reaching * predStrength;
  const ratio = defenseBefore > 0 ? rawDamage / defenseBefore : Infinity;

  // Ammo drives how many attackers actually die here now - see the
  // CONQUEST KILL RATE section above. ammoSpendable never plans to
  // earmark more than CONQUEST_AMMO_MAX_RATIO ammo per attacker even
  // out of a huge stockpile - past that point more ammo doesn't kill
  // that one insect any deader, so there's no reason to let 200 ammo
  // all get credited toward killing a single attacker.
  const ammoStock = Math.max(0, targetFort.resources?.ammo || 0);
  const ammoSpendable = Math.min(ammoStock, reaching * CONQUEST_AMMO_MAX_RATIO);
  const ammoPerInsect = reaching > 0 ? ammoSpendable / reaching : 0;
  const killFraction = Math.min(1, conquestAmmoKillFraction(ammoPerInsect) * defenseAmplifier(ratio));
  const combatDeaths = Math.round(reaching * killFraction);

  const lostInAssault = Math.min(remaining, attritionDeaths + combatDeaths);

  // Second pass: the damage actually charged against the fort's defense.
  // Attackers the fort killed this round (lostInAssault) didn't all land
  // a full hit first - some died before ever reaching the wall, others
  // plausibly got their hit in before going down - so rather than assume
  // either extreme, only half of them count toward the damage tally.
  // The more a fort's defenders kill, the less its walls take this round.
  // Rounded here, at the one place totalDamage is computed - both the
  // preview (getEventDetailsHTML, script.js) and the actual resolution
  // below just destructure outcome.totalDamage, so rounding it once here
  // is what keeps them showing/applying the exact same whole number
  // instead of each risking its own separate float.
  const effectiveAttackers = Math.max(0, reaching - lostInAssault / 2);
  const totalDamage = Math.round(effectiveAttackers * predStrength);

  return {
    remaining, reaching, attritionDeaths, combatDeaths, lostInAssault,
    predStrength, defenseBefore, ammoStock, ammoSpendable,
    effectiveAttackers, totalDamage
  };
}

function searchChanceWithDistance(loc) {
  const ratio = ratioHumansPerInsect();
  const base = successChance(S.settings.searchBaseChance, S.settings.searchRatioScale, ratio);

  // Once humans get scarce relative to the colony's own insect population
  // (fewer than 2 humans per insect), search success shouldn't just plateau
  // at the base chance - there's genuinely less prey to find, so failure
  // should become *much* more likely as the ratio keeps falling below that
  // point. Squaring how far below the 2:1 threshold the ratio has fallen
  // (normalized to that threshold) gives a steep falloff while leaving
  // ratio >= 2 (humans still plentiful relative to insects) unpenalized.
  const SCARCITY_ONSET_RATIO = 1;
  const scarcityMultiplier = ratio >= SCARCITY_ONSET_RATIO
    ? 1
    : Math.max(0, ratio / SCARCITY_ONSET_RATIO) ** 2;

  const scarcityAbs = S.humans <= 150 
    ? ((150 - S.humans) / 100) 
    : 0;

  const target = loc || S.nest;

  const dFort = getNearestAliveFortDistance(target);
  const fortBonus = (dFort === Infinity) ? 0 : Math.max(0, (50 - dFort) / 50) * 0.5;

  const adjusted = base * scarcityMultiplier * (1 + fortBonus - scarcityAbs);
  console.log('adjusted:' + adjusted + 'scarcityabs:' + scarcityAbs + 'fortbonus:' + fortBonus);
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

const MARKING_SWARM_SIZE = 15; // max scouts that can be in flight toward one fort at once
const SCOUT_FORT_DISTANCE = 5; // same positioning convention as predator icons around a fort

// The ring only has this many physical icon positions, regardless of
// MARKING_SWARM_SIZE - a scout's slot id maps onto one of these via `% 
// MARKING_RING_SIZE` (see markingScoutSlotPosition in script.js), so several
// slots can share the same ring position and render as one icon together.
// This is what keeps the display from getting crowded even with up to
// MARKING_SWARM_SIZE scouts in flight: 3 scouts -> 3 icons, 5 -> 5, 15 ->
// still only 5 (the ring's positions all filled, each shared by ~3 scouts).
const MARKING_RING_SIZE = 5;

// Marking scouts share a ring position (and its one icon) with any other
// slot that maps to the same position - see MARKING_RING_SIZE above and
// markingScoutSlotPosition in script.js.

function maxMarkingScoutsForFort(f) {
  return MARKING_SWARM_SIZE;
}

function maybeMarkFortsFromSearch(markerCount) {
  if (markerCount <= 0) return [];

  const nestId = S.nest.id;

  const candidates = S.forts.filter(
    f =>
      f.alive &&
      !fortMark(f, nestId).marked &&
      (fortMark(f, nestId).markingScoutCount || 0) < maxMarkingScoutsForFort(f) &&
      (f.population || 0) > 0
  );

  if (candidates.length === 0) return [];

  const newlyDispatched = []; // scouts sent to attempt a mark, not confirmed successes

  // Scouts dispatched to the same fort within this call are folded into a
  // single group event (like fort attackers sharing one event) rather than
  // getting one event each - this map tracks the still-open group event per
  // fort, keyed by fort id, for the duration of this call only.
  const openGroupByFortId = new Map();

  for (let i = 0; i < markerCount; i++) {

    // Eligibility here doesn't depend on fort readiness - any alive,
    // unmarked, populated fort with an open ring slot is fair game. Which
    // one gets picked is a plain distance-weighted random draw (same shape
    // as pickTargetFort for the attack side) - scouts don't get to reason
    // about a fort's readiness (food/human/predator scarcity) before
    // setting out, only how far away it is.
    const eligible = candidates.filter(
      f =>
        !fortMark(f, nestId).marked &&
        (fortMark(f, nestId).markingScoutCount || 0) < maxMarkingScoutsForFort(f)
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

    // Fort readiness doesn't gate whether a fort can be attempted, and every
    // fort gets the same ring size (see maxMarkingScoutsForFort) - its only
    // role here was picking which fort gets marked first, just above. It
    // does NOT affect whether an attempt actually succeeds either: success
    // is a flat, readiness-independent roll made later, when the group's
    // event resolves at the end of the step (see the fortMarkScout
    // resolution block in advanceNestStepLogic).

    // Claim a ring slot for this scout - capacity is still tracked per
    // individual scout (maxMarkingScoutsForFort), even though scouts headed
    // to the same fort this call share one visible group/event.
    const pickedMark = fortMark(picked, nestId);
    pickedMark.markingScoutCount = (pickedMark.markingScoutCount || 0) + 1;

    // Stable, individual ring-slot id for this scout: 0..(MARKING_SWARM_SIZE-1),
    // reusing markingScoutCount's post-increment value (just bumped above) as
    // a free, collision-proof id - it only ever grows while scouts targeting
    // this fort are in flight, and is freed in lockstep with them (see the
    // fortMarkScout resolution block in advanceNestStepLogic, and the
    // mark-expiry reset below). Kept separate from groupSize/killed, which
    // stay untouched here since combat resolution elsewhere still depends on
    // that whole-wave bookkeeping.
    const slot = pickedMark.markingScoutCount - 1;

    let group = openGroupByFortId.get(picked.id);

    if (group) {
      // Another scout joining the same in-flight wave toward this fort.
      group.groupSize += 1;
      if (!Array.isArray(group.scoutSlots)) group.scoutSlots = [];
      group.scoutSlots.push({ slot, hidden: true });
    } else {
      // First scout of a new wave toward this fort this call. The icon(s)
      // representing this wave stay hidden (no map render, no walk-out
      // animation) until scanForHidden() reveals them - same idea as the
      // generic S.scoutsHidden pool, just with a mission already attached.
      group = {
        id: nid(),
        type: 'search',
        status: 'pending',
        outcome: null,
        nestId,

        // Special scout wave whose only purpose is to mark a fort.
        fortMarkScout: true,
        targetFortId: picked.id,

        // Number of scouts represented by this single event/icon-group, and
        // how many of them the player has personally killed so far - same
        // groupSize/killed convention as hunt and fort events.
        groupSize: 1,
        killed: 0,

        // One entry per individually alive-and-unkilled scout in this wave,
        // each tracking its own hidden/revealed state and fixed ring slot -
        // see the render/scan/kill logic in script.js that reads this
        // instead of one aggregate `hidden` flag per wave.
        scoutSlots: [{ slot, hidden: true }],

        hidden: true,

        // Anchor position for the (single) hidden reveal marker - once
        // revealed, rendering computes one or more icon positions around
        // the fort based on how many scouts remain (see the map render
        // code), same as fort attacker icons.
        x: Math.max(
          3,
          Math.min(97, picked.x + SCOUT_FORT_DISTANCE / WORLD_ASPECT_RATIO)
        ),
        y: Math.max(3, Math.min(97, picked.y))
      };

      S.events.push(group);
      openGroupByFortId.set(picked.id, group);
    }

    newlyDispatched.push(picked);
  }

  return newlyDispatched;
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

function successChance(base, ratioScale, ratio){
  return Math.min(0.9, Math.max(0, base + ratio*ratioScale));
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

function aliveNestCount(){
  return S.nests ? Math.max(1, S.nests.filter(n => n.alive).length) : 1;
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

// --------------------------- min nest defenders ---------------------------
// Baseline defense: what it already costs, in Attack Nest points, to kill
// everything resting at home - predators/scouts on cooldown, plus nymphs.
// (20 points is roughly what it costs to fight through to the queen - 26
// including her.) If that baseline is already worth at least 20 points, the
// nest is safe enough to send every available predator and scout out;
// otherwise it holds back a reserve of available predators and scouts
// (about 3 predators per scout) before dispatching either pool.
const MIN_GARRISON_POINTS = 20;
const GARRISON_PREDATOR_SCOUT_RATIO = 3; // predators per scout in the held-back reserve

function baselineNestDefense(){
  const s = S.settings;
  return S.predatorsCooldown * s.costAttackNestPredator +
    S.scoutsCooldown * s.costAttackNestScout +
    sumCohort(S.nymph) * s.costKillNymph;
}

// How many of this nest's *available* predators/scouts should stay home
// this step rather than being dispatched to hunt/search.
function nestGarrisonReserve(){
  const shortfall = MIN_GARRISON_POINTS - baselineNestDefense();
  if (shortfall <= 0) return { predators: 0, scouts: 0 };

  const s = S.settings;
  const pointsPerUnit = GARRISON_PREDATOR_SCOUT_RATIO * s.costAttackNestPredator + s.costAttackNestScout;
  const units = Math.ceil(shortfall / Math.max(1, pointsPerUnit));

  return {
    predators: Math.min(S.predatorsAvailable, units * GARRISON_PREDATOR_SCOUT_RATIO),
    scouts: Math.min(S.scoutsAvailable, units)
  };
}

// Priority for idle predators, after nest defense (nestGarrisonReserve) has
// already taken its cut: hunting gets first claim (see the hunt dispatch in
// advanceNestStepLogic, which runs BEFORE this function each step), and
// whatever's left afterward attacks instead of sitting idle. There's only
// ever one call of this per nest per step, so "join an existing attack" and
// "launch a new one" collapse into the same thing here - see the big
// comment below for why a genuinely separate "reinforce an attack already
// in flight from a previous turn" case can't occur.
function maybeTriggerFort() {
  const nestId = S.nest.id;
  // Everything not needed for defense and not claimed by this step's hunt
  // dispatch (see advanceNestStepLogic, which calls this AFTER hunts) ends
  // up here.
  const idlePredators = S.predatorsAvailable;
  if (idlePredators <= 0) return;

  // NOTE: there is deliberately no "is there already a pending fort assault
  // to reinforce" check here. By the time this runs each turn, any assault
  // dispatched on a *previous* turn has already been resolved earlier in
  // this exact same advanceNestStepLogic() call (see "resolve fort assault"
  // above) - so a check like that can never find anything and was dead
  // code. Since this function only ever runs once per nest per step and
  // always spends every leftover predator it's given, "join an existing
  // attack" and "launch a new one" are the same action here: whatever's
  // left after hunts becomes (or reinforces, if this ever changes to allow
  // multiple calls per step) this step's one attack.
  const targetFort = pickTargetFort();
  if (!targetFort) return; // nothing marked to attack - leftover just stays idle this step

  const readiness = fortReadiness(targetFort);

  // Scarcity factors are purely descriptive now (the log's "why" text) -
  // they used to also gate/weight whether an attack happened at all, but
  // that's simpler now: any predator with no defense duty and no hunt slot
  // attacks, full stop.
  const foodScarcity = Math.max(0, Math.min(1, readiness.foodPct));
  const wildHumans = S.humans || 0;
  const targetHumanThreshold = 10;
  const humanScarcity = Math.max(0, Math.min(1, 1 - (wildHumans / targetHumanThreshold)));

  const attackers = idlePredators;
  S.predatorsAvailable -= attackers;

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
  if (humanScarcity > 0.5) reasons.push(t('fort_trigger.humans_hidden'));
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

const HUMAN_MOBILITY_MIN = -10;
const HUMAN_MOBILITY_MAX = 10;
const HUMAN_MOBILITY_FLEE_RATIO = 0.5;   // humans/insects <= this (i.e. >=2 insects per human) => full flee bias
const HUMAN_MOBILITY_RETURN_RATIO = 4;   // humans/insects >= this (>=4 humans per insect) => full return bias
const HUMAN_MOBILITY_RATIO_MAX_WEIGHT = 600; // max weight the humans:insects ratio factor can add to a candidate value's weight, at full bias
const HUMAN_MOBILITY_POP_MAX_WEIGHT = 300;   // max weight the absolute insect-population factor can add - about half of the ratio factor's cap
const HUMAN_MOBILITY_POP_SATURATION = 200;   // total insects (all nests, previous step) at/above which the population factor is fully maxed out
const HUMAN_MOBILITY_LOW_POP_THRESHOLD = 50; // total insects (all nests, previous step) below which a "few insects left" return bias kicks in
const HUMAN_MOBILITY_LOW_POP_MAX_WEIGHT = 900; // max weight the low-population return bias can add, reached at 0 insects - bigger than the ratio factor's cap so it can override even a full flee-ratio bias

// The humans:insects ratio recorded at the end of the previous step (the
// last entry already pushed to S.history) - or null before any step has run.
function previousHumanInsectRatio(){
  if (!S.history || S.history.length === 0) return null;
  const prev = S.history[S.history.length - 1];
  if (!prev.insects || prev.insects <= 0) return Infinity; // no insects around last step = totally safe
  return prev.humans / prev.insects;
}

function previousTotalInsects(){
  if (!S.history || S.history.length === 0) return null;
  return S.history[S.history.length - 1].insects;
}

function humanMobilityBias(ratio){
  if (ratio === null) return 0; // no history yet: neutral/uniform draw
  if (!isFinite(ratio)) return 1;
  if (ratio <= 0) return -1;
  const lowLog = Math.log(HUMAN_MOBILITY_FLEE_RATIO);
  const highLog = Math.log(HUMAN_MOBILITY_RETURN_RATIO);
  const t = (Math.log(ratio) - lowLog) / (highLog - lowLog);
  return Math.max(-1, Math.min(1, 2 * t - 1));
}

function humanMobilityPopulationBias(totalInsectsPrev){
  if (totalInsectsPrev === null || totalInsectsPrev <= 0) return 0;
  return -Math.max(0, Math.min(1, totalInsectsPrev / HUMAN_MOBILITY_POP_SATURATION));
}

// Independent of the ratio: once the insect population (all nests, previous
// step) drops below HUMAN_MOBILITY_LOW_POP_THRESHOLD, humans start feeling
// safe to return regardless of how the humans:insects ratio looks (e.g. 0
// humans vs a handful of insects still reads as a hostile ratio). Scales
// from 0 at the threshold up to 1 at 0 insects - the fewer insects, the
// stronger the pull to return.
function humanMobilityLowPopulationBias(totalInsectsPrev){
  if (totalInsectsPrev === null) return 0;
  if (totalInsectsPrev >= HUMAN_MOBILITY_LOW_POP_THRESHOLD) return 0;
  const remaining = Math.max(0, totalInsectsPrev);
  return Math.max(0, Math.min(1, (HUMAN_MOBILITY_LOW_POP_THRESHOLD - remaining) / HUMAN_MOBILITY_LOW_POP_THRESHOLD));
}

function rollHumanMobility(ratioBias, populationBias, lowPopulationBias){
  const values = [];
  const weights = [];
  let totalWeight = 0;
  for (let v = HUMAN_MOBILITY_MIN; v <= HUMAN_MOBILITY_MAX; v++) {
    const vFrac = v / HUMAN_MOBILITY_MAX;
    const ratioContribution = ratioBias * vFrac * HUMAN_MOBILITY_RATIO_MAX_WEIGHT;
    const populationContribution = populationBias * vFrac * HUMAN_MOBILITY_POP_MAX_WEIGHT;
    const lowPopulationContribution = lowPopulationBias * vFrac * HUMAN_MOBILITY_LOW_POP_MAX_WEIGHT;
    const w = Math.max(0.01, 1 + ratioContribution + populationContribution + lowPopulationContribution);
    values.push(v);
    weights.push(w);
    totalWeight += w;
  }
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < values.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return values[i];
  }
  return values[values.length - 1];
}

function humanCountPluralKey(base, count){
  const n = Math.abs(count);
  if (n === 1) return `${base}_singular`;
  if (n >= 2 && n <= 4) return `${base}_few`;
  return `${base}_many`;
}

function applyHumanMobility(){
  const ratioBias = humanMobilityBias(previousHumanInsectRatio());
  const populationBias = humanMobilityPopulationBias(previousTotalInsects());
  const lowPopulationBias = humanMobilityLowPopulationBias(previousTotalInsects());
  const mobility = rollHumanMobility(ratioBias, populationBias, lowPopulationBias);
  S.humanMobility = mobility;
  S.humans = Math.max(0, S.humans + mobility);
  if (mobility < 0) {
    const count = -mobility;
    log(t(humanCountPluralKey('log.humans_left', count), { count }));
  } else if (mobility > 0) {
    const count = mobility;
    log(t(humanCountPluralKey('log.humans_returned', count), { count }));
  }
  return mobility;
}

function advanceStepLogic(){
  if(S.gameOver) return;
  S.events = S.events.filter(e=>e.status==='pending');
  S.selectedEventId = null;

  spawnMerchants(); // sent out at the beginning of the step - see MERCHANT FRAMEWORK

  applyHumanMobility();

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
    advanceNestStepLogic(nest); // also dispatches/resolves this nest's merchant-route scouts and ambushes - see MERCHANT HUNTING
  });

  S.activeNestIndex = S.focusedNestIndex || 0;

  S.history.push({step:S.step, humans:S.humans, insects: totalInsectsAll(), insectsByNest: insectsByNestSnapshot(), adultInsects: totalAdultInsectsAll(), adultInsectsByNest: adultInsectsByNestSnapshot()});

  // Total humans anywhere - outside, plus inside any fort that's still
  // standing (a conquered fort's population is already released back into
  // S.humans above, so this isn't double counting). Checking population
  // rather than fort-alive status means an empty, never-evacuated fort
  // can't singlehandedly block defeat.
  const totalHumansEverywhere = S.humans + S.forts.reduce((sum, f) => sum + (f.alive ? (f.population || 0) : 0), 0);
  const allNestsGone = S.nests.every(n => !n.alive);

  if (totalHumansEverywhere <= 0) {
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

  resolveMerchants();
  produceFortResources();
  consumeFortFood();
  applyAutoWorkerAllocations(); // re-plans workers for any fort.autoWorkers=true fort, off updated stock
  sustainHybrids();

  S.step += 1;
  S.points = S.maxPoints;
  S.reinforcedForts = []; // a fort can be reinforced again once the new step begins

  selectNextPendingEvent();
}

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

  // killedScoutsThisStep counts every individual scout death this step,
  // whether it's a lone searching scout (outcome 'killed' below) or part of
  // a fort-marking wave (each wave can lose some scouts to player kills or
  // natural death risk without the whole wave outcome being 'killed') -
  // feeds processLifecycle's scoutBias later in this same step, so nymph
  // maturation reacts to losses regardless of which duty the scout was on.
  let killedScoutsThisStep = 0;

  // Resolve marking-scout waves. Each event now represents a whole group of
  // scouts (see maybeMarkFortsFromSearch) - scouts the player has already
  // killed (e.killed) are removed first, then the remaining scouts each
  // roll natural death risk, then any survivors each roll a mark-success
  // chance (first success marks the fort). The group can be killed some,
  // but cannot be distracted.
  S.events
    .filter(e => e.type === 'search' && e.fortMarkScout && e.status === 'pending' && e.nestId === nestId)
    .forEach(e => {
      const targetFort = S.forts.find(f => f.id === e.targetFortId);

      e.status = 'resolved';

      // Free up this whole wave's slots in the fort's marking swarm/ring at
      // once - other waves (from a different call/step) may still be in flight.
      if (targetFort) {
        const mark = fortMark(targetFort, nestId);
        mark.markingScoutCount = Math.max(0, (mark.markingScoutCount || 0) - e.groupSize);
      }

    const playerKilledScouts = e.killed || 0;
    const afterPlayerKills = Math.max(0, e.groupSize - playerKilledScouts);

    // Roll death risk (double the rate of standard search death risk) for
    // each scout still standing.
    const markDeathRisk = Math.min(1, S.settings.searchDeathRisk * 1.2);
    let naturalDeaths = 0;
    for (let i = 0; i < afterPlayerKills; i++) {
      if (Math.random() < markDeathRisk) naturalDeaths++;
    }
    killedScoutsThisStep += playerKilledScouts + naturalDeaths;
    const survivors = afterPlayerKills - naturalDeaths;
      if (survivors <= 0) {
        // Whole wave is gone, whether by the player's hand or bad luck.
        e.outcome = 'killed';
        return;
      }

      if (!targetFort || !targetFort.alive) return;

      // Success is a flat chance (S.settings.scoutMarkChance) per surviving
      // scout, independent of fort readiness - readiness only ever affected
      // whether this wave was dispatched to attempt in the first place (see
      // maybeMarkFortsFromSearch). First survivor to succeed marks the fort.
      let marked = false;
      for (let i = 0; i < survivors; i++) {
        if (Math.random() < S.settings.scoutMarkChance) { marked = true; break; }
      }

      if (!marked) {
        e.outcome = 'mark_failed';
        return;
      }

      const mark = fortMark(targetFort, nestId);
      // Another wave may have already marked this fort - only log it the
      // first time, but let this wave still refresh the visible timer.
      if (!mark.marked) {
        mark.marked = true;
        log(`Hniezdo ${nestId}: skaut označil pevnosť ${targetFort.id} ako cieľ na dobytie.`);
      }

      mark.markedUntilStep = S.step + 2;
      mark.markedAttackDispatched = false;

      e.outcome = 'fort_marked';
    });

    // Resolve merchant-route scouting. Each event here is exactly one real
    // scout, pulled from S.scoutsAvailable at dispatch time (see
    // dispatchMerchantRouteScouts, called in step 7 below) - same pool, same
    // per-scout death risk as an ordinary searching scout. A scout that
    // survives always successfully marks its route: the eligibility/chance
    // roll already happened back at dispatch (merchantRouteSearchChance),
    // there's no separate on-site success check the way a normal search has.
    // See MERCHANT HUNTING (further up) for the full lifecycle.
    S.events
      .filter(e => e.type === 'search' && e.routeSearch && e.status === 'pending' && e.nestId === nestId)
      .forEach(e => {
        e.status = 'resolved';

        // Mirrors the normal-search pattern below: killScout()/distractScout()
        // may already have decided this scout's fate before this resolution
        // ever runs - respect that instead of re-rolling over it, the same
        // way the ordinary search block only rolls `if (!e.outcome)`.
        if (e.outcome === 'killed') {
          killedScoutsThisStep += 1;
          return;
        }
        if (e.outcome === 'distracted') {
          return; // survives, but was pulled off-task - route stays unmarked
        }

        if (Math.random() < Math.min(1, S.settings.searchDeathRisk + enemyProximityDeathRisk(e, nestId))) {
          e.outcome = 'killed';
          killedScoutsThisStep += 1;
          return;
        }

        e.outcome = 'route_marked';

        const route = (S.routes || []).find(r => routeKey(r.fortIdA, r.fortIdB) === e.targetRouteKey);
        const point = route ? routeFarthestPointFromForts(route) : null;
        if (!route || !point) return;

        if (!S.merchantRouteMarks) S.merchantRouteMarks = [];
        S.merchantRouteMarks.push({
          id: nid(),
          routeKey: e.targetRouteKey,
          fortIdA: route.fortIdA,
          fortIdB: route.fortIdB,
          x: point.x,
          y: point.y,
          triggerStep: S.step + 1, // S.step hasn't been incremented for this step yet - "+1" is genuinely next step
          nestId // whose predators get first crack at dispatching the ambush - see dispatchMerchantRouteAmbushes
        });
      });

    // nonDeathFailures mirrors naturalFailures but excludes the 'killed'
    // outcome (a scout that died on this search) - decisions that should
    // react to "a scout came back empty-handed" (next-step fort-marking
    // demand, the predator/scout maturation bias) care about failures where
    // the colony still has a scout to redirect, not ones where the scout is
    // simply gone. 'distracted' (player pulled the scout off-task) still
    // counts as a non-death failure - the scout survives, it just didn't
    // search.
    let successfulSearches = 0, naturalFailures = 0, nonDeathFailures = 0, activeSearchers = 0;
    // Sum of THIS event's own death risk (base searchDeathRisk + its own
    // enemyProximityDeathRisk(), since each scout searched its own spot)
    // for every natural-failure event below - replaces the old flat
    // `naturalFailures * searchDeathRisk` multiplication, which had no way
    // to account for some scouts having searched closer to a big enemy
    // nest than others. killedScouts (further down) is now this sum,
    // rounded, instead of that flat product.
    let searchDeathRiskSum = 0;

    S.events
      .filter(e =>
        e.type === 'search' &&
        !e.fortMarkScout &&
        !e.routeSearch &&
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
          nonDeathFailures++;
          searchDeathRiskSum += Math.min(1, S.settings.searchDeathRisk + enemyProximityDeathRisk(e, nestId));
          return; // Skip food search success, but keep activeSearchers count
        }

        const searchChance = searchChanceWithDistance(e);
        if (!e.outcome) {
          // Per-scout roll, not a population-wide switch: searchChance is
          // never below 0.5 while any humans remain (base 0.5 + a
          // non-negative ratio term), so a deterministic "0.5 < searchChance"
          // check here would make every scout succeed every tick until
          // humans hit exactly 0 - starving naturalFailures (and anything
          // downstream of it, like fort-marking demand) of any real signal
          // for the whole game. Rolling per scout instead means each one
          // independently fails ~ (1 - searchChance) of the time, so
          // naturalFailures stays a meaningful, gradually-varying count
          // throughout, not just at population collapse.
          if (Math.random() < searchChance) { e.outcome = 'succeeded'; successfulSearches++; }
          else {
            e.outcome = 'failed'; naturalFailures++; nonDeathFailures++;
            searchDeathRiskSum += Math.min(1, S.settings.searchDeathRisk + enemyProximityDeathRisk(e, nestId));
          }
        } else if (e.outcome === 'distracted' || e.outcome === 'killed') {
          naturalFailures++;
          if (e.outcome === 'distracted') nonDeathFailures++;
          searchDeathRiskSum += Math.min(1, S.settings.searchDeathRisk + enemyProximityDeathRisk(e, nestId));
        }
      });

  // A per-scout coin flip has no idea how many humans are actually left, so
  // it's possible for more events to roll 'succeeded' than there are
  // humans to have been found. Clamping only the aggregate successfulSearches
  // number (as before) would leave those extra events showing outcome:
  // 'succeeded' in the log/UI/history while silently not counting toward
  // naturalFailures either - inconsistent, and it starves the fort-marking
  // demand of failures that should count. So instead, when successes
  // outnumber available humans, downgrade a random subset of the *events*
  // themselves to 'failed' (and count them as such) until the totals line
  // up with S.humans.
  if (successfulSearches > S.humans) {
    let excess = successfulSearches - Math.max(0, S.humans);
    const succeededEvents = S.events.filter(e =>
      e.type === 'search' && !e.fortMarkScout && e.nestId === nestId &&
      e.status === 'resolved' && e.outcome === 'succeeded'
    );
    // Fisher-Yates shuffle so it's not always the same scouts (e.g. always
    // the first/last dispatched) losing out to the shortage.
    for (let i = succeededEvents.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [succeededEvents[i], succeededEvents[j]] = [succeededEvents[j], succeededEvents[i]];
    }
    for (let i = 0; i < excess && i < succeededEvents.length; i++) {
      succeededEvents[i].outcome = 'failed';
      naturalFailures++;
      nonDeathFailures++;
      searchDeathRiskSum += Math.min(1, S.settings.searchDeathRisk + enemyProximityDeathRisk(succeededEvents[i], nestId));
    }
    successfulSearches = Math.max(0, successfulSearches - excess);
  }

  const bonusEggs = Math.round(successfulSearches * S.settings.eggsPerSearch);

  const killedScouts = Math.round(Math.max(0, searchDeathRiskSum));
  const playerKilledSearchScouts = S.events.filter(
    e => e.type === 'search' && !e.fortMarkScout && e.nestId === nestId &&
      e.outcome === 'killed'
  ).length;
  killedScoutsThisStep += killedScouts + playerKilledSearchScouts;
  if(killedScouts>0) log(t('log.scouts_died_search', { count: killedScouts }));

  let scoutSurvivorsThisTick = S.events.filter(e=>e.type==='search' && !e.fortMarkScout && e.outcome!=='killed' && e.nestId===nestId).length;  if(successfulSearches>0) log(t('log.searches_succeeded', { count: successfulSearches, eggs: bonusEggs, eggWord: wordForm('noun.egg', bonusEggs) }));
  if(naturalFailures>0) log(t('log.searches_failed', { count: naturalFailures }));

  // Marking demand is driven by two events insects can actually observe
  // themselves, rather than the human/insect ratio (which colony members
  // have no way to know):
  //  - a scout coming back empty-handed (non-death search failure)
  //  - a predator with no hunting slot last step (one slot = one predator,
  //    not one group) - if the colony had muscle sitting idle with nothing
  //    to hunt, it points some of it at marking forts instead. This same
  //    count also nudges nymph maturation toward more predators (see
  //    predatorBias in processLifecycle) - both effects fire off the one
  //    stashed value.
  // Both are only known at the *end* of last step (searches resolve, then
  // hunts get dispatched, both after this point in the step), so they can
  // only inform *this* step's demand via what was stashed last step, not
  // via this step's own naturalFailures/dispatch. Capped by this step's
  // activeSearchers, since only that many scouts are actually on hand to
  // spare for the job.
  const markersDemanded = Math.min(
    activeSearchers,
    (S.lastNonDeathFailures || 0) * 2 + (S.lastUnoccupiedHuntingSlots || 0)
  );

  // Dispatching a scout here just means an attempt was sent - whether it
  // actually marks the fort is decided later, when its event resolves (see
  // the fortMarkScout resolution block above), so this only logs departure.
  const newlyDispatchedToMark = maybeMarkFortsFromSearch(markersDemanded);

  // Remember this step's non-death failures so *next* step's marking demand
  // can be sized off them.
  S.lastNonDeathFailures = nonDeathFailures;

  /* ---- 2. resolve hunts ---- */
  let totalHunted = 0, totalHuntDeaths = 0, predatorSurvivorsThisTick = 0;
  const pendingHunts = S.events.filter(e=>e.type==='hunt' && !e.routeHunt && e.status==='pending' && e.nestId===nestId);
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

  // Resolve merchant-route ambushes. Each event here is a full
  // S.settings.groupSize predator group, pulled from S.predatorsAvailable at
  // dispatch time (see dispatchMerchantRouteAmbushes, called in step 7
  // below) - same pool, same per-predator success/death rolls (0.5 vs
  // huntChance, huntChance vs deathRisk) as an ordinary hunt group above.
  // The only real difference: there are only MERCHANT_PAIR_SIZE (2) humans
  // on the targeted merchant run, so successes past the second just have
  // nothing left to kill - equivalent to "rolling and automatically
  // failing", just without wasting the roll. See MERCHANT HUNTING further up.
  S.events
    .filter(e => e.type === 'hunt' && e.routeHunt && e.status === 'pending' && e.nestId === nestId)
    .forEach(e => {
      e.status = 'resolved';

      const target = e.targetMerchantId
        ? S.events.find(m => m.id === e.targetMerchantId && m.type === 'merchant' && m.status === 'pending')
        : null;

      const huntChance = huntChanceWithDistance(e);
      const deathRisk = Math.min(0.95, S.settings.huntDeathRisk + enemyProximityDeathRisk(e, nestId));
      // Mirrors the normal-hunt pattern above: a predator the player already
      // rescued/killed this step (via escapePredator()/killPredatorAction())
      // must not still get a chance to land a kill or die again below.
      const activeHunters = e.groupSize - e.neutralized - e.killed;

      // Of the pair, however many the player already got to safety
      // (e.neutralized) are out of danger for good - only the rest can
      // still be run down. Each remaining active predator gets its OWN
      // independent roll against huntChance (unlike the normal-hunt loop
      // above, which shares one deterministic check across the whole
      // group) - a run of early misses never stops later predators from
      // still getting their shot, right up until either every active
      // predator has gone or nobody's left to catch.
      const huntableHumans = Math.max(0, MERCHANT_PAIR_SIZE - (e.neutralized || 0));
      let killedHumans = 0, huntDeaths = 0;
      for (let i = 0; i < activeHunters; i++) {
        if (killedHumans < huntableHumans && Math.random() < huntChance) killedHumans++;
        if (huntChance < deathRisk) huntDeaths++;
      }
      const eventSurvivors = Math.max(0, activeHunters - huntDeaths);

      predatorSurvivorsThisTick += eventSurvivors + e.neutralized;
      totalHuntDeaths += huntDeaths;
      e.survivors = eventSurvivors + e.neutralized;

      if (!target) {
        e.outcome = 'no_target'; // the marked route happened to be empty this step
        return;
      }

      const merchantSurvivors = Math.max(0, MERCHANT_PAIR_SIZE - killedHumans);
      target.survivors = merchantSurvivors;
      target.outcome = merchantSurvivors > 0 ? 'delivered' : 'hunted'; // >=1 survivor still gets the cargo through
      e.outcome = merchantSurvivors > 0 ? 'ambush_failed' : 'ambush_succeeded';
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
    const targetFort = S.forts.find(f => f.id === e.targetFortId);

    if (targetFort && targetFort.alive) {
      const outcome = estimateFortAssaultOutcome(e, targetFort, nest);
      const { remaining, predStrength, defenseBefore, ammoStock, ammoSpendable, lostInAssault, totalDamage } = outcome;

      predatorSurvivorsThisTick += remaining - lostInAssault;
      targetFort.defense = Math.max(0, defenseBefore - totalDamage);

      if (targetFort.defense <= 0) {
        e.outcome = 'conquered';
        targetFort.alive = false;
        targetFort.marks = {}; // clear every nest's marking state on this fort
        const releasedHumans = targetFort.population || 0;
        S.humans += releasedHumans;
        targetFort.population = 0;

        // Every hybrid stationed at this fort (distributeHybridsAcrossForts()/
        // hireAtFort()) goes down with it - same permanent AP loss as a
        // hybrid dying any other way (applySoldierLossRisk() in script.js,
        // sustainHybrids() above), just all at once instead of one at a time.
        const lostHybrids = targetFort.hybrids || 0;
        if (lostHybrids > 0) {
          S.maxPoints = Math.max(1, S.maxPoints - lostHybrids);
          S.points = Math.min(S.points, S.maxPoints);
          targetFort.hybrids = 0;
        }

        log(
          t('log.fort_fallen_prefix', {
            id: targetFort.id,
            damage: totalDamage,
            attackers: remaining,
            strength: predStrength,
            attackerWord: wordForm('noun.predator', remaining)
          }) +
          t('log.fort_fallen_lost', { lost: lostInAssault }, lostInAssault) +
          t('log.fort_fallen_humans', { humans: releasedHumans }, releasedHumans) +
          (lostHybrids > 0
            ? (t('log.fort_fallen_hybrids', { hybrids: lostHybrids }, lostHybrids) !== 'log.fort_fallen_hybrids'
                ? t('log.fort_fallen_hybrids', { hybrids: lostHybrids }, lostHybrids)
                : ` Prišli sme o ${lostHybrids} hybridov stanovaných v tejto pevnosti.`)
            : '')
        );
      } else {
        e.outcome = 'defended';
        if (targetFort) {
          if (!targetFort.resources) targetFort.resources = emptyResourceBundle();
          // Spends exactly what the kill-rate calculation above assumed was
          // available (ammoSpendable), not a flat per-kill rate - see the
          // CONQUEST KILL RATE section.
          targetFort.resources.ammo = roundResource(Math.max(0, ammoStock - ammoSpendable));
        };
        log(
          t('log.fort_held_prefix', {
            id: targetFort.id,
            damage: totalDamage,
            defense: targetFort.defense,
            maxDefense: targetFort.maxDefense,
            attackers: remaining,
            strength: predStrength,
            attackerWord: wordForm('noun.predator', remaining)
          }) +
          t('log.fort_held_lost', { lost: lostInAssault }, lostInAssault)
        );
      }
    }
  });

  /* ---- 4. lifecycle ---- */
  const scoutsAliveBefore = oldScoutsAvailable + oldScoutsCooldown + scoutSurvivorsThisTick - killedScouts;
  const predatorsAliveBefore = oldPredatorsAvailable + oldPredatorsCooldown + predatorSurvivorsThisTick;
  const lc = processLifecycle(
    bonusEggs,
    { scoutsAlive: scoutsAliveBefore, predatorsAlive: predatorsAliveBefore },
    naturalFailures,
    successfulSearches,
    nonDeathFailures,
    S.lastUnoccupiedHuntingSlots || 0,
    killedScoutsThisStep
  );
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
  ensureHiddenScoutPositions(nest);
  S.scoutsAvailable = readyScouts - newlyHiddenScouts;
  S.predatorsCooldown = predatorsAfter.survivors;
  S.predatorsAvailable = predatorsAfter.available + predatorsAfter.cooldown + predatorsAfter.newlyMatured;

  if (totalInsectsForNest(nest) <= 0) {
    nest.alive = false;
    return;
  }

  /* ---- 7. dispatch NEXT step ---- */
  // Min nest defenders: figure out how many available predators/scouts stay
  // home as a garrison before either pool gets dispatched below, then hand
  // the predator half back unspent after hunts/fort-attacks are settled -
  // "leave some predators and scouts in the nest".
  const garrisonReserve = nestGarrisonReserve();

  dispatchMerchantRouteScouts(nest); // competes for the SAME S.scoutsAvailable pool as the normal dispatch right below - see MERCHANT HUNTING
  const scoutsToDispatch = humansAreGone ? 0 : Math.max(0, S.scoutsAvailable - garrisonReserve.scouts);
  S.scoutsAvailable = humansAreGone ? 0 : (S.scoutsAvailable - scoutsToDispatch);
  for(let i=0;i<scoutsToDispatch;i++){ 
    const e = { id:nid(), type:'search', status:'pending', outcome:null, nestId }; 
    assignEventCoords(e);
    S.events.push(e); 
  }
  S.predatorsAvailable -= garrisonReserve.predators;
  dispatchMerchantRouteAmbushes(nest); // consumes any of this nest's due route marks, drawing a group from the SAME S.predatorsAvailable pool as the hunt dispatch below - see MERCHANT HUNTING

  // Hunting gets first claim on whatever predators aren't held back for
  // defense - fill as many hunt groups as this step's successful searches
  // actually support (each hunt group needs a "trail" from a successful
  // search, so this is a hard cap, not just a predator-count one).
  const groupSize = S.settings.groupSize;
  const predatorsBeforeHuntDispatch = S.predatorsAvailable;
  const numGroups = humansAreGone ? 0 : Math.max(0, Math.min(Math.floor(predatorsBeforeHuntDispatch/groupSize), successfulSearches));
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

  // "Unoccupied hunting slot": a predator that didn't get assigned to a
  // hunt group this step - one slot per predator, not per group. Whatever's
  // left in the pool after dispatch is exactly this (it's about to go
  // attack a fort instead, per maybeTriggerFort() below, but it also feeds
  // *next* step's marker demand - the colony had muscle sitting idle with
  // nothing to hunt). Only known now, at the end of this step's dispatch,
  // so it can't affect this step's own marker-demand calc above.
  S.lastUnoccupiedHuntingSlots = Math.max(0, predatorsBeforeHuntDispatch - dispatched);

  // Whatever's left once defense and hunting are both satisfied attacks a
  // marked fort instead of sitting idle - see maybeTriggerFort().
  maybeTriggerFort();

  S.predatorsAvailable += garrisonReserve.predators;

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

const STARVATION_BUFFER_STEPS = 5;

function processLifecycle(bonusEggs, pop, naturalFailures, successfulSearches = 0, nonDeathFailures = 0, unoccupiedHuntingSlots = 0, deadScouts = 0){  
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
    : (naturalFailures || 0) * S.settings.scoutBiasPerFailedSearch +
      (deadScouts || 0) * 2;
  // predatorBias pulls the opposite way from scoutBias: two events an
  // insect can actually observe - its own scout coming back empty-handed
  // (nonDeathFailures, this step) and a predator that had no hunting slot
  // last step (unoccupiedHuntingSlots, one step delayed since it's only
  // known once that step's hunt dispatch has happened - same value that
  // also feeds marker demand) - push development toward more predators
  // instead of more scouts. It's capped below (maxPredatorsAllowed) so
  // this never pushes predatorsAlive past scoutsAlive * groupSize - beyond
  // that point extra predators couldn't be organized into hunt groups by
  // the scouts on hand anyway.
  const predatorBias = isLowPopulation
    ? 0
    : (nonDeathFailures || 0) * S.settings.predatorBiasPerFailedSearch +
      (unoccupiedHuntingSlots || 0) * S.settings.predatorBiasPerUnoccupiedHuntingSlot;

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

    if(c.age >= 4){
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
      }, naturalFailures);
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
        // Tightened from 0.9/0.7: that let scouts climb to 70-90% of the predator
        // count, which is most of the reason a few killed/distracted scouts barely
        // moved the needle - there was always a huge surplus behind them. 0.5/0.35
        // keeps meaningfully fewer scouts in reserve relative to predators.
        const maxScoutsAllowedRecovery =
          S.bounceback &&
          S.bounceback.active
            ? Infinity
            : (
                predatorsAlive < 25
                  ? Math.round(predatorsAlive * 0.6)
                  : Math.round(predatorsAlive * 0.4)
              );

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

          // predatorBias only applies while there's still room under the
          // predator ceiling (scoutsAlive * groupSize) - once projected
          // predators (current adults + everything still in the nymph
          // pipeline, including nymphs this cohort is about to add) would
          // meet or exceed that, treat this cohort as if predatorBias were 0
          // so it falls back to the plain scoutBias-only formula instead of
          // pushing predators over the cap.
          const maxPredatorsAllowed = scoutsAlive * S.settings.groupSize;
          const projectedPredators =
            predatorsAlive + sumCohort(stillNymph) + newNymph + newRecoveryNymph;
          const effectivePredatorBias =
            projectedPredators < maxPredatorsAllowed ? predatorBias : 0;

          const desiredScouts = isLowPopulation
            ? ratioScouts
            : Math.ceil(
                predatorsAlive /
                (S.settings.groupSize * 0.8) +
                scoutBias -
                effectivePredatorBias
              );

          // Tightened from 0.9/0.7 - see the matching comment on the recovery-cohort
          // cap above. Lower ratio = less scout surplus = each scout killed/distracted
          // is a bigger fraction of the total, i.e. more directly consequential.
          const maxScoutsAllowed = predatorsAlive < 25 ? Math.round(predatorsAlive * 0.6) : Math.round(predatorsAlive * 0.4);

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
          (foodRatio - 1) * 0.4
        );
      }
      let minimalEggs = 0;
      if (insectCount < 5) {
        minimalEggs = 2;
      }
      const FreeNestCapacity = Math.max(0.1, Math.min(1, 1-(predatorsAlive + scoutsAlive) / 150));
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
        }, eggFoodCost);
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
  // STARVATION BUFFER
  // ---------------------------------------------------------------------------
  //
  // Missing food does NOT cause immediate deaths.
  //
  // Each insect type gets a consecutive-starvation counter.
  // If a type is affected by food shortage:
  //   step 1 -> starvation = 1
  //   step 2 -> starvation = 2
  //   step 3 -> starvation = 3 -> deaths can occur
  //
  // If a type gets enough food again, its counter resets to 0.
  //

  let deaths = {
    queen: 0,
    scouts: 0,
    predators: 0,
    nymphs: 0
  };

  const starvingGroups = {
    scouts: normalScouts,
    predators: predatorsAlive,
    nymphs: nymphCount
  };

  Object.keys(starvingGroups).forEach(key => {

    const count = starvingGroups[key];

    // No insects of this type -> no starvation streak.
    if(count <= 0){
      S.starvation[key] = 0;
      return;
    }

    // No shortage means everybody was fed.
    if(!shortage || unfed <= 0){
      S.starvation[key] = 0;
      return;
    }

    // Estimate how much of the shortage belongs to this insect type.
    const typeUnfed =
      normalFeeders > 0
        ? Math.max(
            0,
            Math.min(
              count,
              (count / normalFeeders) * unfed
            )
          )
        : 0;

    if(typeUnfed > 0){

      S.starvation[key] =
        Math.min(
          STARVATION_BUFFER_STEPS,
          (S.starvation[key] || 0) + 1
        );

    } else {

      S.starvation[key] = 0;

    }
  });


  // ---------------------------------------------------------------------------
  // APPLY STARVATION DEATHS
  // ---------------------------------------------------------------------------
  //
  // Only groups that have been starving for the full buffer duration
  // are eligible to die.
  //

  const eligibleGroups =
    normalFeederGroups.map(g => ({
      ...g,
      count:
        S.starvation[g.key] >= STARVATION_BUFFER_STEPS
          ? g.count
          : 0
    }));

  const eligibleTotal =
    eligibleGroups.reduce(
      (a, g) => a + g.count,
      0
    );

  if(unfed > 0 && eligibleTotal > 0){

    deaths =
      distributeDeaths(
        eligibleGroups,
        Math.min(
          unfed,
          eligibleTotal
        )
      );
  



    // -------------------------------------------------------------------------
    // QUEEN RESERVE BAILOUT (future-food protection)
    // -------------------------------------------------------------------------
    // distributeDeaths() above doesn't distinguish insects that are truly
    // doomed from ones with a concrete shot at bringing food home very soon.
    // If the queen still holds reserve food, she'll spend it to pull two
    // groups out of the death toll:
    //   - a full hunting group's worth of predators, but only if the nest
    //     currently has at least groupSize predators alive (cooldown +
    //     available) to form one - a partial group has no hunt to look
    //     forward to, so it isn't protected. Predators go first: they're
    //     the ones a scout actually needs to have something to lead.
    //   - up to 1 scout per successful search THIS step - it just found
    //     food; starving it the instant before delivery makes no sense -
    //     but only as many as the colony's near-future predator pipeline
    //     can actually support (see below), and only with whatever reserve
    //     the predator bailout above didn't already spend.
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

      if(predatorsAlive >= groupSize){

        queenBailoutPredators =
          Math.min(
            deaths.predators,
            groupSize,
            availableForBailout
          );

        if(queenBailoutPredators > 0){
          deaths.predators -= queenBailoutPredators;
          S.queenReserve -= queenBailoutPredators;
        }
      }

      const stillAvailableForBailout = availableForBailout - queenBailoutPredators;

      // Only bail out scouts if the colony is actually going to have enough
      // predators for them to lead soon: nymphs still maturing, predators
      // just saved above, and any predators that were never marked for
      // death all count toward that future pool. A scout with nothing to
      // guide is dead weight, so cap protection at 1 scout per 4 predators
      // expected next.
      const survivingNymphs = Math.max(0, nymphCount - deaths.nymphs);
      const survivingPredators = predatorsAlive - deaths.predators;
      const predatorsInNextStep = survivingNymphs + survivingPredators;
      const maxScoutsForPredatorRatio = Math.floor(predatorsInNextStep / 4);

      queenBailoutScouts =
        Math.min(
          deaths.scouts,
          successfulSearches,
          stillAvailableForBailout,
          maxScoutsForPredatorRatio
        );

      if(queenBailoutScouts > 0){
        deaths.scouts -= queenBailoutScouts;
        S.queenReserve -= queenBailoutScouts;
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

let currentLang = 'sk';
let translations = {};

// Slovak/English plural-form bucket for a count: 1 -> singular, 2-4 -> few,
// 0/5+/non-integer -> many (genitive plural covers decimals too).
function pluralSuffix(n) {
  if (typeof n !== 'number' || !isFinite(n) || !Number.isInteger(n)) return 'many';
  const a = Math.abs(n);
  if (a === 1) return 'singular';
  if (a >= 2 && a <= 4) return 'few';
  return 'many';
}

function wordForm(prefix, n) {
  return t(prefix + '_' + pluralSuffix(n));
}

// Shared by script.js's action functions and nest_defense_dqn.html's
// applyPointAction() - see the apLossRisk* settings for what each action rolls.
// Deliberately just a coin flip against a probability, not stateful - there's no
// "streak" or diminishing-risk-with-fatigue concept requested, just a flat chance
// per use.
function rollSoldierLoss(probability){
  return Math.random() < (probability || 0);
}

// Diminishing returns on fort capacity growth: flat +fortCapacityIncreaseAmount
// (default 5) below 125 capacity, then -1 to the increment every +25 capacity
// after that (125->+4, 150->+3, 175->+2, 200->+1), floored at +1 so the action
// never becomes a complete no-op. currentCapacity is the fort's capacity BEFORE
// this use - the threshold check uses the state the player is acting on, not the
// result.
function capacityIncreaseAmount(currentCapacity, baseAmount){
  const base = baseAmount || 5;
  const DIMINISH_START = 125, DIMINISH_STEP = 25, FLOOR = 1;
  if (currentCapacity < DIMINISH_START) return base;
  const steps = 1 + Math.floor((currentCapacity - DIMINISH_START) / DIMINISH_STEP);
  return Math.max(FLOOR, base - steps);
}

function t(key, params = {}, pluralCount = null) {
  const count = (pluralCount !== null) ? pluralCount
    : (typeof params.count === 'number' ? params.count : null);

  let resolvedKey = key;
  if (count !== null) {
    const candidate = key + '_' + pluralSuffix(count);
    if ((translations[currentLang] && translations[currentLang][candidate] !== undefined) ||
        (translations['en'] && translations['en'][candidate] !== undefined)) {
      resolvedKey = candidate;
    }
  }

  let text = translations[currentLang]?.[resolvedKey] || translations['en']?.[resolvedKey] || resolvedKey;

  // Replace placeholders like {step}, {count}, etc.
  Object.keys(params).forEach(param => {
    text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
  });

  return text;
}

function ensureHiddenScoutPositions(nest) {
  if (!nest) return;
  if (!Array.isArray(nest.hiddenScoutPositions)) nest.hiddenScoutPositions = [];

  const previousActiveIndex = S.activeNestIndex;
  S.activeNestIndex = S.nests.indexOf(nest);
  while (nest.hiddenScoutPositions.length < nest.scoutsHidden) {
    const scout = { type: 'search', status: 'pending', outcome: null, nestId: nest.id };
    assignEventCoords(scout);
    nest.hiddenScoutPositions.push({ x: scout.x, y: scout.y });
  }
  nest.hiddenScoutPositions.length = Math.min(nest.hiddenScoutPositions.length, nest.scoutsHidden);
  S.activeNestIndex = previousActiveIndex;
}