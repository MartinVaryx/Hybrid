# script.js — Engine Documentation
*Generated for AI-assisted debugging. Covers data flow, contracts, known gotchas, and storage behaviour. Not a tutorial.*

---

## 1. Global State — Master Reference

### Flags & Mode Booleans
| Variable | Type | Initial | Meaning |
|---|---|---|---|
| `gameOn` | bool | `false` | Set `true` only after hero confirmed. `proceed()` is a no-op while `false`. |
| `hero_selected` | bool | `false` | Set `true` after hero confirmed OR weapon selected. Guards `toggleBuilder(true)`. |
| `hero_created` | bool | `true` | Set `false` when a new character is created (has unspent SP). Governs "unspent SP" prompt in `toggleBuilder(false)`. |
| `sequential_msgs_done` | bool | `false` | Tracks whether a challenge node's sequential messages have finished playing. |
| `is_conflict` | bool | `false` | `true` while an enemy is active. Set by `updateUI()` based on `enemy !== null`. |
| `is_action_phase` | bool | `false` | `true` when current challenge node has `difficulty` + `threat`. Set by `runActionPhase()` and `updateUI()`. |
| `inputs_frozen` | bool | `false` | When `true`, card-tray and adrenaline clicks are blocked. `updateUI()` shows "ČAKAJ...". |
| `chase_mode` | bool | `false` | `true` when either side is actively escaping. Governs `resolveConflict()` branching. |
| `player_escaping` | bool | `false` | Player clicked Escape. `chase_mode` becomes `true`. |
| `enemy_escaping` | bool | `false` | Enemy AI decided to flee. |
| `cards_are_flipped` | bool | `false` | `true` when the card zone display is visually flipped (player/enemy zones swapped). Toggled by `#flip-cards-btn`. |
| `DEBUG` | const bool | `false` | Skips hero-selection and weapon-selection overlays. Auto-picks index 0 and weapon index 0. |

### Combat State
| Variable | Type | Meaning |
|---|---|---|
| `enemy` | string\|null | Active enemy type key into `ENEMY_TYPES`. `null` = no combat. |
| `enemy_id` | string\|null | Instance key into `CHALLENGES` (e.g. `"SKAUTKA_2"`). Used for `saved_stress` memory. |
| `enemy_stress` | int | Current enemy stress. Compared against `ENEMY_TYPES[enemy].stress_thresh`. |
| `enemy_advantage` | int | Enemy's accumulated advantage modifier on rolls. |
| `advantage` | int | Player's accumulated advantage modifier. |
| `weapon` | int | **Active combat intensity** of the player's currently selected weapon (0 = bare hands). Set by weapon dropdown `change` event. NOT the same as `HERO.weapon`. |
| `skill` | int | Active skill level for current roll. Set by skill dropdown `change` event. |
| `stress` | int | **Deprecated/shadowed global.** A `let stress = 0` exists at module level but is never read by the game engine; `HERO.stress` is the authoritative value. |
| `stress_thresh` | const int | `8`. A module-level constant that mirrors the default `HERO.stress_thresh`. Unused at runtime; `HERO.stress_thresh` is the authoritative value. |
| `turn` | `"p"` \| `"e"` | Whose move it is this half-round. |
| `move` | int | 0 = nobody moved yet, 1 = one side moved, 2 = both moved → triggers `resolveConflict()`. |
| `round` | int | Total rounds elapsed. Incremented on every `resolveConflict()` completion. |
| `player_action` | `[type, card]` \| null | e.g. `["A","O"]`. Set in `handleConflictInput()`. |
| `enemy_action` | `[type, card]` \| null | Set in `enemyChoice()` / `proceedWithEnemyChoice()`. |
| `player_escape_counter` | int | Steps toward successful player escape. Needs ≥ 2 to succeed. |
| `enemy_escape_counter` | int | Steps toward enemy escape. Needs ≥ 2 to succeed. |
| `player_zero_counter` | int | Consecutive rounds where player escape counter stayed at 0. Used for advantage logic. |
| `enemy_zero_counter` | int | Same for enemy. |
| `combat_starter` | `"p"` \| `"e"` \| null | Who went first this round. Alternates each round. |
| `player_turn_timeout` | timeout\|null | Handle for a pending player-turn message timer. Cleared on state transitions to prevent stale messages. |
| `conflict_difficulty` | const int | `6`. Fixed difficulty threshold used in all enemy conflicts (distinct from challenge-node `difficulty`). |
| `conflict_threat` | const int | `2`. Number of DH dice rolled for threat checks in enemy conflicts. |

### Navigation State
| Variable | Type | Meaning |
|---|---|---|
| `current_challenge_key` | string | Key of the currently active challenge node. Initial: `"START"`. |
| `challenge_history` | string[] | Stack of visited challenge keys. Used for Back button. |
| `pending_challenge_key` | string\|array\|null | Challenge to go to after combat ends. Set when an array target contains an enemy mid-sequence. |
| `pre_encounter_challenge_key` | string\|null | Where the player was before entering combat. Used for escape routing. |
| `proceed_target` | function\|string\|null | Callback or challenge key stored for the Proceed button click. |
| `DELAYED` | string[] | **`const` array** of mod strings (e.g. `"stress+1"`) deferred until a node with `trigger_delayed` is reached. |

---

## 2. Static Data Structures

### `HERO` (const object — mutated in place)
The **single source of truth** for the active character in memory. Never replaced; mutated via `Object.assign` or key deletion + reassign.

```
HERO = {
  name:           string       — UPPERCASE
  skills:         {name: int}  — e.g. {"STREĽBA": 1, "VRHANIE": 1} (initial placeholder)
  stress:         int          — current stress (mutable in-game)
  stress_thresh:  int          — collapse threshold (default 8)
  sp:             int          — skill points for builder
  weapons:        string[]     — MUTABLE in-game arsenal (consumed throwing weapons removed here)
  ammo:           {name: int}  — MUTABLE in-game ammo counts
  items:          {name: int}  — MUTABLE in-game item counts
  weapon:         int          — UNUSED at runtime (always 0 after load). Active weapon intensity lives in global `weapon`.
  defaultWeapons: string[]     — SNAPSHOT set at creation/load. Never touched in-game.
  defaultAmmo:    {name: int}  — SNAPSHOT set at creation/load. Never touched in-game.
  defaultItems:   {name: int}  — SNAPSHOT set at creation/load. Never touched in-game.
  isInitialPhase: bool         — true while character creation is incomplete (builder not yet closed)
  humanity:       int          — builder field, not used by game engine
  initialSkillsSnapshot: {}   — builder field, not used by game engine
}
```

**Critical invariant:** `weapons/ammo/items` are the in-game mutable copies. `defaultWeapons/Ammo/Items` are the reset snapshots. `syncHeroToStorage()` explicitly preserves the `default*` fields from localStorage, preventing in-game state from overwriting them.

### `HEROES` (let — initialized as `{}`, rebuilt as array)
Array of character objects matching `HERO` shape. Declared as `let HEROES = {}` but rebuilt as a proper array inside `Promise.all`. `HEROES[activeCharIdx]` is the currently active one. Built from localStorage on load; rebuilt on `toggleBuilder(false)`.

**⚠ Partial fix applied:** The `Promise.all` "new stock heroes" branch (merged path) now correctly includes `defaultWeapons/defaultAmmo/defaultItems` in `HEROES[]` entries. However, the "saved only" branch (no new stock heroes) still omits these fields — so `HEROES[n].defaultWeapons` may be `undefined` for returning players whose saved roster hasn't changed. The `storage` event listener was updated separately and now always includes `default*` fields. Only the localStorage record is reliably correct in all paths.

### `CHALLENGES` (let object — loaded from JSON)
Map of all challenge nodes. Keys are node names (e.g. `"SHACK_0"`). Each node can have:
- `initial_msg`, `initial_msg_1..N` — sequential narrative text
- `difficulty`, `threat` — if present, node is an action phase
- `choice_A..F`, `case_A..F` — branching choices
- `case_success`, `case_threat`, `case_threat_delayed` — outcomes
- `next` — auto-advance without player input
- `back: true` — show Back button
- `type` — if present, node is an enemy wrapper (value = enemy type key)
- `saved_stress` — written by engine after enemy retreats, read on re-encounter
- `image` — background image URL
- `skills` — array of skill names valid for this challenge node
- `trigger_delayed` — mod strings checked against `DELAYED` on node entry
- `enemy_escape`, `enemy_escape_delayed` — routing on enemy escape
- `ACTIVE` sub-key — map of challenge names → bool for enable/disable

