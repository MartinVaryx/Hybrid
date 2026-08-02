// generate_dataset.js / data collector.js (Node.js & Browser dual environment)

/* ============================= ENVIRONMENT DETECT ============================= */
const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
const fs = isNode ? require('fs') : null;

/* ============================= STATE ============================= */
let S = null;
let chart = null;

function dist(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function assignEventCoords(e) {
  e.x = Math.floor(12 + Math.random() * 76);
  e.y = Math.floor(12 + Math.random() * 76);
}

function openNestAnalytics() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('nestAnalyticsOverlay');
  if (el) el.classList.remove('hidden');
}

function closeNestAnalytics() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('nestAnalyticsOverlay');
  if (el) el.classList.add('hidden');
}

function freshState(){
  return {
    step: 0,
    points: 10,
    maxPoints: 10,
    phase: 'idle', // idle | active
    humans: 300,
    humansKilled: 0,
    food: 400,
    settings: {
      groupSize: 4, foodPerHuman: 5, maxPoints: 10, eggsPerSearch: 2,
      eggCap: 20, eggsPerFood: 5,
      searchBaseChance: 0.25, searchRatioScale: 0.25,
      huntBaseChance: 0.40, huntRatioScale: 0.25,
      huntDeathRisk: 0.5,
      scoutBiasPerFailedSearch: 0.2,
      fortLimit: 10,
      fortFoodLow: 2, fortFoodHigh: 4, fortHumanLow: 1, fortHumanHigh: 5,
      fortPredatorThreshold: 40, fortPredatorLoss: 20,
      fortHumanGain: 50, fortDefendCost: 10, fortDefendExtraLoss: 10,
      costDistractScout: 1, costKillScout: 2, costEscapePredator: 1, costKillPredator: 3,
      costSaveHumans: 1, saveHumansAmount: 3
    },
    queen: { alive: true },
    fortCooldown: 1,
    nest: { x: 25, y: 25 },
    forts: [],

    scoutsAvailable: 6,
    scoutsCooldown: 7,
    predatorsAvailable: 30,
    predatorsCooldown: 45,
    eggs: [], larva: [], cocoon: [], nymph: [],
    events: [],
    selectedEventId: null,
    history: [],
    log: [],
    gameOver: false,
    gameOverMsg: '',
    nextEventId: 1
  };
}