### `ENEMY_TYPES` (let object — loaded from JSON)
Map of enemy type templates. Each entry: `{ skill, weapon, stress_thresh, image, ranged? }`.

### `SKILLS_DB` (let object — loaded from JSON, also exposed as `window.SKILLS_DB`)
Map of skill name → `[category_int, group_string, related_skills_array, description_string]`.

```
SKILLS_DB[name] = [
  0: int     — category / base cost multiplier (e.g. 1, 2, 3)
  1: string  — skill group name (e.g. "DANOSTI", "BOJ", "SOMORA")
  2: string[] — related skill names used for SP discount calculation (up to top 3 used)
  3: string  — human-readable description shown in builder tooltips
]
```

`category_string` (index 1) is checked for `"BOJ"` to classify combat vs non-combat skills in `populatePlayerSkillsDropdown()`. Index 1 `"SOMORA"` marks skills that consume `humanity` on purchase.

### `WEAPON_LIST` (const)
```
{
  "BOJ Z DIAĽKY": { "pištoľ":1, "samopal":2, "brokovnica":2 },
  "BOJ ZBLÍZKA":  { "nôž":1, "sekera":2, "mačeta":2, "ostne":1,
                    "hryzadlá":2, "klepetá":2, "kyselina":3, "žihadlo":3 },
  "VRHACIE":      { "nôž":1 }
}
```
Lookup by category then name → damage integer. A weapon can appear in multiple categories (nôž is in both ZBLÍZKA and VRHACIE).

### `WEAPON_SKILLS` (const)
Maps damage level (as string `"1"`–`"4"`) → list of skill names valid for that weapon tier.

### `ITEM_LIST` / `INITIAL_WEAPONS` / `INITIAL_AMMO`
- `ITEM_LIST`: global (not `const`, not `let` — implicit global). Mirrored to `window.ITEM_LIST`.
- `INITIAL_WEAPONS`: string[] of weapon names offered at new character creation.
- `INITIAL_AMMO`: `{name: int}` — starting ammo for weapons that use it.

### `CARDS` (const)
```
{ "O": [[caution, [defend_dice]], [base, [attack_dice]]], ... }
```
Four cards: O, R, S, B. Index 0 = defend side, index 1 = attack side. Sub-index 0 = base modifier, sub-index 1 = dice array.

### `DEFENSE_SKILLS` / `CHASE_SKILLS` (const arrays)
- `DEFENSE_SKILLS`: `["OBRATNOSŤ","ODOLNOSŤ","ZMYSLY","ŠPRINT"]` — valid for defend action in combat.
- `CHASE_SKILLS`: `["OBRATNOSŤ","ZMYSLY","ŠPRINT","ŠPLHANIE"]` — valid for escape/pursuit defend action.

### `FLAGS` (implicit global)
Not declared at top level. Created inside `executeMods()` if needed. Stores arbitrary boolean/numeric game flags set via `flag_KEY:value` or `flag_KEY+/-amount` mod strings.

---

## 3. localStorage Contract

**Key:** `'characters'`  
**Format:** JSON array of character objects (builder format, not game format).

### Builder format (what goes IN to localStorage):
```
{
  name, sp, skills, stress, items,
  isInitialPhase, initialSkillsSnapshot, humanity,
  defaultWeapons: string[],
  defaultAmmo:    {name: int},
  defaultItems:   {name: int}
}
```
Note: `weapons` and `ammo` (in-game copies) are NOT stored. Only `default*` fields persist.

### Game format (what `HEROES[]` entries look like, built FROM localStorage):
```
{
  name (UPPERCASE), sp, skills, stress, stress_thresh, weapon (=0),
  isInitialPhase, humanity, initialSkillsSnapshot,
  weapons:        [...defaultWeapons],   ← copied from default at load time
  ammo:           {...defaultAmmo},
  items:          {...defaultItems},
  defaultWeapons, defaultAmmo, defaultItems   ← also kept for reference
}
```

### Writers to localStorage and what they preserve:

| Writer | Preserves `default*`? | Notes |
|---|---|---|
| `syncHeroToStorage()` | ✅ Yes — explicitly reads `existing.default*` and keeps them | Called on every `updateUI()` |
| `toggleBuilder(false)` normal close | ✅ Yes — reads from localStorage, maps `defaultWeapons→weapons` | Also rebuilds `HEROES[]` |
| `deleteCharacterGlobally()` | ✅ Yes — maps from `h.defaultWeapons` | **⚠ But** `h.defaultWeapons` may be `undefined` if loaded via `Promise.all` (see Bug 4 in session history) |
| `createNewCharacterGlobally()` | ✅ Yes | Writes new hero with empty `default*` (weapon not chosen yet) |
| `selectInitialWeapon()` confirm | ❌ **NO** | Writes to `HERO` in memory only. Never persists to localStorage before calling `toggleBuilder(true)`. |
| SP mod in `executeMods()` | ✅ Partial | Writes SP directly, preserves rest via spread. |
| `Promise.all` merge branch | ✅ Yes (localStorage record) | But `HEROES[]` entries miss `default*` fields |

---

## 4. Function Reference

### Navigation

#### `handleChallengeTransition(caseTarget)`
**The central router.** All navigation, mod execution, and enemy deployment flows through here. Accepts a string, an array, or a challenge key. Returns nothing — side effects only.

**Full resolution order (checked top to bottom, first match wins and returns):**

1. **Null guard** — if `!caseTarget`, return immediately.

2. **`if_` prefix → conditional branch** — delegates to `ifCase()`, which parses the flag condition and calls `handleChallengeTransition()` recursively with the resolved true/false target. Returns after the delegate call.

3. **`"restart"` (case-insensitive) → `restartGame()`** — shows confirm prompt, then `window.location.reload()`.

4. **`BACK_ACTION_N` prefix → history navigation** — parses step count N. Removes the last `(N-1)` entries from `challenge_history`, then pops and re-navigates to the resulting top-of-stack destination via a recursive `handleChallengeTransition()` call. Does NOT push history on the way down. Returns after the delegate call.

5. **`CHALLENGES["ACTIVE"][target] === false` → silent abort** — if the target key is explicitly disabled, execution stops with no side effect (debug log only).

6. **Array → `processNextElement()` sequential chain** — walks the array left to right:
   - If the current element is a `CHALLENGES` key whose node has a `.type` that exists in `ENEMY_TYPES`: sets `pending_challenge_key` to the remainder of the array (single item = scalar, multiple = array), calls `handleChallengeTransition(element)` to start combat, and **stops** walking (combat owns control from here).
   - If the current element is itself directly an `ENEMY_TYPES` key: same as above — set `pending_challenge_key`, delegate, stop.
   - Otherwise (mod string or navigation key): calls `handleChallengeTransition(element)` immediately. If it was a mod string AND more elements remain, freezes inputs for 500 ms then continues to the next element. Non-mods continue immediately without delay.

7. **Enemy wrapper unwrap** — if `caseTarget` is a string that exists in `CHALLENGES` and that node has a `.type` key whose value exists in `ENEMY_TYPES`:
   - Sets `instanceKey = caseTarget` (e.g. `"SKAUTKA_2"`) — this becomes `enemy_id`.
   - Sets `pre_encounter_challenge_key = current_challenge_key` — used for escape routing.
   - Reassigns `actualTarget = enemyType` (e.g. `"Skautka"`) — falls through to step 8.

8. **`ENEMY_TYPES` key → enemy deployment** — see *Enemy Deployment Flow* below. Returns after setup.

9. **`CHALLENGES` key → navigate to node** — see *Challenge Node Entry Flow* below. Returns after setup.

10. **Mod string → `executeMods()`** — if none of the above matched and the string contains `+`, `-`, or `=`, delegates to `executeMods()`. If it returns `true`, unfreezes inputs and calls `updateUI()`.

11. **Unhandled → warning log** — logs `"Warning: Unhandled routing instruction..."` to the terminal.

---

#### Enemy Deployment Flow (step 8 expanded)

When `handleChallengeTransition` reaches an `ENEMY_TYPES` key (either directly or after wrapper unwrap):

```
inputs_frozen = true
updateUI()

setTimeout(300ms):
  Clear all dice animation pools from DOM

  enemy = actualTarget           (e.g. "Skautka")
  enemy_id = instanceKey         (e.g. "SKAUTKA_2", or same as enemy if no wrapper)
  enemy_stress = CHALLENGES[instanceKey].saved_stress OR 0
    ↑ Persistent enemy memory: if this enemy previously retreated,
      its stress was saved. It resumes with that value.
  enemy_escaping = false
  is_conflict = true
  move = 0
  combat_starter = null

  Show enemy sprite (entrance animation)

  Read wrapper node's initial_msg (immediate log, if present)
  Collect sequential msgs: initial_msg_1, initial_msg_2, ...N (all present keys)

  IF sequential msgs exist:
    Log initial_msg_1
    IF this is the last msg:
      proceed(() => {
        log("⚔️ Priprav sa na boj!")
        proceed(() => {
          inputs_frozen = false
          updateUI()
          gameloop(false)       ← starts combat
        })
      })
    ELSE:
      currentMsgIdx++
      proceed(showNextCombatNarrative)   ← gates on player clicking Proceed each time

  ELSE (no sequential msgs, only initial_msg or nothing):
    log("⚔️ Priprav sa na boj!")
    proceed(() => {
      inputs_frozen = false
      updateUI()
      gameloop(false)
    })
```

**Key timing:** Combat only starts after the player clicks Proceed through all narrative messages. Each sequential message requires one Proceed click. The final "⚔️ Priprav sa na boj!" message requires one more click before `gameloop()` is called.

**`pending_challenge_key` role:** If this combat was initiated from an array sequence (step 6 above), `pending_challenge_key` holds what comes after. On combat end (enemy dead / player escape / enemy escape), the routing logic checks `pending_challenge_key` first and routes there instead of `activeChallenge.case_success`.

---

#### Challenge Node Entry Flow (step 9 expanded)

```
IF current_challenge_key !== actualTarget AND caseTarget is not BACK_ACTION_:
  challenge_history.push(current_challenge_key)

current_challenge_key = actualTarget

runActionPhase()
  ↓ returns true (chainOwned) if it started a sequential message chain
  ↓ in that case, caller returns immediately — sequence owns control

IF chainOwned: return

IF current_challenge_key changed during runActionPhase (rare re-entry): return

activeChallenge = CHALLENGES[actualTarget]

IF activeChallenge.next exists:
  proceed(activeChallenge.next)   ← auto-advance, no choices shown
  return

renderChallengeChoices(activeChallenge)
```

---

#### `runActionPhase()`
Called on every challenge node entry. Resets all combat state and sets up the node's environment.

```
enemy = null
is_conflict = false
player_action = null
enemy_action = null
move = 0
hidecards(true)
Hide enemy sprite, remove enemy dice pool

current_challenge.difficulty = activeChallenge.difficulty
current_challenge.threat = activeChallenge.threat

proceedWithPhase():
  1. DELAYED trigger check (see below)
  2. Show/hide challenge-stats-display based on difficulty/threat presence
     → sets is_action_phase = true/false
  3. Log initial_msg (or node key if absent)
  4. Log difficulty/threat values if present
  5. inputs_frozen = false; updateUI()
  6. Collect sequential msgs (initial_msg_1..N)
     IF sequential msgs exist:
       inputs_frozen = true; updateUI()
       Log initial_msg_1, gate on proceed()
       On last msg:
         IF activeChallenge.next: proceed(() → handleChallengeTransition(next))
         ELSE: inputs_frozen = false; renderChallengeChoices()
       Otherwise: currentMsgIdx++; proceed(showNextNarrativeMessage)
       → Returns true (chainOwned) to caller

Image handling (wraps proceedWithPhase()):
  IF activeChallenge.image:
    IF already set as --bg-image: call proceedWithPhase() directly
    ELSE: create temp Image, on load → set --bg-image, fade-in, call proceedWithPhase()
  ELSE: remove --bg-image, call proceedWithPhase()
```

**`trigger_delayed` check** (inside `proceedWithPhase`, runs before anything else):
```
FOR each effect in activeChallenge.trigger_delayed:
  IF effect exists in DELAYED[]:
    DELAYED.splice(index, 1)   ← consume it (one-shot)
    handleChallengeTransition(effect)
    IF effect does NOT contain "+": return immediately
      ↑ Non-additive effects (e.g. destination keys) take over routing.
      ↑ Additive effects (e.g. "stress+1") execute and let the node continue.
```

**Return value:** `runActionPhase()` itself has no explicit return value, but if it starts a sequential chain it sets `chainOwned = true` which the caller checks via the local variable returned from the inner `proceedWithPhase()` scope. Actually: `runActionPhase` is `void`; the check `if (chainOwned)` in the caller reads the return of `runActionPhase()`, which is `undefined` unless `proceedWithPhase` is structured to bubble it — in practice the sequential chain case early-returns inside the async `proceed()` gate chain, leaving the caller's `if (chainOwned)` check as a falsy guard. The net effect is correct: if sequential messages exist, `renderChallengeChoices` is never reached by the caller.

---

#### `renderChallengeChoices(activeChallenge)`
Builds the choice button UI. Called only after `runActionPhase()` establishes the node.

```
Preload images for all case_X targets that have images.

IF activeChallenge.back === true AND challenge_history.length > 0:
  Add Back button (⬅) targeting "BACK_ACTION_1"

FOR each suffix A–F:
  IF choice_X and case_X both exist:
    IF CHALLENGES["ACTIVE"][case_X] === false: skip
    Add button → onClick: hide prompt, handleChallengeTransition(case_X)

IF validChoices.length > 0 AND (has real choices OR node has no difficulty):
  inputs_frozen = true
  Show choice-prompt div with all buttons
ELSE:
  inputs_frozen = false; updateUI()
  ↑ This fires when a node has no choices and no auto-next — e.g. pure action phase nodes
    where the card tray is the input mechanism.
```

Back button is always rendered last (bottom-left, black background), separate from the choice button flow.

---

#### `ifCase(caseTarget)`
Parses conditional routing strings. Two syntax forms:

**Full form:** `"if_FLAGKEY==VALUE_TRUETARGET_else_FALSETARGET"`
**Short form:** `"if_FLAGKEY_TRUETARGET_else_FALSETARGET"` — assumes `== true`

Supported operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `:`, `=` (`:` and `=` both treated as `==`).

Type coercion: string `"true"`/`"false"` → bool; numeric strings → number. Both sides coerced before comparison.

If condition passes → `handleChallengeTransition(trueTarget)`. If fails and `falseTarget` exists → `handleChallengeTransition(falseTarget)`. If fails and no `falseTarget` → console error, no navigation.

Reads from `FLAGS` global. If `FLAGS` is undefined or the key is absent, treats current value as `false`.

---

#### `proceed(target)`
**Gate function.** Stores `target` in `proceed_target`, shows the `#proceed-prompt` button. No-op if `!gameOn`.

When the player clicks the Proceed button:
1. Hides `#proceed-prompt`
2. Sets `inputs_frozen = true`
3. Clears all dice animation pools from DOM
4. Clears `#enemy-card-container` and `#player-card-container` innerHTML
5. If `proceed_target` is a function: calls it directly
6. If `proceed_target` is a string: calls `handleChallengeTransition(proceed_target)`

`proceed()` also calls `preloadImages(target)` immediately on registration, before the player clicks — pre-warms image cache for the next likely destination.

---

#### `executeMods(caseTarget)` → bool
Parses mod strings. Returns `true` if anything was executed, `undefined`/falsy otherwise.

**`flag_` prefix — FLAGS manipulation:**
- `"flag_KEY+N"` / `"flag_KEY-N"` — increment/decrement `FLAGS[KEY]` (initialises to 0 if absent)
- `"flag_KEY:VALUE"` — assign `FLAGS[KEY]`; auto-converts `"true"` → bool, `"false"` → bool, numeric strings → number

**`=` operator — reset/assign combat stats:**
- `"difficulty=X"` — resets `current_challenge.difficulty` to the node's original value from `CHALLENGES` (ignores X, always reads from node)
- `"threat=X"` — same for `current_challenge.threat`
- `"advantage=X"` — sets `advantage = parseInt(X)`
- `"enemy_advantage=X"` — sets `enemy_advantage = parseInt(X)`