/* ============================= MAP & SPATIAL MATH ============================= */
function generateMapElements() {
  S.nest = {
    x: Math.random() * 50,
    y: Math.random() * 50
  };

  const count = S.settings.fortLimit || 10;
  S.forts = [];

  for (let i = 0; i < count; i++) {
    let placed = false;
    let attempts = 0;
    let bestCand = null;
    let maxMinDist = -1;

    while (attempts < 1000) {
      attempts++;
      const cand = {
        id: i + 1,
        x: 5 + Math.random() * 90,
        y: 5 + Math.random() * 90,
        alive: true
      };

      let valid = true;
      let minDistToOther = Infinity;

      for (const existing of S.forts) {
        const d = dist(cand, existing);
        if (d < minDistToOther) minDistToOther = d;
        if (d < 15) valid = false;
      }

      if (minDistToOther > maxMinDist) {
        maxMinDist = minDistToOther;
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

function getNearestAliveFortDistance() {
  const aliveForts = S.forts.filter(f => f.alive);
  if (aliveForts.length === 0) return Infinity;
  let minD = Infinity;
  aliveForts.forEach(f => {
    const d = dist(S.nest, f);
    if (d < minD) minD = d;
  });
  return minD;
}

function getFortConquerChance(fortEvent) {
  const remaining = Math.max(0, fortEvent.originalAttackers - fortEvent.killed);
  const baseChance = S.settings.fortPredatorThreshold > 0 
    ? Math.min(1, remaining / S.settings.fortPredatorThreshold) 
    : 0;

  const targetFort = S.forts.find(f => f.id === fortEvent.targetFortId);
  if (!targetFort) return baseChance;

  const d = dist(S.nest, targetFort);
  const distanceFactor = Math.max(0.4, 1.0 - (d / 120));

  return baseChance * distanceFactor;
}

function searchChanceWithDistance() {
  const base = successChance(S.settings.searchBaseChance, S.settings.searchRatioScale, ratioHumansPerInsect());
  const dMin = getNearestAliveFortDistance();
  if (dMin === Infinity) return base;

  const bonus = Math.max(0, (50 - dMin) / 50) * 0.25;
  return Math.min(0.90, base * (1 + bonus));
}

function huntChanceWithDistance() {
  const base = successChance(S.settings.huntBaseChance, S.settings.huntRatioScale, ratioHumansPerInsect());
  const dMin = getNearestAliveFortDistance();
  if (dMin === Infinity) return base;
  const penalty = Math.max(0, (50 - dMin) / 50) * 0.25;
  return Math.max(0.01, base * (1 - penalty));
}

function pickTargetFort() {
  const aliveForts = S.forts.filter(f => f.alive);
  if (aliveForts.length === 0) return null;

  const weights = aliveForts.map(f => {
    const d = Math.max(1, dist(S.nest, f));
    return 1 / (d * d);
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalWeight;

  for (let i = 0; i < aliveForts.length; i++) {
    if (rand < weights[i]) return aliveForts[i];
    rand -= weights[i];
  }
  return aliveForts[0];
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
function scoutsTotal(){ return S.scoutsAvailable + scoutsWorking() + S.scoutsCooldown; }
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
  'groupSizeInput','foodPerHumanInput','startHumansInput','startFoodInput',
  'maxPointsInput','eggsPerSearchInput','eggCapInput','eggsPerFoodInput',
  'searchBaseChanceInput','searchRatioScaleInput','huntBaseChanceInput','huntRatioScaleInput',
  'huntDeathRiskInput','scoutBiasPerFailedSearchInput','fortLimitInput',
  'fortFoodLowInput','fortFoodHighInput','fortHumanLowInput','fortHumanHighInput',
  'fortPredatorThresholdInput','fortPredatorLossInput','fortHumanGainInput',
  'costDistractScoutInput','costKillScoutInput','costEscapePredatorInput','costKillPredatorInput',
  'costSaveHumansInput','saveHumansAmountInput'
];

function initGame(){
  const D = freshState();
  S = freshState();
  const g = id => {
    if (typeof document === 'undefined') return null;
    const el = document.getElementById(id);
    return el ? el.value : null;
  };
  S.settings.groupSize            = clampInt(g('groupSizeInput'), 1, 20, D.settings.groupSize);
  S.settings.foodPerHuman          = clampInt(g('foodPerHumanInput'), 1, 50, D.settings.foodPerHuman);
  S.humans                         = clampInt(g('startHumansInput'), 1, 5000, D.humans);
  S.food                           = clampInt(g('startFoodInput'), 0, 5000, D.food);
  S.settings.maxPoints             = clampInt(g('maxPointsInput'), 1, 50, D.settings.maxPoints);
  S.settings.eggsPerSearch         = clampInt(g('eggsPerSearchInput'), 0, 20, D.settings.eggsPerSearch);
  S.settings.eggCap                = clampInt(g('eggCapInput'), 0, 500, D.settings.eggCap);
  S.settings.eggsPerFood           = clampInt(g('eggsPerFoodInput'), 0, 50, D.settings.eggsPerFood);
  S.settings.searchBaseChance      = clampFloat(g('searchBaseChanceInput'), 0, 90, D.settings.searchBaseChance*100) / 100;
  S.settings.searchRatioScale      = clampFloat(g('searchRatioScaleInput'), 0, 100, D.settings.searchRatioScale*100) / 100;
  S.settings.huntBaseChance        = clampFloat(g('huntBaseChanceInput'), 0, 90, D.settings.huntBaseChance*100) / 100;
  S.settings.huntRatioScale        = clampFloat(g('huntRatioScaleInput'), 0, 100, D.settings.huntRatioScale*100) / 100;
  S.settings.huntDeathRisk         = clampFloat(g('huntDeathRiskInput'), 0, 100, D.settings.huntDeathRisk*100) / 100;
  S.settings.scoutBiasPerFailedSearch = clampFloat(g('scoutBiasPerFailedSearchInput'), 0, 5, D.settings.scoutBiasPerFailedSearch);
  S.settings.fortLimit             = clampInt(g('fortLimitInput'), 1, 30, D.settings.fortLimit);
  S.settings.fortFoodLow           = clampFloat(g('fortFoodLowInput'), 0, 20, D.settings.fortFoodLow);
  S.settings.fortFoodHigh          = clampFloat(g('fortFoodHighInput'), 0, 20, D.settings.fortFoodHigh);
  S.settings.fortHumanLow          = clampFloat(g('fortHumanLowInput'), 0, 20, D.settings.fortHumanLow);
  S.settings.fortHumanHigh         = clampFloat(g('fortHumanHighInput'), 0, 20, D.settings.fortHumanHigh);
  S.settings.fortPredatorThreshold = clampInt(g('fortPredatorThresholdInput'), 1, 500, D.settings.fortPredatorThreshold);
  S.settings.fortPredatorLoss      = clampInt(g('fortPredatorLossInput'), 0, 200, D.settings.fortPredatorLoss);
  S.settings.fortHumanGain         = clampInt(g('fortHumanGainInput'), 0, 2000, D.settings.fortHumanGain);
  S.settings.costDistractScout     = clampInt(g('costDistractScoutInput'), 0, 50, D.settings.costDistractScout);
  S.settings.costKillScout         = clampInt(g('costKillScoutInput'), 0, 50, D.settings.costKillScout);
  S.settings.costEscapePredator    = clampInt(g('costEscapePredatorInput'), 0, 50, D.settings.costEscapePredator);
  S.settings.costKillPredator      = clampInt(g('costKillPredatorInput'), 0, 50, D.settings.costKillPredator);
  S.settings.costSaveHumans        = clampInt(g('costSaveHumansInput'), 0, 50, D.settings.costSaveHumans);
  S.settings.saveHumansAmount      = clampInt(g('saveHumansAmountInput'), 0, 500, D.settings.saveHumansAmount);
  
  S.maxPoints = S.settings.maxPoints;
  S.points = S.maxPoints;
  
  generateMapElements();

  S.history.push({step:0, humans:S.humans, insects: totalInsects()});
  log('The nest stirs. <b>'+totalInsects()+'</b> insects wait in the dark; <b>'+S.humans+'</b> humans remain unaware.');
  if (typeof document !== 'undefined') {
    const el = document.getElementById('gameOverOverlay');
    if (el) el.classList.add('hidden');
    setSetupEnabled(true);
  }
  render();
}

function applyDefaultsToInputs(){
  if (typeof document === 'undefined') return;
  const d = freshState();
  const map = {
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
    fortFoodLowInput: d.settings.fortFoodLow,
    fortFoodHighInput: d.settings.fortFoodHigh,
    fortHumanLowInput: d.settings.fortHumanLow,
    fortHumanHighInput: d.settings.fortHumanHigh,
    fortPredatorThresholdInput: d.settings.fortPredatorThreshold,
    fortPredatorLossInput: d.settings.fortPredatorLoss,
    fortHumanGainInput: d.settings.fortHumanGain,
    costDistractScoutInput: d.settings.costDistractScout,
    costKillScoutInput: d.settings.costKillScout,
    costEscapePredatorInput: d.settings.costEscapePredator,
    costKillPredatorInput: d.settings.costKillPredator,
    costSaveHumansInput: d.settings.costSaveHumans,
    saveHumansAmountInput: d.settings.saveHumansAmount,
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
  if (typeof document === 'undefined') return;
  SETTINGS_INPUT_IDS.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.disabled = !enabled;
  });
  const note = document.getElementById('settingsNote');
  if(note){
    note.textContent = enabled
      ? 'Edit before beginning the simulation. These lock once the nest is active.'
      : 'Locked — the nest is already active. Restart the simulation to change these.';
    note.classList.toggle('locked', !enabled);
  }
}

function openSettings(){ if (typeof document !== 'undefined') document.getElementById('settingsOverlay')?.classList.remove('hidden'); }
function closeSettings(){ if (typeof document !== 'undefined') document.getElementById('settingsOverlay')?.classList.add('hidden'); }

function closeGameOverOverlay() {
  if (typeof document !== 'undefined') document.getElementById('gameOverOverlay')?.classList.add('hidden');
}

/* Event Detail Overlay Handlers */
function openEventDetails(eid){
  if (typeof document === 'undefined') return;
  S.selectedEventId = eid;
  const overlay = document.getElementById('eventDetailOverlay');
  const container = document.getElementById('eventDetailContent');
  if(container) container.innerHTML = getEventDetailsHTML(eid);
  if(overlay) overlay.classList.remove('hidden');
}

function closeEventDetails(){
  if (typeof document === 'undefined') return;
  document.getElementById('eventDetailOverlay')?.classList.add('hidden');
}

function beginSimulation(){
  if(S.step>0) return;
  initGame();
  setSetupEnabled(false);
  S.phase = 'active';
  const n = S.scoutsAvailable;
  S.scoutsAvailable = 0;
  for(let i=0;i<n;i++){ 
    const e = { id:nid(), type:'search', status:'pending', outcome:null }; 
    assignEventCoords(e);
    S.events.push(e); 
  }
  maybeTriggerFort();
  S.step = 1;
  S.points = S.maxPoints;
  log('<b>— Step '+S.step+' begins —</b> ('+n+' scout(s) on patrol)');
  selectNextPendingEvent();
  render();
}

function ratioHumansPerInsect(){
  const insects = totalInsects();
  if(insects<=0) return 0;
  return S.humans / insects;
}

function fortFactorPct(value, low, high){
  if(high <= low) return value <= low ? 1 : 0;
  if(value <= low) return 1;
  if(value >= high) return 0;
  return (high - value) / (high - low);
}

function fortReadiness(){
  const s = S.settings;
  const insects = totalInsects();
  const foodPerInsect = insects > 0 ? S.food / insects : 0;
  const foodPct = insects > 0 ? fortFactorPct(foodPerInsect, s.fortFoodLow, s.fortFoodHigh) : 0;
  const humanPct = insects > 0 ? fortFactorPct(ratioHumansPerInsect(), s.fortHumanLow, s.fortHumanHigh) : 0;
  const predatorPct = s.fortPredatorThreshold > 0 ? (predatorsTotal() / s.fortPredatorThreshold) : 0;
  return { foodPct, humanPct, predatorPct, total: foodPct + humanPct + predatorPct };
}

function maybeTriggerFort() {
  if (S.events.some(e => e.type === 'fort' && e.status === 'pending')) return;
  if (S.fortCooldown > 0) { S.fortCooldown -= 1; return; }

  const aliveForts = S.forts.filter(f => f.alive);
  if (aliveForts.length === 0) return;

  const readiness = fortReadiness();
  if (readiness.total < 2.5) return;

  const targetFort = pickTargetFort();
  if (!targetFort) return;

  const d = dist(S.nest, targetFort);
  const attemptChance = Math.max(0.10, 1.0 - (d / 80)); 
  if (Math.random() > attemptChance) return;

  const cap = Math.max(0, S.settings.fortPredatorThreshold);
  let needed = Math.min(cap, S.predatorsAvailable + predatorsWorking());
  if (needed <= 0) return;

  const fromAvailable = Math.min(needed, S.predatorsAvailable);
  S.predatorsAvailable -= fromAvailable;
  needed -= fromAvailable;

  let fromWorking = 0;
  if (needed > 0) {
    for (const e of S.events) {
      if (needed <= 0) break;
      if (e.type !== 'hunt' || e.status !== 'pending') continue;
      const active = e.groupSize - e.neutralized - e.killed;
      const take = Math.min(active, needed);
      if (take <= 0) continue;
      e.groupSize -= take;
      fromWorking += take;
      needed -= take;
    }
  }

  const attackers = fromAvailable + fromWorking;
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
  if (readiness.foodPct >= 1) reasons.push('food reserves are critically low');
  if (readiness.humanPct >= 1) reasons.push('humans have grown too plentiful for the swarm');
  const reasonText = reasons.length ? reasons.join(' and ') : 'combined readiness has tipped the swarm over the edge';
  let msg = '<b>' + reasonText.charAt(0).toUpperCase() + reasonText.slice(1) + '.</b> (' + Math.round(readiness.total * 100) + '% readiness) A war party of ' + attackers + ' predator(s) marches on Fort #' + targetFort.id + '.';
  if (fromWorking > 0) msg += ' ' + fromWorking + ' of them were pulled off an active hunt.';
  if (leftoverHunting > 0) msg += ' ' + leftoverHunting + ' predator(s) continue hunting.';
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

function advanceStep(){
  if(S.gameOver) return;
  S.events = S.events.filter(e=>e.status==='pending');
  S.selectedEventId = null;

  const oldScoutsAvailable = S.scoutsAvailable;
  const oldScoutsCooldown = S.scoutsCooldown;
  const oldPredatorsAvailable = S.predatorsAvailable;
  const oldPredatorsCooldown = S.predatorsCooldown;

  /* ---- 1. resolve searches ---- */
  const searchChance = searchChanceWithDistance();
  let successfulSearches = 0, naturalFailures = 0;
  S.events.filter(e=>e.type==='search' && e.status==='pending').forEach(e=>{
    e.status = 'resolved';
    if (!e.outcome) { 
        if(Math.random() < searchChance){ e.outcome='succeeded'; successfulSearches++; }
        else { e.outcome='failed'; naturalFailures++; }
    } else if (e.outcome === 'distracted' || e.outcome === 'killed') {
        naturalFailures++;
    }
  });
  const bonusEggs = successfulSearches * S.settings.eggsPerSearch;
  let scoutSurvivorsThisTick = S.events.filter(e=>e.type==='search' && e.outcome!=='killed').length;
  if(successfulSearches>0) log(successfulSearches+' search(es) succeeded ('+Math.round(searchChance*100)+'% chance) — queen laid '+bonusEggs+' bonus egg(s).');
  if(naturalFailures>0) log(naturalFailures+' search(es) found nothing.');

  /* ---- 2. resolve hunts ---- */
  let totalHunted = 0, totalHuntDeaths = 0, predatorSurvivorsThisTick = 0;
  const huntChance = huntChanceWithDistance();
  const pendingHunts = S.events.filter(e=>e.type==='hunt' && e.status==='pending');
  pendingHunts.forEach(e=>{
    const activeHunters = e.groupSize - e.neutralized - e.killed;
    let eventSurvivors = activeHunters;
    if(activeHunters>0){
      let caught = 0;
      for(let i=0;i<activeHunters;i++){
        if(S.humans - totalHunted - caught <= 0) break;
        if(Math.random() < huntChance) caught++;
      }
      totalHunted += caught;
      let huntDeaths = 0;
      for(let i=0;i<activeHunters;i++){ if(Math.random()<S.settings.huntDeathRisk) huntDeaths++; }
      if(huntDeaths>0){ totalHuntDeaths += huntDeaths; eventSurvivors = Math.max(0, activeHunters-huntDeaths); }
    }
    predatorSurvivorsThisTick += eventSurvivors + e.neutralized;
    e.status = 'resolved';
    e.outcome = 'done';
  });
  if(totalHunted>0){
    S.humans -= totalHunted;
    S.humansKilled += totalHunted;
    S.food += totalHunted * S.settings.foodPerHuman;
    log(totalHunted+' human(s) hunted down ('+Math.round(huntChance*100)+'% chance/predator). Food storage +'+(totalHunted*S.settings.foodPerHuman)+'.');
  } else if(pendingHunts.length>0){
    log('All hunting parties failed to catch anyone.');
  }
  if(totalHuntDeaths>0) log(totalHuntDeaths+' predator(s) died during the hunt.');

  /* ---- 3. resolve fort assault ---- */
  S.events.filter(e => e.type === 'fort' && e.status === 'pending').forEach(e => {
    e.status = 'resolved';
    const remaining = Math.max(0, e.originalAttackers - e.killed);
    
    const conquerChance = getFortConquerChance(e);
    e.conquerChance = conquerChance;

    const targetFort = S.forts.find(f => f.id === e.targetFortId);

    if (Math.random() < conquerChance) {
      e.outcome = 'conquered';
      if (targetFort) targetFort.alive = false;
      const lostInAssault = Math.min(remaining, S.settings.fortPredatorLoss);
      predatorSurvivorsThisTick += remaining - lostInAssault;
      S.humans += S.settings.fortHumanGain;
      S.fortCooldown = 1;
      log('<b>Fort #' + (targetFort ? targetFort.id : '') + ' has fallen!</b> (' + Math.round(conquerChance * 100) + '% chance, ' + remaining + ' attacker(s) remained.) ' + lostInAssault + ' predator(s) died in the assault, but ' + S.settings.fortHumanGain + ' human(s) were captured.');
    } else {
      e.outcome = 'defended';
      predatorSurvivorsThisTick += remaining;
      log('<b>Fort #' + (targetFort ? targetFort.id : '') + ' held.</b> (' + Math.round(conquerChance * 100) + '% chance) Attackers were repelled by fortified defenders.');
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
  S.scoutsAvailable = scoutsAfter.available + scoutsAfter.cooldown + scoutsAfter.newlyMatured;
  S.predatorsCooldown = predatorsAfter.survivors;
  S.predatorsAvailable = predatorsAfter.available + predatorsAfter.cooldown + predatorsAfter.newlyMatured;

  S.history.push({step:S.step, humans:S.humans, insects: totalInsects()});
  if(S.humans<=0){
    S.gameOver = true;
    S.gameOverMsg = 'The swarm has consumed all of humanity. The hive reigns supreme over silent cities.';
  } else if(!S.queen.alive){
    S.gameOver = true;
    S.gameOverMsg = 'The queen has died. Without her to lay eggs, the nest cannot go on — the colony collapses.';
  } else if(totalInsects()<=0){
    S.gameOver = true;
    S.gameOverMsg = 'The nest has collapsed into silence. Humanity endures, scarred but alive.';
  }
  if(S.gameOver){ render(); return; }

  /* ---- 7. dispatch NEXT step ---- */
  const scoutsToDispatch = S.scoutsAvailable;
  S.scoutsAvailable = 0;
  for(let i=0;i<scoutsToDispatch;i++){ 
    const e = { id:nid(), type:'search', status:'pending', outcome:null }; 
    assignEventCoords(e);
    S.events.push(e); 
  }
  const groupSize = S.settings.groupSize;
  const numGroups = Math.max(0, Math.min(Math.floor(S.predatorsAvailable/groupSize), successfulSearches));
  const dispatched = numGroups*groupSize;
  S.predatorsAvailable -= dispatched;
  for(let i=0;i<numGroups;i++){ 
    const e = { id:nid(), type:'hunt', status:'pending', outcome:null, groupSize, neutralized:0, killed:0 }; 
    assignEventCoords(e);
    S.events.push(e); 
  }
  if(numGroups>0) log(numGroups+' hunting part(y/ies) dispatched.');

  maybeTriggerFort();

  S.step += 1;
  S.points = S.maxPoints;
  selectNextPendingEvent();
  render();
}

function processLifecycle(bonusEggs, pop, naturalFailures){
  let scoutsAlive = pop.scoutsAlive;
  let predatorsAlive = pop.predatorsAlive;
  let newlyMaturedScouts = 0, newlyMaturedPredators = 0;
  const scoutBias = (naturalFailures||0) * S.settings.scoutBiasPerFailedSearch;

  let maturingCount = 0;
  let stillNymph = [];
  S.nymph.forEach(c=>{
    c.age += 1;
    if(c.age>=1) maturingCount += c.count; else stillNymph.push(c);
  });
  S.nymph = stillNymph;
  for(let i=0;i<maturingCount;i++){
    const desiredScouts = Math.ceil(predatorsAlive / S.settings.groupSize + scoutBias);
    if(scoutsAlive < desiredScouts){ scoutsAlive += 1; newlyMaturedScouts += 1; }
    else { predatorsAlive += 1; newlyMaturedPredators += 1; }
  }
  if(maturingCount>0){
    let matureMsg = maturingCount+' nymph(s) matured into adult insects.';
    if(naturalFailures>0) matureMsg += ' ('+naturalFailures+' fruitless search(es) this step biased maturation '+(scoutBias>=1?'strongly':'slightly')+' toward scouts.)';
    log(matureMsg);
  }

  let newNymph = 0, stillCocoon = [];
  S.cocoon.forEach(c=>{ c.age+=1; if(c.age>=1) newNymph+=c.count; else stillCocoon.push(c); });
  S.cocoon = stillCocoon;
  if(newNymph>0) S.nymph.push({age:0, count:newNymph});

  let newCocoon = 0, stillLarva = [];
  S.larva.forEach(c=>{ c.age+=1; if(c.age>=2) newCocoon+=c.count; else stillLarva.push(c); });
  S.larva = stillLarva;
  if(newCocoon>0) S.cocoon.push({age:0, count:newCocoon});

  let newLarva = 0, stillEggs = [];
  S.eggs.forEach(c=>{ c.age+=1; if(c.age>=2) newLarva+=c.count; else stillEggs.push(c); });
  S.eggs = stillEggs;
  if(newLarva>0) S.larva.push({age:0, count:newLarva});

  let queenStarved = false;
  if(S.queen.alive){
    if(S.food >= 1){
      S.food -= 1;
    } else {
      S.queen.alive = false;
      queenStarved = true;
    }
  }

  const nymphCount = sumCohort(S.nymph);
  const feederGroups = [
    { key:'scouts',    count: scoutsAlive },
    { key:'predators', count: predatorsAlive },
    { key:'nymphs',    count: nymphCount },
  ];
  const totalFeeders = feederGroups.reduce((a,g)=>a+g.count,0);
  const shortage = S.food < totalFeeders;

  let unfed = 0;
  if(shortage){
    unfed = totalFeeders - S.food;
    S.food = 0;
  } else {
    S.food -= totalFeeders;
  }

  let eggsLaid = 0;
  let eggFoodCost = 0;
  let eggsWereCapped = false;
  if(S.queen.alive && !shortage){
    const desiredEggs = 1 + bonusEggs;
    const cappedEggs = Math.min(S.settings.eggCap, desiredEggs);
    eggsWereCapped = cappedEggs < desiredEggs;
    const foodRemaining = S.food;
    const eggsPerFood = S.settings.eggsPerFood;
    let affordableEggs = cappedEggs;
    if(eggsPerFood > 0){
      const foodBudget = Math.max(0, foodRemaining);
      const maxAffordable = foodBudget*eggsPerFood + (eggsPerFood-1);
      affordableEggs = Math.min(cappedEggs, maxAffordable);
    }
    eggsLaid = affordableEggs;
    eggFoodCost = eggsPerFood > 0 ? Math.floor(eggsLaid / eggsPerFood) : 0;
    if(eggsLaid > 0){
      S.eggs.push({age:0, count: eggsLaid});
      S.food -= eggFoodCost;
    }
  }

  if(eggsLaid>0){
    let eggMsg = 'Queen laid '+eggsLaid+' egg(s)';
    if(eggFoodCost>0) eggMsg += ', costing '+eggFoodCost+' food';
    if(eggsWereCapped) eggMsg += ' (capped at '+S.settings.eggCap+')';
    log(eggMsg+'.');
  } else if(S.queen.alive && !shortage && (1+bonusEggs)>0 && S.settings.eggCap>0){
    log('Queen withheld egg-laying — not enough food left to pay the cost.');
  }

  let eatenImmature = 0;
  if(unfed > 0){
    eatenImmature = eatFromCohorts(unfed);
    unfed -= eatenImmature;
  }

  let deaths = { queen:0, scouts:0, predators:0, nymphs:0 };
  if(unfed > 0){
    deaths = distributeDeaths(feederGroups, unfed);
    scoutsAlive -= deaths.scouts;
    predatorsAlive -= deaths.predators;
    if(deaths.nymphs > 0) removeFromNymphCohorts(deaths.nymphs);
  }

  if(queenStarved){
    log('<b>The queen has starved.</b> Food storage was completely empty when it was her turn to eat — without her, the nest cannot endure.');
  }

  if(shortage){
    let msg = '<b>Famine.</b> Food storage couldn\'t sustain '+totalFeeders+' remaining mouths this step.';
    if(eatenImmature > 0) msg += ' '+eatenImmature+' egg(s)/larva(e)/cocoon(s) devoured for sustenance.';
    if(unfed > 0){
      const parts = [];
      if(deaths.scouts)    parts.push(deaths.scouts+' scout(s)');
      if(deaths.predators) parts.push(deaths.predators+' predator(s)');
      if(deaths.nymphs)    parts.push(deaths.nymphs+' nymph(s)');
      if(parts.length>0) msg += ' Starved: '+parts.join(', ')+'.';
    }
    if(S.queen.alive) msg += ' The queen withheld egg-laying this step.';
    log(msg);
  }

  return {
    newlyMaturedScouts, newlyMaturedPredators,
    scoutDeaths: deaths.scouts, predatorDeaths: deaths.predators,
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
  const cost = S.settings.costDistractScout;
  if(!e || e.status!=='pending' || e.outcome || S.points<cost) return;
  
  S.points -= cost; 
  e.outcome='distracted';
  log('Scout distracted — search failed.');
  selectNextPendingEvent();
  render();
}

function killScout(eid){
  const e = findEvent(eid);
  const cost = S.settings.costKillScout;
  if(!e || e.status!=='pending' || e.outcome || S.points<cost) return;
  
  S.points -= cost; 
  e.outcome='killed';
  log('Scout killed — search failed permanently.');
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
  log('A human slipped away from a predator.');
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
  log('A predator was killed before it could hunt.');
  if(e.neutralized+e.killed >= e.groupSize){
    selectNextPendingEvent();
  }
  render();
}

function saveHumans(){
  const cost = S.settings.costSaveHumans;
  if(S.phase!=='active' || S.gameOver) return;
  if(S.points<cost) return;
  if(S.humans<=0) return;
  const amount = Math.min(S.settings.saveHumansAmount, S.humans);
  S.points -= cost;
  S.humans -= amount;
  log(amount+' human(s) evacuated out of the hunting pool before the nest could reach them.');
  render();
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
  log('A predator was killed before it could join the assault on Fort #'+e.targetFortId+'.');
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
  if (typeof document === 'undefined') return;

  document.getElementById('stepVal').textContent = String(S.step).padStart(3,'0');
  document.getElementById('humansVal').textContent = S.humans;

  const killedEl = document.getElementById('humansKilledVal');
  if(killedEl) killedEl.textContent = S.humansKilled;

  document.getElementById('insectsVal').textContent = totalInsects();
  document.getElementById('pointsVal').textContent = S.points;
  document.getElementById('queenTag').textContent = S.queen.alive ? 'Queen active' : 'Queen dead';

  const pr = document.getElementById('pointsRow');
  if (pr) {
    pr.innerHTML='';
    for(let i=0;i<S.maxPoints;i++){
      const p = document.createElement('div');
      p.className = 'pip' + (i<S.points ? ' filled':'');
      pr.appendChild(p);
    }
  }

  renderPhaseBanner();
  renderGlobalActions();
  renderQueue();
  renderStats();
  renderMap();
  renderLog();
  renderChart();
  renderOverlay();
}

function renderPhaseBanner(){
  if (typeof document === 'undefined') return;
  const txt = document.getElementById('phaseText');
  const btn = document.getElementById('phaseBtn');
  if(!txt || !btn) return;

  if(S.gameOver){
    txt.innerHTML = 'Simulation has ended.';
    btn.textContent = 'View Result';
    btn.disabled = false;
    btn.onclick = renderOverlay;
    return;
  }
  if(S.phase==='idle'){
    txt.innerHTML = 'Standing by. Open <b>⚙ Parameters</b> to configure the nest, then begin observation.';
    btn.textContent = 'Begin Simulation';
    btn.disabled = false;
    btn.onclick = beginSimulation;
  } else {
    const searching = scoutsWorking();
    const hunting = predatorsWorking();
    const fortPending = S.events.some(e=>e.type==='fort'&&e.status==='pending');
    const parts = [];
    if(searching>0) parts.push(searching+' scout(s) searching');
    if(hunting>0) parts.push(hunting+' predator(s) hunting');
    if(fortPending) parts.push('a fort under assault');
    txt.innerHTML = '<b>Step '+S.step+'</b> — '+(parts.length ? parts.join(', ')+'.' : 'quiet this step.')+' Spend points to intervene, then resolve.';
    btn.textContent = 'Resolve Step →';
    btn.disabled = false;
    btn.onclick = advanceStep;
  }
}

function renderGlobalActions(){
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('saveHumansBtn');
  if(!btn) return;
  document.getElementById('saveHumansCostLbl').textContent = S.settings.costSaveHumans;
  document.getElementById('saveHumansAmountLbl').textContent = S.settings.saveHumansAmount;
  btn.disabled = S.gameOver || S.phase!=='active' || S.points<S.settings.costSaveHumans || S.humans<=0;
}

function renderQueue(){
  if (typeof document === 'undefined') return;
  const list = document.getElementById('queueList');
  const tag = document.getElementById('queueTag');
  if(!list || !tag) return;
  list.innerHTML = '';
  if(S.events.length===0){
    const li = document.createElement('li');
    li.className = 'empty-note';
    li.textContent = S.step===0 ? 'No transmissions yet. Begin the simulation to start receiving field reports.' : 'No active events this step.';
    list.appendChild(li);
    tag.textContent = '0 pending';
    return;
  }
  const pendingCount = S.events.filter(e => {
    if(e.status !== 'pending') return false;
    if(e.type === 'search' && e.outcome) return false;
    return true;
  }).length;
  tag.textContent = pendingCount+' pending';

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
      ? 'Scout patrol scanning for settlements'
      : (e.type==='hunt'
        ? 'Hunting party ('+e.groupSize+' predators) closing on target'
        : 'War party marching on Fort #'+e.targetFortId);

    li.title = eventDescription;

    const badge = document.createElement('span');
    badge.className = 'badge ' + e.type;
    badge.textContent = e.type==='search' ? 'SEARCH' : (e.type==='hunt' ? 'HUNT' : 'FORT');

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'q-actions';

    if (e.status === 'pending') {
      if (e.type === 'search' && !e.outcome) {
        const distractBtn = document.createElement('button');
        distractBtn.className = 'act-mini';
        distractBtn.textContent = 'DISTRACT';
        distractBtn.title = 'Distract scout to make search fail (−'+S.settings.costDistractScout+' pt)';
        distractBtn.disabled = S.points < S.settings.costDistractScout;
        distractBtn.onclick = (ev) => { ev.stopPropagation(); distractScout(e.id); };

        const killBtn = document.createElement('button');
        killBtn.className = 'act-mini danger';
        killBtn.textContent = 'KILL';
        killBtn.title = 'Kill scout to fail search permanently (−'+S.settings.costKillScout+' pt)';
        killBtn.disabled = S.points < S.settings.costKillScout;
        killBtn.onclick = (ev) => { ev.stopPropagation(); killScout(e.id); };

        actionsWrap.appendChild(distractBtn);
        actionsWrap.appendChild(killBtn);

      } else if (e.type === 'hunt') {
        const active = e.groupSize - (e.neutralized + e.killed);
        if (active > 0) {
          const rescueBtn = document.createElement('button');
          rescueBtn.className = 'act-mini';
          rescueBtn.textContent = 'RESCUE';
          rescueBtn.title = 'Help a human escape from a predator (−'+S.settings.costEscapePredator+' pt)';
          rescueBtn.disabled = S.points < S.settings.costEscapePredator;
          rescueBtn.onclick = (ev) => { ev.stopPropagation(); escapePredator(e.id); };

          const killBtn = document.createElement('button');
          killBtn.className = 'act-mini danger';
          killBtn.textContent = 'KILL';
          killBtn.title = 'Kill 1 hunting predator (−'+S.settings.costKillPredator+' pt)';
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
          defendBtn.textContent = 'DEFEND';
          defendBtn.title = 'Kill 1 predator attacking Fort #'+e.targetFortId+' (−'+S.settings.costKillPredator+' pt)';
          defendBtn.disabled = S.points < S.settings.costKillPredator;
          defendBtn.onclick = (ev) => { ev.stopPropagation(); killFortAttacker(e.id); };

          actionsWrap.appendChild(defendBtn);
        }
      }
    }

    const status = document.createElement('span');
    status.className = 'q-status';
    if(e.status==='pending' && !isFailedSearch){
      status.textContent = 'pending';
    } else if(e.type==='search'){
      if(e.outcome==='distracted'){ status.textContent='distracted'; status.classList.add('good'); }
      else if(e.outcome==='killed'){ status.textContent='scout killed'; status.classList.add('good'); }
      else if(e.outcome==='failed'){ status.textContent='found nothing'; status.classList.add('good'); }
      else { status.textContent='succeeded'; status.classList.add('bad'); }
    } else if(e.type==='hunt'){
      const stopped = e.neutralized+e.killed;
      status.textContent = stopped>=e.groupSize ? 'fully stopped' : (stopped>0? stopped+'/'+e.groupSize+' stopped':'resolved');
      status.classList.add(stopped>=e.groupSize ? 'good' : (stopped>0?'good':'bad'));
    } else {
      if(e.outcome==='defended'){ status.textContent='defended'; status.classList.add('good'); }
      else { status.textContent='fort conquered'; status.classList.add('bad'); }
    }

    const infoBtn = document.createElement('button');
    infoBtn.className = 'q-info-btn';
    infoBtn.textContent = 'i';
    infoBtn.title = 'View full details';
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
    const d = targetFort ? dist(S.nest, targetFort) : 30;
    const prepFactor = Math.max(0.4, 1.0 - (d / 120));
    const baseChancePct = s.fortPredatorThreshold>0 ? Math.min(1, remaining/s.fortPredatorThreshold) : 0;
    const finalChancePct = Math.round(baseChancePct * prepFactor * 100);

    let html = '<h3 class="detail-title">Fort Assault: Fort #'+(targetFort ? targetFort.id : '')+'</h3>';
    html += '<div class="detail-desc">A war party of <b style="color:var(--hybrid-amber)">'+e.originalAttackers+'</b> predators is attacking Fort #'+(targetFort ? targetFort.id : '')+'. Farther forts have more time to prepare, reducing conquest chance proportionally. Current conquer chance: <b style="color:var(--hybrid-amber)">'+finalChancePct+'%</b>. If conquered, '+s.fortPredatorLoss+' predator(s) die in the siege, and '+s.fortHumanGain+' human(s) are captured.</div>';
    html += '<div class="detail-meta">';
    html += '<div>Original Attackers<b>'+e.originalAttackers+'</b></div>';
    html += '<div>Killed<b>'+e.killed+'</b></div>';
    html += '<div>Remaining<b>'+remaining+'</b></div>';
    html += '<div>Conquer Chance<b>'+finalChancePct+'%</b></div>';
    html += '</div>';
    if(e.status==='pending'){
      html += '<div class="actions">';
      html += '<button class="act danger" '+((S.points<s.costKillPredator || remaining<=0)?'disabled':'')+' onclick="killFortAttacker('+e.id+'); openEventDetails('+e.id+');">Defend Fort / Kill Predator <span class="cost">(−'+s.costKillPredator+' pt)</span></button>';
      html += '</div>';
      if(remaining<=0){
        html += '<div class="detail-desc" style="margin-top:8px;">All attacking predators have been eliminated — Fort #'+e.targetFortId+' is safe.</div>';
      }
    } else {
      html += '<div class="detail-meta"><div>Outcome<b>'+(e.outcome==='defended'?'Defended':'Fort Conquered')+'</b></div></div>';
    }
    return html;
  }

  if(e.type==='search'){
    const chance = Math.round(searchChanceWithDistance()*100);
    let html = '<h3 class="detail-title">Scout Search</h3>';
    html += '<div class="detail-desc">A lone scout is combing the perimeter for human settlements (current success chance: <b style="color:var(--hybrid-amber)">'+chance+'%</b>, influenced by distance to nearest fort and humans-per-insect ratio). If it succeeds, the queen instantly lays '+S.settings.eggsPerSearch+' bonus egg(s).</div>';
    if(e.status==='pending' && !e.outcome){
      html += '<div class="actions">';
      html += '<button class="act" '+(S.points<S.settings.costDistractScout?'disabled':'')+' onclick="distractScout('+e.id+'); openEventDetails('+e.id+');">Distract Scout <span class="cost">(−'+S.settings.costDistractScout+' pt)</span></button>';
      html += '<button class="act danger" '+(S.points<S.settings.costKillScout?'disabled':'')+' onclick="killScout('+e.id+'); openEventDetails('+e.id+');">Kill Scout <span class="cost">(−'+S.settings.costKillScout+' pt)</span></button>';
      html += '</div>';
    } else {
      html += '<div class="detail-meta"><div>Outcome<b>'+outcomeLabel(e)+'</b></div></div>';
    }
    return html;
  } else {
    const stopped = e.neutralized + e.killed;
    const active = e.groupSize - stopped;
    const huntChancePct = Math.round(huntChanceWithDistance()*100);
    const deathRiskPct = Math.round(S.settings.huntDeathRisk*100);
    let html = '<h3 class="detail-title">Hunting Party</h3>';
    html += '<div class="detail-desc">A pack of '+e.groupSize+' predators has located a group of humans. Each predator not stopped independently has a <b style="color:var(--hybrid-amber)">'+huntChancePct+'%</b> chance to catch a human (adjusted by distance to nearest fort), with a separate <b style="color:var(--hybrid-red)">'+deathRiskPct+'%</b> risk of dying.</div>';
    html += '<div class="detail-meta">';
    html += '<div>Pack Size<b>'+e.groupSize+'</b></div>';
    html += '<div>Escaped<b>'+e.neutralized+'</b></div>';
    html += '<div>Killed<b>'+e.killed+'</b></div>';
    html += '<div>Still Hunting<b>'+active+'</b></div>';
    html += '</div>';
    if(e.status==='pending' && active>0){
      html += '<div class="actions">';
      html += '<button class="act" '+(S.points<S.settings.costEscapePredator?'disabled':'')+' onclick="escapePredator('+e.id+'); openEventDetails('+e.id+');">Help Human Escape <span class="cost">(−'+S.settings.costEscapePredator+' pt)</span></button>';
      html += '<button class="act danger" '+(S.points<S.settings.costKillPredator?'disabled':'')+' onclick="killPredatorAction('+e.id+'); openEventDetails('+e.id+');">Kill Predator <span class="cost">(−'+S.settings.costKillPredator+' pt)</span></button>';
      html += '</div>';
    } else if(e.status==='pending'){
      html += '<div class="detail-desc" style="margin-top:8px;">This pack has been fully neutralized.</div>';
    } else {
      html += '<div class="detail-desc" style="margin-top:8px;">Resolved this step.</div>';
    }
    return html;
  }
}

function outcomeLabel(e){
  if(e.outcome==='distracted') return 'Distracted (failed)';
  if(e.outcome==='killed') return 'Scout killed (failed)';
  if(e.outcome==='failed') return 'Found nothing (failed)';
  if(e.outcome==='succeeded') return 'Succeeded';
  return e.outcome || '—';
}

function renderStats(){
  if (typeof document === 'undefined') return;
  const row = document.getElementById('stageRow');
  if(!row) return;
  row.innerHTML = '';

  const groups = [
    {
      title: 'Core',
      items: [
        { label: 'Food Storage', count: S.food, cls: 'food' },
        { label: 'Queen', count: S.queen.alive ? 'Active' : 'Dead', cls: S.queen.alive ? 'good' : 'bad' }
      ]
    },
    {
      title: 'Scouts',
      items: [
        { label: 'Total', count: scoutsTotal(), cls: 'main' },
        { label: 'Available', count: S.scoutsAvailable },
        { label: 'Working', count: scoutsWorking() },
        { label: 'Cooldown', count: S.scoutsCooldown }
      ]
    },
    {
      title: 'Predators',
      items: [
        { label: 'Total', count: predatorsTotal(), cls: 'main' },
        { label: 'Available', count: S.predatorsAvailable },
        { label: 'Working', count: predatorsWorking() },
        { label: 'Cooldown', count: S.predatorsCooldown },
        { label: 'Fort Duty', count: predatorsFortDuty() }
      ]
    },
    {
      title: 'Immatures',
      items: [
        { label: 'Eggs', count: sumCohort(S.eggs) },
        { label: 'Larvae', count: sumCohort(S.larva) },
        { label: 'Cocoons', count: sumCohort(S.cocoon) },
        { label: 'Nymphs', count: sumCohort(S.nymph) }
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

function renderMap() {
  if (typeof document === 'undefined') return;
  const wrap = document.getElementById('mapWrap');
  const fortsTag = document.getElementById('fortsTag');
  if (!wrap) return;

  const aliveForts = S.forts.filter(f => f.alive);
  if (fortsTag) {
    fortsTag.textContent = `${aliveForts.length}/${S.forts.length} forts standing`;
  }

  wrap.innerHTML = '';

  /* ---- Nest Icon ---- */
  const nestImg = document.createElement('img');
  nestImg.src = '/hive/assets/nest_icon.png';
  nestImg.className = 'map-icon nest-icon';
  nestImg.style.left = S.nest.x + '%';
  nestImg.style.top = S.nest.y + '%';
  nestImg.title = 'The Nest — Click to view Nest Analytics';
  nestImg.onclick = openNestAnalytics;
  wrap.appendChild(nestImg);

  /* ---- Fort Icons ---- */
  const activeFortEvent = S.events.find(e => e.type === 'fort' && e.status === 'pending');
  const activeTargetId = activeFortEvent ? activeFortEvent.targetFortId : null;

  let nearestAliveId = null;
  if (!activeTargetId) {
    let minD = Infinity;
    aliveForts.forEach(f => {
      const d = dist(S.nest, f);
      if (d < minD) {
        minD = d;
        nearestAliveId = f.id;
      }
    });
  }

  S.forts.forEach(f => {
    const fortImg = document.createElement('img');
    fortImg.src = '/hive/assets/fort_icon.png';
    let cls = 'map-icon fort-icon';

    const isUnderAssault = activeTargetId === f.id;

    if (!f.alive) {
      cls += ' fallen';
      fortImg.title = `Fort #${f.id} (Fallen)`;
    } else if (isUnderAssault) {
      cls += ' under-attack';
      fortImg.title = `Fort #${f.id} UNDER ASSAULT! Click to view defense options`;
      fortImg.onclick = () => openEventDetails(activeFortEvent.id);
    } else if (nearestAliveId === f.id) {
      cls += ' nearest';
      fortImg.title = `Fort #${f.id} (Nearest Standing Fort)`;
    } else {
      fortImg.title = `Fort #${f.id} (Standing)`;
    }

    fortImg.className = cls;
    fortImg.style.left = f.x + '%';
    fortImg.style.top = f.y + '%';
    wrap.appendChild(fortImg);
  });

  /* ---- Active Map Events (Scouts & Predators) ---- */
  const activeMapEvents = S.events.filter(e => {
    if (e.status !== 'pending') return false;
    if (e.type === 'search' && e.outcome) return false;
    if (e.type === 'hunt' && (e.neutralized + e.killed >= e.groupSize)) return false;
    return e.type === 'search' || e.type === 'hunt';
  });

  activeMapEvents.forEach(e => {
    if (e.x === undefined || e.y === undefined) assignEventCoords(e);

    const container = document.createElement('div');
    container.className = 'map-event';
    container.style.left = e.x + '%';
    container.style.top = e.y + '%';

    const iconImg = document.createElement('img');
    iconImg.className = 'map-icon event-icon';

    if (e.type === 'search') {
      iconImg.src = '/hive/assets/scout.png';
      iconImg.title = 'Scout Search Patrol — Click to interact';
    } else {
      iconImg.src = '/hive/assets/predator.png';
      const activeHunters = e.groupSize - (e.neutralized + e.killed);
      iconImg.title = `Hunting Party (${activeHunters}/${e.groupSize} predators active) — Click to interact`;
    }

    iconImg.onclick = (ev) => {
      ev.stopPropagation();
      const isOpen = container.classList.contains('open');
      document.querySelectorAll('.map-event.open').forEach(el => el.classList.remove('open'));
      if (!isOpen) container.classList.add('open');
    };

    const infoBtn = document.createElement('button');
    infoBtn.className = 'map-event-btn info';
    infoBtn.textContent = 'i';
    infoBtn.title = 'View details';
    infoBtn.onclick = (ev) => {
      ev.stopPropagation();
      container.classList.remove('open');
      openEventDetails(e.id);
    };

    const leftBtn = document.createElement('button');
    leftBtn.className = 'map-event-btn left';

    const rightBtn = document.createElement('button');
    rightBtn.className = 'map-event-btn right';
    rightBtn.textContent = '✕';

    if (e.type === 'search') {
      leftBtn.textContent = '⚡';
      leftBtn.title = `Distract Scout (−${S.settings.costDistractScout} pt)`;
      leftBtn.disabled = S.points < S.settings.costDistractScout;
      leftBtn.onclick = (ev) => {
        ev.stopPropagation();
        distractScout(e.id);
      };

      rightBtn.title = `Kill Scout (−${S.settings.costKillScout} pt)`;
      rightBtn.disabled = S.points < S.settings.costKillScout;
      rightBtn.onclick = (ev) => {
        ev.stopPropagation();
        killScout(e.id);
      };
    } else {
      leftBtn.textContent = '🏃';
      leftBtn.title = `Help Human Escape (−${S.settings.costEscapePredator} pt)`;
      leftBtn.disabled = S.points < S.settings.costEscapePredator;
      leftBtn.onclick = (ev) => {
        ev.stopPropagation();
        escapePredator(e.id);
      };

      rightBtn.title = `Kill Predator (−${S.settings.costKillPredator} pt)`;
      rightBtn.disabled = S.points < S.settings.costKillPredator;
      rightBtn.onclick = (ev) => {
        ev.stopPropagation();
        killPredatorAction(e.id);
      };
    }

    container.appendChild(infoBtn);
    container.appendChild(leftBtn);
    container.appendChild(rightBtn);
    container.appendChild(iconImg);
    wrap.appendChild(container);
  });
}

function renderLog(){
  if (typeof document === 'undefined') return;
  const list = document.getElementById('logList');
  if(!list) return;
  list.innerHTML = '';
  S.log.slice(0,60).forEach(entry=>{
    const li = document.createElement('li');
    li.innerHTML = '<span style="color:#666">[S: '+entry.step+']</span> '+entry.msg;
    list.appendChild(li);
  });
}

function renderChart(){
  if (typeof document === 'undefined') return;
  if(typeof Chart === 'undefined'){
    const wrap = document.querySelector('.graph-wrap');
    if(wrap && !wrap.dataset.warned){
      wrap.dataset.warned = '1';
      wrap.innerHTML = '<div class="empty-note">Chart library failed to load. Population data is still tracked in the Field Log and stat panel.</div>';
    }
    return;
  }
  const labels = S.history.map(h=>h.step);
  const humansData = S.history.map(h=>h.humans);
  const insectsData = S.history.map(h=>h.insects);

  if(!chart){
    const canvas = document.getElementById('popChart');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    chart = new Chart(ctx, {
      type:'line',
      data:{
        labels: labels,
        datasets:[
          { label:'Humans', data:humansData, borderColor:'#7ea23c', backgroundColor:'rgba(126,162,60,0.08)', borderWidth:2, tension:0.25, pointRadius:0, fill:true },
          { label:'Insects', data:insectsData, borderColor:'#a8402c', backgroundColor:'rgba(168,64,44,0.08)', borderWidth:2, tension:0.25, pointRadius:0, fill:true }
        ]
      },
      options:{
        responsive:true, 
        maintainAspectRatio:false,
        plugins:{ legend:{display:false} },
        scales:{
          x:{ 
            ticks:{ color:'#000000', font:{family:'IBM Plex Mono', size:10} }, 
            grid:{ color:'#cccccc' }, 
            title:{ display:true, text:'Step', color:'#000000', font:{size:10, weight:'bold'} } 
          },
          y:{ 
            ticks:{ color:'#000000', font:{family:'IBM Plex Mono', size:10} }, 
            grid:{ color:'#cccccc' } 
          }
        }
      }
    });
  } else {
    chart.data.labels = labels;
    chart.data.datasets[0].data = humansData;
    chart.data.datasets[1].data = insectsData;
    chart.update();
  }
}

function renderOverlay(){
  if (typeof document === 'undefined') return;
  const ov = document.getElementById('gameOverOverlay');
  if(!ov) return;
  if(S.gameOver){
    document.getElementById('overTitle').textContent = S.humans<=0 ? 'Humanity Has Fallen' : 'The Nest Has Collapsed';
    document.getElementById('overText').textContent = S.gameOverMsg + ' Survived ' + S.step + ' step(s) (~' + Math.round(S.step*12/24*10)/10 + ' days).';
    ov.classList.remove('hidden');
  } else {
    ov.classList.add('hidden');
  }
}

function setupCollapseButtons() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.panel-collapse-btn').forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const panel = btn.closest('.panel');
      if (panel) {
        panel.classList.toggle('collapsed');
      }
    };
  });
}

/* ============================= EVENT LISTENERS SETUP ============================= */
function initUIEventListeners() {
  if (typeof document === 'undefined') return;

  const closeX = document.getElementById('nestAnalyticsCloseX');
  if (closeX) closeX.onclick = closeNestAnalytics;
  const nestOverlay = document.getElementById('nestAnalyticsOverlay');
  if (nestOverlay) {
    nestOverlay.addEventListener('click', (ev) => {
      if (ev.target.id === 'nestAnalyticsOverlay') closeNestAnalytics();
    });
  }

  const setBtn = document.getElementById('settingsBtn');
  if (setBtn) setBtn.onclick = openSettings;
  const setClose = document.getElementById('settingsCloseX');
  if (setClose) setClose.onclick = closeSettings;
  const setDone = document.getElementById('settingsDoneBtn');
  if (setDone) {
    setDone.onclick = () => {
      initGame();
      closeSettings();
    };
  }
  const setOv = document.getElementById('settingsOverlay');
  if (setOv) {
    setOv.addEventListener('click', (ev) => {
      if (ev.target.id === 'settingsOverlay') closeSettings();
    });
  }

  const goClose = document.getElementById('gameOverCloseX');
  if (goClose) goClose.onclick = closeGameOverOverlay;
  const goOv = document.getElementById('gameOverOverlay');
  if (goOv) {
    goOv.addEventListener('click', (ev) => {
      if (ev.target.id === 'gameOverOverlay') closeGameOverOverlay();
    });
  }

  const edClose = document.getElementById('eventDetailCloseX');
  if (edClose) edClose.onclick = closeEventDetails;
  const edOv = document.getElementById('eventDetailOverlay');
  if (edOv) {
    edOv.addEventListener('click', (ev) => {
      if(ev.target.id === 'eventDetailOverlay') closeEventDetails();
    });
  }

  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.map-event')) {
      document.querySelectorAll('.map-event.open').forEach(el => el.classList.remove('open'));
    }
  });

  const rBtn = document.getElementById('restartBtn');
  if (rBtn) {
    rBtn.onclick = () => {
      setSetupEnabled(true);
      initGame();
    };
  }

  setupCollapseButtons();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUIEventListeners);
  } else {
    initUIEventListeners();
  }
}

/* ============================= DATA COLLECTION ============================= */
function extractStateVector(state) {
  const eggCount = sumCohort(state.eggs);
  const larvaCount = sumCohort(state.larva);
  const cocoonCount = sumCohort(state.cocoon);
  const nymphCount = sumCohort(state.nymph); 
  const aliveForts = state.forts ? state.forts.filter(f => f.alive).length : 0;
  const conqueredForts = state.fortsConquered || 0;

  return [
    state.humans / 1000,
    state.food / 5000,
    scoutsTotal() / 100,
    predatorsTotal() / 100,
    eggCount / 200,
    larvaCount / 200,
    cocoonCount / 100,
    nymphCount / 100,
    aliveForts / 10,
    conqueredForts / 10
  ];
}

function runDataCollection(numRuns = 200, stepsPerRun = 150, outputFile = 'simulation_dataset.json') {
  const dataset = [];

  for (let r = 0; r < numRuns; r++) {
    initGame();
    S.phase = 'active';

    // Dispatch initial scouts on step 0
    const n = S.scoutsAvailable;
    S.scoutsAvailable = 0;
    for (let i = 0; i < n; i++) {
      const e = { id: nid(), type: 'search', status: 'pending', outcome: null };
      assignEventCoords(e);
      S.events.push(e);
    }

    for (let t = 0; t < stepsPerRun; t++) {
      if (S.gameOver) break;

      const currentVec = extractStateVector(S);
      const conqueredBefore = S.fortsConquered || 0; // Track conquest count before step
      
      advanceStep();
      
      const nextVec = extractStateVector(S);
      const deltaVec = nextVec.map((val, idx) => val - currentVec[idx]);
      
      // Determine if a conquest occurred during this step transition
      const conqueredAfter = S.fortsConquered || 0;
      const conquestOccurred = conqueredAfter > conqueredBefore ? 1 : 0;

      dataset.push({ 
        input: currentVec, 
        target: deltaVec,
        conquest: conquestOccurred // Included binary event target for multi-task training
      });
    }
  }

  if (fs) {
    fs.writeFileSync(outputFile, JSON.stringify(dataset, null, 2));
    console.log(`Generated ${dataset.length} state transition samples saved to ${outputFile}.`);
  } else {
    console.log(`Generated ${dataset.length} state transition samples (in-memory mode).`);
  }

  return dataset;
}

/* Exports & Auto-run Guard */
if (isNode) {
  module.exports = {
    freshState,
    initGame,
    advanceStep,
    extractStateVector,
    runDataCollection
  };

  // Only run dataset generation automatically if executed directly via Node (`node generate_dataset.js`)
  if (require.main === module) {
    runDataCollection();
  }
}