**`set_` prefix — enable/disable challenge nodes:**
- `"set_CHALLENGENAME_true"` / `"set_CHALLENGENAME_false"` — writes to `CHALLENGES["ACTIVE"][CHALLENGENAME]`. Initialises `CHALLENGES["ACTIVE"]` if absent. Name is extracted as everything between `"set_"` and the last `"_"`.

**`+` / `-` operators — incremental modifications (checked in this priority order):**
- `"stress+N"` / `"stress-N"` — modifies `HERO.stress`. Clamps to 0 min. If stress exceeds `stress_thresh` → freezes inputs, logs failure, calls `restartGame()`.
- `"sp+N"` / `"sp-N"` — modifies `HERO.sp` (clamps to 0). Also writes the new value directly to `localStorage['characters']` by name-match. Initialises `HERO.sp` to 0 if undefined.
- `"enemy_advantage+N"` / `"enemy_advantage-N"` — modifies `enemy_advantage` (clamps to 0).
- `"advantage+N"` / `"advantage-N"` — modifies `advantage` (clamps to 0).
- `"difficulty+N"` / `"difficulty-N"` — modifies `current_challenge.difficulty` (clamps to 0).
- `"threat+N"` / `"threat-N"` — modifies `current_challenge.threat` (clamps to 0).
- `"weapon+WEAPONNAME"` — pushes `weaponName` (lowercased, first word only) to `HERO.weapons` if not already present. Calls `populateWeaponDropdown()`. No-ops silently if already owned.
- `"WEAPONNAME+N"` / `"WEAPONNAME-N"` — if `parts[0]` matches any key in any `WEAPON_LIST` category: modifies `HERO.ammo[weaponName]` by N (clamps to 0). The IIFE check scans all categories before deciding.
- `"item_ITEMNAME+N"` / `"item_ITEMNAME-N"` — modifies `HERO.items[ITEMNAME]` (clamps to 0). Only operates if `ITEM_LIST[ITEMNAME]` exists.

**Important:** `executeMods` is called from `handleChallengeTransition` (step 10), from inside `resolveActionPhase` for `case_threat` processing, and from `trigger_delayed` handling inside `runActionPhase`. It does **not** call `updateUI()` itself — callers are responsible for that after it returns `true`.

---

### Combat

#### `gameloop(fromCard, fromCycle?)`
Entry point for each combat turn. If `enemy === null`, calls `runActionPhase()` (should not happen in normal flow — a fail-safe). Otherwise calls `runConflictTurn()`.

#### `runConflictTurn()`
Orchestrates a half-round.

```
IF move === 0 (start of new round):
  IF combat_starter === null: randomly pick "p" or "e"
  ELSE: flip from last round (p→e, e→p)
  turn = combat_starter

IF turn === "e" AND move < 2:
  inputs_frozen = true; updateUI()
  setTimeout(1000ms): enemyChoice()

IF turn === "p" AND move < 2:
  inputs_frozen = false; updateUI()
  IF enemy went first: show "SOM READY" prompt → player clicks ready → enemyChoice()
  IF player goes first: player clicks a card → handleConflictInput()
```

#### `handleConflictInput(actionType, cardCode)`
Called when player clicks a card zone in conflict mode (after validation by the card-tray click listener).

```
player_action = [actionType, cardCode]   ("A"/"D", "O"/"R"/"S"/"B")
move++
turn = "e"
runGameloopCycle() → enemyChoice() after delay
```

The card-tray click listener pre-validates: blocks if `inputs_frozen`, blocks non-defense skills in attack, blocks insufficient ammo for ranged weapons, blocks wrong skill type for chase.

#### `enemyChoice()` → `proceedWithEnemyChoice()`
AI decision. `enemyChoice()` shows a brief visual delay and logs a hint; `proceedWithEnemyChoice()` sets `enemy_action` and calls `resolveConflict()`.

**Chase mode logic:**
- If `enemy_escaping`: 70% chance D (flee), 30% chance A (turn and fight; sets `chase_mode = false`)
- If `player_escaping` and enemy has no ranged weapon and `player_escape_counter >= 1`: force D (pure pursuit)
- Otherwise: react to player card with normal AI

**Normal mode logic (simplified):** AI chooses A or D card based on player's chosen card and random weights.

After setting `enemy_action`: `move++`. If `move >= 2`: `resolveConflict()`.

#### `resolveConflict()`
Both sides have acted. Full resolution in this order:

```
Roll dice for both sides (with advantage + adrenaline already factored in logging)
enemy_roll += enemy_advantage
player_roll += (advantage + adrenaline)
```

**Priority 1 — Mutual escape (both sides chose D while both escaping):**
```
IF chase_mode AND player_escaping AND enemy_escaping AND both actions are "D":
  Log mutual flee
  enemy_escape_counter += 2  (instant enemy escape)
  Write enemy_escape_delayed → DELAYED[]
  Reset all combat state
  Route: enemy_escape > pending_challenge_key > case_success
  return
```

**Priority 2 — Escaping side attacked (chase cancellation):**
```
IF chase_mode:
  IF player_escaping AND player_action[0] === "A":
    chase_mode = false; player_escaping = false; player_escape_counter = 0
    (fall through to damage calc)
  IF enemy_escaping AND enemy_action[0] === "A":
    chase_mode = false; enemy_escaping = false; enemy_escape_counter = 0
    (fall through to damage calc)
```

**Priority 3 — Chase counter evaluation (if chase_mode still active):**

*Player escaping:*
```
IF player_roll > enemy_roll: player_escape_counter++
ELSE IF enemy_roll > player_roll AND enemy_action === "A": log hit (no counter change)
ELSE IF enemy_roll > player_roll: player_escape_counter = max(0, counter - 1)
ELSE (tie): no change

IF player_escape_counter >= 2:
  Player escapes → reset combat → route (see Escape Routing below)
  return
```

*Enemy escaping:*
```
IF enemy_roll > player_roll: enemy_escape_counter++
ELSE IF player_roll > enemy_roll AND player_action === "A": log hit (no counter change)
ELSE IF player_roll > enemy_roll: enemy_escape_counter = max(0, counter - 1)
ELSE (tie): no change

IF enemy_escape_counter >= 2:
  Enemy escapes → HERO.sp++ (+1 BR) → route (see Escape Routing below)
  return
```

**Priority 4 — Simultaneous damage calculation (if nobody escaped):**
```
IF player_roll >= enemy_roll AND player_action === "A":
  potential_enemy_damage = max(0, card_base_modifier + weapon - enemy_caution)
  (enemy_caution = CARDS[enemy_action[1]][0][0] only if enemy chose "D", else 0)

IF player_roll <= enemy_roll AND enemy_action === "A":
  potential_player_damage = max(0, card_base_modifier + ENEMY_TYPES[enemy].weapon - player_caution)
  (player_caution = CARDS[player_action[1]][0][0] only if player chose "D", else 0)

Apply damage: enemy_stress += potential_enemy_damage; HERO.stress += potential_player_damage
```

**Priority 5 — Death checks:**
```
player_dead = HERO.stress > stress_thresh
enemy_dead  = enemy_stress > ENEMY_TYPES[enemy].stress_thresh

IF both dead: log mutual kill → restartGame()
IF player dead only: log defeat → restartGame()
IF enemy dead only:
  HERO.sp++ (+1 BR)
  Reset combat state
  Route: pending_challenge_key > case_success
  return
```

**Priority 6 — Advantage updates (both survived):**
```
IF NOT player_escaping:
  IF (player wins AND chose D AND enemy_zero_counter > 1) OR (tie AND player D, enemy A AND enemy_zero_counter > 1):
    advantage++

IF NOT enemy_escaping:
  IF (enemy wins AND chose D AND player_zero_counter > 1) OR (tie AND enemy D, player A AND player_zero_counter > 1):
    enemy_advantage++

(zero_counters increment each round a side's escape_counter stays at 0; reset otherwise)
```

**Priority 7 — Threat checks for mutual D choices:**
```
IF both chose "D":
  IF player_roll <= conflict_difficulty (6): schedule checkConflictThreat(player_roll, false, player_action) at delay
  IF enemy_roll <= conflict_difficulty (6): schedule checkConflictThreat(enemy_roll, true, enemy_action) at delay+1500ms
```

**Priority 8 — Reset and loop:**
```
move = 0; round++; player_action = null; enemy_action = null
setTimeout(delay + 2000ms): gameloop(false)
```

#### Escape Routing After Combat

**Player successfully escapes (`player_escape_counter >= 2`):**
```
IF bothEscaping (mutual flee triggered):
  pre_encounter_challenge_key = null
  Route: pending_challenge_key > case_success

ELSE IF pre_encounter_challenge_key exists:
  escapeTarget = pre_encounter_challenge_key
  IF CHALLENGES[escapeTarget].type is in ENEMY_TYPES:
    ↑ We came from an encounter wrapper itself — step back further
    escapeTarget = challenge_history[last] or null
  pre_encounter_challenge_key = null; pending_challenge_key = null
  handleChallengeTransition('BACK_ACTION_' + escapeTarget)
  ↑ Uses BACK_ACTION_ prefix to avoid re-pushing history

ELSE:
  Route: pending_challenge_key > case_success
```

**Enemy successfully escapes (`enemy_escape_counter >= 2`):**
```
Write enemy_escape_delayed → DELAYED[]
Reset combat state
Route: enemy_escape > pending_challenge_key > case_success
```

**Enemy dead:**
```
Reset combat state
Route: pending_challenge_key > case_success
```

#### `checkConflictThreat(roll, isEnemy, action)`
Rolls `conflict_threat` (= 2) DH dice. Checks against `CARDS[action[1]][0][0]` (card caution).

If `threat_roll > caution`:
- Enemy's bad roll (isEnemy=true): in chase → decrement relevant escape counter; in normal → `advantage++`
- Player's bad roll (isEnemy=false): in chase → decrement relevant escape counter + `HERO.stress++`; in normal → `enemy_advantage++`; checks stress collapse

#### `resolveActionPhase(card)`
Non-combat challenge roll. Called by the card-tray click listener when `!enemy`.

```
inputs_frozen = true; updateUI()
roll_result = rollDice(card, false, skill)  ← defend-side only, no attack
roll_result += adrenaline
success = roll_result >= current_challenge.difficulty
is_tie_or_failure = roll_result <= current_challenge.difficulty

Log success or failure message.

IF is_tie_or_failure:
  Roll current_challenge.threat DH dice
  IF threat_roll > CARDS[card][0][0] (caution): threat_realized = true

setTimeout(300ms):
  IF threat_realized:
    Push case_threat_delayed → DELAYED[]
    Execute case_threat:
      IF string: executeMods(case_threat)
      IF array: processNextThreatMod() chain (500ms between mods)

  IF success:
    HERO.sp++ (+1 BR)
    Push case_success_delayed → DELAYED[]
    proceed(activeChallenge.case_success)
  ELSE:
    Push case_failure_delayed → DELAYED[]
    proceed(activeChallenge.case_failure)
```

`case_threat` mods execute **before** routing to `case_success` or `case_failure`. The threat can therefore modify stats (e.g. `stress+1`) that the player carries into the next node, regardless of whether they succeeded or failed the roll.

---

### Character System

#### `selectHero()`
Shows hero selection overlay (dynamically created, appended to `.gaming-table-floor`). On confirm: calls `switchCharacterGlobally()`, sets `hero_selected=true`, `gameOn=true`, removes overlay, calls `handleChallengeTransition()`.

**⚠ Overlay elements** `hero-display-name` and `hero-skills-grid` are dynamically created here and destroyed on confirm. They do NOT exist in the static HTML. Any code calling `updateHeroDisplay()` after this overlay is gone will crash on null unless guarded.

#### `updateHeroDisplay()`
Updates `hero-display-name` and `hero-skills-grid`. Has null guard: returns early if either element is missing. Safe to call any time.

#### `switchCharacterGlobally(newIdx)`
Sets `activeCharIdx`, clears and re-assigns `HERO` via `Object.assign(HERO, HEROES[newIdx])`. Ensures `stress_thresh` and `weapon` defaults. Calls `updateUI()` and syncs to builder iframe if open.

#### `createNewCharacterGlobally(name)`
Creates new hero with empty `skills/weapons/ammo/items` and `defaultWeapons:[]/defaultAmmo:{}/defaultItems:{}`. Sets `isInitialPhase:true`. Pushes to `HEROES[]`, sets `activeCharIdx` to last index, assigns to `HERO`. Saves to localStorage. Then calls `selectInitialWeapon()`.

#### `selectInitialWeapon()`
Shows weapon-selection overlay. On confirm: adds `chosenWeapon` to `HERO.weapons` and `HERO.defaultWeapons`, adds ammo to `HERO.ammo` and `HERO.defaultAmmo`.

**⚠ Does NOT save to localStorage.** `HERO` is updated in memory only. `toggleBuilder(true)` is called immediately after. When builder is later closed, `toggleBuilder(false)` reads from localStorage → overwriting memory → weapon is lost.

**Fix needed:** persist `defaultWeapons` and `defaultAmmo` to localStorage immediately after assignment, before calling `toggleBuilder(true)`.

#### `deleteCharacterGlobally()`
Takes no parameters (ignore any passed argument). Splices `HEROES[]`, adjusts index, updates `HERO`, saves to localStorage via `HEROES.map(h => ({...h.defaultWeapons || []}))`.

**⚠ Guard:** if `HEROES.length <= 1`, returns early without deleting or clearing `isInitialPhase`. This caused infinite prompt loops (now partially mitigated in `toggleBuilder`).

#### `toggleBuilder(show)`
Opens or closes the builder iframe overlay (`builder-overlay` / `builder-iframe`).

**Open path (`show=true`):** Guards against `is_conflict`, `is_action_phase`, `!hero_selected`. Sets `iframe.src = 'builder/index.html'`. On iframe load: calls `iframe.contentWindow.syncCharacterFromParent(activeCharIdx)`.

**Close path (`show=false`):**
1. Reads `activeHero` fresh from localStorage
2. If `isInitialPhase`: shows "incomplete creation" prompt → on confirm, deletes or clears flag, then closes overlay directly (no recursion)
3. If `!hero_created && sp > 0`: shows "unspent SP" prompt → on confirm, sets `hero_created=true`, recurses `toggleBuilder(false)`
4. Normal: calls `updateHeroDisplay()` (safe now with null guard), rebuilds `HEROES[]` from localStorage, re-assigns `HERO`, calls `updateUI()`, hides overlay, blanks iframe src.

#### `syncHeroToStorage()`
Called inside every `updateUI()`. Reads current `HEROES` name-match from localStorage, merges `HERO` over it but **explicitly re-applies** `existing.defaultWeapons/Ammo/Items` to prevent in-game consumption from overwriting defaults.

---

### UI

#### `updateUI()`
Called constantly. Always calls `syncHeroToStorage()` first. 

Steps:
1. Update `player-advantage`, `sp` display
2. Filter `HERO.weapons` — remove throwing weapons with 0 ammo, log removal
3. Show/hide Escape button
4. Update weapon dropdown option text (name + dmg + ammo count)
5. Rebuild skill dropdown from `HERO.skills`, filtering biological weapons (they go to `HERO.weapons` instead)
6. Update stress track and adrenaline nodes
7. If `enemy === null`: hide enemy panel, set challenge mode, update `is_action_phase`
8. If `enemy !== null`: show enemy panel, update stress/advantage/skill/weapon display, set conflict mode
9. Update turn indicator text based on `inputs_frozen`, `is_conflict`, `turn`

#### `populateWeaponDropdown()`
Rebuilds weapon dropdown from `HERO.weapons`. For each weapon: looks up damage in `WEAPON_LIST`, checks `INITIAL_AMMO` and `HERO.ammo` for ammo display. Does NOT modify any state.

#### `populatePlayerSkillsDropdown()`
Rebuilds skill dropdown from `HERO.skills`. Biological weapons (`OSTNE`, `HRYZADLÁ`, `KLEPETÁ`, `KYSELINA`, `ŽIHADLO`) are pushed to `HERO.weapons` instead of the dropdown. Calls `populateWeaponDropdown()` after.

#### `log(message, className, extraSpacing)`
Appends a line to `#terminal-screen`. Auto-scrolls. CSS classes: `"danger-msg"`, `"success-msg"`, `"failure-msg"`, `"info-msg"`, `"system-msg"`, `"narrative-msg"`, `"error-msg"`.

#### `rollDice(cardCode, attack, skillLevel, isEnemy)` → int
Looks up card in `CARDS`. Picks defend (0) or attack (1) side. Rolls listed dice. If `skillLevel >= 6`: adds a D6, reduces skillLevel by 6. Remaining skill levels: each adds a DH (coin flip: 0 or 1). Calls `triggerDiceVisualAnimation()`. Returns total.

#### `triggerDiceVisualAnimation(diceRolls, isEnemy)`
Creates a `.dice-animation-pool` div in `.gaming-table-floor`. Renders die images and labels. Enemy dice use `enemy-pool` class, player use `player-pool`. Previous pool of same type is removed first.

#### `showGeneralPrompt(text, onConfirm, onCancel, input)`
Shows `#general-prompt` modal. Clones buttons to strip old listeners. If `!onConfirm && !onCancel && !input`: message-only mode (OK button, no cancel). If `input`: shows text input. Closes on confirm/cancel.

#### `showMenu()` / `hideMenu()`
Shows/hides `#main-menu` element.

#### `restartGame()`
Shows confirm prompt. On confirm: `window.location.reload()`. Note: SP upgrades persist via localStorage; in-game items/progress do not.

---

### Event Listeners

| Element | Event | Handler |
|---|---|---|
| `#player-skill-dropdown` | `change` | Sets global `skill`. In combat: validates combat/defense classification. In challenge: validates against `activeChallenge.skills`. |
| `#player-weapon-dropdown` | `change` | Sets global `weapon` (damage integer). Logs to terminal. |
| `#card-tray-container` | `click` | In conflict: validates skill/weapon/ammo/chase rules, calls `handleConflictInput()`. In action phase: calls `resolveActionPhase()`. |
| `#escape-btn` | `click` | Toggles `player_escaping`. Sets/clears `chase_mode`. |
| `#adrenaline-track-row` | `click` | Sets `HERO.stress` to clicked node's value, stores adrenaline value in `#adrenaline-select`. |
| `#proceed-btn` | `click` | Executes `proceed_target` (function or `handleChallengeTransition`). |
| `#ready-btn` | `click` | Hides ready prompt, calls `enemyChoice()` after 500ms. |
| `#flip-cards-btn` | `click` | Swaps visual top/bottom of card zones, toggles `cards_are_flipped`. |
| `document` | `keydown` | Space → clicks proceed or ready button if visible. Arrow keys / Enter → navigate hero selection during `selectHero()`. |
| `window` | `storage` | Debounced 250ms. On `characters` key change: rebuilds `HEROES[]` from `e.newValue`. Updates `HERO.skills/sp/isInitialPhase` only (not weapons/ammo). Uses `stockHeroesData` if defined. |

---

## 5. Challenge Routing — Detailed Data Flow

This section traces all routing paths from a player action to the final state change, including the full lifecycle of arrays, enemy wrappers, `pending_challenge_key`, `DELAYED`, and the `proceed()` gate.

### 5a. Simple String Navigation

```
Player clicks choice button "Go to CITY"
  └─ renderChallengeChoices onClick → handleChallengeTransition("CITY")
       └─ "CITY" in CHALLENGES → enter node
            └─ challenge_history.push(current_challenge_key)
               current_challenge_key = "CITY"
               runActionPhase()
                 └─ Reset combat state
                    Set current_challenge.difficulty / .threat from node
                    Load background image (if any) → fade-in
                    proceedWithPhase():
                      Check DELAYED triggers → none
                      Show/hide challenge-stats-display
                      Log initial_msg
                      inputs_frozen = false; updateUI()
                      No sequential msgs → return
               renderChallengeChoices(CHALLENGES["CITY"])
                 └─ Build choice buttons; show prompt; inputs_frozen = true
```

---

### 5b. Array Sequence With Mods Then Navigation

Target: `["stress+1", "CITY"]`

```
handleChallengeTransition(["stress+1", "CITY"])
  └─ Array → processNextElement()
       i=0: "stress+1"
         → not an enemy wrapper, not in ENEMY_TYPES
         → isModification = true (contains "+")
         → handleChallengeTransition("stress+1")
              └─ executeMods("stress+1"): HERO.stress++; return true
                 inputs_frozen = false; updateUI()
         → i++ = 1; isModification=true AND i < length
         → inputs_frozen = true; updateUI()
         → setTimeout(500ms):
              inputs_frozen = false
              processNextElement()
                i=1: "CITY"
                  → not enemy, not in ENEMY_TYPES
                  → isModification = false
                  → handleChallengeTransition("CITY")  ← normal node entry
                  → processNextElement() called immediately (i++ = 2, exits)
```

---

### 5c. Array Sequence With Enemy Mid-Chain

Target: `["stress+1", "SKAUTKA_2", "CITY"]`

```
handleChallengeTransition(["stress+1", "SKAUTKA_2", "CITY"])
  └─ Array → processNextElement()
       i=0: "stress+1"
         → isModification=true
         → handleChallengeTransition("stress+1") → executeMods → HERO.stress++
         → i++ = 1
         → setTimeout(500ms): processNextElement()
              i=1: "SKAUTKA_2"
                → CHALLENGES["SKAUTKA_2"] exists AND .type = "Skautka" ∈ ENEMY_TYPES
                → remainder = ["CITY"]  (caseTarget.slice(2))
                → pending_challenge_key = "CITY"  ← stored for post-combat routing
                → handleChallengeTransition("SKAUTKA_2")
                     └─ Wrapper unwrap:
                          instanceKey = "SKAUTKA_2"
                          pre_encounter_challenge_key = current_challenge_key
                          actualTarget = "Skautka"
                        Enemy deployment:
                          inputs_frozen = true; setTimeout(300ms)
                          enemy = "Skautka"; enemy_id = "SKAUTKA_2"
                          enemy_stress = CHALLENGES["SKAUTKA_2"].saved_stress OR 0
                          is_conflict = true; move = 0; combat_starter = null
                          Read wrapper msgs → proceed() gate chain
                          → combat starts via gameloop(false)
                return  ← processNextElement() stops; array walk is done
```

After combat, enemy collapses:
```
resolveConflict() → enemy_dead:
  HERO.sp++
  Reset: enemy=null, is_conflict=false, ...
  IF pending_challenge_key ("CITY"):
    nextChallenge = "CITY"; pending_challenge_key = null
    proceed("CITY")
      → player clicks Proceed → handleChallengeTransition("CITY")
```

---

### 5d. Enemy Wrapper: Narrative Sequence Timing

Wrapper node `SKAUTKA_2`: `{ type: "Skautka", initial_msg: "X", initial_msg_1: "Y", initial_msg_2: "Z" }`

```
Enemy deployment (inside setTimeout 300ms):
  Log "X" immediately (initial_msg)
  sequentialMsgs = ["Y", "Z"]

  currentMsgIdx = 0
  showNextCombatNarrative():
    Log "Y"  (initial_msg_1)
    currentMsgIdx (0) !== last (1) → currentMsgIdx++ = 1
    proceed(showNextCombatNarrative)   ← Proceed button now shown

  [Player clicks Proceed]
    showNextCombatNarrative():
      Log "Z"  (initial_msg_2)
      currentMsgIdx (1) === last (1) → final message
      proceed(() => {
        log("⚔️ Priprav sa na boj!")
        proceed(() => {
          inputs_frozen = false; updateUI()
          gameloop(false)   ← combat starts
        })
      })

  [Player clicks Proceed → "⚔️ Priprav sa na boj!"]
  [Player clicks Proceed again → gameloop starts]
```

Total player clicks required before combat: 1 per `initial_msg_N` + 2 (battle cry + start).  
For a node with 2 sequential messages: **4 Proceed clicks** before combat begins.

---

### 5e. BACK_ACTION Navigation

`BACK_ACTION_N` takes the player N steps back in history. The steps parameter controls how far back the history is trimmed before popping the destination.

```
challenge_history = ["START", "FOREST", "CAVE"]
current_challenge_key = "CAVE"

handleChallengeTransition("BACK_ACTION_2")
  └─ steps = 2
     stepsToTake = min(steps-1, history.length-1) = min(1, 2) = 1
     challenge_history.splice(length - 1, 1)
       → removes "CAVE" from history
       → challenge_history = ["START", "FOREST"]
     destination = challenge_history[last] = "FOREST"
     challenge_history.pop()  → challenge_history = ["START"]
     handleChallengeTransition("FOREST")
       └─ "FOREST" in CHALLENGES
          challenge_history.push(current_challenge_key)  ← "CAVE" re-added
          current_challenge_key = "FOREST"
          runActionPhase() → renderChallengeChoices()
```

`BACK_ACTION_1` returns to the immediately previous node (removes 0 intermediate entries, pops the destination and re-navigates to it).

**Note:** History is NOT pushed for the `BACK_ACTION_` call itself (the prefix check in `handleChallengeTransition` prevents the history push on the string form), but the clean `handleChallengeTransition(destination)` call DOES push history normally (since `destination` is a plain string at that point). This means the destination is re-added to history cleanly.

---

### 5f. Conditional Branching (`if_`)

```
handleChallengeTransition("if_door-open==true_ROOM_else_LOCKED")
  └─ ifCase("if_door-open==true_ROOM_else_LOCKED")
       parts = ["if_door-open==true_ROOM", "LOCKED"]
       falseTarget = "LOCKED"
       ifPart = "door-open==true_ROOM"
       match: flagKey="door-open", operator="==", rawValue="true", trueTarget="ROOM"
       
       currentFlagValue = FLAGS["door-open"] OR false
       processedTarget = true  (coerced from "true")
       
       IF FLAGS["door-open"] === true:
         handleChallengeTransition("ROOM")
       ELSE:
         handleChallengeTransition("LOCKED")
```

Short form `"if_door-open_ROOM_else_LOCKED"` is identical but assumes `== true`.

---

### 5g. DELAYED Queue Lifecycle

`DELAYED` is a `const` array (contents mutable, reference fixed). Items are pushed in and consumed on arrival at nodes that declare `trigger_delayed`.

**Producers (push to DELAYED):**
- `resolveActionPhase()` success: `case_success_delayed`
- `resolveActionPhase()` failure: `case_failure_delayed`
- `resolveActionPhase()` threat: `case_threat_delayed`
- `resolveConflict()` enemy escape: `enemy_escape_delayed`
- `resolveConflict()` mutual escape: `enemy_escape_delayed`

**Consumer (splice from DELAYED):**
- `runActionPhase()` → `proceedWithPhase()` at every node entry:
  ```
  FOR each effect in activeChallenge.trigger_delayed:
    index = DELAYED.indexOf(effect)
    IF index !== -1:
      DELAYED.splice(index, 1)   ← consumed; won't fire again
      handleChallengeTransition(effect)
      IF effect does NOT include "+":
        return  ← navigation/non-additive effect takes over routing
  ```

**Semantics:**
- Items are matched by exact string equality.
- Multiple items can fire at the same node if the node lists them all in `trigger_delayed`.
- Additive effects (containing `+`) execute and allow further processing to continue.
- Non-additive effects (destination keys, flag assignments) take over routing and return immediately.
- Items survive in `DELAYED` across any number of nodes until a matching `trigger_delayed` node is reached.
- `DELAYED` is never cleared globally — items only leave via `splice` on consumption.

---

### 5h. Post-Combat Routing Decision Tree

After any combat conclusion (enemy death, player escape, enemy escape):

```
Determine outcome type:
  A. Enemy dead
  B. Player escape (player_escape_counter >= 2)
  C. Enemy escape (enemy_escape_counter >= 2)
  D. Mutual flee (both D in chase while both escaping)

For each outcome:

A. Enemy dead:
   IF pending_challenge_key: proceed(pending_challenge_key); pending = null
   ELSE: proceed(CHALLENGES[current_challenge_key].case_success)

B. Player escape:
   IF bothEscaping (rare: mutual flee already handled as D, but fallback):
     pre_encounter_challenge_key = null
     IF pending: proceed(pending); pending = null
     ELSE: proceed(case_success)
   ELSE IF pre_encounter_challenge_key:
     escapeTarget = pre_encounter_challenge_key
     IF CHALLENGES[escapeTarget].type ∈ ENEMY_TYPES:
       escapeTarget = challenge_history[last]  ← step further back
     pre_encounter_challenge_key = null; pending = null
     handleChallengeTransition("BACK_ACTION_" + escapeTarget)
   ELSE IF pending: proceed(pending); pending = null
   ELSE: proceed(case_success)

C. Enemy escape:
   Push enemy_escape_delayed → DELAYED[]
   IF activeChallenge.enemy_escape: proceed(enemy_escape)
   ELSE IF pending: proceed(pending); pending = null
   ELSE: proceed(case_success)

D. Mutual flee:
   Push enemy_escape_delayed → DELAYED[]
   IF activeChallenge.enemy_escape: proceed(enemy_escape)
   ELSE IF pending: proceed(pending); pending = null
   ELSE: proceed(case_success)
```

**`pre_encounter_challenge_key` lifecycle:**
Set when a challenge wrapper node is unwrapped (step 7 of `handleChallengeTransition`). Cleared when player escapes successfully. Never cleared on enemy death or enemy escape — it carries over if the player enters another combat from the same location.

---

## 6. Initialisation Sequence

```
Page load
  → Static variables declared
  → HERO constant defined (default placeholder values)
  → Event listeners attached
  → Promise.all([CHALLENGES, ENEMY_TYPES, HEROES.json, skillsDB])
      → stockHeroesData = heroesData  (module-level, used by storage listener)
      → window.SKILLS_DB = skillsDbData
      → Merge saved localStorage chars with new stock heroes
      → Build HEROES[] from merged array
          ✅ "new stock heroes" branch: HEROES[] entries NOW include defaultWeapons/defaultAmmo/defaultItems
          ⚠ "saved only" branch: HEROES[] entries STILL missing defaultWeapons/defaultAmmo/defaultItems
      → Save merged to localStorage (if new stock heroes added)
      → selectHero()
      → populateWeaponDropdown()
```

**Hero selection flow (new character):**
```
selectHero() overlay shown
  → User clicks "NOVÝ HRDINA"
      → createNewCharacterGlobally(name)
          → New hero pushed to HEROES[], assigned to HERO
          → Saved to localStorage (empty default*)
          → selectInitialWeapon()
              → Weapon overlay shown
              → User confirms weapon
                  → HERO.weapons, HERO.defaultWeapons, HERO.ammo, HERO.defaultAmmo updated
                  ⚠ NOT saved to localStorage here
                  → toggleBuilder(true) called
                      → builder iframe opens
              → User closes builder
                  → toggleBuilder(false)
                      → Reads HEROES from localStorage
                      ⚠ localStorage has empty default* (weapon was never saved)
                      → HERO overwritten with empty weapons/ammo
```

**Hero selection flow (existing character):**
```
selectHero() overlay shown
  → User confirms existing hero
      → switchCharacterGlobally(idx)
          → HERO = HEROES[idx] (which has weapons/ammo from defaultWeapons/defaultAmmo at load)
      → hero_selected = true, gameOn = true
      → overlay.remove()
      → handleChallengeTransition(current_challenge_key)
```

---

## 7. Data Flow: Defaults Lifecycle

```
SOURCE (HEROES.json or user creation)
  → defaultWeapons / defaultAmmo / defaultItems defined

LOAD TIME
  → localStorage record preserves default*
  → HEROES[n].weapons = [...defaultWeapons]   ← in-game copy
  → HEROES[n].ammo    = {...defaultAmmo}
  → HEROES[n].items   = {...defaultItems}
  ✅ "new stock heroes" branch: HEROES[n].defaultWeapons now included
  ⚠ "saved only" branch: HEROES[n].defaultWeapons still undefined

GAME PLAY
  → HERO.weapons / ammo / items mutated freely
  → syncHeroToStorage() on every updateUI():
      reads existing.defaultWeapons from localStorage (NOT from HEROES[])
      merges HERO over it, re-applies existing.default* on top
      → defaults in localStorage are safe from in-game consumption

STORAGE LISTENER (builder changes)
  ✅ Storage event listener now always maps defaultWeapons/defaultAmmo/defaultItems
     into rebuilt HEROES[] entries (fixed). Updates HERO.skills/sp/isInitialPhase only.

BUILDER CLOSE
  → toggleBuilder(false) reads localStorage
  → HEROES[] rebuilt: weapons = char.defaultWeapons, ammo = char.defaultAmmo
  → HERO = HEROES[activeCharIdx]  ← reset to defaults

NEW CHARACTER WEAPON ASSIGNMENT
  ⚠ HERO.defaultWeapons updated in memory
  ⚠ NOT written to localStorage
  → toggleBuilder opens, closes
  → localStorage overrides memory → weapon lost
  FIX: persist to localStorage immediately after weapon confirm
```

---

## 8. Known Gotchas & Invariants

1. **`weapon` (global int) ≠ `HERO.weapon`** — The dropdown sets the global `weapon` variable. `HERO.weapon` is always 0 at runtime and unused by combat.

2. **`updateHeroDisplay()` is safe** — Has null guard. But was previously called without guard from `toggleBuilder(false)`, causing crashes because `hero-display-name`/`hero-skills-grid` are dynamic elements that only exist during `selectHero()`.

3. **Throwing weapons auto-remove** — `updateUI()` removes any weapon from `HERO.weapons` if it's in `WEAPON_LIST["VRHACIE"]` and `HERO.ammo[name] === 0`. This fires on every `updateUI()` call (i.e. constantly).

4. **`proceed()` is a no-op before game starts** — `gameOn` must be `true`. Set in `confirmHeroSelection()`.

5. **`INITIAL_AMMO` check for ranged fire** — Ammo is only decremented if the weapon appears in `INITIAL_AMMO`. Weapons not in `INITIAL_AMMO` fire freely.

6. **`chase_mode` can be set in two places** — By `escape-btn` click (player), or inside `proceedWithEnemyChoice()` when enemy decides to flee. Both set `enemy_escaping` or `player_escaping` accordingly.

7. **History is NOT pushed for BACK_ACTION_ transitions** — The prefix is stripped, the target is navigated to, but `challenge_history.push` is skipped.

8. **`FLAGS` is an implicit global** — Not declared with `let`/`const`. Created inside `executeMods()`. Accessible globally but not declared at module top.

9. **`ITEM_LIST` is an implicit global** — Also not declared with `let`/`const`. Mirrored to `window.ITEM_LIST`.

10. **`modificationExecuted` in `handleChallengeTransition`** — Implicit global (line 527, no declaration). Works due to accidental global scope.

11. **`stockHeroesData`** — Module-level `let` (line 10). Assigned in `Promise.all` `.then()`. Used by `storage` event listener to re-merge stock heroes when localStorage changes. Was previously `heroesData` (a `.then()` parameter, out of scope in the listener).

12. **Biological weapon skills** — Skills named `OSTNE`, `HRYZADLÁ`, `KLEPETÁ`, `KYSELINA`, `ŽIHADLO` are intercepted in both `populatePlayerSkillsDropdown()` and `updateUI()` and pushed directly to `HERO.weapons` instead of appearing in the skill dropdown.

13. **`deleteCharacterGlobally()` signature mismatch** — Defined with 0 parameters; called with `activeCharIdx` at line 2866 (ignored). Always uses the current global `activeCharIdx`.

14. **`player_zero_counter` typo in chase threat** — Line 2019: `player_escape_counter = Math.max(0, enemy_escape_counter - 1)` — uses `enemy_escape_counter` instead of `player_escape_counter`. Bug exists in current version.

15. **`HEROES` initialized as `{}` but used as array** — `let HEROES = {}` at declaration. Immediately overwritten as an array inside `Promise.all`. Any code that runs before `Promise.all` resolves and reads `HEROES` will get an empty object, not an array.

16. **`stress` / `stress_thresh` shadow** — Module-level `let stress = 0` and `const stress_thresh = 8` exist but are never read by the engine at runtime. All game logic uses `HERO.stress` and `HERO.stress_thresh`. These dead globals can mislead debugging.

17. **`DELAYED` is `const`** — Declared `const DELAYED = []`. The array contents are mutated (pushed/spliced) in-game, which is valid for a `const` array reference, but it cannot be replaced or reset by reassignment. Code must use splice/pop to clear it.

18. **`saveState()` in builder also persists `skillsDB_new`** — `saveState()` writes both `characters` and `skillsDB_new` to localStorage. Edits made in the skill editor are therefore persistent across sessions even without an explicit export.

---

## 9. Builder — `script_builder.js`

The builder runs in an iframe (`builder/index.html`) and communicates with the parent via `window.parent.*` calls. It operates on its own local copy of `characters[]` (loaded from localStorage via `syncCharacterFromParent()`) and `skillsDB_new` (loaded from localStorage or the parent's `SKILLS_DB`).

### Builder State Variables

| Variable | Meaning |
|---|---|
| `characters` | Local array of character objects (builder format). Mirrors localStorage `'characters'`. |
| `activeCharIdx` | Index of the currently edited character. Set by `syncCharacterFromParent()`. |
| `skillsDB_new` | Local working copy of the skills database. Read from localStorage `'skillsDB_new'` on load; falls back to parent's `SKILLS_DB`. |
| `selectedSkill` | Name of the currently highlighted skill in the builder list. |
| `editingRels` | Array of related skill names being edited in the skill editor panel. |
| `upgradeHistory` | Stack of upgrade/downgrade actions for undo support. |
| `isSyncing` | Guard flag to prevent re-entrant sync calls. |

### `skillsDB_new` Entry Format

```
skillsDB_new[name] = [
  0: int      — category / base SP cost multiplier
  1: string   — skill group (e.g. "DANOSTI", "BOJ", "SOMORA")
  2: string[] — related skill names (top 3 used for SP discount)
  3: string   — description shown in tooltip
]
```

### SP Cost Formula

**Phase 1 (isInitialPhase = true):**
```
discount = sum of top 3 related skill levels owned
cost = max(targetLevel, (targetLevel × category) − discount)
```
Spending the last SP triggers phase transition: `isInitialPhase = false`, `sp = 20`, `initialSkillsSnapshot` frozen.

**Phase 2 (isInitialPhase = false):**
Uses `getOptimalCostsForPhase2()` — a bounded branch-and-bound search (max 100 paths) that finds the cheapest SP ordering to reach the current build. SP balance = total hero budget − optimal cost of current build.

**`SOMORA` group:** each SP spent also costs 1 `humanity`. If `humanity ≤ cost`, upgrade is blocked.

**Skill limits:** max 16 skills total. Max 6 skills in Phase 1 (`isInitialPhase`).

### Key Builder Functions

#### `upgradeSelected()` / `downgradeSkill()` / `undoUpgrade()`
Manage skill level changes. Phase 1 uses simple linear history; Phase 2 recalculates the full optimal cost diff on every change. Undo pops `upgradeHistory` and restores state.

#### `filterBuilder()`
Filters the builder skill list by search text and group. In Phase 1, only shows skills in the `"DANOSTI"` group.

#### `saveState()`
Merges `characters[]` back into localStorage `'characters'` (char wins on conflicts, existing keys survive for fields not in char). Also persists `skillsDB_new` to localStorage `'skillsDB_new'`. Called after every upgrade/downgrade.

#### `saveSkill()` / `deleteSkill()` / `exportSkills()`
Skill editor CRUD. `saveSkill()` writes `[cat, group, editingRels, description]` into `skillsDB_new` then calls `saveState()`. `exportSkills()` downloads `skillsDB_new` as `skillsDB_new.json`. `deleteSkill()` prompts for confirmation before removing.

#### `renderStats()`
Renders the character sheet preview (`#character-stats`). Positions name, SP (BR), and humanity fields absolutely on a background image. Renders up to 16 skill slots across 2 columns of 8. Truncates skill names to 18 characters.

#### `initSkillTooltips()`
Attaches delegated `mouseover`/`mousemove`/`mouseout` listeners to the document. Shows a `.skill-tooltip` div with the skill's description (index 3 from `skillsDB_new`) when hovering any `.skill-list-item` that has a non-empty `data-description` attribute.

#### `renderStats()` — mobile vs PC
`renderStats()` detects `window.innerWidth <= 768`. On mobile: renders a flex header row with name, humanity, SP. On PC: places fields at absolute percentage positions for the character sheet image.

#### Character sheet export (html2canvas)
An export function uses `html2canvas` to rasterize `#character-stats` at 1050×1485px. On mobile, temporarily forces fixed dimensions and absolute positioning on all skill slots, hides `.mobile-header-row`, and applies a column-2 translateX fix for alignment. Restores all styles after capture. Downloads as `{name}_dennik.png`.

### Cross-iframe Communication

| Direction | Call | Purpose |
|---|---|---|
| Parent → Builder | `iframe.contentWindow.syncCharacterFromParent(idx)` | Sends active character index on builder open |
| Builder → Parent | `window.parent.useItem(name)` | Triggers item use in the game engine |
| Builder → Parent | `window.parent.onIframeReady()` | Signals builder is loaded and ready |
