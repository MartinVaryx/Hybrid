        let test_mode = true;
        const MODE = "NORMAL"; // "EASY" | "NORMAL" | "HARD"
        const DEBUG = true;
        let debug_start = "START"

        let tooltipsInitialized = false;


        let current_challenge_key = "WELCOME";
        let back_to_game = "START";
        let keep_testing = false;
        let is_tutorial = false;
        let is_help = false;
        let narrative_phase = false;
        let prev_challenge = null;
        let pre_encounter_challenge_key = null;
        let queued_difficulty_target = null;
        let stuck_counter = 0;
        let CHALLENGES = {};
        let ENEMY_TYPES = {};
        let HEROES = [];
        let SKILLS_DB = {}; // <--- PRIDANÉ: Sem sa načítajú dáta zo skillsDB.json
        let activeCharIdx = 0;
        let hero_selected = false;
        let sequential_msgs_done = false;
        let hero_created = true;
        let gameOn = false;
        let welcome = true;
        let stockHeroesData = [];
        let combatLoopTimeout = null;
        let readyPromptTimeout = null;


        const conflict_difficulty = 6;
        const conflict_threat = 2;
        if (DEBUG) { gameOn = true, hero_selected = true};

        const SYSTEM_COMMANDS = ["BACK_TO_GAME", "ABOUT"];
        let SETTINGS = {
            "tutorial": true,
        };


        const DEFENSE_SKILLS = ["OBRATNOSŤ", "ODOLNOSŤ", "ZMYSLY", "ŠPRINT"];
        const ATTACK_SKILLS = ["SILA", "OBRATNOSŤ", "ZMYSLY"]
        const CHASE_SKILLS = ["OBRATNOSŤ", "ZMYSLY", "ŠPRINT", "ŠPLHANIE"];
        const SNEAK_SKILLS = ["PLÝŽENIE", "ŠPEHOVANIE", "OBRATNOSŤ"]

        const CARDS = {
            "O": [[3, [10]], [1, [10, 4]]],
            "R": [[1, [12]], [2, [12]]],
            "S": [[0, [10, 4]], [3, [10]]],
            "B": [[-1, [10, 6]], [4, [8]]],
        };

        const HERO = {
            "name": "Hrdina 1",
            "skills": {"STREĽBA":1, "VRHANIE":1},
            "stress_thresh": 8,
            "stress": 0,
            "items": {},
            "weapons": [],
            "ammo":{},
            "weapon": 1,
            "defaultWeapons": [],
            "defaultAmmo": {},
            "defaultItems": {},
        };

        const DELAYED = [];
        const DELAYED_COOLDOWN = [];

        const WEAPON_LIST = {
            "BOJ Z DIAĽKY": {
            "pištoľ":1,
            "samopal":2,
            "brokovnica":2,
            },
            "BOJ ZBLÍZKA": {
                "nôž":1,
                "sekera":2,
                "mačeta":2,
                "ostne":1,
                "hryzadlá":2, 
                "klepetá":2, 
                "kyselina":3, 
                "žihadlo":3 
            },
            "VRHACIE":{
                "nôž":1,
            }
        }

        const BIOLOGICAL_WEAPONS = ["OSTNE", "HRYZADLÁ", "KLEPETÁ", "KYSELINA", "ŽIHADLO"];


        ITEM_LIST = {
            "SLIVOVICA": {
                "description":"Vydezinfikuje zvnútra aj zvonku, nakopne, aj upokojí.",
                "effect":"stress-1",
                "message":"STRESS (-1) \n ALKOHOLIZMUS (+1) \n RIZIKO VZNIKU RAKOVINY (+1) \n RIZIKO CIRHÓZY PEČENE (+1)"
            },
            "TRÁVA": {
                "description":"Daj sa do chillu.",
                "effect":"stress-3"
            },
            "LYŽIČKA": {
                "description":"Ak nájdeš nejakú konzervu... Inak ti je nanič.",
            },
            "HADICA": {
                "description":"Dĺžka akurát tak na dno nádrže s benzínom.",
            },
            "BANDASKA": {
                "description":"Šikovná, ani príliš veľká, ani príliš malá.",
            },
            "LANO": {
                "description":"Mohlo by sa zísť.",
            },
            "DEZINFEKCIA": {
                "description": "Už 10 rokov po exspirácii. Snáď aspoň neuškodí, ak aj nepomôže.",
                "effect":"stress-2",
                 "message":"STRESS (-2) \n Poriadne to páli, tak je ešte asi dobrá."
            },
            "ZDRAVOTNÉ POMÔCKY": {
                "description": "Nevyhnutné pre poskytnutie prvej pomoci."
            },
            "ŽĽAZA SOMORY": {
                "description": "Dali by sa z toho syntetizovať feromóny."
            },
            "FEROMÓNY": {
                "description": "Dokážu ovplyvniť správanie Somôr."
            },
            "BOMBA":{
                "description": "Vďaka nej zmiznú veci, ktoré ti prekážajú."
            },
            "FILTER":{
                "description": "Palivový filter. Aby sa do motora nedostalo nejaké svinstvo."
            }
        }
        window.ITEM_LIST = ITEM_LIST;


        INITIAL_WEAPONS = ["nôž","pištoľ","mačeta"]
        INITIAL_AMMO = {
            "pištoľ":10,
            "nôž": 1,
        }

        const WEAPON_SKILLS = {
            "1":["STREĽBA","VRHANIE","ELIMINÁCIA Z DIAĽKY","ĽAHKÉ ZBRANE","OMRÁČENIE","MUČENIE","TICHÁ ELIMINÁCIA"],
            "2":["ŤAŽKÉ STRELNÉ ZBRANE","ELIMINÁCIA Z DIAĽKY","ŤAŽKÉ ZBRANE","OMRÁČENIE","MUČENIE","TICHÁ ELIMINÁCIA"],
            "3":["ŠPECIÁLNE STRELNÉ ZBRANE","ELIMINÁCIA Z DIAĽKY","ŠPECIÁLNE ZBRANE","MUČENIE","OMRÁČENIE","TICHÁ ELIMINÁCIA"],
            "4":["BOJOVÉ STROJE","HROMADNÉ NIČENIE","ELIMINÁCIA Z DIAĽKY"]
        }



        // --- Core Engine Architecture Variables ---
        let pending_challenge_key = null;  
        let pending_enemy_key = null;
        let player_escaping = false;
        let player_escape_counter = 0;
        let player_zero_counter = 0
        let proceed_target = null; 
        let enemy = null;
        let enemy_id = null;
        let enemy_stress = 0;
        let enemy_escaping = false;
        let enemy_escape_counter = 0;
        let enemy_zero_counter = 0
        let turn = "p";
        let round = 0;
        let move = 0;
        let weapon = 0;
        let stress = 0;
        let perm_stress = 0;
        const stress_thresh = 8;
        const ADVANTAGE_CAP = 3;
        let skill = 0;
        let advantage = 0;
        let enemy_advantage = 0;
        let cards_are_flipped = false; 
        
        let player_action = null; 
        let enemy_action = null;  

        let is_action_phase = false;
        let is_conflict = false; 
        let chase_mode = false;
        let distance_combat_active = false; // true while player has ranged advantage and distance > 0
        let conflict_distance = 0; // current distance to enemy_id's CHALLENGES entry
        let current_challenge = { difficulty: 7, threat: 2 };
        let inputs_frozen = false;
        let combat_starter = null;
        let challenge_history = [];

        let currentSelectedCardIdx = 0; // Index karty v tray (0, 1, 2...)
        let currentSelectedActionType = "D"; // Predvolene vrchná zóna ("D" alebo "A" podľa flipu)

        let touchHoverActive = false;
        let touchPendingCardIdx = null;
        let touchClickSuppressed = false;
        const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

        // Global state initialized outside the functions
        let logs_pending = [];
        let isProcessingQueue = false;
        let onTerminalFinishedCallback = null; 
        let activeLogTimeout = null; // NEW: Keeps track of the active waiting timer
        let is_collapse_check = false;
        let collapse_resume_callback = null;
        let collapse_failure_callback = null;
        let collapse_pending_proceed_target = null;
        let collapse_pending_target = null;
        let collapse_conflict_mode = false;
        let collapse_savedActionType = "D";
        let collapse_action_done = false;
        let is_heal_check = false;
        let heal_attempts = 0;
        let is_elimination_check = false;
        let elimination_mode = "kill"; // "kill" | "sneak" — set by runElimination()
        let transition_in_progress = false;

        function elimination(enemyKey) {
            inputs_frozen = true;
            if (!enemyKey) return null;

            const hasSilentSkill = HERO.skills["TICHÁ ELIMINÁCIA"] !== undefined && HERO.skills["TICHÁ ELIMINÁCIA"] > 0;
            const hasRangedSkill = HERO.skills["ELIMINÁCIA Z DIAĽKY"] !== undefined && HERO.skills["ELIMINÁCIA Z DIAĽKY"] > 0;
            const dist = (CHALLENGES[enemyKey] && CHALLENGES[enemyKey].distance) || 0;

            // Zistenie aktuálne vybranej zbrane a jej poškodenia
            const weaponDropdown = document.getElementById("player-weapon-dropdown");
            const selectedWeaponName = weaponDropdown ? weaponDropdown.value : "placeholder";

            let currentWeaponDamage = 0;
            let isRangedWeapon = false;

            if (selectedWeaponName && selectedWeaponName !== "placeholder") {
                if (WEAPON_LIST["BOJ Z DIAĽKY"] && WEAPON_LIST["BOJ Z DIAĽKY"][selectedWeaponName] !== undefined) {
                    currentWeaponDamage = WEAPON_LIST["BOJ Z DIAĽKY"][selectedWeaponName];
                    isRangedWeapon = true;
                } else if (WEAPON_LIST["VRHACIE"] && WEAPON_LIST["VRHACIE"][selectedWeaponName] !== undefined) {
                    currentWeaponDamage = WEAPON_LIST["VRHACIE"][selectedWeaponName];
                    isRangedWeapon = true;
                }
            }

            // Rovnako ako v boji (KROK 4): zbraň s muníciou v INITIAL_AMMO ju musí mať k dispozícii
            let hasAmmo = true;
            if (isRangedWeapon && typeof INITIAL_AMMO !== "undefined" && INITIAL_AMMO[selectedWeaponName] !== undefined) {
                const currentAmmo = HERO["ammo"][selectedWeaponName];
                hasAmmo = currentAmmo !== undefined && currentAmmo > 0;
            }

            // Podmienka: Eliminácia z diaľky + strelná/vrhacia zbraň s dmg >= 2 + munícia
            const canRangedKill = hasRangedSkill && isRangedWeapon && currentWeaponDamage >= 2 && hasAmmo;

            if (dist > 0) {
                // Nepriateľ je mimo dosahu boja zblízka
                if (canRangedKill) return "kill";
                return "sneak"; // bez diaľkovej zbrane sa dá iba nepozorovane priblížiť
            }

            // Vzdialenosť 0 — boj zblízka je v dosahu
            if (hasSilentSkill || canRangedKill) {
                return "kill";
            }

            is_elimination_check = false;
            return null;
        }

        function runElimination(enemyKey, mode = "kill") {
            inputs_frozen = true;
            is_elimination_check = true;
            elimination_mode = mode;
            pending_enemy_key = enemyKey; // Uložíme si nepriateľa pre prípadné spustenie konfliktu

            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');

            // Nastavenie parametrov výzvy
            current_challenge.difficulty = 8;
            current_challenge.threat = 2;
            currentSelectedActionType = "A";

            const challengeDisplay = document.getElementById("challenge-stats-display");
            if (challengeDisplay) {
                toggleChallengeDisplay(true, current_challenge);
            }

            // Výpis textu okamžite pred spustením výzvy
            if (mode === "sneak") {
                log("Nepriateľ je ešte mimo dosahu. Skús sa k nemu nepozorovane priblížiť.", "system-msg", true);
            } else {
                log("Nepriateľ ťa ešte nevidí, chceš ho skúsiť eliminovať?", "system-msg", true);
            }

            inputs_frozen = false;
            if (scrollRow) scrollRow.classList.add('enable-interaction');
            updateUI();
        }


        function resolveEliminationCheck(cardCode, actionType) {
            inputs_frozen = true;
            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');

            // --- 1. DETERMINE SKILL BONUS ---
            const skillDropdown = document.getElementById("player-skill-dropdown");
            const selectedSkillName = skillDropdown ? skillDropdown.value : "placeholder";
            let chosenSkillBonus = 0;
            if (selectedSkillName && selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                chosenSkillBonus = HERO.skills[selectedSkillName] || 0;
            }

            let roll_result = rollDice(cardCode, actionType === "A", chosenSkillBonus, false);
            let adrenaline = parseInt(document.getElementById("adrenaline-select").value) || 0;

            roll_result += advantage + adrenaline;
            resetAdrenalineSelection();

            const targetEnemyKey = pending_enemy_key;
            const dist = (CHALLENGES[targetEnemyKey] && CHALLENGES[targetEnemyKey].distance) || 0;

            // Get weapon specs for validation
            const weaponDropdown = document.getElementById("player-weapon-dropdown");
            const selectedWeaponName = weaponDropdown ? weaponDropdown.value : "placeholder";

            let isRangedWeapon = false;
            let weaponDmg = 0;

            if (selectedWeaponName && selectedWeaponName !== "placeholder") {
                if (WEAPON_LIST["BOJ Z DIAĽKY"] && WEAPON_LIST["BOJ Z DIAĽKY"][selectedWeaponName] !== undefined) {
                    weaponDmg = WEAPON_LIST["BOJ Z DIAĽKY"][selectedWeaponName];
                    isRangedWeapon = true;
                } else if (WEAPON_LIST["VRHACIE"] && WEAPON_LIST["VRHACIE"][selectedWeaponName] !== undefined) {
                    weaponDmg = WEAPON_LIST["VRHACIE"][selectedWeaponName];
                    isRangedWeapon = true;
                } else if (WEAPON_LIST["BOJ ZBLÍZKA"] && WEAPON_LIST["BOJ ZBLÍZKA"][selectedWeaponName] !== undefined) {
                    weaponDmg = WEAPON_LIST["BOJ ZBLÍZKA"][selectedWeaponName];
                }
            }
            // --- 2. BRANCH BY ACTION TYPE ---

            // ==========================================
            // ACTION "A" — ATTACK / KILL
            // ==========================================
            if (actionType === "A") {

                is_elimination_check = false;
                if (skillDropdown && skillDropdown.options[0]) skillDropdown.value = skillDropdown.options[0].value;

                // Resolve Attack Roll
                if (roll_result >= current_challenge.difficulty) {
                    // Success — Apply damage
                    let totalDmg = CARDS[cardCode][1][0] + weaponDmg;
                    if (!CHALLENGES[targetEnemyKey].saved_stress) CHALLENGES[targetEnemyKey].saved_stress = 0;
                    CHALLENGES[targetEnemyKey].saved_stress += totalDmg;
                    log(`Zasiahneš nepriateľa zo zálohy. Zvyšuješ mu stres o ${totalDmg}.`, "success-msg");

                    const enemyType = CHALLENGES[targetEnemyKey]?.type || targetEnemyKey;
                    const maxStress = ENEMY_TYPES[enemyType]?.stress_thresh || 8;

                    if (CHALLENGES[targetEnemyKey].saved_stress > maxStress) {
                        log(`Nepriateľ bol ticho zneškodnený!`, "success-msg");
                        HERO.sp = Math.max(0, (HERO.sp || 0) + 1);
                        if(enemyType === "Predátorka" || enemyType === "Skautka") executeMods("item_ŽĽAZA SOMORY+1");
                        
                        if (CHALLENGES[targetEnemyKey]) CHALLENGES[targetEnemyKey].alerted = true;
                        updateUI();

                        onTerminalFinishedCallback = () => {
                            const enemyContainer = document.getElementById("enemy-sprite-container");
                            if (enemyContainer) enemyContainer.style.display = "none";
                            let activeChallenge = CHALLENGES[targetEnemyKey];
                            if (targetEnemyKey) CHALLENGES["ACTIVE"][targetEnemyKey] = false;

                            enemy = null; enemy_stress = 0; enemy_escaping = false; player_escaping = false; chase_mode = false;
                            enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                            player_action = null; enemy_action = null; is_conflict = false;

                            let nextChallenge = [];

                            pushFlat(nextChallenge, activeChallenge?.on_death);

                            if (pending_challenge_key) {
                                pushFlat(nextChallenge, pending_challenge_key);
                                pending_challenge_key = null;
                            } else {
                                pushFlat(nextChallenge, activeChallenge?.case_success);
                            }

                            proceed(nextChallenge);
                        };
                        return;
                    } else {
                        log(`⚠️ Nepriateľ útok prežil! Odhalil ťa a začína otvorený boj.`, "failure-msg");
                    }
                } else {
                    // Failure — Attack missed
                    log(`⚠️ Minieš! Nepriateľ si ťa všimne a okamžite vyráža do útoku.`, "failure-msg");
                }

                // Cleanup and transition to regular combat on failure or survived attack
                pending_enemy_key = null;
                if (CHALLENGES[targetEnemyKey]) CHALLENGES[targetEnemyKey].alerted = true;
                updateUI();
                proceed(targetEnemyKey);
                return;
            }

            // ==========================================
            // ACTION "D" — SNEAK / POSITION / ADVANTAGE
            // ==========================================
            if (actionType === "D") {
                const isSuccess = roll_result >= current_challenge.difficulty;
                let caution_threshold = CARDS[cardCode][0][0];
                let threat_roll = 0;
                let threatRollsData = [];
                let enemyAlerted = false;

                if (!isSuccess){
                    for (let n = 0; n < current_challenge.threat; n++) {
                        let r = Math.floor(Math.random() * 2);
                        threat_roll += r;
                        threatRollsData.push({ type: "DH", value: r, isSkillDie: true });
                    }
                    triggerDiceVisualAnimation(threatRollsData, true);
                    enemyAlerted = threat_roll > caution_threshold
                }


                // Clean UI setup
                is_elimination_check = false;
                if (skillDropdown && skillDropdown.options[0]) skillDropdown.value = skillDropdown.options[0].value;

                // 1. Evaluate Success / Failure
                if (isSuccess) {
                    let adv_before = advantage;
                    advantage = Math.min(advantage + 1, ADVANTAGE_CAP);
                    if (dist > 0) {
                        const newDist = Math.max(0, dist - 1);
                        if (CHALLENGES[targetEnemyKey]) CHALLENGES[targetEnemyKey].distance = newDist;
                        log(`Podarí sa ti nepozorovane priblížiť. (Vzdialenosť: ${newDist})`, "success-msg");
                        if (advantage > adv_before) log(`Získavaš výhodu +1!`, "success-msg", false,false,true);
                    } else {
                        log(`Dostaneš sa do lepšej pozície.`, "success-msg");
                        if (advantage > adv_before) log(`Získavaš výhodu +1!`, "success-msg", false,false,true);
                    }
                } else {
                    if (dist > 0) {
                        log(`⚠️ Nedarí sa ti nepozorovane priblížiť! Nepriateľ si dáva pozor.`, "failure-msg");
                    } else {
                        log(`⚠️ Nedarí ti získať výhodnejšiu pozíciu. Začína otvorený boj.`, "failure-msg");
                    }
                }

                // 2. Evaluate Threat consequence
                if (enemyAlerted) {
                    if (CHALLENGES[targetEnemyKey]) CHALLENGES[targetEnemyKey].alerted = true;
                    log(`Nepriateľ si ťa všimne a začína sa boj.`, "failure-msg");
                }

                if (dist < 1) {
                    if (CHALLENGES[targetEnemyKey]) CHALLENGES[targetEnemyKey].alerted = true;
                }

                pending_enemy_key = null;
                updateUI();

                proceed(targetEnemyKey);
                return;
            }
        }


        function enterCollapseConflictMode() {
            collapse_conflict_mode = true;
            collapse_savedActionType = currentSelectedActionType || "D";
            currentSelectedActionType = "D";
            document.querySelectorAll("#card-tray-container .card-container").forEach(card => {
                const zone1 = card.children[0];
                const zone2 = card.children[1];
                // During collapse, zonation is irrelevant: hide both zones
                if (zone1) zone1.style.display = "none";
                if (zone2) zone2.style.display = "none";
            });
            updateCardKeyboardHighlight();
        }

        function exitCollapseConflictMode() {
            if (!collapse_conflict_mode) return;
            collapse_conflict_mode = false;
            document.querySelectorAll("#card-tray-container .card-container").forEach(card => {
                const zone1 = card.children[0];
                const zone2 = card.children[1];
                if (!zone1 || !zone2) return;
                zone1.style.display = "";
                zone2.style.display = "";
            });
            currentSelectedActionType = collapse_savedActionType || "D";
            updateCardKeyboardHighlight();
        }


        function log(message, className = "", extraSpacing = true, extraSpacingB = false, isInline = false) {
            if (/(danger|failure|error|success)/i.test(className)) {
                extraSpacing = false;
                extraSpacingB = false;
            }
            
            let needsSeparator = false;
            if (isInline) {
                const lastQueuedItem = logs_pending[logs_pending.length - 1];
                if (lastQueuedItem && !lastQueuedItem.isSeparator) {
                    const lastMsg = lastQueuedItem.message || "";
                    if (!lastMsg.trim().endsWith("...")) {
                        needsSeparator = true;
                    }
                }
                if (message && !message.endsWith(" ")) {
                    message += " ";
                }
            }
            
            // Pass the instruction safely inside ONE flat object layer
            logs_pending.push({ message, className, extraSpacing, extraSpacingB, isInline, needsSeparator });
            
            if (!isProcessingQueue) {
                isProcessingQueue = true;
                activeLogTimeout = setTimeout(processQueue, 0); 
            }
        }

        function processQueue() {
            if (logs_pending.length === 0) {
                isProcessingQueue = false;
                activeLogTimeout = null;
                if (typeof onTerminalFinishedCallback === "function") {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null;
                    callback();
                }
                return;
            }

            const currentLog = logs_pending.shift();
            const terminal = document.getElementById("terminal-screen");
            const scrollContainer = terminal.parentElement;

            if (currentLog.message !== "") {
                if (currentLog.isInline && terminal.lastElementChild) {
                    
                    // 1. IF THE LOG WAS FLAGGED AS NEEDING A SEPARATOR, INJECT IT FIRST
                    if (currentLog.needsSeparator) {
                        const separator = document.createElement("span");
                        separator.className = "terminal-inline-segment";
                        separator.innerText = "... ";
                        terminal.lastElementChild.appendChild(separator);
                    }

                    // 2. Then append the actual inline text span
                    const span = document.createElement("span");
                    span.className = `terminal-inline-segment ${currentLog.className}`.trim();
                    span.innerText = currentLog.message;
                    terminal.lastElementChild.appendChild(span);
                    
                } else {
                    // Standard new block line behavior
                    const line = document.createElement("div");

                    let bottomSpaceClass = '';
                    if (currentLog.extraSpacingB || currentLog.message.length < 150) {
                        bottomSpaceClass = 'spacing-bottom';
                    } else if (currentLog.message.length >= 150 && currentLog.message.length < 220) {
                        bottomSpaceClass = 'spacing-bottom-medium';
                    }

                    line.className = `terminal-line ${currentLog.className} ${currentLog.extraSpacing ? 'spacing-top' : ''} ${bottomSpaceClass}`.trim();
                    line.innerText = currentLog.message;

                    terminal.appendChild(line);
                }
                
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }

            // Determine timing for the next item in the queue (Original version behavior)
            if (logs_pending.length > 0) {
                if (logs_pending.length > 5) {
                    activeLogTimeout = setTimeout(processQueue, 0);
                } else {
                    let finalDelay;
                    if (test_mode) {
                        finalDelay = 100;
                    }  else {
                        const characterDelay = currentLog.message.length * 35;
                        finalDelay = Math.max(800, 400 + characterDelay);
                    }
                    activeLogTimeout = setTimeout(processQueue, finalDelay);
                }
            } else {
                isProcessingQueue = false;
                activeLogTimeout = null;
                if (typeof onTerminalFinishedCallback === "function") {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null;
                    callback();
                }
            }
        }

        function flushLogQueue() {
            if (activeLogTimeout) {
                clearTimeout(activeLogTimeout);
                activeLogTimeout = null;
            }
            if (logs_pending.length === 0 && !isProcessingQueue) return;

            isProcessingQueue = false;

            const flushNext = () => {
                if (logs_pending.length === 0) {
                    activeLogTimeout = null;
                    return;
                }
                const currentLog = logs_pending.shift();
                const terminal = document.getElementById("terminal-screen");
                const scrollContainer = terminal.parentElement;

                if (currentLog.message !== "") {
                    if (currentLog.isInline && terminal.lastElementChild) {
                        
                        // FIXED: Use the flat flag check instead of blindly injecting the separator
                        if (currentLog.needsSeparator) {
                            const separator = document.createElement("span");
                            separator.className = "terminal-inline-segment";
                            separator.innerText = "... ";
                            terminal.lastElementChild.appendChild(separator);
                        }

                        const span = document.createElement("span");
                        span.className = `terminal-inline-segment ${currentLog.className}`.trim();
                        span.innerText = currentLog.message;
                        terminal.lastElementChild.appendChild(span);
                    } else {
                        const line = document.createElement("div");
                        let bottomSpaceClass = '';
                        if (currentLog.extraSpacingB || currentLog.message.length < 90) {
                            bottomSpaceClass = 'spacing-bottom';
                        } else if (currentLog.message.length >= 80 && currentLog.message.length < 240) {
                            bottomSpaceClass = 'spacing-bottom-medium';
                        }
                        line.className = `terminal-line ${currentLog.className} ${currentLog.extraSpacing ? 'spacing-top' : ''} ${bottomSpaceClass}`.trim();
                        line.innerText = currentLog.message;
                        terminal.appendChild(line);
                    }
                    scrollContainer.scrollTop = scrollContainer.scrollHeight;
                }

                if (logs_pending.length > 0) {
                    let delay = test_mode ? 100 : 500;
                    activeLogTimeout = setTimeout(flushNext, delay);
                } else {
                    activeLogTimeout = null;
                    if (typeof onTerminalFinishedCallback === "function") {
                        const callback = onTerminalFinishedCallback;
                        onTerminalFinishedCallback = null;
                        callback();
                    }
                }
            };

            flushNext();
        }

        document.getElementById("proceed-btn").addEventListener("click", function () {
            console.log("PROCEED_HANDLER: click detected");
            if (!gameOn && !welcome && !is_tutorial) {
                console.log("PROCEED_HANDLER: gameOn is false, returning");
                return;
            }
            if (document.getElementById('hero-selection-overlay')) {
                console.log("PROCEED_HANDLER: hero-selection-overlay present, returning");
                return;
            }

            // Queue is still processing - skip and let test() retry
            if (logs_pending.length > 0 || isProcessingQueue) {
                console.log("PROCEED_HANDLER: logs pending (" + logs_pending.length + ") or isProcessingQueue (" + isProcessingQueue + "), skipping - will retry");
                return;
            }

            // KRITICKÁ OCHRANA: Ak proceed_target nie je pripravený, prerušíme handler, aby sme nezamrzli UI
            if (typeof proceed_target === 'undefined' || proceed_target === null || proceed_target === "") {
                console.log("PROCEED_HANDLER: proceed_target is NOT set yet, ignoring click and waiting for engine");
                return;
            }

            const prompt = document.getElementById("proceed-prompt");

            // Queue is clear - proceed with transition
            console.log("PROCEED_HANDLER: no logs pending, executing transition");
            if (typeof activeLogTimeout !== 'undefined' && activeLogTimeout) {
                clearTimeout(activeLogTimeout);
                activeLogTimeout = null;
            }
            inputs_frozen = true;
            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');
            console.log("PROCEED_HANDLER: calling executeProceedTransition");
            executeProceedTransition();
        });

        // --- UNIFIED KEYBOARD CONTROLLER ---
        window.addEventListener('keydown', (e) => {
            if (!gameOn && !welcome && !is_tutorial) return;

            // Check visibility states for all elements
            const generalPrompt = document.getElementById('general-prompt');
            const isGeneralVisible = generalPrompt && window.getComputedStyle(generalPrompt).display !== "none";

            const proceedPrompt = document.getElementById("proceed-prompt");
            const isProceedVisible = proceedPrompt && window.getComputedStyle(proceedPrompt).display !== "none";

            const readyPrompt = document.getElementById("ready-prompt");
            const isReadyVisible = readyPrompt && window.getComputedStyle(readyPrompt).display !== "none";

            const choicePrompt = document.getElementById("choice-prompt");
            const isChoiceVisible = choicePrompt && window.getComputedStyle(choicePrompt).display !== "none";

            const adrenalineKeys = ['1', '2', '3', '4'];

            const cards = document.querySelectorAll("#card-tray-container .card-container");
            const trayContainer = document.getElementById("card-tray-container");

            if (!inputs_frozen && ((!isChoiceVisible && !narrative_phase) || is_heal_check || is_elimination_check || is_tutorial)  && !isReadyVisible && !isProceedVisible && !isGeneralVisible){
                if (cards.length === 0) return;

                // =========================================================================
                // 1. LISTOVANIE KARIET (ŠÍPKY VĽAVO / VPRAVO)
                // =========================================================================
                if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    
                    // KLÁVESNICA PREBERÁ KONTROLU: Rušíme myšovú dominanciu
                    if (trayContainer) trayContainer.classList.remove("mouse-active");
                    
                    currentSelectedCardIdx = (currentSelectedCardIdx - 1 + cards.length) % cards.length;
                    updateCardKeyboardHighlight();
                    return;
                }

                if (e.key === "ArrowRight") {
                    e.preventDefault();

                    // KLÁVESNICA PREBERÁ KONTROLU: Rušíme myšovú dominanciu
                    if (trayContainer) trayContainer.classList.remove("mouse-active");
                    
                    currentSelectedCardIdx = (currentSelectedCardIdx + 1) % cards.length;
                    updateCardKeyboardHighlight();
                    return;
                }

                // =========================================================================
                // 2. PREPÍNANIE POLOVÍC KARTY (ŠÍPKY HORE / DOLE) - Len počas konfliktu
                // =========================================================================
                if ((is_conflict || is_elimination_check) && (e.key === "ArrowUp" || e.key === "ArrowDown" )) {
                    e.preventDefault();
                    
                    // KLÁVESNICA PREBERÁ KONTROLU: Rušíme myšovú dominanciu
                    if (trayContainer) trayContainer.classList.remove("mouse-active");
                    
                    currentSelectedActionType = (currentSelectedActionType === "A") ? "D" : "A";
                    updateCardKeyboardHighlight();
                    return;
                }
                    

                // =========================================================================
                // 3. OTOČENIE KARIET (KLÁVESA "F")
                // =========================================================================
                if (!inputs_frozen && e.key === "f" || !inputs_frozen && e.key === "F") {
                    e.preventDefault();
                    const flipBtn = document.getElementById("flip-cards-btn");
                    if (flipBtn) {
                        flipBtn.click(); // Spustí tvoj pôvodný flip kód
                        updateCardKeyboardHighlight(); // Hneď aktualizuje transformácie v CSS
                    }
                    return;
                }

                // =========================================================================
                // 4. ESCAPE MÓD (KLÁVESA "E") - Len počas konfliktu
                // =========================================================================
                if (!inputs_frozen && is_conflict && (e.key === "e" || !inputs_frozen && e.key === "E")) {
                    e.preventDefault();
                    const escapeBtn = document.getElementById("escape-btn");
                    if (escapeBtn) {
                        escapeBtn.click(); // Spustí tvoj pôvodný escape kód
                    }
                    return;
                }

                // =========================================================================
                // 5. POTVRDENIE ŤAHU (SPACE ALEBO ENTER)
                // =========================================================================
                if (!inputs_frozen && e.key === " " || !inputs_frozen && e.key === "Enter") {
                    e.preventDefault();
                    
                    const activeCard = cards[currentSelectedCardIdx];
                    if (!activeCard) return;

                    if (!is_conflict && !is_elimination_check) {
                        // Mimo boja: Klik na celú kartu
                        activeCard.click();
                    } else {
                        // V boji: Nájdeme konkrétnu vybranú zónu a klikneme na ňu
                        const zone1 = activeCard.children[0];
                        const zone2 = activeCard.children[1];
                        
                        if (zone1.getAttribute("data-action") === currentSelectedActionType) {
                            zone1.click();
                        } else if (zone2.getAttribute("data-action") === currentSelectedActionType) {
                            zone2.click();
                        }
                    }
                    return;
                }
            }

            if (!inputs_frozen && adrenalineKeys.includes(e.key)) {
                e.preventDefault(); // Zabráni posunu stránky alebo vpísaniu znaku
                
                const targetBonus = e.key; // '1', '2', '3' alebo '4'
                const availableNodes = Array.from(document.querySelectorAll("#adrenaline-track-row .ad-node.ad-playable"))
                    .filter(node => node.getAttribute("data-val") === targetBonus);

                if (availableNodes.length === 0) {
                    log(`⚠️ Bonus +${targetBonus} momentálne nie je k dispozícii alebo je zablokovaný.`, "error-msg");
                    return;
                }

                let bestNode = null;

                if (availableNodes.length === 1) {
                    // Ak existuje iba jedna možnosť (napr. pre číslo 4), vyberieme ju hneď
                    bestNode = availableNodes[0];
                } else {                    
                    let minValidStressDiff = Infinity;
                    let absoluteClosestNode = availableNodes[0];
                    let absoluteMinDiff = Infinity;

                    availableNodes.forEach(node => {
                        const nodeStress = parseInt(node.getAttribute("data-idx"), 10);
                        const diff = nodeStress - HERO.stress;

                        // Sledujeme celkovo najbližší uzol pre prípad, že žiadny nesplní ideálnu podmienku
                        if (Math.abs(diff) < absoluteMinDiff) {
                            absoluteMinDiff = Math.abs(diff);
                            absoluteClosestNode = node;
                        }
                        if (diff >= 0 && diff < minValidStressDiff) {
                            const isInvalidLowStressJump = (HERO.stress < 4 && (nodeStress === 5 || nodeStress === 6 || nodeStress === 7));
                            const isInvalidHighStressJump = (HERO.stress > 3 && (nodeStress > HERO.stress + 1));

                            if (!isInvalidLowStressJump && !isInvalidHighStressJump) {
                                minValidStressDiff = diff;
                                bestNode = node;
                            }
                        }
                    });
                    if (!bestNode) {
                        bestNode = absoluteClosestNode;
                    }
                }
                if (bestNode) {
                    selectAdrenalineNode(bestNode);
                }
                return;
            }
            // =========================================================================
            // 1. ABSOLUTE PRIORITY: GENERAL PROMPT SEIZES SPACEBAR
            // =========================================================================
            if (isGeneralVisible) {
                if (e.code === 'Space') {
                    const gp_input = document.getElementById('general-prompt-input');
                    if (gp_input && document.activeElement === gp_input) return; 

                    e.preventDefault();
                    const confirmBtn = document.getElementById('gp-confirm-btn');
                    if (confirmBtn) confirmBtn.click();
                }
                return; 
            }

            // =========================================================================
            // 2. DROPDOWN HOTKEY CYCLING (ONLY RUNS IF CONTROLS ARE NOT FROZEN)
            // =========================================================================
            if (gameOn || welcome) {
                if (e.key === 'h' || e.key === 'H') {
                    e.preventDefault();
                    runHealCheck();
                    return;
                }
                // --- WEAPON SELECTOR: Q (Previous) / A (Next) ---
                if (e.key === 'q' || e.key === 'Q') {
                    e.preventDefault();
                    cycleDropdown("player-weapon-dropdown", -1); // Up / Backward
                    return;
                }
                if (e.key === 'a' || e.key === 'A') {
                    e.preventDefault();
                    cycleDropdown("player-weapon-dropdown", 1);  // Down / Forward
                    return;
                }

                // --- SKILL SELECTOR: W (Previous) / S (Next) ---
                if (e.key === 'w' || e.key === 'W') {
                    e.preventDefault();
                    cycleDropdown("player-skill-dropdown", -1);  // Up / Backward
                    return;
                }
                if (e.key === 's' || e.key === 'S') {
                    e.preventDefault();
                    cycleDropdown("player-skill-dropdown", 1);   // Down / Forward
                    return;
                }
            }

            // =========================================================================
            // 3. HIGH PRIORITY INTERCEPT: INTERACTION CHOICES PROMPT
            // =========================================================================
            if (isChoiceVisible) {
                // If there are logs still queued/animating, ArrowRight (and Space) should
                // flush them instead of cycling/selecting choices.
                const hasPendingLogs = logs_pending.length > 0 || isProcessingQueue || activeLogTimeout;

                if (hasPendingLogs && (e.code === 'ArrowRight' || e.code === 'Space')) {
                    e.preventDefault();
                    flushLogQueue();
                    return;
                }

                const data = choicePrompt.userData;
                if (data && data.validChoices) {
                    const count = data.validChoices.length;

                    if (e.code === 'ArrowRight') {
                        e.preventDefault();
                        activeChoiceIndex = (activeChoiceIndex + 1) % count; // Wrap around to the start
                        updateVisualChoiceHighlights();
                        return;
                    }
                    if (e.code === 'ArrowLeft') {
                        e.preventDefault();
                        activeChoiceIndex = (activeChoiceIndex - 1 + count) % count; // Wrap around backwards
                        updateVisualChoiceHighlights();
                        return;
                    }
                    if (e.code === 'Space') {
                        e.preventDefault();
                        const buttons = choicePrompt.querySelectorAll(".adrenaline-select");
                        if (buttons[activeChoiceIndex]) {
                            buttons[activeChoiceIndex].click(); // Emulate concrete button execution
                        }
                        return;
                    }
                }
            }
            // =========================================================================
            // 3. TERTIARY PRIORITY: PROMPT SPECIFIC SPACE CHECKS
            // =========================================================================
            if (e.code === 'Space') {
                if (isProceedVisible) {
                    e.preventDefault();
                    if (document.getElementById('hero-selection-overlay')) return; // Shared block
                    
                    // If there is actual text waiting in line, just advance to the next single log
                    if (logs_pending.length > 0) {
                        flushLogQueue(); 
                    } 
                    // If the array is empty, we don't care about the leftover delay timer. JUMP INSTANTLY.
                    else {
                        if (activeLogTimeout) {
                            clearTimeout(activeLogTimeout);
                            activeLogTimeout = null;
                        }
                        isProcessingQueue = false; 
                        inputs_frozen = true;
                        const scrollRow = document.querySelector('.card-scroll-row');
                        if (scrollRow) scrollRow.classList.remove('enable-interaction');
                        executeProceedTransition();
                    }
                    return;
                }

                if (isReadyVisible) {
                    e.preventDefault();
                    const readyBtn = document.getElementById("ready-btn");
                    if (readyBtn) readyBtn.click();
                    return;
                }
            }

            // =========================================================================
            // 4. LOWEST PRIORITY: STANDARD ENGINE QUICK-SKIP LOGS (ONLY RUNS IF NO PROMPT IS OPEN)
            // =========================================================================
            if (e.code === 'ArrowRight' && (isProcessingQueue || activeLogTimeout)) {
                e.preventDefault();
                flushLogQueue();
            }
        });


        function flashRed() {
            const floor = document.querySelector(".gaming-table-floor");
            floor.classList.add("flash-red");
            setTimeout(() => floor.classList.remove("flash-red"), 400);
        }

        function resetAdrenalineSelection() {
            document.getElementById("adrenaline-select").value = "0";
            document.querySelectorAll(".ad-node").forEach(node => node.classList.remove("ad-selected"));
        }
        
        function rollDice(cardCode, attack = false, skillLevel = 0, isEnemy = false) {
            if (!(cardCode in CARDS)) {
                log("Invalid card code error!", "danger-msg", true);
                return 0;
            }
            
            let side = attack ? 1 : 0;
            let total_roll = 0;
            let dice_list = CARDS[cardCode][side][1];
            let rollsData = []; 

            if (skillLevel >= 6) {
                dice_list = [...dice_list, 6];
                skillLevel = skillLevel - 6;
            }
                        
            dice_list.forEach(d => {
                let r = Math.floor(Math.random() * d) + 1;
                total_roll += r;
                rollsData.push({ type: `D${d}`, value: r, isSkillDie: false });
            });
            
            for (let i = 0; i < skillLevel; i++) {
                let r = Math.floor(Math.random() * 2); 
                total_roll += r;
                rollsData.push({ type: 'DH', value: r, isSkillDie: true });
            }
            
            // Forward identity check state down to display pipeline layer
            triggerDiceVisualAnimation(rollsData, isEnemy);
            
            return total_roll;
        }

        function restartGame(menu = false) {
            gameOn = false;
            let delay = 0;
            if (menu) {delay = 0} else {delay = 6000}
            setTimeout(() => {
                
                showGeneralPrompt(
                    'Chceš začať odznova? \n \n Zvýšené úrovne schopností ti zostanú, ale tvoj pokrok ani predmety nebudú uložené.',
                    () => {            

                            updateUI();
                            // Okamžité vyčistenie a znovunačítanie pôvodného stavu hry
                            window.location.reload();
                        }

                );
            },delay);
        }

        function showMenu() {
            const main_menu = document.getElementById("main-menu");
            if (main_menu) {
                main_menu.style.display = "flex";
            }
        }

        function hideMenu() {
            document.getElementById('main-menu').style.display = 'none';
        }

        function showSettings() {
            const settings = document.getElementById("settings");
            if (settings) {
                settings.style.display = "flex";
            }
            hideMenu();

            syncUIWithSettings();
        }

        function syncUIWithSettings() {
            if (typeof SETTINGS === 'undefined') return;

            const tutorialCheckbox = document.getElementById('tutorial-checkbox');
            if (tutorialCheckbox) {
                tutorialCheckbox.checked = !!SETTINGS.tutorial;
            }
        }

        function hideSettings() {
            document.getElementById('settings').style.display = 'none';
        }

        function saveSettings() {
            try {
                if (typeof SETTINGS !== 'undefined') {
                    localStorage.setItem('SETTINGS', JSON.stringify(SETTINGS));
                    console.log("Nastavenia boli úspešne uložené do localStorage.");
                } else {
                    console.warn("Globálna premenná SETTINGS nie je definovaná.");
                }
            } catch (error) {
                console.error("Nepodarilo sa uložiť nastavenia do localStorage:", error);
            }
        }

        function toggleTutorial() {
            const checkbox = document.getElementById('tutorial-checkbox');
            if (!checkbox) return;

            if (typeof SETTINGS === 'undefined') {
                window.SETTINGS = {};
            }

            // Set the setting explicitly to match the checkbox state
            SETTINGS.tutorial = checkbox.checked;

            if (typeof saveSettings === 'function') {
                saveSettings();
            }
        }

        function updateTutorialVisual() {
            const checkbox = document.getElementById('tutorial-checkbox');
            if (!checkbox) return;

            // Force the checkbox UI to match the current data structure state
            if (typeof SETTINGS !== 'undefined' && SETTINGS.tutorial) {
                checkbox.checked = true;
            } else {
                checkbox.checked = false;
            }
        }



        function ifCase(caseTarget, arrayContext = null, currentIndex = null) {
            // 1. Vyhodnotíme podmienku a získame finálny cieľový string
            const finalTarget = evaluateIfCondition(caseTarget);

            // Interná pomocná funkcia pre posun v sekvenčnom poli
            const checkAndProceedNextInArray = () => {
                if (arrayContext && currentIndex !== null && currentIndex + 1 < arrayContext.length) {
                    const nextTarget = arrayContext[currentIndex + 1];
                    if (DEBUG === true) {
                        log(`[ifCase] Detekované sekvenčné pole. Automaticky posúvam na ďalší krok: '${nextTarget}'`);
                    }
                    handleChallengeTransition(nextTarget);
                    return true;
                }
                return false;
            };

            if (finalTarget) {
                const lowerFinal = finalTarget.toLowerCase();

                // --- DETEKCIA SYSTÉMOVÝCH PRÍKAZOV (MÓDOV) ---
                if (
                    lowerFinal.startsWith("set_") || 
                    lowerFinal.startsWith("flag_") || 
                    lowerFinal.includes("=") || 
                    lowerFinal.includes("+") || 
                    lowerFinal.includes("-")
                ) {
                    if (DEBUG === true) {
                        log(`[ifCase] Podmienka splnená. Cieľ '${finalTarget}' bol vyhodnotený ako systémový mod. Spúšťam executeMods().`);
                    }
                    executeMods(finalTarget);
                    
                    // Ak máme systémový mod, skontrolujeme, či pole pokračuje ďalším prvkom
                    if (!checkAndProceedNextInArray()) return;
                    return;
                }
                if (DEBUG === true) {
                    log(`[ifCase] Podmienka pre '${caseTarget}' Final target: ${finalTarget}.`);
                }
                // Ak to nie je systémový mod, vykonáme klasický prechod na novú scénu
                handleChallengeTransition(finalTarget);
                return;
            } else {
                // Ak podmienka neprešla a chýbala else vetva (finalTarget je null)
                if (DEBUG === true) {
                    log(`[ifCase] Podmienka pre '${caseTarget}' neprešla a chýba 'else' vetva.`);
                }
                
                // Dovolíme poľu skočiť na ďalší krok, ak existuje
                if (!checkAndProceedNextInArray()) return;
                return;
            }
        }            

        function evaluateIfCondition(caseTarget) {
            if (typeof caseTarget !== 'string' || !caseTarget.startsWith('if_')) {
                return caseTarget;
            }
            const parts = caseTarget.split('_else_');
            const ifPart = parts[0].substring(3); // Odstráni "if_"
            const falseTarget = parts[1] || null;

            let flagKey, operator, rawValue, trueTarget;

            // 1. Pokus o zachytenie plného zápisu s operátorom (napr. door-open==true_TARGET alebo CITY_0:false_CITY)
            const match = ifPart.match(/^([\p{L}\p{N}_ \-]+?)([:=<>!]+)([^_]+)_(.+)$/u);
            if (match) {
                flagKey = match[1];
                operator = match[2];
                rawValue = match[3].trim();
                trueTarget = match[4];
            } else {
                // 2. BACKUP: Skrátený zápis bez operátora (napr. door-open_TARGET) -> predvolíme == true
                const shortMatch = ifPart.match(/^([a-zA-Z0-9_-]+)_(.+)$/);
                if (shortMatch) {
                    flagKey = shortMatch[1];
                    operator = '==';
                    rawValue = 'true';
                    trueTarget = shortMatch[2];
                }
            }

            if (!flagKey) return null;

            // Získanie aktuálnej hodnoty z herného stavu
            let currentFlagValue;
            if (typeof FLAGS !== 'undefined' && flagKey in FLAGS) {
                currentFlagValue = FLAGS[flagKey];
            } else if (typeof CHALLENGES !== 'undefined' && CHALLENGES["ACTIVE"] && flagKey in CHALLENGES["ACTIVE"]) {
                currentFlagValue = CHALLENGES["ACTIVE"][flagKey];
            } else {
                currentFlagValue = false;
            }

            let processedCurrent = currentFlagValue;
            let processedTarget = rawValue;

            // Normalizácia typov (Booleans a Numbers)
            if (rawValue.toLowerCase() === 'true') processedTarget = true;
            else if (rawValue.toLowerCase() === 'false') processedTarget = false;
            else if (!isNaN(Number(rawValue))) processedTarget = Number(rawValue);
        
            if (flagKey.toLowerCase().startsWith('item')) {
                const itemKey = flagKey.substring(5).replace(/_/g, ' ').toUpperCase();
                processedCurrent = (typeof HERO !== 'undefined' && HERO.items && HERO.items[itemKey] !== undefined)
                    ? HERO.items[itemKey]
                    : 0;
            } else if (!isNaN(Number(currentFlagValue)) && typeof currentFlagValue !== 'boolean') {
                processedCurrent = Number(currentFlagValue);
            }

            // Vyhodnotenie podmienky podľa operátorov vrátane dvojbodky
            let conditionPassed = false;
            switch (operator) {
                case ':':
                case '=':
                case '==':  conditionPassed = (processedCurrent === processedTarget); break;
                case '!=':  conditionPassed = (processedCurrent !== processedTarget); break;
                case '>':   conditionPassed = (processedCurrent > processedTarget); break;
                case '<':   conditionPassed = (processedCurrent < processedTarget); break;
                case '>=':  conditionPassed = (processedCurrent >= processedTarget); break;
                case '<=':  conditionPassed = (processedCurrent <= processedTarget); break;
            }

            return conditionPassed ? trueTarget : falseTarget;
        }

        function resetStateFlags(){
            is_conflict = false;
            is_elimination_check = false;
            is_collapse_check = false;
            is_heal_check = false;
            is_action_phase = false;
            inputs_frozen = true
        }

        function about(){
            if (is_collapse_check){
                showGeneralPrompt("Teraz to nie je možné.")
            }
            const choicePrompt = document.getElementById("choice-prompt");
            const isChoicePromptVisible = choicePrompt && window.getComputedStyle(choicePrompt).display !== "none";
            hideMenu();
            if (!isChoicePromptVisible){
                showGeneralPrompt(
                `POZOR! \n Prídeš o pokrok v súboji alebo výzve! \n Naozaj chceš zobraziť informácie o hre teraz?'`,
                () => {
                    runAbout()})
            } else {
                runAbout()
            }
        }
        
        function runAbout(){
            resetStateFlags(); 
            const proceedPrompt = document.getElementById("proceed-prompt");
            if (proceedPrompt) {
                proceedPrompt.style.display = "none";
            };
            target = "ABOUT";
            back_to_game = current_challenge_key;
            handleChallengeTransition(target)
        }

        function help(){
            if (is_collapse_check){
                showGeneralPrompt("Teraz to nie je možné.")
            }
            const choicePrompt = document.getElementById("choice-prompt");
            const isChoicePromptVisible = choicePrompt && window.getComputedStyle(choicePrompt).display !== "none";
            hideMenu();
            if (!isChoicePromptVisible){
                showGeneralPrompt(
                `POZOR! \n Prídeš o pokrok v súboji alebo výzve! \n Naozaj chceš zobraziť informácie o hre teraz?'`,
                () => {
                    runHelp()})
            } else {
                runHelp()
            }
        }
        
        function runHelp(){
            resetStateFlags(); 
            const proceedPrompt = document.getElementById("proceed-prompt");
            if (proceedPrompt) {
                proceedPrompt.style.display = "none";
            };
            target = "HELP";
            back_to_game = current_challenge_key;
            handleChallengeTransition(target)
        }

        function handleChallengeTransition(caseTarget) {
            if (caseTarget == "WELCOME"){
                const proceedBtn = document.getElementById('proceed-btn');
                proceedBtn.innerText = "ZAČAŤ"
            } else {
                const proceedBtn = document.getElementById('proceed-btn');
                proceedBtn.innerText = "ĎALEJ"
            }

            const closeBtn = document.getElementById('close-btn');
            const proceedPrompt = document.getElementById('proceed-prompt');

            if (caseTarget.includes("TUTORIAL") || caseTarget.includes("DUMMY")){
                closeBtn.innerText = "UKONČIŤ";
                closeBtn.style.display = "block"
                proceedPrompt.style.justifyContent = "space-between";
                is_tutorial = true
            }

            if (caseTarget.includes("HELP")){
                closeBtn.innerText = "UKONČIŤ";
                closeBtn.style.display = "block"
                proceedPrompt.style.justifyContent = "space-between";
                is_help = true
            }

            if (caseTarget == "BACK_TO_GAME"){
                let final_target = [];
                stress_reset = "stress-10";
                if (back_to_game.includes("START")) final_target.push(stress_reset);
                final_target.push(back_to_game);
                is_tutorial = false;
                is_help = false;
                proceedPrompt.style.justifyContent = "end";
                closeBtn.style.display = "none";
                updateUI;
                handleChallengeTransition(final_target);

                return
            }
            if (test_mode){
                let mod = 0;
                let a = 0;
                a = 30 / HERO.stress
                mod = Math.min(0,Math.floor(Math.random() * 14 - 1))
                HERO.stress = Math.max(0, HERO.stress + mod);
            }
            if (!caseTarget || (!gameOn && !welcome && !is_tutorial)) return;
            if (typeof is_collapse_check !== 'undefined' && is_collapse_check === true) {
                return; // Early return to completely freeze challenge transitions
            }

            document.querySelectorAll("#card-tray-container .card-container").forEach(card => {
                card.classList.remove("keyboard-hover");
                card.children[0].classList.remove("keyboard-hover-zone");
                card.children[1].classList.remove("keyboard-hover-zone");
            });

            if (typeof caseTarget === 'string' && caseTarget.startsWith('if_')) {
                ifCase(caseTarget);
                return
            }
            // -----------------------------------------------------------
            if (typeof caseTarget === 'string' && caseTarget.toLowerCase().trim() === 'restart') {
                restartGame();
                return;
            }

            let actualTarget = caseTarget;
            let instanceKey = typeof caseTarget === 'string' ? caseTarget : null;

            if (typeof actualTarget === 'string' && actualTarget.startsWith('BACK_ACTION_')) {
                const steps = parseInt(actualTarget.replace('BACK_ACTION_', ''), 10);
                
                if (isNaN(steps) || steps < 1 || challenge_history.length === 0) {
                    if (DEBUG) log(`Warning: Invalid BACK_ACTION step count '${actualTarget}'`, "danger-msg", true);
                    return;
                }

                const stepsToTake = Math.min(steps, challenge_history.length);
                const targetHistoryIndex = challenge_history.length - stepsToTake;
                const destination = challenge_history[targetHistoryIndex];

                if (!destination) {
                    if (DEBUG) log(`Warning: BACK_ACTION went past the beginning of history.`, "danger-msg", true);
                    return;
                }

                if (CHALLENGES["ACTIVE"] && CHALLENGES["ACTIVE"][destination] === false) {
                    log("Už nie je možné ísť späť.", "danger-msg", true);
                    return;
                }

                // 1. Odrežeme históriu presne pred cieľovou lokáciou
                challenge_history.splice(targetHistoryIndex);
                
                current_challenge_key = destination;
                
                // Reset počítadla kôl
                move = 0; 

                // 3. Spustíme čistý prechod na cieľovú lokáciu
                handleChallengeTransition(destination);
                return;
            }

            if (CHALLENGES["ACTIVE"] && CHALLENGES["ACTIVE"][actualTarget] === false) {
                if (DEBUG === true) {
                    log(`Target ${actualTarget} je neaktívny (false). Prechod bol zrušený.`);
                }
                return; // Preskočí sa vykonanie tejto výzvy
            }

            // Kontrola pre pole (Array) - ak obsahuje odkaz na inštanciu nepriateľa
            if (Array.isArray(caseTarget)) {
                let i = 0;

                function processNextElement() {
                    // Process all mods synchronously first
                    while (i < caseTarget.length) {
                        const target = caseTarget[i];

                        // 1. Enemy check (unchanged)
                        if (typeof target === 'string' && CHALLENGES[target] && CHALLENGES[target].type) {
                            const enemyType = CHALLENGES[target].type;
                            const isInactiveEnemy = CHALLENGES["ACTIVE"] && CHALLENGES["ACTIVE"][target] === false;

                            if (enemyType in ENEMY_TYPES && !isInactiveEnemy) {
                                const remainder = caseTarget.slice(i + 1);
                                if (remainder.length > 0) {
                                    pending_challenge_key = remainder.length === 1 ? remainder[0] : remainder;
                                }
                                handleChallengeTransition(target);
                                return;
                            } else if (isInactiveEnemy) {
                                if (DEBUG === true) {
                                    log(`Enemy wrapper ${target} je neaktívny (false), skúšam ďalší prvok v poli.`);
                                }
                                i++;
                                continue; 
                            }
                        } else if (target in ENEMY_TYPES) {
                            const isInactiveEnemy = CHALLENGES["ACTIVE"] && CHALLENGES["ACTIVE"][target] === false;

                            if (!isInactiveEnemy) {
                                const remainder = caseTarget.slice(i + 1);
                                if (remainder.length > 0) {
                                    pending_challenge_key = remainder.length === 1 ? remainder[0] : remainder;
                                }
                                handleChallengeTransition(target);
                                return;
                            } else {
                                if (DEBUG === true) {
                                    log(`Nepriateľ ${target} je neaktívny (false), skúšam ďalší prvok v poli.`);
                                }
                                i++;
                                continue; 
                            }
                        }

                        // 2. KONTROLA MODIFIKÁCIÍ - PLNE AKTUALIZOVANÁ A ZABEZPEČENÁ
                        const isModification = typeof target === 'string' && (
                            target.includes('+') ||
                            target.includes('-') ||
                            target.includes('=') ||
                            target.includes(':') ||                     // Pre alerted_...:true a flag_...:hodnota
                            target.toLowerCase().includes('weapon+') ||
                            target.toLowerCase().includes('item_') ||   // PRIDANÉ: Bezpečné zachytenie predmetov
                            target.toLowerCase().startsWith('set_') ||
                            target.toLowerCase().startsWith('flag_') ||
                            target.toLowerCase().startsWith('alerted_') // PRIDANÉ: Ostražitosť nepriateľov
                        );

                        // 3. Špeciálna izolovaná kontrola pre podmienky (if_)
                        const isIfCondition = typeof target === 'string' && target.toLowerCase().startsWith('if_');

                        if (isModification) {
                            const isGenericDifficultyMod = target.toLowerCase().includes("difficulty") &&
                                !target.toLowerCase().startsWith("difficulty_");

                            if (isGenericDifficultyMod) {
                                queued_difficulty_target = null;
                                for (let j = i + 1; j < caseTarget.length; j++) {
                                    const lookaheadTarget = caseTarget[j];
                                    if (typeof lookaheadTarget === 'string' &&
                                        CHALLENGES[lookaheadTarget] &&
                                        CHALLENGES[lookaheadTarget].difficulty !== undefined) {
                                        queued_difficulty_target = lookaheadTarget;
                                        break;
                                    }
                                }
                                if (DEBUG === true && queued_difficulty_target) {
                                    log(`[executeMods lookahead] Difficulty mod sa naviaže na nasledujúcu výzvu: ${queued_difficulty_target}.`);
                                }
                            }

                            handleChallengeTransition(target);
                            if (is_collapse_check) {
                                collapse_pending_target = caseTarget.slice(i + 1);
                                if (collapse_pending_target.length === 1) {
                                    collapse_pending_target = collapse_pending_target[0];
                                }
                                return;
                            }
                            i++;
                            // keep looping
                        }
                        else if (isIfCondition) {
                            if (typeof ifCase === "function") {
                                ifCase(target);
                            }
                            i++; 
                            // keep looping
                        }
                        else {
                            // Terminal item — but check if it's inactive first.
                            const isInactiveTarget = CHALLENGES["ACTIVE"] && CHALLENGES["ACTIVE"][target] === false;

                            if (isInactiveTarget) {
                                if (DEBUG === true) {
                                    log(`Target ${target} je neaktívny (false), skúšam ďalší prvok v poli.`);
                                }
                                i++;
                                continue; 
                            }

                            // Terminal item — hand off and stop
                            i++;
                            onTerminalFinishedCallback = null;
                            handleChallengeTransition(target);
                            return;
                        }
                    }
                    // Fell off the end — all items were mods, nothing left to do
                    updateUI();
                }

                processNextElement(); 
                return; 
            }

            // Ak je target v CHALLENGES a má definovaný "type", presmerujeme ho na daného nepriateľa
            if (typeof actualTarget === 'string' && CHALLENGES[actualTarget] && CHALLENGES[actualTarget].type) {
                const enemyType = CHALLENGES[actualTarget].type;
                if (enemyType in ENEMY_TYPES) {
                    instanceKey = actualTarget; 
                    pre_encounter_challenge_key = current_challenge_key; 
                    actualTarget = enemyType;   
                }
            }

            if (actualTarget in ENEMY_TYPES && !(actualTarget in SYSTEM_COMMANDS)) { 
                if (!is_elimination_check && CHALLENGES[instanceKey] && (!CHALLENGES[instanceKey].alerted)) {                    
                    challenge_history.push(instanceKey)
                    const elimKey = instanceKey ? instanceKey : actualTarget;
                    const elimMode = elimination(elimKey);
                    conflict_distance = (CHALLENGES[instanceKey].distance > 0)
                        ? CHALLENGES[instanceKey].distance
                        : 0;
                    distance_combat_active = conflict_distance > 0 && playerHasRangedWeapon() && !enemyHasRangedWeapon();
                    if (DEBUG) log(`Distance: ${conflict_distance} distance combat: Distance: ${distance_combat_active}`, "system-msg");
                    if (elimMode) {
                        const enemyContainer = document.getElementById("enemy-sprite-container");
                        const enemyImg = document.getElementById("enemy-sprite");
                        
                        if (enemyContainer && enemyImg && ENEMY_TYPES[actualTarget].image) {
                            // Ensure correct scaling states are applied regardless of round
                            enemyContainer.classList.add("elimination-mode");
                            enemyContainer.classList.remove("distance-mode");

                            // ONLY run the setup/entrance code if the sprite isn't already active on screen
                            if (enemyContainer.style.display !== "block" || enemyImg.getAttribute('src') !== ENEMY_TYPES[actualTarget].image) {
                                enemyImg.src = ENEMY_TYPES[actualTarget].image;
                                enemyContainer.style.display = "block";
                                enemyContainer.classList.remove("enemy-entrance", "enemy-hit");
                                void enemyContainer.offsetWidth; // Force reflow for clean animation
                                enemyContainer.classList.add("enemy-entrance");
                            }
                        }
                        runElimination(elimKey, elimMode);
                        return;
                    }
                }
                inputs_frozen = true;
                const scrollRow = document.querySelector('.card-scroll-row');
                if (scrollRow) scrollRow.classList.remove('enable-interaction');
                updateUI();

                document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());
                const oldEnemy = document.getElementById("enemy-card-container");
                const oldPlayer = document.getElementById("player-card-display");
                if (oldEnemy) oldEnemy.classList.remove("show"); // Odsunie starú kartu nepriateľa
                if (oldPlayer) oldPlayer.classList.remove("show"); // Odsunie starú kartu hráča

                // 1. STABILIZE KEY REFERENCES
                // Ensure enemy_id strongly favors the state tracking wrapper over the base engine archetype
                enemy = actualTarget; // "Skautka"
                if (!instanceKey || instanceKey === enemy) {
                    // Fallback: If instanceKey was lost, scan CHALLENGES to see if current_challenge_key was the wrapper
                    if (current_challenge_key && CHALLENGES[current_challenge_key] && CHALLENGES[current_challenge_key].type === enemy) {
                        instanceKey = current_challenge_key;
                    }
                }
                enemy_id = instanceKey ? instanceKey : actualTarget;

                // 2. CALCULATE REST MODIFIERS
                let enemy_rest = 0;

                // KONTROLA HISTÓRIE: Pozrieme sa na posledné 3 kroky
                let engaged_recently = false;
                if (typeof challenge_history !== 'undefined' && challenge_history.length > 0) {
                    // Vezmeme buď posledné 3 kroky, alebo celú dĺžku, ak je história kratšia
                    const lookback_depth = Math.min(3, challenge_history.length);
                    
                    for (let i = 1; i <= lookback_depth; i++) {
                        if (challenge_history[challenge_history.length - i] === enemy_id) {
                            engaged_recently = true;
                            break;
                        }
                    }
                }

                // Ak bol nepriateľ v posledných 3 krokoch, neodpočíva vůbec (enemy_rest = 0)
                if (engaged_recently) {
                    enemy_rest = 0;
                } else {
                    // Štandardný výpočet odpočinku, ak sa hráč vrátil po dlhšom čase
                    if (typeof MODE !== 'undefined') {
                        if (MODE === "EASY") enemy_rest = 1;
                        else if (MODE === "NORMAL") enemy_rest = 2;
                        else enemy_rest = 3;
                    } else {
                        enemy_rest = 2; // Default fallback
                    }
                }

                // 3. EXTRACT AND APPLY SAVED STRESS FROM WRAPPER
                let foundWrapper = CHALLENGES[enemy_id];

                if (foundWrapper && typeof foundWrapper.saved_stress !== 'undefined') {
                    enemy_stress = Math.max(0, foundWrapper.saved_stress - enemy_rest);
                    
                    // Logujeme odpočinok iba vtedy, ak reálne nejaký bol a nepriateľ mal nejaký stres
                    if (enemy_rest > 0 && foundWrapper.saved_stress > 0) {
                        log(`Od posledného súboja si nepriateľ odpočinul. Stres mu klesol o ${enemy_rest}. (Aktuálny stres: ${enemy_stress})`, "system-msg");
                    }
                } else {
                    enemy_stress = 0;
                }

                enemy_escaping = false;
                is_conflict = true;
                move = 0;
                combat_starter = null;

                const enemyContainer = document.getElementById("enemy-sprite-container");
                const enemyImg = document.getElementById("enemy-sprite");
                if (enemyContainer && enemyImg && ENEMY_TYPES[actualTarget].image) {
                    enemyImg.src = ENEMY_TYPES[actualTarget].image;
                    enemyContainer.style.display = "block";
                    
                    // --- ADDED: Manage distance/elimination scale classes ---
                    if (is_elimination_check || (typeof elimination_mode !== 'undefined' && elimination_mode !== "kill" && elimination_mode !== null)) {
                        enemyContainer.classList.add("elimination-mode");
                        enemyContainer.classList.remove("distance-mode");
                    } else if (distance_combat_active) {
                        enemyContainer.classList.add("distance-mode");
                        enemyContainer.classList.remove("elimination-mode");
                    } else {
                        enemyContainer.classList.remove("distance-mode", "elimination-mode");
                    }
                    // -------------------------------------------------------

                    enemyContainer.classList.remove("enemy-entrance", "enemy-hit");
                    void enemyContainer.offsetWidth;
                    enemyContainer.classList.add("enemy-entrance");
                }

                const wrapperChallenge = instanceKey && CHALLENGES[instanceKey];
                const wrapperMsg = wrapperChallenge && wrapperChallenge.initial_msg;

                // Načítanie sekvenčných správ initial_msg_1, initial_msg_2...
                const sequentialMsgs = [];
                if (wrapperChallenge) {
                    let msgIndex = 1;
                    while (wrapperChallenge[`initial_msg_${msgIndex}`]) {
                        sequentialMsgs.push(wrapperChallenge[`initial_msg_${msgIndex}`]);
                        msgIndex++;
                    }
                }

                // Log základnej správy (ak existuje) hneď na začiatku
                if (wrapperMsg) {
                    log(wrapperMsg, "narrative-msg", true);
                }

                // UNIFORMNÝ OPRAVENÝ SYSTÉM PRE SEKVENČNÉ TEXTY V BOJI
                // =========================================================================
                if (sequentialMsgs.length > 0) {
                    let currentMsgIdx = 0;

                    const showNextCombatNarrative = () => {
                        // Vypíšeme aktuálnu správu zo sekvencie
                        log(sequentialMsgs[currentMsgIdx], "narrative-msg", true);

                        // Skontrolujeme, či sme práve vypísali úplne poslednú textovú správu
                        if (currentMsgIdx === sequentialMsgs.length - 1) {
                            
                            // Text je na obrazovke. Povieme tlačidlu Proceed, 
                            // že pri ďalšom kliknutí má vypísať bojovú hlášku a pripraviť štart.
                            proceed(() => {
                                log(`\n⚔️ Priprav sa na boj! Proti tebe stojí: ${actualTarget}`, "danger-msg", true);
                                
                                // Následné kliknutie reálne spustí boj
                                proceed(() => {
                                    inputs_frozen = false;
                                    const scrollRow = document.querySelector('.card-scroll-row');
                                    if (scrollRow) scrollRow.classList.add('enable-interaction');
                                    updateUI();
                                    gameloop(false);
                                });
                            });

                        } else {
                            // Ak ešte nie sme na konci, posunieme index a čakáme na ďalší text
                            currentMsgIdx++;
                            proceed(showNextCombatNarrative);
                        }
                    };

                    // Naštartovanie prvého kliknutia pre initial_msg_1
                    proceed(showNextCombatNarrative);

                } else {
                    // FALLBACK: Ak uzol nemá žiadne dodatočné texty
                    log(`⚔️ Priprav sa na boj! Proti tebe stojí: ${actualTarget}`, "danger-msg", true);
                    
                    // Počkáme na jedno stlačenie Proceed, kým reálne spustíme bojové kolo
                    proceed(() => {
                        inputs_frozen = false;
                        const scrollRow = document.querySelector('.card-scroll-row');
                        if (scrollRow) scrollRow.classList.add('enable-interaction');
                        updateUI();
                        gameloop(false);
                    });
                }
                return;
            }

            // 2. If target moves the user forward to another challenge map node
            if (actualTarget in CHALLENGES && !(actualTarget in SYSTEM_COMMANDS)) { 
                if (current_challenge_key && current_challenge_key !== actualTarget && typeof caseTarget === 'string' && !caseTarget.startsWith('BACK_ACTION_')) {
                    challenge_history.push(current_challenge_key);
                }

                current_challenge_key = actualTarget; 
                const chainOwned = runActionPhase();

                if (chainOwned) {
                    return;
                }

                if (current_challenge_key !== actualTarget) {
                    return; 
                }
                
                const activeChallenge = CHALLENGES[actualTarget];


                if (activeChallenge && activeChallenge.next) {
                    proceed(activeChallenge.next);
                    if (test_mode && !keep_testing) {
                        keep_testing = true;
                        test();
                    }
                    return; 
                }
                
                renderChallengeChoices(activeChallenge);
                if (test_mode && !keep_testing) {
                    keep_testing = true;
                    test();
                }
                return;
            }

            // 3. If target string contains stat modifications (e.g. additions or assignments)
            if (typeof caseTarget === 'string') {
                modificationExecuted = executeMods(caseTarget)
                if (modificationExecuted) {
                    inputs_frozen = false;
                    const scrollRow = document.querySelector('.card-scroll-row');
                    if (scrollRow) scrollRow.classList.add('enable-interaction');
                    updateUI();
                    return;
                }
            }

            log(`Warning: Unhandled routing instruction case reference '${caseTarget}'`, "danger-msg", true);
        }
        
        function executeMods(caseTarget){
            let modificationExecuted = false;

            // 1. KONTROLA PRE ALERTED MODS (Case Sensitive pre challengekey)
            if (caseTarget.startsWith("alerted_") && caseTarget.includes(":")) {
                // Odrežeme "alerted_" (8 znakov) z pôvodného reťazca
                const alertPart = caseTarget.substring(8); 
                const parts = alertPart.split(":");
                
                // challengeKey si zachová presný tvar (napr. "Predátorka_2")
                const challengeKey = parts[0].trim(); 
                const rawVal = parts[1].trim().toLowerCase();
                const booleanState = (rawVal === "true");

                // Poistka pre existenciu objektu CHALLENGES a jeho uzla
                if (typeof CHALLENGES !== 'undefined' && CHALLENGES[challengeKey]) {
                    CHALLENGES[challengeKey].alerted = booleanState;
                    
                    if (DEBUG === true) {
                        log(`[ALERTED] Stav ostražitosti pre výzvu '${challengeKey}' bol nastavený na: ${booleanState}`);
                        return true
                    }
                } else if (DEBUG === true) {
                    log(`[executeMods] Výzva '${challengeKey}' nebola nájdená v databáze CHALLENGES.`, "danger-msg");
                    return false
                }
                modificationExecuted = true;
            }

            // Vytvoríme lowercase verziu PRE OSTATNÉ VETVY
            const lowerTarget = caseTarget.toLowerCase();

            // Zmenené na ELSE IF, aby sa po úspešnom spracovaní alerted_ tieto vetvy preskočili
            if (!modificationExecuted && lowerTarget.startsWith("flag_")) {
                const flagPart = caseTarget.substring(5); // Odstráni "flag_"
                
                // Inicializácia objektu FLAGS, ak by náhodou ešte neexistoval
                if (typeof FLAGS === 'undefined') {
                    FLAGS = {};
                }

                // 1. PRÍPAD: Inkrementácia (napr. flag_door-open+1 alebo flag_door-open-2)
                if (flagPart.includes("+") || flagPart.includes("-")) {
                    const isAddition = flagPart.includes("+");
                    const parts = isAddition ? flagPart.split("+") : flagPart.split("-");
                    const flagKey = parts[0].trim();
                    const amount = parts[1] ? parseInt(parts[1]) : 1;
                    const modifier = isAddition ? amount : -amount;

                    // Ak flag neexistoval, začneme od 0
                    const currentVal = Number(FLAGS[flagKey]) || 0;
                    FLAGS[flagKey] = currentVal + modifier;

                    if (DEBUG === true) {
                        log(`[FLAGS] Hodnota flagu '${flagKey}' bola upravená o ${modifier}. Aktuálne: ${FLAGS[flagKey]}`);
                    }
                    modificationExecuted = true;
                }
                // 2. PRÍPAD: Priradenie hodnoty cez dvojbodku (napr. flag_door-open:true, flag_door-open:yes)
                else if (flagPart.includes(":")) {
                    const parts = flagPart.split(":");
                    const flagKey = parts[0].trim();
                    let rawVal = parts[1].trim();
                    let finalVal = rawVal;

                    // Automatická konverzia typov pre textové hodnoty
                    if (rawVal.toLowerCase() === "true") finalVal = true;
                    else if (rawVal.toLowerCase() === "false") finalVal = false;
                    else if (!isNaN(Number(rawVal)) && rawVal !== '') finalVal = Number(rawVal); // Prekonvertuje "1" na číslo 1

                    FLAGS[flagKey] = finalVal;

                    if (DEBUG === true) {
                        log(`[FLAGS] Flag '${flagKey}' bol nastavený na: ${finalVal}`);
                    }
                    modificationExecuted = true;
                }
            }
            // -----------------------------------------------

            // --- Handle assignment/reset rules using '=' ---
            if (!modificationExecuted && lowerTarget.includes("=")) {
                const parts = caseTarget.split("=");
                const key = parts[0].toLowerCase().trim();
                const val = parts[1].toLowerCase().trim();

                if (key === "enemy_advantage") {
                    enemy_advantage = parseInt(val) || 0;
                    log(`Výhoda nepriateľa bola upravená na ${enemy_advantage}.`);
                    modificationExecuted = true;
                }
                else if (key === "advantage") {
                    advantage = parseInt(val) || 0;
                    log(`Tvoja výhoda bola upravená na ${advantage}.`);
                    modificationExecuted = true;
                }
                else if (key === "difficulty") {
                    const defaultVal = CHALLENGES[current_challenge_key]?.difficulty ?? 2;
                    current_challenge.difficulty = defaultVal;
                    log(`Náročnosť výzvy bola obnovená na základnú hodnotu (${defaultVal}).`);
                    modificationExecuted = true;
                }
                else if (key === "threat") {
                    const defaultVal = CHALLENGES[current_challenge_key]?.threat ?? 3;
                    current_challenge.threat = defaultVal;
                    log(`Hrozba výzvy bola obnovená na základnú hodnotu (${defaultVal}).`);
                    modificationExecuted = true;
                }
            }
            else if (!modificationExecuted && lowerTarget.startsWith("set_")) {
                const lastUnderscore = caseTarget.lastIndexOf('_');
                
                if (lastUnderscore !== -1) {
                    const stateStr = caseTarget.substring(lastUnderscore + 1).toLowerCase().trim();
                    // Vyrežeme názov výzvy (od indexu 4, čo preskočí "set_")
                    const challengeName = caseTarget.substring(4, lastUnderscore).toUpperCase().trim();
                    
                    if (stateStr === "true" || stateStr === "false") {
                        const booleanState = (stateStr === "true");
                        
                        // Inicializácia objektu ACTIVE, ak by náhodou ešte neexistoval
                        if (!CHALLENGES["ACTIVE"]) {
                            CHALLENGES["ACTIVE"] = {};
                        }
                        
                        CHALLENGES["ACTIVE"][challengeName] = booleanState;
                        modificationExecuted = true;
                        if (DEBUG === true) {
                            log(`Stav výzvy ${challengeName} bol zmenený na ${booleanState}.`);
                        }
                    }
                }
            }

            // --- Handle incremental modifications using '+' or '-' ---
            if (!modificationExecuted && (lowerTarget.includes("+") || lowerTarget.includes("-"))) {
                const isAddition = lowerTarget.includes("+");
                const parts = isAddition ? caseTarget.split("+") : caseTarget.split("-");
                const amount = parts[1] ? parseInt(parts[1]) : 1;
                const modifier = isAddition ? amount : -amount; 

                if (lowerTarget.includes("stress")) {
                    HERO.stress += modifier;
                    if(modifier > 0) flashRed();
                    
                    // --- UPRAVENÉ PRAVIDLO PRE PERM_STRESS ---
                    // Ak hrdina nemá perm_stress, dno je 0
                    const currentPermStress = perm_stress || 0;

                    if (modifier < 0 && HERO.stress < currentPermStress) {
                        // Ak stres klesal a padol pod permanentný stres, zarovnáme ho presne naň
                        HERO.stress = currentPermStress;
                    } else if (HERO.stress < 0) {
                        // Poistka pre prípad, že perm_stress je 0, aby stres nešiel do záporných čísiel
                        HERO.stress = 0;
                    }
                    // -------------------------------------
                    
                    if (modifier > 0) {
                        log(`Stúpol ti stres o ${amount}!`, "danger-msg");
                        heal_attempts = 0;
                    } else {
                        log(`Stres ti klesol o ${amount}.`, "success-msg");
                    }
                    
                    // --- KONTROLA KOLAPSU ---
                    if (HERO.stress > stress_thresh) {
                        is_collapse_check = true;

                        runCollapseCheck(
                            // --- CALLBACK PRE ÚSPECH ---
                            () => {
                                is_collapse_check = false;
                                inputs_frozen = false;
                                const scrollRow = document.querySelector('.card-scroll-row');
                                if (scrollRow) scrollRow.classList.add('enable-interaction');
                                updateUI();

                                if (typeof onTerminalFinishedCallback === "function") {
                                    const callback = onTerminalFinishedCallback;
                                    onTerminalFinishedCallback = null;
                                    callback();
                                }
                            },
                            // --- CALLBACK PRE ZLYHANIE (Game Over) ---
                            () => {
                                is_collapse_check = false;
                                inputs_frozen = true;
                                const scrollRow = document.querySelector('.card-scroll-row');
                                if (scrollRow) scrollRow.classList.remove('enable-interaction');
                                log("💀 Stres presiahol hodnotu kolapsu. KONIEC HRY.", "failure-msg", true);
                                
                                onTerminalFinishedCallback = () => { 
                                    restartGame(); 
                                };

                                if (typeof isProcessingQueue !== 'undefined' && !isProcessingQueue) {
                                    restartGame();
                                }
                            }
                        );

                        return true; 
                    }                    
                    modificationExecuted = true;
                }
                else if (lowerTarget.includes("sp")) {
                    // Inicializujeme sp, ak by náhodou u hrdinu neexistovalo
                    if (typeof HERO.sp === 'undefined') {
                        HERO.sp = 0;
                    }

                    // Upravíme hodnotu v globálnom objekte HERO
                    HERO.sp += modifier;
                    if (HERO.sp < 0) HERO.sp = 0;

                    if (modifier > 0) {
                        log(`Získavaš body rastu: ${amount}. Celkovo: ${HERO.sp}`, "success-msg");
                    } else {
                        log(`Strácaš ${Math.abs(modifier)} SP. Celkovo: ${HERO.sp}`, "danger-msg");
                    }

                    // AKTUALIZÁCIA V LOKÁLNOM SÚBORE (localStorage)
                    const savedCharacters = JSON.parse(localStorage.getItem('characters'));
                    if (savedCharacters && savedCharacters.length > 0) {
                        const charIndex = savedCharacters.findIndex(char => char.name.toUpperCase() === HERO.name.toUpperCase());
                        
                        if (charIndex !== -1) {
                            const currentDbSp = savedCharacters[charIndex].sp || 0;
                            savedCharacters[charIndex].sp = currentDbSp + modifier;
                            if (savedCharacters[charIndex].sp < 0) savedCharacters[charIndex].sp = 0;

                            localStorage.setItem('characters', JSON.stringify(savedCharacters));
                            if (typeof characters !== 'undefined') {
                                characters = savedCharacters;
                            }
                            if (DEBUG === true) {
                                log(`[LOCAL STORAGE] SP pre hrdinu ${HERO.name} úspešne aktualizované v localStorage na ${savedCharacters[charIndex].sp}.`);
                            }
                        }
                    }

                    modificationExecuted = true;
                }
                else if (lowerTarget.includes("enemy_advantage")) {
                    enemy_advantage = Math.min(advantage + 1, ADVANTAGE_CAP);
                    if (enemy_advantage < 0) enemy_advantage = 0; 
                    
                    if (modifier > 0) {
                        log(`Nepriateľ získava výhodu +1!`, "danger-msg");
                    } else {
                        log(`Nepriateľovi klesla výhoda o 1.`);
                    }
                    modificationExecuted = true;
                }
                else if (lowerTarget.includes("advantage")) {
                    let adv_before = advantage;
                    advantage = Math.min(advantage + 1, ADVANTAGE_CAP);
                    if (advantage < 0) advantage = 0; 
                    
                    if (modifier > 0 && advantage > adv_before) {
                        log(`Získavaš výhodu +${amount}!`);
                    } else {
                        log(`Klesla ti výhoda o ${amount}.`, "danger-msg");
                    }
                    modificationExecuted = true;
                }
                else if (lowerTarget.startsWith("difficulty_")) {
                    const lastUnderscore = caseTarget.lastIndexOf('_');

                    if (lastUnderscore !== -1) {
                        const amountStr = caseTarget.substring(lastUnderscore + 1).trim();
                        const targetChallenge = caseTarget.substring("difficulty_".length, lastUnderscore).toUpperCase().trim();
                        const explicitModifier = parseInt(amountStr);

                        if (targetChallenge && !isNaN(explicitModifier) && CHALLENGES[targetChallenge]) {
                            const baseDifficulty = CHALLENGES[targetChallenge].difficulty ?? 0;
                            const newDifficulty = Math.max(0, baseDifficulty + explicitModifier);
                            CHALLENGES[targetChallenge].difficulty = newDifficulty;

                            if (DEBUG === true) {
                                log(`Náročnosť výzvy '${targetChallenge}' bola upravená o ${explicitModifier}. Nová základná hodnota: ${newDifficulty}.`);
                            }
                            modificationExecuted = true;
                        } else if (DEBUG === true) {
                            log(`[executeMods] Neplatný cieľ pre difficulty mod: '${caseTarget}'.`);
                        }
                    }
                }
                else if (lowerTarget.includes("difficulty")) {
                    if (queued_difficulty_target && CHALLENGES[queued_difficulty_target]) {
                        const baseDifficulty = CHALLENGES[queued_difficulty_target].difficulty ?? 0;
                        const newDifficulty = Math.max(0, baseDifficulty + modifier);
                        CHALLENGES[queued_difficulty_target].difficulty = newDifficulty;

                        if (modifier > 0) {
                            log(`Náročnosť nasledujúcej výzvy (${queued_difficulty_target}) sa zvyšuje o ${amount}!`);
                        } else {
                            log(`Náročnosť nasledujúcej výzvy (${queued_difficulty_target}) klesá o ${amount}.`, "success-msg");
                        }
                    } else {
                        current_challenge.difficulty += modifier;
                        if (current_challenge.difficulty < 0) current_challenge.difficulty = 0; 

                        if (modifier > 0) {
                            log(`Náročnosť výzvy sa zvyšuje o ${amount}!`);
                        } else {
                            log(`Náročnosť výzvy klesá o ${amount}.`, "success-msg");
                        }
                    }
                    queued_difficulty_target = null;
                    modificationExecuted = true;
                }
                else if (lowerTarget.includes("threat")) {
                    current_challenge.threat += modifier;
                    if (current_challenge.threat < 0) current_challenge.threat = 0; 
                    
                    if (modifier > 0) {
                        log(`Hrozba výzvy sa zvyšuje o ${amount}!`, "danger-msg");
                    } else {
                        log(`Hrozba výzvy klesá o ${amount}.`, "success-msg");
                    }
                    modificationExecuted = true;
                }
                else if (lowerTarget.includes("weapon+")) {
                    const weaponName = lowerTarget.split("weapon+")[1].trim().split(" ")[0].toLowerCase();
                    
                    // POISTKA: Bezpečne inicializuje zbrane ak chýbajú
                    if (!HERO.weapons || !Array.isArray(HERO.weapons)) {
                        HERO.weapons = [];
                    }

                    if (!HERO.weapons.includes(weaponName)) {
                        HERO.weapons.push(weaponName);
                        log(`Získavaš novú zbraň: ${weaponName.toUpperCase()}!`, "success-msg", true);
                        
                        if (typeof populateWeaponDropdown === "function") {
                            populateWeaponDropdown();
                        }
                    } else {
                        log(`Zbraň ${weaponName.toUpperCase()} už máš vo svojom arzenáli.`, "system-msg", true);
                    }
                    modificationExecuted = true;
                }
                else if (lowerTarget.includes("item_")) {
                    const itemName = parts[0].split("item_")[1].trim().toUpperCase();

                    // POISTKA: Bezpečne inicializuje predmety ak chýbajú
                    if (!HERO.items || typeof HERO.items !== 'object') {
                        HERO.items = {};
                    }

                    if (typeof ITEM_LIST !== 'undefined' && ITEM_LIST[itemName] !== undefined) {
                        const current = HERO.items[itemName] || 0;
                        const newVal = Math.max(0, current + modifier);
                        HERO.items[itemName] = newVal;

                        if (modifier > 0) {
                            log(`Získavaš predmet: ${itemName} (${newVal})!`, "success-msg");
                        } else {
                            log(`Strácaš predmet: ${itemName} (zostatok: ${newVal}).`, "danger-msg");
                        }
                    } else {
                        const current = HERO.items[itemName] || 0;
                        HERO.items[itemName] = Math.max(0, current + modifier);
                        log(`[Zmena] ${itemName}: ${HERO.items[itemName]}`, "system-msg");
                        
                        if (DEBUG === true) {
                            log(`Predmet ${itemName} neexistuje v ITEM_LIST.`, "danger-msg");
                        }
                    }
                    modificationExecuted = true;
                }
                else {
                    // MUNÍCIA BLOK: Ak string nebol item ani weapon+, overíme či ide o registrovanú zbraň z WEAPON_LIST
                    const targetWeaponName = parts[0].trim().toLowerCase();
                    let isKnownWeapon = false;

                    if (typeof WEAPON_LIST !== 'undefined') {
                        for (const category in WEAPON_LIST) {
                            if (WEAPON_LIST[category] && WEAPON_LIST[category][targetWeaponName] !== undefined) {
                                isKnownWeapon = true;
                                break;
                            }
                        }
                    }

                    if (isKnownWeapon) {
                        // POISTKA: Bezpečne inicializuje ammo objekt ak chýba
                        if (!HERO.ammo || typeof HERO.ammo !== 'object') {
                            HERO.ammo = {};
                        }

                        const currentWeaponAmmo = HERO.ammo[targetWeaponName] || 0;
                        const newAmmoValue = Math.max(0, currentWeaponAmmo + modifier);
                        
                        HERO.ammo[targetWeaponName] = newAmmoValue;

                        if (modifier > 0) {
                            log(`Získavaš muníciu pre ${targetWeaponName.toUpperCase()}: +${amount} ks. (Celkovo: ${newAmmoValue})`, "success-msg");
                        } else {
                            log(`Strácaš muníciu pre ${targetWeaponName.toUpperCase()}: -${amount} ks. (Celkovo: ${newAmmoValue})`, "danger-msg");
                        }
                        modificationExecuted = true;
                    }
                }
            }

            if (modificationExecuted) {
                return true;
            }
            return false;
        }
    

        function useItem(item) {
            const itemName = item.toUpperCase();
            
            if (!ITEM_LIST[itemName]) {
                log(`Predmet ${itemName} neexistuje.`, "danger-msg");
                return;
            }
            if (!HERO.items[itemName] || HERO.items[itemName] <= 0) {
                log(`Nemáš žiadny predmet ${itemName}.`, "danger-msg");
                return;
            }

            const effect = ITEM_LIST[itemName].effect;
            const isAddition = effect.includes("+");
            const parts = isAddition ? effect.split("+") : effect.split("-");
            const amount = parts[1] ? parseInt(parts[1]) : 1;
            const modifier = isAddition ? amount : -amount;
            const effectTarget = parts[0].toLowerCase();


            if (effectTarget === "stress") {
                HERO.stress = Math.max(0, HERO.stress + modifier);
                if(modifier<0) {
                    flashRed();
                    heal_attempts = 0
                }
                log(modifier < 0 
                    ? `Stres ti klesol o ${amount}. (${HERO.stress})` 
                    : `Stres ti stúpol o ${amount}. (${HERO.stress})`, 
                    modifier < 0 ? "success-msg" : "danger-msg");
            } 
            else if (effectTarget === "advantage") {
                advantage = Math.max(0, Math.min(advantage + modifier, ADVANTAGE_CAP));
                log(modifier > 0 
                    ? `Získavaš +${amount} k výhode. (${advantage})` 
                    : `Strácaš ${amount} z výhody. (${advantage})`, 
                    modifier > 0 ? "success-msg" : "danger-msg");
            }

            // Consume the item
            HERO.items[itemName] = HERO.items[itemName] - 1;
            log(`Použitý predmet ${itemName}. (zostatok: ${HERO.items[itemName]}x)`, "system-msg");
            
            updateUI();
            if (ITEM_LIST[itemName].message) {
                const message = ITEM_LIST[itemName].message;
                showGeneralPrompt(message)
                return;
            }            
        }

        let activeChoiceIndex = 0; // Tracks which index is chosen via keyboard

        function renderChallengeChoices(activeChallenge) {
            const suffixes = ['A', 'B', 'C', 'D', 'E', 'F'];
            let validChoices = [];
            const activeDict = CHALLENGES?.["ACTIVE"] || {};

            document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());
            const enemyCardContainer = document.getElementById("enemy-card-container");
            if (enemyCardContainer) enemyCardContainer.innerHTML = "";
            const playerCardContainer = document.getElementById("player-card-container");
            if (playerCardContainer) playerCardContainer.innerHTML = "";

            // --- 1. PRELOADER OBRÁZKOV ---
            const preloadUrls = suffixes
                .map(suff => {
                    let target = activeChallenge[`case_${suff}`];
                    if (typeof target === 'string' && target.startsWith('if_')) {
                        const clean = target.split('_else_');
                        const match = clean[0].substring(3).match(/_([a-zA-Z0-9_-]+)$/);
                        target = match ? match[1] : clean[1];
                    }
                    return target;
                })
                .filter(target => target && CHALLENGES[target]?.image)
                .map(target => CHALLENGES[target].image);

            if (preloadUrls.length > 0) preloadImages(preloadUrls);

            // --- 2. HISTÓRIA (SPÄŤ) ---
            if (activeChallenge.back === true && challenge_history.length > 0) {
                const backDest = challenge_history[challenge_history.length - 1];
                if (activeDict[backDest] === true) {
                    validChoices.push({ text: "⬅", target: "BACK_ACTION_1", isBack: true });
                }
            }

            // --- 3. VYHODNOCOVANIE MOŽNOSTÍ PRE HRÁČA ---
            suffixes.forEach(suff => {
                const choiceText = activeChallenge[`choice_${suff}`];
                let targetValue = activeChallenge[`case_${suff}`];

                if (!choiceText || !targetValue) return;

                let finalTarget = null;

                // Spracovanie poľa (Array)
                if (Array.isArray(targetValue)) {
                    for (let item of targetValue) {
                        if (typeof item === 'string' && item.startsWith('if_')) {
                            item = evaluateIfCondition(item);
                        }
                        // Overenie: Existuje scéna a je v ACTIVE nastavená na true?
                        if (item && CHALLENGES[item] && activeDict[item] === true) {
                            finalTarget = targetValue;
                            break;
                        }
                    }
                } 
                // Spracovanie bežného reťazca (String / "if_")
                else {
                    if (typeof targetValue === 'string' && targetValue.startsWith('if_')) {
                        targetValue = evaluateIfCondition(targetValue);
                    }
                    if (targetValue && CHALLENGES[targetValue] && activeDict[targetValue] === true) {
                        finalTarget = targetValue;
                    }
                }

                // Ak cieľ prešiel všetkými overeniami, pridáme voľbu na vykreslenie
                if (finalTarget) {
                    validChoices.push({
                        text: choiceText,
                        target: finalTarget
                    });
                }
            });

        
            const hasRealChoices = suffixes.some(suff => activeChallenge[`choice_${suff}`]);

            if (validChoices.length > 0 && (hasRealChoices || activeChallenge.difficulty === undefined)) {
                inputs_frozen = true;
                const scrollRow = document.querySelector('.card-scroll-row');
                if (scrollRow) scrollRow.classList.remove('enable-interaction');
                narrative_phase = true; 
                
                let choicePrompt = document.getElementById("choice-prompt");
                

                if (!choicePrompt) {
                    choicePrompt = document.createElement("div");
                    choicePrompt.id = "choice-prompt";
                    // Removed style.cssText — styling handled completely in CSS!
                    document.querySelector(".gaming-table-floor").appendChild(choicePrompt);
                }

                choicePrompt.innerHTML = "";
                activeChoiceIndex = 0; 
                choicePrompt.userData = { validChoices: validChoices };

                validChoices.forEach((choice, index) => {
                    const btn = document.createElement("button");
                    btn.className = "adrenaline-select choice-btn"; // Use both class profiles
                    
                    if (choice.isBack) {
                        btn.classList.add("back-btn");
                    }

                    btn.innerText = choice.text;
                    
                    btn.onmouseenter = () => {
                        activeChoiceIndex = index;
                        updateVisualChoiceHighlights();
                    };

                    btn.onclick = () => {
                        if (typeof is_collapse_check !== 'undefined' && is_collapse_check === true) {
                            return; 
                        }
                        choicePrompt.style.display = "none";
                        narrative_phase = false;
                        handleChallengeTransition(choice.target);
                    };
                    
                    choicePrompt.appendChild(btn);
                });

                choicePrompt.style.display = "flex";
                updateVisualChoiceHighlights(); // Apply initial first element highlight state
                if (test_mode && !keep_testing) {
                    keep_testing = true;
                    test();
                }
            } else {
                updateUI();
            }
        }

        // Visual layout sync helper
        function updateVisualChoiceHighlights() {
            const choicePrompt = document.getElementById("choice-prompt");
            if (!choicePrompt || choicePrompt.style.display === "none") return;

            const buttons = choicePrompt.querySelectorAll(".adrenaline-select");
            buttons.forEach((btn, idx) => {
                if (idx === activeChoiceIndex) {
                    btn.classList.add("choice-hover-highlight");
                } else {
                    btn.classList.remove("choice-hover-highlight");
                }
            });
        }

        function triggerDiceVisualAnimation(diceRolls, isEnemy = false) {
            const tableFloor = document.querySelector('.gaming-table-floor');
            if (!tableFloor) return;

            // Target the specific sandboxed track pool type so actor nodes do not conflict
            const poolClass = isEnemy ? 'enemy-pool' : 'player-pool';
            const oldPool = tableFloor.querySelector(`.dice-animation-pool.${poolClass}`);
            if (oldPool) oldPool.remove();

            // Create a new sandbox layer container bound inside the floor space
            const pool = document.createElement('div');
            pool.className = `dice-animation-pool ${poolClass}`;
            tableFloor.appendChild(pool);

            diceRolls.forEach((die, index) => {
                const container = document.createElement('div');
                
                // Track visual custom animation behavior profile configurations
                const modifierAnimationClass = isEnemy ? ' enemy-die' : '';
                
                if (die.isSkillDie) {
                    container.className = `die-container die-dh${modifierAnimationClass}`;
                    container.style.animationDelay = `${index * 0.1}s`; 
                    
                    const img = document.createElement('img');
                    img.src = `assets/DH${die.value}.png`;
                    img.className = 'die-img';
                    img.alt = `Skill Die ${die.value}`;
                    
                    container.appendChild(img);
                } else {
                    const classType = die.type.toLowerCase(); 
                    container.className = `die-container die-${classType}${modifierAnimationClass}`;
                    container.style.animationDelay = `${index * 0.1}s`;
                    
                    const img = document.createElement('img');
                    img.src = `assets/${die.type}.png`;
                    img.className = 'die-img';
                    img.alt = die.type;
                    
                    const label = document.createElement('div');
                    label.className = 'die-label';
                    label.innerText = die.value;
                    
                    container.appendChild(img);
                    container.appendChild(label);
                }
                
                pool.appendChild(container);
            });
        }

        function toggleChallengeDisplay(show, data = null) {
            const challengeDisplay = document.getElementById("challenge-stats-display");
            if (!challengeDisplay) return;
            if (show) {
                if (data) {
                    // Update the span values instead of replacing innerHTML
                    const spans = challengeDisplay.querySelectorAll('.stat-item span');
                    if (spans[0]) spans[0].textContent = data.difficulty;
                    if (spans[1]) spans[1].textContent = data.threat;
                }
                
                // 1. Reveal the element structure
                challengeDisplay.style.display = "flex"; 
                
                // 2. Force a quick browser reflow
                void challengeDisplay.offsetWidth; 
                
                // 3. Slide it down
                challengeDisplay.classList.add("show");
                initTooltips()

            } else {
                // Only attempt to hide it if it's actually visible right now
                if (challengeDisplay.classList.contains("show")) {
                    
                    // 4. Start sliding up
                    challengeDisplay.classList.remove("show");
                    
                    // 5. Wait for the CSS transition to finish
                    challengeDisplay.addEventListener('transitionend', function handleHide() {
                        if (!challengeDisplay.classList.contains("show")) {
                            challengeDisplay.style.display = "none";
                        }
                        challengeDisplay.removeEventListener('transitionend', handleHide);
                    });
                } else {
                    challengeDisplay.style.display = "none";
                }
            }
        }

        function runActionPhase() {
            enemy = null;
            is_conflict = false;
            player_action = null;
            enemy_action = null;
            move = 0;
            hidecards(true);

            const enemyContainer = document.getElementById("enemy-sprite-container");
            const enemyImg = document.getElementById("enemy-sprite");

            if (enemyContainer) {
                enemyContainer.style.display = "none";
                enemyContainer.classList.remove("enemy-entrance", "enemy-hit");
            }

            if (enemyImg) enemyImg.src = "";

            const tableFloor = document.querySelector('.gaming-table-floor');
            if (tableFloor) {
                const enemyPool = tableFloor.querySelector('.dice-animation-pool.enemy-pool');
                if (enemyPool) enemyPool.remove();
            }

            const activeChallenge = CHALLENGES[current_challenge_key];
            current_challenge.difficulty = activeChallenge.difficulty;
            current_challenge.threat = activeChallenge.threat;

            // This helper executes the UI setup and logic flow
            const proceedWithPhase = () => {
                // 1. Trigger delayed even if it's not an array (handles string or array)
                if (activeChallenge.trigger_delayed) {
                    const delayedTargets = Array.isArray(activeChallenge.trigger_delayed)
                        ? activeChallenge.trigger_delayed
                        : [activeChallenge.trigger_delayed];

                    let triggeredEffects = [];

                    // Gather all delayed challenges currently waiting in the global pool
                    for (const effect of delayedTargets) {
                        
                        // 2. If triggered effect is in COOLDOWN, skip it and remove it from COOLDOWN
                        const cooldownIndex = DELAYED_COOLDOWN.indexOf(effect);
                        if (cooldownIndex !== -1) {
                            DELAYED_COOLDOWN.splice(cooldownIndex, 1);
                            continue; 
                        }

                        const delayedIndex = DELAYED.indexOf(effect);
                        if (delayedIndex !== -1) {
                            // Remove it from the pool immediately so it cannot re-trigger
                            DELAYED.splice(delayedIndex, 1);

                            const targetIsInactive = typeof effect === 'string' &&
                                CHALLENGES["ACTIVE"] &&
                                CHALLENGES["ACTIVE"][effect] === false;

                            if (targetIsInactive) {
                                if (DEBUG === true) {
                                    log(`Delayed target ${effect} je neaktívny, ignorujem.`);
                                }
                                continue; 
                            }

                            triggeredEffects.push(effect);
                            
                            // 3. Add successfully triggered effects to DELAYED_COOLDOWN
                            DELAYED_COOLDOWN.push(effect);
                        }
                    }

                    // If any matching threats were triggered, chain them together sequentially
                    if (triggeredEffects.length > 0) {
                        if (DEBUG === true) {
                            log(`[Trigger Delayed] Spúšťam reťazec odložených hrozieb: ${triggeredEffects.join(', ')}`);
                        }

                        // We build an execution chain: Encounter 1 -> Encounter 2 -> back to Original Card
                        const executionChain = [...triggeredEffects, current_challenge_key];

                        // Hand over the array sequence to your existing engine routing
                        handleChallengeTransition(executionChain);
                        return true; // Stop rendering the current card's UI layout for now
                    }
                }
                const challengeDisplay = document.getElementById("challenge-stats-display");
                
                // --- CORE DETERMINISTIC DISTINCTION ---
                // If difficulty and threat exist, it is strictly an action gameplay node
                if (activeChallenge.difficulty !== undefined && activeChallenge.threat !== undefined) {
                    // Shows the display, injects data, and triggers the smooth slide down
                    toggleChallengeDisplay(true, current_challenge);
                    is_action_phase = true;
                } else {
                    // It is a clean narrative choice node -> hide action layout properties
                    if (challengeDisplay) {
                        challengeDisplay.style.display = "none";
                    }
                    is_action_phase = false;
                }

                if (activeChallenge.initial_msg) {
                    log(activeChallenge.initial_msg, "system-msg", true);
                }
                
                
                inputs_frozen = false;
                const scrollRow = document.querySelector('.card-scroll-row');
                if (scrollRow) scrollRow.classList.add('enable-interaction');
                updateUI();

                // Message Queue Logic
                let sequentialMsgs = [];
                let msgIndex = 1;
                while (activeChallenge[`initial_msg_${msgIndex}`]) {
                    sequentialMsgs.push(activeChallenge[`initial_msg_${msgIndex}`]);
                    msgIndex++;
                }

                if (sequentialMsgs.length > 0) {
                    inputs_frozen = true;
                    const scrollRow = document.querySelector('.card-scroll-row');
                    if (scrollRow) scrollRow.classList.remove('enable-interaction');
                    updateUI();
                    let currentMsgIdx = 0;

                    const showNextNarrativeMessage = () => {
                        log(sequentialMsgs[currentMsgIdx], "", true);
                        if (currentMsgIdx === sequentialMsgs.length - 1) {
                            if (activeChallenge && activeChallenge.next) {
                                proceed(() => {
                                    inputs_frozen = true;
                                    updateUI();
                                    handleChallengeTransition(activeChallenge.next);
                                });
                            } else {
                                proceed(() => {
                                    updateUI();
                                    renderChallengeChoices(activeChallenge); // Securely renders choices after message strings
                                });
                            }
                        } else {
                            currentMsgIdx++;
                            proceed(showNextNarrativeMessage);
                        }
                    };
                    proceed(showNextNarrativeMessage);
                    return true;
                }

                // If it's a narrative choice node with NO multi-message queue, automatically process its choices immediately
                if (!is_action_phase) {
                    if (activeChallenge.next) {
                        proceed(activeChallenge.next);
                    } else {
                        renderChallengeChoices(activeChallenge);
                    }
                    return true;
                }

                // Only return false if it's an action card challenge needing card clicks!
                return false;
            };

            // --- Image asset management ---
            if (tableFloor && activeChallenge.image) {
                const newUrl = activeChallenge.image;
                
                // 1. Check if it's already the current one
                if (tableFloor.style.getPropertyValue('--bg-image') === `url('${newUrl}')`) {
                    return proceedWithPhase();
                } else {
                    // 2. Create a temporary image to force a clean decode
                    const tempImg = new Image();
                    tempImg.onload = () => {
                        tableFloor.style.setProperty('--bg-image', `url('${newUrl}')`);
                        tableFloor.classList.add('fade-in');
                        tableFloor.classList.toggle('safari-repaint-trigger');
                        proceedWithPhase(); // Now proceed with narrative UI layout or action checks
                    };
                    tempImg.onerror = () => {
                    if (DEBUG) log(`[IMAGE] Failed to load '${newUrl}', continuing without background swap.`, "danger-msg");
                        proceedWithPhase(); // don't let a broken/slow asset freeze the whole game
                    };
                    tempImg.src = newUrl; 
                    return true;
                }
            } else {
                if (tableFloor) tableFloor.style.removeProperty('--bg-image');
                return proceedWithPhase();
            }
        }

        function pushDelayed(effect) {
            if (!effect) return;
            if (!DELAYED.includes(effect)) {
                DELAYED.push(effect);
            }
        }

        // Sledovanie výberu schopnosti hráčom (mimo boja aj počas boja)
        document.getElementById("player-skill-dropdown").addEventListener("change", function(e) {
            const selectedSkillName = e.target.value;
            let chosenSkillValue = 0;
            let isPlaceholder = false;
            if (selectedSkillName == "placeholder") isPlaceholder = true;

            // --- REŽIM BOJA (COMBAT) ---
            if (enemy) {
                const skillData = SKILLS_DB[selectedSkillName];
                const isDefenseSkill = DEFENSE_SKILLS.includes(selectedSkillName.toUpperCase());
                const isCombatSkill = ATTACK_SKILLS.includes(selectedSkillName.toUpperCase()) || 
                        (skillData && skillData[1] && skillData[1].toUpperCase().includes("BOJ"));                
                // PRVÝ KROK: Ak schopnosť nie je bojová a nie je ani v obranných, vyhodíme ju
                if (!isCombatSkill && !isDefenseSkill && !isPlaceholder) {
                    log(`⚠️ "${selectedSkillName}" nemôžeš použiť v boji.`, "error-msg");
                    return;
                };
                return
            }
            // --- REŽIM VÝZVY (CHALLENGE) ---
            const activeChallenge = CHALLENGES[current_challenge_key];
            const actualHeroValue = HERO.skills[selectedSkillName] || 0;

            if (activeChallenge && activeChallenge.skills && activeChallenge.skills.length > 0) {
                if (!activeChallenge.skills.includes(selectedSkillName) && !isPlaceholder) {
                    log(`⚠️ Schopnosť ${selectedSkillName} ti teraz nepomôže, skús jednu z týchto: (${activeChallenge.skills.join(', ')})`, "error-msg");
                } else if(!isPlaceholder){
                    log(`✅ ${selectedSkillName} (+${actualHeroValue}) je vhodná schopnosť!`, "success-msg");
                }
            } else if (challengeDisplay) {
                log(`ℹ️ Pri tejto výzve ti nepomôžu žiadne schopnosti.`, "system-msg");
            }
        });


        function cycleDropdown(dropdownId, direction) {
            const el = document.getElementById(dropdownId);
            // Bezpečnostný zámok: Ak element neexistuje alebo je zakázaný, nerobíme nič
            if (!el || el.disabled || window.getComputedStyle(el).display === "none") return;

            const options = Array.from(el.options);
            if (options.length <= 1) return; // Ak je v zozname len jedna možnosť, niet kam cyklovať

            // Ak nie je konflikt ani eliminácia, všetky dostupné možnosti sú automaticky povolené
            if ((typeof is_conflict === 'undefined' || !is_conflict) && !is_elimination_check) {
                let nextIndex = (el.selectedIndex + direction + options.length) % options.length;
                while (options[nextIndex].disabled && nextIndex !== el.selectedIndex) {
                    nextIndex = (nextIndex + direction + options.length) % options.length;
                }
                if (nextIndex !== el.selectedIndex) {
                    el.selectedIndex = nextIndex;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
                return;
            }


            function simulateActionCheck(actionType, skillVal, weaponVal) {
                const upperSkill = (skillVal || "").toUpperCase();
                const isPlaceholderSkill = skillVal === "placeholder" || skillVal === "none" || skillVal === "";
                const isPlaceholderWeapon = weaponVal === "placeholder" || weaponVal === "";

                const skillData = typeof SKILLS_DB !== 'undefined' ? SKILLS_DB[skillVal] : null;
                
                // Ak sme v režime eliminácie, preverujeme SNEAK_SKILLS, inak klasické DEFENSE_SKILLS
                let currentDefenseList = (typeof DEFENSE_SKILLS !== 'undefined') ? DEFENSE_SKILLS : [];
                if (is_elimination_check) {
                    currentDefenseList = (typeof SNEAK_SKILLS !== 'undefined') ? SNEAK_SKILLS : [];
                }

                const isDefenseSkill = currentDefenseList.includes(upperSkill);
                const isCombatSkill = ATTACK_SKILLS.includes(upperSkill) || 
                                    (skillData && skillData[1] && skillData[1].toUpperCase().includes("BOJ"));
                
                // Zistenie, či ide o eliminačný skill
                const isEliminationSkill = upperSkill.includes("ELIMIN");

                // --- 0. B. VALIDÁCIA PRE BOJ / ELIMINÁCIU ---
                // Povolíme bojové skilly, obranné/sneak skilly, placeholdery a POČAS ELIMINÁCIE aj eliminačné skilly
                if (!isCombatSkill && !isDefenseSkill && !isPlaceholderSkill) {
                    if (!(is_elimination_check && isEliminationSkill)) {
                        return false;
                    }
                }

                // --- 1. KROK: VRHANIE A ŤAŽKÉ PREDMETY ---
                if (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY") {
                    if (!WEAPON_LIST["VRHACIE"] || WEAPON_LIST["VRHACIE"][weaponVal] === undefined) return false;
                }

                // --- 2. KROK: KONTROLA EXKLUZIVITY ÚTOK/OBRANA ---
                // V eliminačnom režime sme striktne na ÚTOKU ("A") alebo "D" (podľa zóny sneak/kill), 
                // eliminačné skilly preto nesmú byť vyradené pravidlom exkluzivity
                if (!isPlaceholderSkill && !isEliminationSkill) {
                    if (actionType === "A" && !isCombatSkill && isDefenseSkill) return false;
                    if (actionType === "D" && isCombatSkill && !isDefenseSkill) return false;
                }

                // --- 3. KROK: KONTROLA KOMBINÁCIE ZBRANE A SCHOPNOSTI ---
                if (!isPlaceholderSkill) {
                    if (skillData) {
                        const skillCategory = skillData[1] ? skillData[1].toUpperCase() : "";
                        if (skillCategory === "BOJ Z DIAĽKY" || upperSkill.includes("ZBRANE")) {
                            if (isPlaceholderWeapon) return false;
                        }
                    }

                    if (!isPlaceholderWeapon) {
                        let foundDamage = 0;
                        for (const category in WEAPON_LIST) {
                            if (WEAPON_LIST[category] && WEAPON_LIST[category][weaponVal] !== undefined) {
                                foundDamage = WEAPON_LIST[category][weaponVal];
                                break;
                            }
                        }
                        
                        const weaponAllowed = WEAPON_SKILLS[String(foundDamage)] || [];
                        const allowedSkills = weaponAllowed.concat(ATTACK_SKILLS);
                        
                        // Ak sme v eliminácii, tak eliminačné skilly automaticky prechádzajú touto kontrolou zbraní
                        if (!isEliminationSkill && !allowedSkills.includes(upperSkill)) return false;

                        if (skillData && skillData[1]) {
                            const skillCategory = skillData[1].toUpperCase();
                            if (upperSkill !== "VRHANIE" && upperSkill !== "ŤAŽKÉ PREDMETY" && !isEliminationSkill) {
                                if (skillCategory === "BOJ ZBLÍZKA" || skillCategory === "BOJ Z DIAĽKY") {
                                    if (!WEAPON_LIST[skillCategory] || WEAPON_LIST[skillCategory][weaponVal] === undefined) return false;
                                }
                            }
                        }
                    }
                }

                // --- 4. KROK: KONTROLA MUNÍCIE ---
                if (actionType === "A" && !isPlaceholderWeapon) {
                    if (typeof INITIAL_AMMO !== "undefined" && INITIAL_AMMO[weaponVal] !== undefined) {
                        const isRangedWeapon = WEAPON_LIST["BOJ Z DIAĽKY"] && WEAPON_LIST["BOJ Z DIAĽKY"][weaponVal] !== undefined;
                        const isThrownWeapon = WEAPON_LIST["VRHACIE"] && WEAPON_LIST["VRHACIE"][weaponVal] !== undefined;
                        const isThrownSkill = (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY");

                        if (isRangedWeapon || (isThrownWeapon && isThrownSkill)) {
                            const currentAmmo = (HERO && HERO["ammo"]) ? HERO["ammo"][weaponVal] : undefined;
                            if (currentAmmo === undefined || currentAmmo <= 0) return false;
                        }
                    }
                }

                // --- 5. KROK: REŽIMY PRENASLEDOVANIA A ÚNIKU ---
                const isChaseMode = typeof chase_mode !== 'undefined' && chase_mode;
                const isPlayerEscaping = typeof player_escaping !== 'undefined' && player_escaping;
                const isEnemyEscaping = typeof enemy_escaping !== 'undefined' && enemy_escaping;
                const escapeCounter = typeof enemy_escape_counter !== 'undefined' ? enemy_escape_counter : 0;

                if (isChaseMode || isPlayerEscaping || isEnemyEscaping) {
                    if (isPlayerEscaping && actionType === "D" && !isPlaceholderSkill && !CHASE_SKILLS.includes(upperSkill)) return false;
                    if (isEnemyEscaping) {
                        if (actionType === "D" && !isPlaceholderSkill && !CHASE_SKILLS.includes(upperSkill)) return false;
                        if (actionType === "A") {
                            if (isPlaceholderWeapon) {
                                if (escapeCounter >= 1) return false;
                            } else {
                                const isRanged = WEAPON_LIST["BOJ Z DIAĽKY"] && WEAPON_LIST["BOJ Z DIAĽKY"][weaponVal] !== undefined;
                                const isThrownWeapon = WEAPON_LIST["VRHACIE"] && WEAPON_LIST["VRHACIE"][weaponVal] !== undefined;
                                const isThrownSkill = (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY");
                                const canAttackAtDistance = isRanged || (isThrownWeapon && isThrownSkill);
                                if (!canAttackAtDistance && escapeCounter >= 1) return false;
                            }
                        }
                    }
                }

                return true;
            }

            // Zhromaždenie všetkých teoreticky dostupných možností hrdinu pre elimináciu deadlockov
            const playerWeapons = ["placeholder"].concat((HERO && HERO.weapons) || []);

            function isCandidateValid(candidateValue) {
                if (dropdownId === "player-weapon-dropdown") return true;

                try {
                    if (dropdownId === "player-skill-dropdown") {
                        const upperCandidate = candidateValue.toUpperCase();

                        // --- 1. KONTROLA: PRESKOČIŤ ELIMINAČNÉ SKILLY V ČISTOM KONFLIKTE ---
                        if (typeof is_conflict !== 'undefined' && is_conflict && !is_elimination_check) {
                            if (upperCandidate.includes("ELIMIN")) {
                                return false;
                            }
                        }

                        // Unikátna záchrana: Prázdne/placeholder voľby sú povolené vždy
                        if (candidateValue === "placeholder" || candidateValue === "none" || candidateValue === "") return true;

                        // --- 2. ÚPRAVA PRE ELIMINAČNÝ REŽIM ---
                        if (typeof is_elimination_check !== 'undefined' && is_elimination_check) {
                            if (upperCandidate.includes("ELIMIN")) {
                                return true; 
                            }
                        }

                        // Testujeme skill voči všetkým zbraniam, ktoré hrdina reálne vlastní
                        return playerWeapons.some(w => simulateActionCheck("A", candidateValue, w) || simulateActionCheck("D", candidateValue, w));
                    }
                } catch (err) {
                    return true;
                }
                return true;
            }

            let currentIndex = el.selectedIndex;
            let nextIndex = currentIndex;

            do {
                nextIndex = (nextIndex + direction + options.length) % options.length;
                if (nextIndex === currentIndex) break;

                const candidate = options[nextIndex];
                if (candidate.disabled) continue;

                if (isCandidateValid(candidate.value)) {
                    break; 
                }
            } while (nextIndex !== currentIndex);

            if (nextIndex !== currentIndex) {
                el.selectedIndex = nextIndex;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }


        function updateUI() {
            document.getElementById("player-advantage").innerText = advantage;
            syncHeroToStorage();
            const spElement = document.getElementById("sp");
            if (spElement) {
                // Ak HERO.sp neexistuje, použije sa 0
                spElement.innerText = HERO.sp !== undefined ? HERO.sp : 0;
            }

            if (HERO.weapons && Array.isArray(HERO.weapons)) {
                let weaponsChanged = false;
                
                // Prefiltrujeme zbrane - ponecháme len tie, ktoré nie sú vrhacie ALEBO majú muníciu > 0
                const filteredWeapons = HERO.weapons.filter(weaponName => {
                    const lowerName = weaponName.toLowerCase();
                    const currentAmmo = HERO.ammo ? (HERO.ammo[lowerName] || 0) : 0;
                    
                    // Kontrola, či je zbraň v kategórii VRHACIE
                    const isThrowing = WEAPON_LIST["VRHACIE"] && WEAPON_LIST["VRHACIE"][lowerName] !== undefined;
                    
                    if (isThrowing && currentAmmo === 0) {
                        weaponsChanged = true; // Zaznamenáme, že vymazávame zbraň
                        log(`💥 Tvoja vrhacia zbraň ${lowerName.toUpperCase()} sa minula a bola odstránená.`, "danger-msg");
                        
                        // Ak mal hráč tento nôž práve vybraný v dropdowne, prepneme na placeholder alebo inú zbraň
                        const weaponDropdown = document.getElementById("player-weapon-dropdown");
                        if (weaponDropdown && weaponDropdown.value === lowerName) {
                            weaponDropdown.value = "placeholder"; 
                        }
                        return false; // Vymaže zbraň z poľa
                    }
                    return true; // Ponechá zbraň v poli
                });

                if (weaponsChanged) {
                    HERO.weapons = filteredWeapons; // Uložíme aktualizované pole hrdinovi
                    }
                if (typeof populateWeaponDropdown === "function") {
                    populateWeaponDropdown();
                }
                // Ak došlo k reálnej zmene (nôž klesol na 0 a bol vymazaný)
                
                
            }

            const escapeBtn = document.getElementById("escape-btn");
            if (escapeBtn) {
                if (is_conflict) {
                    escapeBtn.style.display = "block"; 
                } else {
                    escapeBtn.style.display = "none";
                    player_escaping = false;
                    escapeBtn.style.background = "#000";
                }
            }

            // --- 1. SEKCIA ZBRANÍ (Tvoj pôvodný kód) ---
            const weaponDropdown = document.getElementById("player-weapon-dropdown");
            if (weaponDropdown) {
                const currentSelectedWeapon = weaponDropdown.value;

                Array.from(weaponDropdown.options).forEach(option => {
                    const weaponName = option.value;
                    if (weaponName === "placeholder") return;

                    let dmgValue = 0;
                    if (typeof WEAPON_LIST === "object") {
                        for (const category in WEAPON_LIST) {
                            if (WEAPON_LIST[category] && WEAPON_LIST[category][weaponName] !== undefined) {
                                dmgValue = WEAPON_LIST[category][weaponName];
                                break;
                            }
                        }
                    }

                    let ammoText = "";
                    const hasInitialAmmo = typeof INITIAL_AMMO !== "undefined" && INITIAL_AMMO[weaponName] !== undefined;
                    const hasHeroAmmo = HERO.ammo && HERO.ammo[weaponName] !== undefined;

                    if (hasInitialAmmo || hasHeroAmmo) {
                        const currentAmmo = (HERO.ammo && HERO.ammo[weaponName] !== undefined) ? HERO.ammo[weaponName] : 0;
                        ammoText = ` x${currentAmmo}`;
                    }

                    option.textContent = `${weaponName.toUpperCase()} (+${dmgValue})${ammoText}`;
                });

                weaponDropdown.value = currentSelectedWeapon;
            }

            // --- 2. PRIDANÁ SEKCIA: AKTUALIZÁCIA SKILL DROPDOWNU (Čisté a bezpečné) ---
            const skillDropdown = document.getElementById("player-skill-dropdown");
            if (skillDropdown) {
                // Uložíme si, čo mal hráč vybrané pred aktualizáciou, aby mu to neprebliklo
                const currentSelectedSkill = skillDropdown.value;

                skillDropdown.innerHTML = ""; // Vyčistenie starých hodnôt

                // Vytvorenie placeholderu
                const placeholder = document.createElement("option");
                placeholder.value = "placeholder";
                placeholder.textContent = "- SCHOPNOSŤ -";
                skillDropdown.appendChild(placeholder);

                const BIOLOGICAL_WEAPONS = ["OSTNE", "HRYZADLÁ", "KLEPETÁ", "KYSELINA", "ŽIHADLO"];

                if (!HERO.weapons || !Array.isArray(HERO.weapons)) {
                    HERO.weapons = [];
                }

                let hasRealSkills = false;

                // Načítanie čerstvých skillov z aktuálneho objektu HERO
                if (HERO.skills && Object.keys(HERO.skills).length > 0) {
                    for (const [skillName, val] of Object.entries(HERO.skills)) {
                        const upperSkillName = skillName.toUpperCase();

                        if (BIOLOGICAL_WEAPONS.includes(upperSkillName)) {
                            const lowerSkillName = skillName.toLowerCase();
                            if (!HERO.weapons.includes(lowerSkillName)) {
                                HERO.weapons.push(lowerSkillName);
                            }
                            continue; 
                        }

                        const option = document.createElement("option");
                        option.value = skillName;
                        option.textContent = `${skillName} (${val})`;
                        skillDropdown.appendChild(option);
                        hasRealSkills = true;
                    }
                }

                if (!hasRealSkills) {
                    const option = document.createElement("option");
                    option.value = "none";
                    option.textContent = "ŽIADNA (0)";
                    skillDropdown.appendChild(option);
                }

                // Pokúsime sa vrátiť výber na pôvodnú hodnotu, ak v novom zozname stále existuje
                if (Array.from(skillDropdown.options).some(opt => opt.value === currentSelectedSkill)) {
                    skillDropdown.value = currentSelectedSkill;
                    // Re-sync the global skill variable to match the restored dropdown
                    skill = HERO.skills[currentSelectedSkill] || 0;
                } else {
                    skillDropdown.value = "placeholder";
                    skill = 0;
                }
            }

            // --- 3. ZVYŠOK TVOJHO PÔVODNÉHO KÓDU (Stress, Adrenaline, Enemy...) ---
            const tray = document.getElementById("card-tray-container");
            const enemyHeading = document.getElementById("enemy-heading-type");
            const challengeDisplay = document.getElementById("challenge-stats-display");
            const tableFloor = document.querySelector('.gaming-table-floor');

            document.querySelectorAll(".track-cell").forEach(cell => {
                cell.classList.remove("active-stress", "filled-stress", "ad-playable", "ad-locked");
            });

            document.querySelectorAll(".stress-node").forEach(cell => {
                const val = parseInt(cell.getAttribute("data-val"));
                
                // Resetujeme všetky stavové triedy pred novým vyhodnotením
                cell.classList.remove("active-perm", "filled-perm", "active-stress", "filled-stress");
                
                // Zabezpečíme načítanie globálnej premennej perm_stress (ak neexistuje, použijeme 0)
                const currentPerm = typeof perm_stress !== 'undefined' ? perm_stress : 0;

                // 1. VRSTVA: Permanentný stres (čierne pozadie)
                if (val <= currentPerm) {
                    if (val === currentPerm) {
                        cell.classList.add("active-perm");
                    } else {
                        cell.classList.add("filled-perm");
                    }
                } 
                // 2. VRSTVA: Bežný stres (červené pozadie - aplikuje sa iba na políčka nad perm_stress)
                else if (val <= HERO.stress) {
                    if (val === HERO.stress) {
                        cell.classList.add("active-stress");
                    } else {
                        cell.classList.add("filled-stress");
                    }
                }
            });

            

            document.querySelectorAll(".ad-node").forEach(cell => {
                const idx = parseInt(cell.getAttribute("data-idx"));
                if (idx > HERO.stress) {
                    cell.classList.add("ad-playable");
                } else {
                    cell.classList.add("ad-locked");
                }
            });

            // After the ad-node forEach loop in updateUI:
            const selectedVal = document.getElementById("adrenaline-select").value;
            if (selectedVal && selectedVal !== "0") {
                document.querySelectorAll(".ad-node").forEach(node => {
                    if (node.getAttribute("data-idx") === String(HERO.stress)) {
                        node.classList.remove("ad-locked");
                        node.classList.add("ad-selected");
                    }
                });
            }
            
            if (enemy === null) {
                is_conflict = false;
                document.getElementById("enemy-panel").style.display = "none";
                tray.className = "card-tray challenge-mode";
                
                if (tableFloor) tableFloor.classList.remove("combat-mode");
                
                if (challengeDisplay) {
                    if (is_elimination_check){
                        tray.className = "card-tray conflict-mode";
                    }
                    const activeChallenge = CHALLENGES[current_challenge_key];
                    if (activeChallenge && activeChallenge.difficulty !== undefined && activeChallenge.threat !== undefined) {
                        // Slide down and update content
                        toggleChallengeDisplay(true, activeChallenge);
                        is_action_phase = true;
                    } else if (is_collapse_check || is_heal_check || is_elimination_check) {
                        // Slide down without wiping out content
                        toggleChallengeDisplay(true);
                    } else {
                        is_action_phase = false;
                        // Slide smoothly back up out of view
                        toggleChallengeDisplay(false);
                    }
                }
                
                if (enemyHeading) enemyHeading.innerText = "ENEMY";
            } else {
                is_conflict = true;
                document.getElementById("enemy-panel").style.display = "block";
                document.getElementById("enemy-stress").innerText = `${enemy_stress} / ${ENEMY_TYPES[enemy].stress_thresh}`;
                document.getElementById("enemy-advantage").innerText = enemy_advantage;
                document.getElementById("enemy-skill").innerText = `${ENEMY_TYPES[enemy].skill}`;
                document.getElementById("enemy-weapon").innerText = `${ENEMY_TYPES[enemy].weapon}`;
                tray.className = "card-tray conflict-mode";
                
                if (tableFloor) tableFloor.classList.add("combat-mode");
                if (challengeDisplay && !is_collapse_check) challengeDisplay.style.display = "none";
                is_action_phase = false;
                if (enemyHeading) enemyHeading.innerText = enemy;
            }

        }

        function resolveActionPhase(card) {
            inputs_frozen = true;
            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');
            updateUI();
            if (test_mode) skill = 3;
            const activeChallenge = CHALLENGES[current_challenge_key];
            let adrenaline = parseInt(document.getElementById("adrenaline-select").value) || 0;
            let roll_result = rollDice(card, false, skill);
            
            log(`VÝSLEDOK: ${roll_result} (+${adrenaline})`, "error-msg", true);

            roll_result += adrenaline; 

            let success = roll_result >= current_challenge.difficulty;
            let is_failure = roll_result < current_challenge.difficulty;
            let is_tie = roll_result == current_challenge.difficulty;

            let threat_realized = false;

            if (is_tie){
                log("Vyhodnocujem hrozbu...", "error-msg",false, false, true);
            } else if (is_failure) {
                log("Vyhodnocujem hrozbu...", "error-msg",false, false, true);
            }

            // Bezpečne posielame hráča na výslednú lokáciu až po dobehnutí všetkých logov
            const doTransition = () => {
                let followupTarget;
                if (success) {
                    HERO.sp = Math.max(0, (HERO.sp || 0) + 1);
                    log(" (+1 BR!)", "success-msg", false, false, true);
                    if (activeChallenge.case_success_delayed) {
                        if (Array.isArray(activeChallenge.case_success_delayed)) {
                            DELAYED.push(...activeChallenge.case_success_delayed);
                        } else {
                            DELAYED.push(activeChallenge.case_success_delayed);
                        }
                    }
                    followupTarget = activeChallenge.case_success;
                } else {
                    if (activeChallenge.case_failure_delayed) {
                        if (Array.isArray(activeChallenge.case_failure_delayed)) {
                            DELAYED.push(...activeChallenge.case_failure_delayed);
                        } else {
                            DELAYED.push(activeChallenge.case_failure_delayed);
                        }
                    }
                    followupTarget = activeChallenge.case_failure;
                }

                if (threat_realized && activeChallenge.case_threat_delayed) {
                    if (Array.isArray(activeChallenge.case_threat_delayed)) {
                        DELAYED.push(...activeChallenge.case_threat_delayed);
                    } else {
                        DELAYED.push(activeChallenge.case_threat_delayed);
                    }
                }

                if (threat_realized && activeChallenge.case_threat) {
                    const threatChain = Array.isArray(activeChallenge.case_threat)
                        ? [...activeChallenge.case_threat]
                        : [activeChallenge.case_threat];

                    if (Array.isArray(followupTarget)) {
                        threatChain.push(...followupTarget);
                    } else if (followupTarget) {
                        threatChain.push(followupTarget);
                    }

                    proceed(threatChain);
                } else {
                    proceed(followupTarget);
                }
            };
            // Helper function to handle threat post-processing (mods & transitions)
            const runThreatPostProcessing = () => {
                resetAdrenalineSelection();
                const scrollRow = document.querySelector('.card-scroll-row');
                if (scrollRow) scrollRow.classList.add('enable-interaction');

                if (logs_pending.length > 0 || isProcessingQueue) {
                    onTerminalFinishedCallback = doTransition;
                } else {
                    doTransition();
                }
            };

            // 2. Core Fix: Threat Evaluation Logic
            if (is_tie || is_failure) {
                // Define what happens exactly when "Vyhodnocujem hrozbu..." finishes printing
                const evaluateThreatRoll = () => {
                    let threat_roll = 0;
                    let threatRollsData = []; 

                    for (let n = 0; n < current_challenge.threat; n++) {
                        let r = Math.floor(Math.random() * 2);
                        threat_roll += r;
                        threatRollsData.push({ type: "DH", value: r, isSkillDie: true }); 
                    }

                    // The animation fires exactly when the log text has fully appeared!
                    triggerDiceVisualAnimation(threatRollsData, true);

                    let caution_threshold = CARDS[card][0][0];
                    if (threat_roll > caution_threshold) {
                        log(`${activeChallenge.threat_msg || "⚠️ Hrozba sa naplnila!"} - (KOCKY HROZBY: ${threat_roll} > TVOJA OPATRNOSŤ: ${caution_threshold})`, "danger-msg",false, false, true);
                        threat_realized = true;
                    } else {
                        log(`${activeChallenge.threat_avoided_msg || "Vyhneš sa hrozbe."} - (KOCKY HROZBY: ${threat_roll} <= TVOJA OPATRNOSŤ: ${caution_threshold})`, "success-msg", false, false, true);
                    }

                    // Log baseline success or failure text (after threat resolution)
                    if (success) {
                        log(activeChallenge.success_msg || "ÚSPECH!", "success-msg", false, false, true);
                    } else {
                        log(activeChallenge.failure_msg || "ZLYHANIE!", "failure-msg", false, false, true);
                    }

                    // Continue executing modifications and transition setups
                    runThreatPostProcessing();
                };

                // Attach the evaluation block to the queue hook
                if (logs_pending.length > 0 || isProcessingQueue) {
                    onTerminalFinishedCallback = evaluateThreatRoll;
                } else {
                    evaluateThreatRoll();
                }

            } else {
                // If there is no threat evaluation required, proceed immediately
                log(activeChallenge.success_msg || "ÚSPECH!", "success-msg", false, false, true);
                resetAdrenalineSelection();
                const scrollRow = document.querySelector('.card-scroll-row');
                if (scrollRow) scrollRow.classList.add('enable-interaction');

                if (logs_pending.length > 0 || isProcessingQueue) {
                    onTerminalFinishedCallback = doTransition;
                } else {
                    doTransition();
                }
            }
        }


        function gameloop(success = true) {
            let delay = 0;
            if (test_mode) {delay = 100} else {delay = 1000};

            if (enemy === null) {
                if (success) {
                    setTimeout(() => {
                    runActionPhase();
                    },Math.max(100,delay - 500))
                }
            } else {
                setTimeout(() => {
                runConflictTurn();
                },Math.max(100,delay - 700))
            }
        }

        function pushFlat(arr, value) {
            if (!value) return;
            if (Array.isArray(value)) arr.push(...value);
            else arr.push(value);
        }

        function resolveConflict() {
            if (!is_conflict || !enemy || !player_action || !enemy_action) {
                if (DEBUG === true) {
                    log(`[resolveConflict] Ignorovaný duplicitný/neplatný vstup (is_conflict=${is_conflict}, enemy=${enemy}).`, "system-msg");
                }
                return;
            }
            if (enemy_id && CHALLENGES["ACTIVE"] && CHALLENGES["ACTIVE"][enemy_id] === false) {
                if (DEBUG === true) {
                    log(`[resolveConflict] Ignorovaný vstup, inštancia ${enemy_id} je už neaktívna.`, "system-msg");
                }
                return;
            }

            inputs_frozen = true;
            if (test_mode) {skill = 10; weapon = 2};
            let enemy_roll = rollDice(enemy_action[1], enemy_action[0] === "A", ENEMY_TYPES[enemy]["skill"], true);

            let adrenaline = parseInt(document.getElementById("adrenaline-select").value) || 0;
            let player_roll = rollDice(player_action[1], player_action[0] === "A", skill, false);
            let stress_increased = false;
            
            let p_adv_mod = advantage;
            let p_ad_mod = adrenaline;
            let e_adv_mod = enemy_advantage;

            let p_adv_text = p_adv_mod > 0 ? `+${p_adv_mod}` : "";
            let p_ad_text = p_ad_mod > 0 ? `+${p_ad_mod}` : "";
            let e_adv_text = e_adv_mod > 0 ? `+${e_adv_mod}` : "";

            let p_mods = (p_adv_mod > 0 || p_ad_mod > 0) ? ` [${[p_adv_text, p_ad_text].filter(Boolean).join(" ")}]` : "";
            let e_mods = e_adv_mod > 0 ? ` [${e_adv_text}]` : "";
            const enemyType = CHALLENGES[current_challenge_key]?.type || current_challenge_key;


            log(`TY: ${player_roll}${p_mods}   ⚔️   ${enemy.toUpperCase()}: ${enemy_roll}${e_mods}`, "error-msg");

            enemy_roll += enemy_advantage;
            player_roll += (advantage + adrenaline); 

            resetAdrenalineSelection();

            // === DISTANCE / RANGED COMBAT: closing the gap ===
            if (conflict_distance>0) {
                if (enemy_action[0] === "D" && enemy_roll > player_roll) {
                    conflict_distance = Math.max(0, conflict_distance - 1);
                    log(`👣 ${enemy} sa k tebe priblížil! (Vzdialenosť: ${conflict_distance})`, "error-msg");
                }
                if (player_action[0] === "D" && player_roll > enemy_roll) {
                    conflict_distance = Math.max(0, conflict_distance - 1);
                    log(`👣 Približuješ sa k nepriateľovi! (Vzdialenosť: ${conflict_distance})`, "error-msg");
                }

                if (enemy_id && CHALLENGES[enemy_id]) {
                    CHALLENGES[enemy_id].distance = conflict_distance;
                }

                if (conflict_distance <= 0) {
                    distance_combat_active = false;
                    log(`⚔️ Nepriateľ je pri tebe, boj zblízka môže začať!`, "info-msg");
                    
                    // --- ADDED: Smoothly remove distance scale when gap is closed ---
                    const enemyContainer = document.getElementById("enemy-sprite-container");
                    if (enemyContainer) {
                        enemyContainer.classList.remove("distance-mode");
                    }
                    // ----------------------------------------------------------------
                }
            }


            // === CHASE MODE / BOTH ESCAPING ===
            if (chase_mode && player_escaping && enemy_escaping && player_action[0] === "D" && enemy_action[0] === "D") {
                log(`🏃Obojstranný útek! Ty aj nepriateľ utekáte opačným smerom. Konflikt končí!`, "info-msg", true);
                
                enemy_escape_counter += 2;
                log(`🏃 ${enemy.toUpperCase()} ti definitívne mizne z dohľadu!`, "danger-msg");
                
                inputs_frozen = true;
                const scrollRow = document.querySelector('.card-scroll-row');
                if (scrollRow) scrollRow.classList.remove('enable-interaction');

                updateUI();
                
                onTerminalFinishedCallback = () => {
                    const enemyContainer = document.getElementById("enemy-sprite-container");
                    const enemyImg = document.getElementById("enemy-sprite");

                    if (enemyContainer) enemyContainer.style.display = "none";
                    if (enemyImg) enemyImg.src = "";
                    
                    let activeChallenge = CHALLENGES[enemy_id];                    
                    
                    if (activeChallenge && activeChallenge.enemy_escape_delayed) {
                        if (Array.isArray(activeChallenge.enemy_escape_delayed)) {
                            activeChallenge.enemy_escape_delayed.forEach(pushDelayed);
                        } else if (activeChallenge.enemy_escape_delayed !== "") {
                            pushDelayed(activeChallenge.enemy_escape_delayed);
                        }
                    }
                    
                    if (enemy_id && CHALLENGES[enemy_id] && CHALLENGES[enemy_id].type) {
                        CHALLENGES[enemy_id].saved_stress = enemy_stress;
                    }

                    enemy = null; enemy_stress = 0; enemy_escaping = false; player_escaping = false; chase_mode = false;
                    player_escape_counter = 0; enemy_escape_counter = 0;
                    enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                    player_action = null; enemy_action = null; is_conflict = false; distance_combat_active = false; conflict_distance = 0;

                    let nextChallenge = [];

                    pushFlat(nextChallenge, activeChallenge?.enemy_escape);

                    if (pending_challenge_key) {
                        pushFlat(nextChallenge, pending_challenge_key);
                        pending_challenge_key = null;
                    } else {
                        pushFlat(nextChallenge, activeChallenge?.case_success);
                    }

                    proceed(nextChallenge);
                };

                if (!isProcessingQueue) {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null;
                    callback();
                }
                
                return; 
            }

            if (chase_mode) {
                if (player_escaping && player_action[0] === "A") {
                    log(`⚔️ Zaútočíš počas úteku! Rušíš útek a prechádzaš späť do tvrdého boja.`, "info-msg", false,false,true);
                    chase_mode = false;
                    player_escaping = false;
                    player_escape_counter = 0;
                }
                else if (enemy_escaping && enemy_action[0] === "A") {
                    log(`⚔️ Protivník sa otočil a útočí na teba!`, "info-msg", false,false,true);
                    chase_mode = false;
                    enemy_escaping = false;
                    enemy_escape_counter = 0;
                }
            }

            if (chase_mode) {
                if (player_escaping) {
                    if (player_roll > enemy_roll) {
                        player_escape_counter++;
                        log(`🏃 Úspešný únikový manéver! (Únik: ${player_escape_counter}/2)`, "success-msg", false,false,true);
                    } 
                    else if (enemy_roll > player_roll) {
                        if (enemy_action[0] === "A") {
                            if (player_escape_counter < 1) {
                                log(`🎯 Protivník ťa zasiahol počas úteku!`, "warning-msg", false,false,true);
                            } else {
                                log(`🎯 Protivník ťa trafil nadiaľku počas úteku!`, "warning-msg", false,false,true);
                            }
                        } else {
                            player_escape_counter = Math.max(0, player_escape_counter - 1);
                            log(`⚠️ Protivník ťa dobieha! (Únik: ${player_escape_counter}/2)`, "danger-msg", false,false,true);
                        }
                    }
                    else {
                        log(`🏃 Držíš si odstup. (Únik: ${player_escape_counter}/2)`, "info-msg", false,false,true);
                    }

                    if (player_escape_counter >= 2) {
                        log(`\n Úspešne ujdeš z boja!`, "success-msg", false,false,true);
                        inputs_frozen = true;
                        const scrollRow = document.querySelector('.card-scroll-row');
                        if (scrollRow) scrollRow.classList.remove('enable-interaction');

                        updateUI();
                        
                        onTerminalFinishedCallback = () => {
                            const enemyContainer = document.getElementById("enemy-sprite-container");
                            const enemyImg = document.getElementById("enemy-sprite");
                            if (enemyImg) enemyImg.src = "";

                            if (enemyContainer) enemyContainer.style.display = "none";
                            let activeChallenge = CHALLENGES[current_challenge_key];

                            if (enemy_id && CHALLENGES[enemy_id] && CHALLENGES[enemy_id].type) {
                                CHALLENGES[enemy_id].saved_stress = enemy_stress;
                            }
                            
                            const bothEscaping = player_escaping && enemy_escaping;
                            enemy = null; enemy_stress = 0; enemy_escaping = false; player_escaping = false; chase_mode = false;
                            player_escape_counter = 0; enemy_escape_counter = 0;
                            enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                            player_action = null; enemy_action = null; is_conflict = false; distance_combat_active = false; conflict_distance = 0;

                            if (bothEscaping) {
                                pre_encounter_challenge_key = null;
                                let nextChallenge = [];

                                pushFlat(nextChallenge, activeChallenge?.enemy_escape);

                                if (pending_challenge_key) {
                                    pushFlat(nextChallenge, pending_challenge_key);
                                    pending_challenge_key = null;
                                } else {
                                    pushFlat(nextChallenge, activeChallenge?.case_success);
                                }

                                proceed(nextChallenge);
                            } 
                            else if (pre_encounter_challenge_key) {
                                let stepsToRetreat = 0; 
                                let foundValidTarget = false;

                                if (typeof challenge_history !== 'undefined' && challenge_history.length > 0) {
                                    
                                    // Prechádzame históriu od konca (od najnovších po najstaršie)
                                    for (let i = challenge_history.length - 1; i >= 0; i--) {
                                        stepsToRetreat++;
                                        const historicalKey = challenge_history[i];
                                        const historicalNode = CHALLENGES[historicalKey];

                                        // 1. Kontrola na enemy wrapper (obsahuje vlastnosť 'type')
                                        const isEnemyWrapper = historicalNode && typeof historicalNode.type !== 'undefined'; 

                                        // 2. Kontrola na neaktívny challenge (presne podľa tvojej logiky z handleChallengeTransition)
                                        const isInactiveChallenge = CHALLENGES["ACTIVE"] && CHALLENGES["ACTIVE"][historicalKey] === false;

                                        if (isEnemyWrapper || isInactiveChallenge) {
                                            // Ak je to nepriateľ alebo neaktívny uzol, pokračujeme v hľadaní hlbšie do histórie
                                            continue;
                                        } else {
                                            // Našli sme platný príbehový uzol, zastavíme hľadanie
                                            foundValidTarget = true;
                                            break;
                                        }
                                    }
                                }

                                // Bezpečný fallback: Ak by bola história prázdna alebo neobsahovala žiadny platný uzol
                                if (!foundValidTarget) {
                                    stepsToRetreat = 1;
                                    if (CHALLENGES[pre_encounter_challenge_key] && CHALLENGES[pre_encounter_challenge_key].type) {
                                        stepsToRetreat = 2;
                                    }
                                }
                                
                                // Vyčistenie dočasných stavových premenných
                                pre_encounter_challenge_key = null;
                                pending_challenge_key = null;

                                // Vyčistenie DOM / UI elementov
                                document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());
                                const enemyCardContainer = document.getElementById("enemy-card-container");
                                if (enemyCardContainer) enemyCardContainer.innerHTML = "";
                                const playerCardContainer = document.getElementById("player-card-container");
                                if (playerCardContainer) playerCardContainer.innerHTML = "";
                                
                                // Zavolanie prechodu späť s dynamicky vypočítaným počtom krokov
                                handleChallengeTransition('BACK_ACTION_' + stepsToRetreat);
                            } 
                            else if (pending_challenge_key) {
                                let nextChallenge = pending_challenge_key; 
                                pending_challenge_key = null; 
                                proceed(nextChallenge);
                            } else if (activeChallenge && activeChallenge.case_success) {
                                proceed(activeChallenge.case_success);
                            }
                        };

                        if (!isProcessingQueue) {
                            const callback = onTerminalFinishedCallback;
                            onTerminalFinishedCallback = null;
                            callback();
                        }
                        return;
                    }
                }
                else if (enemy_escaping) {
                    if (enemy_roll > player_roll) {
                        enemy_escape_counter++;
                        log(`${enemy.toUpperCase()} sa ti vzďaľuje! (Únik: ${enemy_escape_counter}/2)`, "danger-msg", false,false,true);
                    } 
                    else if (player_roll > enemy_roll) {
                        if (player_action[0] === "A") {
                            log(`Triafaš unikajúceho nepriateľa!`, "success-msg", false,false,true);
                        } else {
                            enemy_escape_counter = Math.max(0, enemy_escape_counter - 1);
                            log(`Dobiehaš nepriateľa! (Únik: ${enemy_escape_counter}/2)`, "success-msg", false,false,true);
                        }
                    }
                    else {
                        log(`Držíte si rovnaké tempo. (Únik: ${enemy_escape_counter}/2)`, "info-msg", false,false,true);
                    }

                    if (enemy_escape_counter >= 2) {
                        log(` ${enemy.toUpperCase()} ti definitívne mizne z dohľadu!`, "danger-msg", false,false,true);
                        HERO.sp = Math.max(0, (HERO.sp || 0) + 1);
                        log(`(+1 BR)`, "success-msg", false,false,true);
                        enemy_escape_counter = 0;
                        enemy_escaping = false;
                        
                        inputs_frozen = true;
                        const scrollRow = document.querySelector('.card-scroll-row');
                        if (scrollRow) scrollRow.classList.remove('enable-interaction');

                        updateUI();
                        onTerminalFinishedCallback = () => {
                            const enemyContainer = document.getElementById("enemy-sprite-container");
                            if (enemyContainer) enemyContainer.style.display = "none";
                            const enemyImg = document.getElementById("enemy-sprite");
                            if (enemyImg) enemyImg.src = "";

                            let activeChallenge = CHALLENGES[current_challenge_key];                            
                            if (activeChallenge && activeChallenge.enemy_escape_delayed) {
                                if (Array.isArray(activeChallenge.enemy_escape_delayed)) {
                                    activeChallenge.enemy_escape_delayed.forEach(pushDelayed);
                                } else if (activeChallenge.enemy_escape_delayed !== "") {
                                    pushDelayed(activeChallenge.enemy_escape_delayed);
                                }
                            }

                            if (enemy_id && CHALLENGES[enemy_id] && CHALLENGES[enemy_id].type) {
                                CHALLENGES[enemy_id].saved_stress = enemy_stress;
                            }

                            enemy = null; enemy_stress = 0; enemy_escaping = false; player_escaping = false; chase_mode = false;
                            player_escape_counter = 0; enemy_escape_counter = 0;
                            enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                            player_action = null; enemy_action = null; is_conflict = false; distance_combat_active = false; conflict_distance = 0;

                            let nextChallenge = [];

                            pushFlat(nextChallenge, activeChallenge?.enemy_escape);

                            if (pending_challenge_key) {
                                pushFlat(nextChallenge, pending_challenge_key);
                                pending_challenge_key = null;
                            } else {
                                pushFlat(nextChallenge, activeChallenge?.case_success);
                            }

                            proceed(nextChallenge);
                        };

                        if (!isProcessingQueue) {
                            const callback = onTerminalFinishedCallback;
                            onTerminalFinishedCallback = null;
                            callback();
                        }
                        return;
                    }
                }
            }

            let potential_player_damage = 0;
            let potential_enemy_damage = 0;

            if (player_roll >= enemy_roll && player_action[0] === "A") {
                let enemy_caution = enemy_action[0] === "D" ? CARDS[enemy_action[1]][0][0] : 0;
                potential_enemy_damage = Math.max(0, CARDS[player_action[1]][1][0] + weapon - enemy_caution); 
            }

            if (player_roll <= enemy_roll && enemy_action[0] === "A") {
                let player_caution = player_action[0] === "D" ? CARDS[player_action[1]][0][0] : 0;
                potential_player_damage = Math.max(0, CARDS[enemy_action[1]][1][0] + ENEMY_TYPES[enemy]["weapon"] - player_caution);
            }

            if (potential_enemy_damage > 0) {
                enemy_stress += potential_enemy_damage;
                log(`${enemy.toUpperCase()}: STRESS +${potential_enemy_damage}.`, "success-msg", false,false,true);
                const enemyContainer = document.getElementById("enemy-sprite-container");
                if (enemyContainer) {
                    enemyContainer.classList.remove("enemy-hit");
                    void enemyContainer.offsetWidth; 
                    enemyContainer.classList.add("enemy-hit");
                }
            }

            if (potential_player_damage > 0) {
                HERO.stress += potential_player_damage;
                heal_attempts = 0;
                flashRed();
                stress_increased = true;
                log(`TVOJ STRESS: +${potential_player_damage}.`, "failure-msg", false, false, true);
            }

            let player_collapse = HERO.stress > stress_thresh;
            let enemy_dead = enemy_stress > ENEMY_TYPES[enemy]["stress_thresh"];

            // CASE A: Mutual Kill
            if (player_collapse && enemy_dead) {
                is_collapse_check = true; 
                runCollapseCheck(() => {
                    player_collapse = false; 

                    HERO.sp = Math.max(0, (HERO.sp || 0) + 1);
                    log(`${enemy.toUpperCase()} padá a ty prežívaš! (+1 BR).`, "success-msg");
                    if(enemyType === "Predátorka" || enemyType === "Skautka") executeMods("item_ŽĽAZA SOMORY+1");
                    inputs_frozen = true; 
                    const scrollRow = document.querySelector('.card-scroll-row');
                    if (scrollRow) scrollRow.classList.remove('enable-interaction');

                    updateUI();

                    onTerminalFinishedCallback = () => {
                        const enemyImg = document.getElementById("enemy-sprite");
                        if (enemyImg) enemyImg.src = "";

                        const enemyContainer = document.getElementById("enemy-sprite-container");
                        if (enemyContainer) enemyContainer.style.display = "none";

                        let activeChallenge = CHALLENGES[enemy_id];

                        enemy = null; enemy_stress = 0; enemy_escaping = false; player_escaping = false; chase_mode = false;
                        enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                        player_action = null; enemy_action = null; is_conflict = false; distance_combat_active = false; conflict_distance = 0;

                        let nextChallenge = [];

                        pushFlat(nextChallenge, activeChallenge?.on_death);

                        if (pending_challenge_key) {
                            pushFlat(nextChallenge, pending_challenge_key);
                            pending_challenge_key = null;
                        } else {
                            pushFlat(nextChallenge, activeChallenge?.case_success);
                        }

                        proceed(nextChallenge);
                    };

                    if (!isProcessingQueue) { 
                        const callback = onTerminalFinishedCallback; 
                        onTerminalFinishedCallback = null; 
                        callback(); 
                    }
                });
                return;
            }

            // CASE B: Only Player Collapses
            if (player_collapse) {
                runCollapseCheck(() => {
                    player_collapse = false; 
                    if (player_escape_counter < 1){
                        player_zero_counter += 1;
                    } else {
                        player_zero_counter = 0;
                    }

                    if (enemy_escape_counter < 1){
                        enemy_zero_counter += 1;
                    } else {
                        enemy_zero_counter = 0;
                    }

                    if (!player_escaping){ 
                        if ((player_roll > enemy_roll && player_action[0] === "D" && enemy_zero_counter > 1) || 
                            (player_roll === enemy_roll && player_action[0] === "D" && enemy_action[0] === "A" && enemy_zero_counter > 1)) {
                            let adv_before = advantage;
                            advantage = Math.min(advantage + 1, ADVANTAGE_CAP);
                            if (advantage>adv_before) log("Získavaš výhodu +1","",false,false,true)
                        } 
                    }
                    if (!enemy_escaping){
                        if ((player_roll < enemy_roll && enemy_action[0] === "D" && player_zero_counter > 1) || 
                        (player_roll === enemy_roll && enemy_action[0] === "D" && player_action[0] === "A" && player_zero_counter > 1)) {
                            let adv_before = enemy_advantage;
                            enemy_advantage = Math.min(enemy_advantage + 1, ADVANTAGE_CAP);
                            if(enemy_advantage>adv_before)log(`🛡️ Nepriateľ získava výhodu +1.`,"", false,false,true);
                        }
                    }

                    if (player_action[0] === "D" && enemy_action[0] === "D") {
                        const capturedPlayerAction = player_action;   
                        const capturedEnemyAction = enemy_action;     
                        const capturedPlayerRoll = player_roll;
                        const capturedEnemyRoll = enemy_roll;

                        if (capturedPlayerRoll <= conflict_difficulty) {
                            checkConflictThreat(capturedPlayerRoll, false, capturedPlayerAction);
                        }
                        if (capturedEnemyRoll <= conflict_difficulty) {
                            checkConflictThreat(capturedEnemyRoll, true, capturedEnemyAction);
                        }
                    }

                    move = 0;
                    round += 1;
                    player_action = null;
                    enemy_action = null;

                    let delay = test_mode ? 100 : 2000; // ✅ Declared in outer scope first
                    setTimeout(() => {
                        gameloop(false);
                    }, delay);
                });

                return; 
            }

            // CASE C: Only Enemy Collapses
            if (enemy_dead) { 
                clearTimeout(combatLoopTimeout);
                clearTimeout(readyPromptTimeout);
                HERO.sp = Math.max(0, (HERO.sp || 0) + 1);
                if(enemyType === "Predátorka" || enemyType === "Skautka") executeMods("item_ŽĽAZA SOMORY+1");
                log(`${enemy} JE DOLE! (+1 BR).`, "success-msg", false,false,true);
                inputs_frozen = true;
                const scrollRow = document.querySelector('.card-scroll-row');
                if (scrollRow) scrollRow.classList.remove('enable-interaction');

                updateUI();

                onTerminalFinishedCallback = () => {
                    const enemyContainer = document.getElementById("enemy-sprite-container");
                    if (enemyContainer) enemyContainer.style.display = "none";
                    const enemyImg = document.getElementById("enemy-sprite");
                    if (enemyImg) enemyImg.src = "";

                    let activeChallenge = CHALLENGES[enemy_id];
                    
                    enemy = null; enemy_stress = 0; enemy_escaping = false; player_escaping = false; chase_mode = false;
                    enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                    player_action = null; enemy_action = null; is_conflict = false; distance_combat_active = false; conflict_distance = 0;

                    let nextChallenge = [];

                    pushFlat(nextChallenge, activeChallenge?.on_death);

                    if (pending_challenge_key) {
                        pushFlat(nextChallenge, pending_challenge_key);
                        pending_challenge_key = null;
                    } else {
                        pushFlat(nextChallenge, activeChallenge?.case_success);
                    }

                    proceed(nextChallenge);
                };

                if (!isProcessingQueue) {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null;
                    callback();
                }
                return; // CRITICAL: Stop execution here so the standard loop below doesn't run!
            }

            // --- 4. ADVANTAGE DETERMINATION & CONTINUATION (Only if both survived) ---
            if (player_escape_counter < 1){
                player_zero_counter += 1
            } else {
                player_zero_counter = 0
            }

            if (enemy_escape_counter < 1){
                enemy_zero_counter += 1
            } else {
                enemy_zero_counter = 0
            }

            if (!player_escaping){ 
                if ((player_roll > enemy_roll && player_action[0] === "D" && enemy_zero_counter > 0) || 
                    (player_roll === enemy_roll && player_action[0] === "D" && enemy_action[0] === "A" && enemy_zero_counter > 0)) {
                    let adv_before = advantage;
                    advantage = Math.min(advantage + 1, ADVANTAGE_CAP);
                    if (advantage > adv_before){
                        log("Získavaš výhodu +1.","", false,false,true);
                    } else {
                        log("Už máš maximálnu výhodu.","", false,false,true)
                    }
                } 
            }
            if (!enemy_escaping){
                if ((player_roll < enemy_roll && enemy_action[0] === "D" && player_zero_counter > 0) || 
                (player_roll === enemy_roll && enemy_action[0] === "D" && player_action[0] === "A" && player_zero_counter > 0)) {
                    let adv_before = enemy_advantage;
                    enemy_advantage = Math.min(enemy_advantage + 1, ADVANTAGE_CAP);
                    if(enemy_advantage>adv_before) log(`Nepriateľ získava výhodu +1.`,"", false,false,true);
                }
            }

            if (player_action[0] === "D" && enemy_action[0] === "D") {
                const capturedPlayerAction = player_action;   
                const capturedEnemyAction = enemy_action;     
                const capturedPlayerRoll = player_roll;
                const capturedEnemyRoll = enemy_roll;

                if (capturedPlayerRoll <= conflict_difficulty) {
                    checkConflictThreat(capturedPlayerRoll, false, capturedPlayerAction);
                }
                if (capturedEnemyRoll <= conflict_difficulty) {
                    checkConflictThreat(capturedEnemyRoll, true, capturedEnemyAction);
                }
            }

            move = 0;
            round += 1;
            player_action = null;
            enemy_action = null;

            inputs_frozen = true;
            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');
            updateUI();
            let delay = test_mode ? 100 : 2000; 
            combatLoopTimeout = setTimeout(() => {
                gameloop(false);
            }, delay);
        }

        function checkConflictThreat(roll, isEnemy, action) {
            if (roll > conflict_difficulty) return;

            let threat_roll = 0;
            let threatRollsData = [];
            for (let n = 0; n < conflict_threat; n++) {
                let r = Math.floor(Math.random() * 2);
                threat_roll += r;
                threatRollsData.push({ type: "DH", value: r, isSkillDie: true });
            }

            const caution = CARDS[action[1]][0][0];
            triggerDiceVisualAnimation(threatRollsData, isEnemy);

            if (threat_roll > caution) {
                if (isEnemy) {
                    if(chase_mode){
                        enemy_stress += 1;
                        if(enemy_escaping){
                            enemy_escape_counter = Math.max(0, enemy_escape_counter - 1);
                            log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) ⚠️ Nepriateľ sa potkol!  Dobehneš ho.`, "danger-msg",false,false,true);
                        } else {
                            player_escape_counter += 1 ;
                            log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) ⚠️ Nepriateľ sa potkol!  Získavaš náskok.`, "danger-msg",false,false,true);
                        }
                    } else {
                        let adv_before = advantage;
                        advantage = Math.min(advantage + 1, ADVANTAGE_CAP);
                        log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) ⚠️ Nepriateľ sa dostal do horšej pozície.`, "danger-msg",false,false,true);
                        if (advantage>adv_before) log("Získavaš výhodu +1","",false,false,true)
                    }
                } else {
                    if(chase_mode){
                        HERO.stress = Math.max(0, (HERO.stress || 0) + 1);
                        flashRed();
                        heal_attempts = 0;
                        if(player_escaping){
                            player_escape_counter = Math.max(0, player_escape_counter - 1);
                            log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) \n ⚠️ Potkneš sa počas úteku! Nepriateľ ťa dobehne.`, "danger-msg",false,false,true);
                        } else {
                            enemy_escape_counter += 1;
                            log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) \n ⚠️ Potkneš sa!  Nepriateľ získava náskok.`, "danger-msg",false,false,true);
                        }
                    } else {
                        let adv_before = enemy_advantage;
                        enemy_advantage = Math.min(enemy_advantage + 1, ADVANTAGE_CAP);
                        log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) \⚠️ Dostaneš sa do horšej pozície.`, "danger-msg",false,false,true);
                        if(enemy_advantage>adv_before) log(`🛡️ Nepriateľ získava výhodu +1.`,"", false,false,true);
                    }
                    
                    // --- NOVÁ ÚPRAVA: INTERCEPCIA KOLAPSU V SÚBOJI ---
                    if (HERO.stress > stress_thresh) {
                        is_collapse_check = true;

                        runCollapseCheck(() => {
                            // TENTO CALLBACK SA SPUSTÍ, IBA AK HRÁČ V HODE USPEJE:
                            is_collapse_check = false;
                            inputs_frozen = false;
                            const scrollRow = document.querySelector('.card-scroll-row');
                            if (scrollRow) scrollRow.classList.add('enable-interaction');

                            updateUI();
                            if (typeof onTerminalFinishedCallback === "function") {
                                const callback = onTerminalFinishedCallback;
                                onTerminalFinishedCallback = null;
                                callback();
                            }
                        });
                        return;
                    }
                }
            } else {
                const who = isEnemy ? "Nepriateľ sa vyhol hrozbe." : "Vyhneš sa hrozbe.";
                log(`${who} (HROZBA: ${threat_roll} <= OPATRNOSŤ: ${caution})`, "success-msg");
            }

            updateUI();
        }


        function runHealCheck() {
            const proceedPrompt = document.getElementById("proceed-prompt");
            const isProceedVisible = proceedPrompt && window.getComputedStyle(proceedPrompt).display !== "none";            
            if (proceedPrompt.style.display === "none") is_proceed_prompt = false;

            if (is_conflict || is_action_phase || is_collapse_check || isProceedVisible || is_elimination_check) {
                log("Teraz nie je čas...","error-msg",false,false,true);
                return
            }

            const skillDropdown = document.getElementById("player-skill-dropdown");
            const selectedSkillName = skillDropdown ? skillDropdown.value : "placeholder";
            if (selectedSkillName && selectedSkillName !== "placeholder" && selectedSkillName !== "none" && selectedSkillName !== "PRVÁ POMOC") {
                log("Môžeš použiť len schopnosť PRVÁ POMOC.", "danger-msg");
                return
            }

            if (typeof ITEM_LIST === 'undefined' || HERO.items["ZDRAVOTNÉ POMÔCKY"] < 1) {
                log(`Nemáš žiadne ZDRAVORNÉ POMÔCKY.`, "system-msg");      
                return         
            }

            if (heal_attempts > 2) {
                log(`Teraz ti pomôže len čas. Nedá sa nič robiť.`, "system-msg");      
                return         
            }

            heal_attempts += 1;
            // Flag the engine that card clicks belong to this sub-system now
            is_heal_check = true;
            inputs_frozen = true;
            const choicePrompt = document.getElementById("choice-prompt");
            choicePrompt.style.display = "none";

            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');


            // Challenge difficulty equals the player's current stress. Threat is hardcoded to 2.
            current_challenge.difficulty = 9; 
            current_challenge.threat = 2;

            const challengeDisplay = document.getElementById("challenge-stats-display");
            if (challengeDisplay) {

                // Passes data and slides down seamlessly
                toggleChallengeDisplay(true, current_challenge);
            }

            log("Nie je úplná sranda poskytnúť prvú pomoc sebe.", "error-msg", true);

            inputs_frozen = false;
            if (scrollRow) scrollRow.classList.add('enable-interaction');
            updateUI();
        }

        function resolveHealCheck(card) {

            inputs_frozen = true;
            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');

            let roll_result = rollDice(card, false, 0, false);
   
            log(`Výsledok pokusu o prvú pomoc: ${roll_result}`, "error-msg");

            let success = roll_result >= current_challenge.difficulty;
            let is_tie_or_failure = roll_result <= current_challenge.difficulty;

            if (success) {
                adjustHeroStress(-1);
                log("Podarí sa ti ošetriť aspoň to najnutnejšie a cítiš sa lepšie.", "success-msg");
            } else {
                log("Prvá pomoc nepomohla. Robíš, čo vieš, ale stále ti je rovnako blbo.", "failure-msg");
            }

            if (is_tie_or_failure) {
                let threat_roll = 0;
                let threatRollsData = [];
                
                for (let n = 0; n < current_challenge.threat; n++) {
                    let r = Math.floor(Math.random() * 2); // 0 or 1
                    threat_roll += r;
                    threatRollsData.push({ type: "DH", value: r, isSkillDie: true });
                }

                // Display threat visual dice pool explicitly tracked away from player pool
                triggerDiceVisualAnimation(threatRollsData, true); 

                let caution_threshold = CARDS[card][0][0]; 
                if (threat_roll > caution_threshold) {
                    log(`Pri ošetrovaní zničíš časť zdravotných pomôcok. \n (KOCKY HROZBY: ${threat_roll} > TVOJA OPATRNOSŤ: ${caution_threshold})`, "danger-msg");
                    executeMods("item_ZDRAVOTNÉ POMÔCKY-1");
                } else {
                    log(`Počínaš si šetrne a pomôcky ti zostanú aj pre budúce pokusy. (KOCKY HROZBY: ${threat_roll} <= TVOJA OPATRNOSŤ: ${caution_threshold})`, "success-msg");
                }
            }

            resetAdrenalineSelection();

            const challengeDisplay = document.getElementById("challenge-stats-display");
            if (challengeDisplay) {
                toggleChallengeDisplay(false);
            }     

            is_heal_check = false;
            inputs_frozen = true;
            if (scrollRow) scrollRow.classList.remove('enable-interaction');

            updateUI();
            proceed(current_challenge_key);
        }

        function runCollapseCheck(onSuccessCallback, onFailureCallback) {
            if (test_mode){
                let statusType;
                statusType = "DEAD";
                setTimeout(() => exportNreload(statusType), 200);
                return;
            }
            is_collapse_check = true;
            collapse_action_done = false;
            inputs_frozen = true;
            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');

            hidecards(true); 

            if (is_conflict) {
                enterCollapseConflictMode();
            }

            // Defer any currently pending proceed target so the collapse check resolves first
            if (proceed_target !== null) {
                collapse_pending_proceed_target = collapse_pending_proceed_target || proceed_target;
                proceed_target = null;
            }
            const proceedPrompt = document.getElementById("proceed-prompt");
            if (proceedPrompt) {
                proceedPrompt.style.display = "none";
            }

            collapse_resume_callback = onSuccessCallback;
            // Ak onFailureCallback nebol poslaný (napr. v konflikte), zostane null a použije sa predvolené správanie
            collapse_failure_callback = onFailureCallback || null; 

            // Challenge difficulty equals the player's current stress. Threat is hardcoded to 2.
            current_challenge.difficulty = HERO.stress; 
            current_challenge.threat = 2;

            const challengeDisplay = document.getElementById("challenge-stats-display");
            if (challengeDisplay) {
                // Passes data and slides down seamlessly
                toggleChallengeDisplay(true, current_challenge);
            }

            log("⚠️ KONTROLA KOLAPSU! Musíš odolať tlaku nahromadeného stresu.", "danger-msg", true);

            // Allow the player to click a card to resolve the collapse check
            inputs_frozen = false;
            if (scrollRow) scrollRow.classList.add('enable-interaction');
            updateUI();
        }

        function resolveCollapseCheck(card) {
            inputs_frozen = true;
            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');

            updateUI();
            let roll_result = rollDice(card, false, 0, false);

            let success = roll_result > current_challenge.difficulty;
            let is_tie_or_failure = roll_result <= current_challenge.difficulty;
            let threat_realized = false;

            if (success) {
                log("💪 Úspech! Zvládneš extrémny tlak a pokračuješ v boji.", "success-msg");
            } else {
                log("❌ Zlyhanie! Skolabuješ pod extrémnym tlakom.", "failure-msg");
            }
            if (is_tie_or_failure) {
                let threat_roll = 0;
                let threatRollsData = [];
                
                for (let n = 0; n < current_challenge.threat; n++) {
                    let r = Math.floor(Math.random() * 2); // 0 or 1
                    threat_roll += r;
                    threatRollsData.push({ type: "DH", value: r, isSkillDie: true });
                }

                // Display threat visual dice pool explicitly tracked away from player pool
                triggerDiceVisualAnimation(threatRollsData, true); 

                let caution_threshold = CARDS[card][0][0]; 
                if (threat_roll > caution_threshold) {
                    log(`⚠️ Permanentný stres narastá! \n (KOCKY HROZBY: ${threat_roll} > TVOJA OPATRNOSŤ: ${caution_threshold})`, "danger-msg");
                    threat_realized = true;
                } else {
                    log(`Vyhneš sa trvalým následkom. (KOCKY HROZBY: ${threat_roll} <= TVOJA OPATRNOSŤ: ${caution_threshold})`, "success-msg");
                }
            }

            resetAdrenalineSelection();

            // --- OPRAVA CHYBY: Zvýšenie globálneho perm_stress o 1 (predtým bolo "= + 1", čo natvrdo priradilo 1) ---
            if (threat_realized) {
                if (typeof perm_stress === 'undefined') perm_stress = 0;
                perm_stress += 1;
                log(`Tvoj permanentný stres sa zvýšil o 1! (na ${perm_stress})`, "danger-msg");
                updateUI();
            }

            // Handle Resolution routing paths
            if (success) {
                const challengeDisplay = document.getElementById("challenge-stats-display");
                if (challengeDisplay) {
                    // Slides smoothly back up out of view
                    toggleChallengeDisplay(false);
                }                
                is_collapse_check = false;

                log("Zotavuješ sa z krízy and pokračuješ presne tam, kde si prestal.");
                
                if (typeof collapse_resume_callback === "function") {
                    const resume = collapse_resume_callback;
                    collapse_resume_callback = null;
                    collapse_failure_callback = null; // Vyčistíme aj druhý callback
                    resume(); 
                }

                if (is_conflict) {
                    exitCollapseConflictMode();
                }

                if (collapse_pending_proceed_target !== null) {
                    const pendingTarget = collapse_pending_proceed_target;
                    collapse_pending_proceed_target = null;
                    proceed(pendingTarget);
                } else if (collapse_pending_target !== null) {
                    const pendingTarget = collapse_pending_target;
                    collapse_pending_target = null;
                    handleChallengeTransition(pendingTarget);
                }
            } else {
                // --- AK HOD ZLYHAL ---
                
                // 1. Ak existuje špecifický failure callback (napr. z executeMods), odovzdáme riadenie jemu
                if (typeof collapse_failure_callback === "function") {
                    const failure = collapse_failure_callback;
                    collapse_resume_callback = null;
                    collapse_failure_callback = null;
                    failure();
                } 
                // 2. Predvolený mechanizmus konca hry (funguje výborne pre checkConflictThreat)
                else {
                    if (typeof enemy !== 'undefined' && typeof ENEMY_TYPES !== 'undefined' && ENEMY_TYPES[enemy] && enemy_stress > ENEMY_TYPES[enemy]["stress_thresh"]) {
                        log(`\n💀 Ou! Zabili ste sa navzájom! Skolabuješ v rovnakom momente, ako padol nepriateľ.`, "failure-msg", true);
                    } else {
                        // Bežný kolaps (padol iba hráč)
                        log("💀 TVOJ STRES PREKROČIL HODNOTU KOLAPSU. KONIEC HRY.", "failure-msg", true);
                    }

                    inputs_frozen = true;
                    const scrollRow = document.querySelector('.card-scroll-row');
                    if (scrollRow) scrollRow.classList.remove('enable-interaction');

                    updateUI();

                    onTerminalFinishedCallback = () => {
                        restartGame();
                    };

                    if (typeof isProcessingQueue !== 'undefined' && !isProcessingQueue) {
                        const callback = onTerminalFinishedCallback;
                        onTerminalFinishedCallback = null;
                        callback();
                    }
                }
            }
            // Reset collapse action flag so test() can resume normal behaviour
            collapse_action_done = false;
            collapse_pending_proceed_target = null;
        }

        function ready() {
            log("Ok, pokračujeme...", "error-msg");
            
            inputs_frozen = true;
            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');

            updateUI();
            
            // Bind unfreezing and enemy execution directly to terminal output completion
            onTerminalFinishedCallback = () => {
                inputs_frozen = false;
                const scrollRow = document.querySelector('.card-scroll-row');
                if (scrollRow) scrollRow.classList.add('enable-interaction');

                enemyChoice();
            };

            // Fallback protection: If the text engine isn't running, execute immediately
            if (!isProcessingQueue) {
                const callback = onTerminalFinishedCallback;
                onTerminalFinishedCallback = null;
                callback();
            }
        }


        function proceed(target) {
            if (!gameOn && !welcome) {
                log("PROCEED: gameOn is false, returning", "danger-msg");
                return;
            }
            if (is_collapse_check) {
                if (DEBUG === true) {
                    log("DEBUG: Collapse active – deferring proceed until check resolves.");
                }
                collapse_pending_proceed_target = collapse_pending_proceed_target || target;
                return;
            }
            if (typeof target === 'string') {
                preloadImages(target);
            }
            proceed_target = target;
            inputs_frozen = true;
            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');

            
            const prompt = document.getElementById("proceed-prompt");
            if (prompt) {
                prompt.style.display = "flex";
            }

            // Start self-play if enabled and not already running
            if (test_mode && !keep_testing) {
                keep_testing = true;
                setTimeout(test, 100); // Give DOM time to update
            }
        }

        // Dedicated transition executor
        function executeProceedTransition() {
            if (transition_in_progress) {
                if (test_mode) log("EXEC_TRANSITION: already in progress, ignoring re-entrant call", "danger-msg");
                return;
            }
            if(test_mode){
                if (is_collapse_check) {
                    return;
                }
            }

            const enemyCardContainer = document.getElementById("enemy-card-container");
            const playerCardDisplay = document.getElementById("player-card-display");
            const prompt = document.getElementById("proceed-prompt");

            if (welcome){
                if (enemyCardContainer) enemyCardContainer.classList.remove("show");
                if (playerCardDisplay) playerCardDisplay.classList.remove("show");
                if (prompt) prompt.style.display = "none";

                welcome = false;
                if(SETTINGS.tutorial){
                    current_challenge_key = "TUTORIAL"
                } else {
                    current_challenge_key = "START"
                }
                selectHero();
                return
            }
            let delay = 0;
            if (is_conflict){delay = 500} else {delay=200}
            if (proceed_target) {
                if (test_mode) log("EXEC_TRANSITION: proceed_target exists, executing after " + delay + "ms", "system-msg");
                transition_in_progress = true;
                const targetToRun = proceed_target;
                proceed_target = null;
                document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());
                if (enemyCardContainer) enemyCardContainer.classList.remove("show");
                if (playerCardDisplay) playerCardDisplay.classList.remove("show");

                setTimeout(() => {
                    if (enemyCardContainer) enemyCardContainer.innerHTML = "";
                    if (playerCardDisplay) playerCardDisplay.innerHTML = "";
                    if (prompt) prompt.style.display = "none";
                    transition_in_progress = false;
                    if (typeof targetToRun === 'function') {
                        if (test_mode) log("EXEC_TRANSITION: calling proceed_target function", "system-msg");
                        targetToRun();
                    } else {
                        if (test_mode) log("EXEC_TRANSITION: calling handleChallengeTransition(" + targetToRun + ")", "system-msg");
                        handleChallengeTransition(targetToRun);
                    }
                }, delay);
            } else {
                if (test_mode) log("EXEC_TRANSITION: proceed_target is NOT set, returning", "danger-msg");
            }

        }


        function runConflictTurn() {
            if (move === 0) {
                if (combat_starter === null) {
                    combat_starter = Math.random() < 0.5 ? "p" : "e";
                } else {
                    combat_starter = (combat_starter === "p") ? "e" : "p";
                }
                turn = combat_starter;
                log(`${turn === "p" ? "Začínaš ty." : "Začína " + enemy + "."}`,"error-msg");
            }

            // --- DISTANCE / RANGED COMBAT CHECK (runs once, at the true start of the conflict) ---
            conflict_distance = (enemy_id && CHALLENGES[enemy_id] && CHALLENGES[enemy_id].distance > 0)
                ? CHALLENGES[enemy_id].distance
                : 0;

            distance_combat_active = conflict_distance > 0 && playerHasRangedWeapon() && !enemyHasRangedWeapon();

            if (distance_combat_active) {
                log("Nepriateľ je ešte ďaleko, môžeš zaútočiť z diaľky alebo sa priblížiť a získať výhodu.","error-msg");
            }

            updateUI();

            if (move < 2 && is_conflict) {
                if (turn === "e") {
                    inputs_frozen = true;
                    const scrollRow = document.querySelector('.card-scroll-row');
                    if (scrollRow) scrollRow.classList.remove('enable-interaction');

                    updateUI();

                    function advanceRoundFlow() {
                        if (move == 1) {
                            enemyChoice();
                        } else {
                            let delay = 0;
                            if (test_mode) {delay = 100} else {delay = 1000};
                            readyPromptTimeout = setTimeout(() => {
                            proceed(ready);
                            },delay);
                        }
                    }

                    onTerminalFinishedCallback = () => {
                        advanceRoundFlow();
                    };

                    if (!isProcessingQueue) {
                        const callback = onTerminalFinishedCallback;
                        onTerminalFinishedCallback = null;
                        callback();
                    }
                } else {
                    if (enemy_escaping) {
                        log("Si na ťahu (prenasleduješ).", "", false, false, true);
                    } else if (player_escaping) {
                        log("Si na ťahu (unikáš).", "", false, false, true);
                    } else {
                        log("Si na ťahu. Vyber si kartu a spôsob (ÚTOK/ČIN).", "", false, false, true);
                    }

                    inputs_frozen = true;
                    const scrollRow = document.querySelector('.card-scroll-row');
                    if (scrollRow) scrollRow.classList.remove('enable-interaction');

                    updateUI();

                    onTerminalFinishedCallback = () => {
                        inputs_frozen = false;
                        const scrollRow = document.querySelector('.card-scroll-row');
                        if (scrollRow) scrollRow.classList.add('enable-interaction');
                        updateUI(); 
                    };

                    if (!isProcessingQueue) {
                        const callback = onTerminalFinishedCallback;
                        onTerminalFinishedCallback = null;
                        callback();
                    }
                }
            } else {
                inputs_frozen = true;
                const scrollRow = document.querySelector('.card-scroll-row');
                if (scrollRow) scrollRow.classList.remove('enable-interaction');

                updateUI();

                onTerminalFinishedCallback = () => {
                    resolveConflict();
                };

                if (!isProcessingQueue) {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null;
                    callback();
                }
            }
        }


        function handleConflictInput(actionType, cardCode) {

            const playerDisplay = document.getElementById("player-card-display");
            const enemyDisplay = document.getElementById("enemy-card-container"); // or your enemy wrapper ID

            // Check if either card is currently visible on the table
            const isPlayerShowing = playerDisplay && playerDisplay.classList.contains("show");
            const isEnemyShowing = enemyDisplay && enemyDisplay.classList.contains("show");

            inputs_frozen = true;
            const scrollRow = document.querySelector('.card-scroll-row');
            if (scrollRow) scrollRow.classList.remove('enable-interaction');

            updateUI();

            function proceedWithSelection() {
                if (move === 0) {
                    hidecards(true);
                    const tableFloor = document.querySelector('.gaming-table-floor');
                    if (tableFloor) {
                        const existingPools = tableFloor.querySelectorAll('.dice-animation-pool');
                        existingPools.forEach(pool => pool.remove());
                    }
                }

                const rotClass = actionType === "D" ? "rotate-player-D" : "rotate-player-A";
                    
                if (playerDisplay) {
                    playerDisplay.innerHTML = `
                        <div class="card-container table-card ${rotClass}">
                            <img src="assets/${cardCode}.png" class="card-img">
                        </div>`;
                    
                    void playerDisplay.offsetWidth;
                    playerDisplay.classList.add("show");
                }

                player_action = [actionType, cardCode];
                move += 1;
                turn = "e";
                
                runGameloopCycle();
            }

            // If EITHER card is showing, strip the 'show' class from BOTH at the exact same instant
            if (isPlayerShowing || isEnemyShowing) {
                if (playerDisplay) playerDisplay.classList.remove("show");
                if (enemyDisplay && move === 0) enemyDisplay.classList.remove("show"); 
                let delay = 0;
                if (test_mode) {delay = 100} else {delay = 500};
                // Wait 500ms for both cards to slide off-screen simultaneously
                setTimeout(proceedWithSelection, delay);
            } else {
                proceedWithSelection();
            }
        }

        function playerHasRangedWeapon() {
            const rangedWeapons = Object.keys(WEAPON_LIST["BOJ Z DIAĽKY"] || {});
            const thrownWeapons = Object.keys(WEAPON_LIST["VRHACIE"] || {});
            const rangedCapable = rangedWeapons.concat(thrownWeapons);
            return !!(HERO && Array.isArray(HERO.weapons) && HERO.weapons.some(w => rangedCapable.includes(w)));
        }

        function enemyHasRangedWeapon() {
            const enemyData = ENEMY_TYPES[enemy];
            return !!(enemyData && enemyData["ranged"] === true);
        }

        function enemyChoice() {
            const container = document.getElementById("enemy-card-container");
            const isCardShowing = container && container.classList.contains("show");

            // If an old card is visible at the start of a round, hide it and create a skippable pause
            if (move === 0 && isCardShowing) {
                hidecards(true);
                const tableFloor = document.querySelector('.gaming-table-floor');
                const existingPools = tableFloor.querySelectorAll('.dice-animation-pool');
                existingPools.forEach(pool => pool.remove());
                
                // Push a short, unprinted break to force a pacing gap in the engine loop
                log("", "", false, false); 
                
                onTerminalFinishedCallback = () => {
                    proceedWithEnemyChoice();
                };
                
                if (!isProcessingQueue) {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null;
                    callback();
                }
            } else {
                proceedWithEnemyChoice();
            }
        }

        function proceedWithEnemyChoice() {
            // 1. Safe context and UI value extraction
            const weaponDropdown = document.getElementById("player-weapon-dropdown");
            const playerWeapon = weaponDropdown ? (parseInt(weaponDropdown.value) || 0) : 0;

            const skillDropdown = document.getElementById("player-skill-dropdown");
            const playerSkill = skillDropdown ? (parseInt(skillDropdown.value) || 0) : 0;

            const adrenaline = parseInt(document.getElementById("adrenaline-select").value) || 0;
            
            // Per instructions: total player advantage combines adrenaline and global advantage
            const totalPlayerAdvantage = adrenaline + (typeof advantage !== 'undefined' ? advantage : 0);
            const currentEnemyAdvantage = typeof enemy_advantage !== 'undefined' ? enemy_advantage : 0;

            // Helper baseline functions
            function easyAction(forcedType = null) {
                const cards   = ["O", "R", "S", "B"];
                const card    = cards[Math.floor(Math.random() * cards.length)];
                const type    = forcedType ?? (Math.random() < 0.5 ? "A" : "D");
                return [type, card];
            }

            function normalAction(options) {
                const pick = options[Math.floor(Math.random() * options.length)];
                const [type, card] = pick.split("-");
                return [type, card];
            }

            function hardAction(scenario, playerCard = null) {
                const counterMap = { "O": "B", "R": "R", "S": "S", "B": "R" };
                switch (scenario) {
                    case "attack_counter":
                        return ["A", playerCard ? (counterMap[playerCard] ?? "R") : "R"];
                    case "defend":
                        return Math.random() < 0.5 ? ["D", "S"] : ["D", "B"];
                    case "escape":
                        return ["D", "O"];
                    case "blind":
                        return ["A", "R"];
                    default:
                        return ["A", "R"];
                }
            }

            // 2. Main AI Decision Matrix
            if (chase_mode) {
                const cards      = ["O", "R", "S", "B"];
                const randomCard = cards[Math.floor(Math.random() * cards.length)];

                if (enemy_escaping) {
                    if (MODE === "EASY") {
                        enemy_action = Math.random() < 0.5 ? ["D", "B"] : ["A", randomCard];
                    } else if (MODE === "NORMAL") {
                        // If player's weapon is highly lethal, narrow choices to fast escapes or interrupts
                        enemy_action = (playerWeapon >= 1 || totalPlayerAdvantage > 2)
                            ? normalAction(["D-O", "A-R", "A-S"])
                            : normalAction(["D-S", "D-B", "D-O", "A-O"]);
                    } else { // HARD
                        // Under severe player weapon pressure, abandon basic blocks and force speed escape
                        if (playerWeapon >= 1) {
                            enemy_action = ["D", "O"]; 
                        } else {
                            enemy_action = Math.random() < 0.7 ? hardAction("defend") : ["A", randomCard];
                        }
                    }

                } else if (player_escaping) {
                    const enemyData  = ENEMY_TYPES[enemy];
                    const hasRanged  = enemyData && enemyData["ranged"] === true;

                    if (MODE === "EASY") {
                        enemy_action = ["D", randomCard];
                    } else if (MODE === "NORMAL") {
                        if (hasRanged || player_escape_counter < 1) {
                            enemy_action = totalPlayerAdvantage > 3 
                                ? normalAction(["A-R", "A-S"]) // High priority control options
                                : normalAction(["A-R", "A-B", "A-O", "A-S"]);
                        } else {
                            enemy_action = normalAction(["A-R", "D-S", "D-R"]);
                        }
                    } else { // HARD
                        if (hasRanged || player_escape_counter < 1) {
                            enemy_action = hardAction("attack_counter"); 
                        } else {
                            enemy_action = hardAction("defend");
                        }
                    }
                }
            } else {
                // Standard Combat Loop
                const pa              = player_action;
                const enemyStressThresh = ENEMY_TYPES[enemy]["stress_thresh"];

                if (pa) {
                    const playerCardStressDmg = CARDS[pa[1]][1][0]; 
                    const enemyNearDeath      = playerCardStressDmg + enemy_stress - 3 > enemyStressThresh;
                    const playerPressuring    = HERO.stress > stress_thresh - 3;
                    const enemyHighStress     = enemy_stress > enemyStressThresh - 2;

                    if (pa[0] === "A") {
                        const playerCard = pa[1]; // 'O', 'R', 'S', or 'B'

                        if (MODE === "EASY") {
                            enemy_action = enemyNearDeath ? ["D", "B"] : easyAction();

                        } else if (MODE === "NORMAL") {
                            // Logic adjustments for dealing with Heavy Blows (A-B)
                            if (playerCard === "B") {
                                // Blend safer defenses (D-O) and speed counters (A-S)
                                enemy_action = totalPlayerAdvantage >= 2 
                                    ? normalAction(["D-O", "D-S"]) 
                                    : normalAction(["A-S", "A-R"]);
                            } else if (enemyNearDeath || playerPressuring || playerWeapon >= 1) {
                                enemy_action = normalAction(["D-B", "D-S", "A-R"]); 
                            } else if (enemyHighStress) {
                                enemy_action = normalAction(["A-O", "A-R", "D-S"]);
                            } else {
                                enemy_action = normalAction(["A-R", "A-S", "A-O", "D-S", "D-R"]);
                            }

                        } else { // HARD Mode - Directly matching the RL Policy
                            if (playerCard === "B") {
                                // SPECIFIC INSIGHT: Player played a slow, high damage Heavy Blow (A-B)
                                if (totalPlayerAdvantage >= 2) {
                                    // Player has momentum: Use D-O to guarantee a -3 damage absorption safety net. 
                                    // Avoid D-B completely because a failed evasion amplifies damage to a catastrophic level.
                                    enemy_action = ["D", "O"]; 
                                } else {
                                    // Player has no leverage: Exploit the slow wind-up! 
                                    // Counterattack with a speed priority option (A-S is highest Q-value, else A-R).
                                    enemy_action = Math.random() < 0.6 ? ["A", "S"] : ["A", "R"];
                                }
                            } else if (enemyNearDeath || playerPressuring) {
                                // Weapon mitigation clause
                                enemy_action = playerWeapon >= 1 ? ["A", "R"] : ["D", "B"];
                            } else if (enemyHighStress) {
                                enemy_action = totalPlayerAdvantage >= 3 ? ["A", "R"] : ["A", "O"];
                            } else {
                                // Healthy Combat State: Respond to high player weapon values
                                if (playerWeapon >= 1) {
                                    enemy_action = ["A", "R"]; // Shut down player gears with reactive counters
                                } else if (totalPlayerAdvantage > currentEnemyAdvantage + 2) {
                                    enemy_action = ["A", "S"]; // Respond to advantage gaps with swift speed tags
                                } else {
                                    enemy_action = hardAction("attack_counter", playerCard);
                                }
                            }
                        }

                    } else {
                        // Player is Defending
                        if (MODE === "EASY") {
                            enemy_action = easyAction("A");
                        } else if (MODE === "NORMAL") {
                            const cards = ["O", "R", "S", "B"];
                            let picked  = null;
                            const structuralThreshold = playerSkill > 2 ? 1 : 0; 

                            if (Math.random() < 0.5) {
                                for (const c of cards) {
                                    if (CARDS[c][1][0] + ENEMY_TYPES[enemy]["weapon"] > CARDS[pa[1]][0][0] + structuralThreshold) {
                                        picked = c;
                                        break;
                                    }
                                }
                            }
                            enemy_action = ["A", picked ?? "O"];

                        } else { // HARD
                            enemy_action = ["A", "O"];
                            const cards = ["O", "R", "S", "B"];
                            for (const c of cards) {
                                if (CARDS[c][1][0] + ENEMY_TYPES[enemy]["weapon"] > CARDS[pa[1]][0][0]) {
                                    enemy_action = ["A", c];
                                    break;
                                }
                            }
                        }
                    }

                } else {
                    // Player hasn't selected an action yet (empty queue)
                    const nearEscapeThresh = enemy_stress >= enemyStressThresh - 1;

                    if (MODE === "EASY") {
                        if (nearEscapeThresh && Math.random() < 0.3) {
                            enemy_action      = ["D", "B"];
                            enemy_escaping    = true;
                            chase_mode        = true;
                        } else {
                            enemy_action = easyAction("A");
                        }

                    } else if (MODE === "NORMAL") {
                        if (nearEscapeThresh) {
                            if (Math.random() < 0.5 || playerWeapon >= 1) {
                                enemy_action      = ["D", "O"];
                                enemy_escaping    = true;
                                chase_mode        = true;
                            } else {
                                enemy_action = normalAction(["A-R", "D-R", "D-B", "A-S"]);
                            }
                        } else {
                            enemy_action = totalPlayerAdvantage > 3 
                                ? normalAction(["A-R", "A-S"]) 
                                : normalAction(["A-R", "D-R", "D-B", "A-S", "D-S"]);
                        }

                    } else { // HARD
                        if (nearEscapeThresh) {
                            enemy_action      = hardAction("escape");
                            enemy_escaping    = true;
                            chase_mode        = true;
                        } else {
                            // Blind-opening prioritization based on positional momentum
                            enemy_action = totalPlayerAdvantage > 2 ? ["A", "S"] : hardAction("blind");
                        }
                    }
                }
            }

            if (conflict_distance > 0 && !enemyHasRangedWeapon() && enemy_action && enemy_action[0] === "A") {
                enemy_action = ["D", enemy_action[1]];
            }

            // 3. Game-loop and State Engine Execution
            move  += 1;
            turn   = "p";

            let escapeText = "";
            if (chase_mode) {
                escapeText = enemy_escaping
                    ? `${enemy} zdrhá!`
                    : `${enemy} ťa prenasleduje!`;
            } else if (enemy_escaping) {
                escapeText = `${enemy} sa snaží ujsť`;
            }

            if (escapeText) {
                log(`${escapeText} `, "", true);
                inputs_frozen = true;
                const scrollRow = document.querySelector('.card-scroll-row');
                if (scrollRow) scrollRow.classList.remove('enable-interaction');

                updateUI();

                onTerminalFinishedCallback = () => {
                    displayEnemyCard(enemy_action[0], enemy_action[1]);
                    runGameloopCycle();
                };

                if (!isProcessingQueue) {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null;
                    callback();
                }
            } else {
                displayEnemyCard(enemy_action[0], enemy_action[1]);
                runGameloopCycle();
            }
        }

        function runGameloopCycle() {
            let delay = 0;
            if (test_mode) {delay = 100} else {delay = 1000};

            setTimeout(() => {gameloop(false, true)},delay);
        }

        function preloadImages(targets) {
            // Ensure targets is an array to handle both single strings and arrays of targets
            const targetList = Array.isArray(targets) ? targets : [targets];

            targetList.forEach(target => {
                // 1. Guard: Check if target is a valid string key in CHALLENGES
                if (typeof target !== 'string') return;

                const node = CHALLENGES[target];
                
                // 2. If it's a valid node and has an image, preload it
                if (node?.image) {
                    const img = new Image();
                    img.src = node.image;
                }
                
                // 3. If it's an array (sequence), recurse to find the first valid image
                else if (Array.isArray(node)) {
                    const firstWithImage = node.find(t => CHALLENGES[t]?.image);
                    if (firstWithImage) {
                        const img = new Image();
                        img.src = CHALLENGES[firstWithImage].image;
                    }
                }
            });
        }

        function displayEnemyCard(actionType, cardCode) {
            const container = document.getElementById("enemy-card-container");
            if (!container) return;

            // Determine rotation: Opposite of player logic 
            // (If Enemy Defends, they rotate -90 to face player's 90)
            const rotClass = actionType === "D" ? "rotate-enemy-D" : "rotate-enemy-A";

            const bgColors = { "O": "#c62828", "R": "#2e7d32", "S": "#e65100", "B": "#1565c0" };
            const bgColor = bgColors[cardCode] || "#333";

            container.innerHTML = `
                <div class="table-card ${rotClass}">
                    <img src="assets/${cardCode}.png" class="card-img" onerror="this.style.display='none'; this.parentElement.style.background='${bgColor}';">
                </div>
            `;

            void container.offsetWidth; // Reflow
            container.classList.add("show");
        }

        function hidecards(player = false, callback = null) {
            const container = document.getElementById("enemy-card-container");
            if (container) {
                container.classList.remove("show");
            }
            const playerDisplay = document.getElementById("player-card-display");
            if (playerDisplay && player) {
                playerDisplay.classList.remove("show");
            }

            // Wait 500ms for the CSS slide-out animation to finish before clearing/moving on
            if (callback) {
                let delay = 0;
                if (test_mode) {delay = 100} else {delay = 500};
                setTimeout(callback, delay); 
            }
        }

        let currentHeroIndex = 0; // Sledovanie indexu zobrazeného hrdinu

        // Funkcia na dynamické naplnenie dropdownu schopnosťami hrdinu
        function populatePlayerSkillsDropdown() {
            const dropdown = document.getElementById("player-skill-dropdown");
            if (!dropdown) return;
            const currentSelectedSkill = dropdown.value;
            dropdown.innerHTML = ""; // Vyčistenie

            // 1. Pridanie predvoleného placeholderu
            const placeholder = document.createElement("option");
            placeholder.value = "placeholder";
            placeholder.textContent = "-- VYBER SI SCHOPNOSŤ --";
            placeholder.selected = true;
            dropdown.appendChild(placeholder);

            // Zoznam biologických zbraní, ktoré filtrujeme preč zo skillov

            // Uistíme sa, že HERO.weapons existuje
            if (!HERO.weapons || !Array.isArray(HERO.weapons)) {
                HERO.weapons = [];
            }

            let hasRealSkills = false;

            // 2. Prechádzame schopnosti hrdinu
            if (HERO.skills && Object.keys(HERO.skills).length > 0) {
                for (const [skillName, val] of Object.entries(HERO.skills)) {
                    const upperSkillName = skillName.toUpperCase();

                    // KONTROLA: Ak ide o bio-zbraň, nepridávame ju do dropdownu skillov!
                    if (BIOLOGICAL_WEAPONS.includes(upperSkillName)) {
                        const lowerSkillName = skillName.toLowerCase();
                        if (!HERO.weapons.includes(lowerSkillName)) {
                            HERO.weapons.push(lowerSkillName); // Pridá sa rovno do zbraní postavy
                        }
                        continue; // Preskočíme pridanie do dropdownu schopností
                    }

                    // Ak to nie je bio-zbraň, ide o normálny skill a pridáme ho do dropdownu
                    const option = document.createElement("option");
                    option.value = skillName;
                    option.textContent = `${skillName} (${val})`;
                    dropdown.appendChild(option);
                    hasRealSkills = true;
                }
            if (Array.from(dropdown.options).some(opt => opt.value === currentSelectedSkill)) {
                dropdown.value = currentSelectedSkill;
                skill = HERO.skills[currentSelectedSkill] || 0;
            } else {
                dropdown.value = "placeholder";
                skill = 0;
            }
            }

            // Ak po odfiltrovaní bio-zbraní nezostali žiadne iné schopnosti
            if (!hasRealSkills) {
                const option = document.createElement("option");
                option.value = "none";
                option.textContent = "ŽIADNA (0)";
                dropdown.appendChild(option);
            }

            // 3. Okamžite prekreslíme dropdown zbraní, aby v ňom postava videla svoje vrodené bio-zbrane
            if (typeof populateWeaponDropdown === "function") {
                populateWeaponDropdown();
            }
        }

        function selectHero() {
            if (!HEROES || HEROES.length === 0) {
                const localData = localStorage.getItem('characters');
                if (localData) {
                    try {
                        const savedCharacters = JSON.parse(localData);
                        if (savedCharacters && savedCharacters.length > 0) {
                            HEROES = savedCharacters.map(char => ({
                                name: char.name.toUpperCase(),
                                sp: char.sp || 0,
                                skills: char.skills || {},
                                weapons: char.defaultWeapons ? [...char.defaultWeapons] : [],
                                ammo:    char.defaultAmmo    ? {...char.defaultAmmo}    : {},
                                items:   char.defaultItems   ? {...char.defaultItems}   : {},
                                stress_thresh: 8,
                                stress: 0,
                                weapon: 0,
                                defaultWeapons: char.defaultWeapons || [],
                                defaultAmmo:    char.defaultAmmo    || {},
                                defaultItems:   char.defaultItems   || {},
                                humanity: char.humanity || 50,
                                initialSkillsSnapshot: char.initialSkillsSnapshot || {},
                                isInitialPhase: char.isInitialPhase !== undefined ? char.isInitialPhase : false
                            }));
                        }
                    } catch(e) {
                        console.error("Chyba pri parsovaní postáv v selectHero:", e);
                    }
                }
            }

            // Fallback ak dáta reálne neexistujú nikde (ani v pamäti, ani v localStorage)
            if (!HEROES || HEROES.length === 0) {
                console.warn("Žiadne postavy (HEROES) neboli nájdené. Prechádzam na challenge.");
                handleChallengeTransition(current_challenge_key);
                return;
            }

            // Ak nemáme nastavený aktuálny index, začneme od nuly
            if (typeof activeCharIdx === 'undefined' || null === activeCharIdx) {
                activeCharIdx = 0;
            }

            // DEBUG MÓD
            if (typeof DEBUG !== 'undefined' && DEBUG === true) {
                activeCharIdx = 0; 
                switchCharacterGlobally(activeCharIdx);
                updateUI();
                log(`[DEBUG] Automatický výber hrdinu: ${HERO.name}`, "success-msg", true);
                if(DEBUG) log(`Default weapons: ${HERO.defaultWeapons} \n Weapons: ${HERO.weapons} \n Default items: ${HERO.defaultItems} `)
                hero_selected = true;
                gameOn = true;
                prev_challenge = debug_start;
                handleChallengeTransition(debug_start);
                return; 
            }

            const tableFloor = document.querySelector(".gaming-table-floor");
            if (!tableFloor) {
                console.error("Element .gaming-table-floor nebol v DOM nájdený!");
                return;
            }

            // Vytvorenie overlay elementu
            const overlay = document.createElement("div");
            overlay.id = "hero-selection-overlay";
            overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
                box-sizing: border-box;
                background: rgba(10, 10, 10, 0.95);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 1000;
                color: white;
            `;

            overlay.innerHTML = `                
                <div id="hero-card-display" style="
                    background: #1a1a1a; 
                    border: 2px solid var(--hybrid-green); 
                    border-radius: 8px; 
                    width: min(705px, 94%); 
                    height: min(380px, 90%);
                    max-width: 94%;
                    max-height: 90%;
                    box-sizing: border-box;
                    box-shadow: 0 0 15px rgba(0, 215, 0, 0.3);
                    display: flex;
                    flex-direction: column;
                ">
                    <!-- Scrollable content area -->
                    <div id="hero-display" style="padding: 15px 15px 10px; text-align: center; overflow-y: auto; flex: 1;">
                        <h3 id="hero-display-name" style="font-family: 'Archivo Black', sans-serif; margin: 0 0 5px 0; text-transform: uppercase; color: #fff;">-</h3>
                        <div id="hero-display-skills" style="text-align: left; font-family: 'Roboto Condensed', sans-serif; font-size: 0.95rem; background: #111; padding: 12px; border-radius: 4px; border: 1px solid #333;">
                            <div id="hero-skills-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 30px;"></div>
                            <div id="hero-other-stats"></div>
                        </div>
                    </div>
                        <div style="padding: 0 15px 15px; border-top: 1px solid #333; background: #1a1a1a; border-radius: 0 0 8px 8px;">
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px;">
                                <button onclick="showGeneralPrompt('Zadaj meno nového hrdinu:', (name) => createNewCharacterGlobally(name), null, true)" id="new-hero-btn" class="adrenaline-select" style="width:100%;max-width: 140px; background: var(--hybrid-green); color: #000; font-weight: bold; cursor: pointer;">NOVÝ HRDINA</button>
                                <div style="display: flex; gap: 5px;">
                                    <button id="hero-prev-btn" class="adrenaline-select" style="width: 60px; font-weight: bold; cursor: pointer;">◀</button>
                                    <button id="hero-confirm-btn" class="adrenaline-select" style="width: 100px; background: var(--hybrid-green); color: #000; font-weight: bold; cursor: pointer;">VYBRAŤ</button>
                                    <button id="hero-next-btn" class="adrenaline-select" style="width: 60px; font-weight: bold; cursor: pointer;">▶</button>
                                </div>
                                <button onclick="deleteCharacter()" id="delete-hero-btn" class="adrenaline-select" style="width:100%; max-width: 100px; background: var(--hybrid-red); color: #000; font-weight: bold; cursor: pointer;">VYMAZAŤ</button>
                            </div>
                        </div>
                </div>
            `;

            tableFloor.appendChild(overlay);
            log(`VYBER SI HRDINU!`, true);

            // Inicializačné zobrazenie
            updateHeroDisplay();

            // Listovanie (používame activeCharIdx namiesto neexistujúceho currentHeroIndex)
            document.getElementById("hero-prev-btn").onclick = () => {
                activeCharIdx = (activeCharIdx - 1 + HEROES.length) % HEROES.length;
                updateHeroDisplay();
            };

            document.getElementById("hero-next-btn").onclick = () => {
                activeCharIdx = (activeCharIdx + 1) % HEROES.length;
                updateHeroDisplay();
            };

            // Potvrdenie výberu hrdinu
            function confirmHeroSelection() {
                switchCharacterGlobally(activeCharIdx);
                hero_selected = true;
                gameOn = true;
                overlay.remove();
                document.removeEventListener("keydown", heroKeyHandler);
                updateUI();
                log(`Tvoj hrdina je: ${HERO.name}`, "success-msg", true);
                handleChallengeTransition(current_challenge_key);
            }

            document.getElementById("hero-confirm-btn").onclick = confirmHeroSelection;

            function heroKeyHandler(e) {
                if (e.key === "ArrowLeft") {
                        activeCharIdx = (activeCharIdx - 1 + HEROES.length) % HEROES.length;
                        updateHeroDisplay();
                    } else if (e.key === "ArrowRight") {
                        activeCharIdx = (activeCharIdx + 1) % HEROES.length;
                        updateHeroDisplay();
                    } else if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        e.stopImmediatePropagation(); // FIX: Kills the event instantly so the global listener can't intercept it

                        // If general prompt is visible, click its confirm button instead
                        const gp = document.getElementById('general-prompt');
                        if (gp && gp.style.display !== 'none') {
                            document.getElementById('gp-confirm-btn')?.click();
                            return;
                        }
                        // If weapon overlay is open, ignore — don't accidentally confirm hero
                        if (document.getElementById('weapon-selection-overlay')) return;
                        confirmHeroSelection();
                    }
                }
            document.addEventListener("keydown", heroKeyHandler);

            document.getElementById("new-hero-btn").onclick = () => {
                showGeneralPrompt('Zadaj meno nového hrdinu:', (name) => createNewCharacterGlobally(name), null, true);
            };
        }

        function deleteCharacter(){
            showGeneralPrompt(
                'Naozaj si želáš odstrániť túto postavu?',
                () => {
                    if (typeof deleteCharacterGlobally === 'function') {
                        deleteCharacterGlobally();
                    }
                }
            );
        }


        function updateHeroDisplay() {
            const activeHero = HEROES[activeCharIdx];
            if (!activeHero) return;

            const nameEl = document.getElementById("hero-display-name");
            const skillsGrid = document.getElementById("hero-skills-grid");
            if (!nameEl || !skillsGrid) return;  // ← ADD THIS — elements may not exist

            nameEl.innerText = activeHero.name;
            skillsGrid.innerHTML = "";

            if (activeHero.skills && Object.keys(activeHero.skills).length > 0) {
                for (const [skillName, val] of Object.entries(activeHero.skills)) {
                    skillsGrid.innerHTML += `
                        <div style="display: flex; justify-content: space-between; margin-bottom: 2px; padding-right:50px;">
                            <span>${skillName}:</span>
                            <span style="color: var(--hybrid-green); font-weight: bold;">${val}</span>
                        </div>`;
                }
            } else {
                skillsGrid.innerHTML = `<div style="color: #777; grid-column: span 2; text-align: center; padding: 10px 0;">Žiadne schopnosti</div>`;
            }
        }

        function selectInitialWeapon() {
            // Ak z nejakého dôvodu nie sú zbrane definované, pokračujeme do hry
            if (!INITIAL_WEAPONS || INITIAL_WEAPONS.length === 0) {
                handleChallengeTransition(current_challenge_key);
                return;
            }


            const tableFloor = document.querySelector(".gaming-table-floor");
            if (!tableFloor) return;

            let currentWeaponIndex = 0;

            // Dynamické vytvorenie identického overlay elementu
            const overlay = document.createElement("div");
            overlay.id = "weapon-selection-overlay";
            overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(10, 10, 10, 0.95);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 1001;
                color: white;
            `;

            overlay.innerHTML = `                
                <div id="weapon-card-display" style="
                    background: #1a1a1a; 
                    border: 2px solid var(--hybrid-green); 
                    border-radius: 8px; 
                    width: 705px; 
                    height: 380px; 
                    box-shadow: 0 0 15px rgba(0, 215, 0, 0.3);
                    display: flex;
                    flex-direction: column;
                    max-height: 90vh;
                ">
                    <!-- Scrollable content area -->
                    <div style="padding: 15px 15px 10px; text-align: center; overflow-y: auto; flex: 1;">
                        <h3 id="weapon-display-name" style="font-family: 'Archivo Black', sans-serif; margin: 0 0 15px 0; text-transform: uppercase; color: #fff;">-</h3>
                        <div id="weapon-display-stats" style="text-align: left; font-family: 'Roboto Condensed', sans-serif; font-size: 0.95rem; background: #111; padding: 12px; border-radius: 4px; border: 1px solid #333;">
                            <div id="weapon-stats-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 30px;"></div>
                        </div>
                    </div>

                    <!-- Fixed bottom controls -->
                    <div style="padding: 0 15px 15px;  border-top: 1px solid #333; background: #1a1a1a; border-radius: 0 0 8px 8px;">
                        <div style="display: flex; gap: 5px; margin-top: 10px; justify-content: center;">
                            <button id="weapon-prev-btn" class="adrenaline-select" style="width: 60px; font-weight: bold; cursor: pointer;">◀</button>
                            <button id="weapon-confirm-btn" class="adrenaline-select" style="width: 140px; background: var(--hybrid-green); color: #000; font-weight: bold; cursor: pointer;">VYBRAŤ</button>
                            <button id="weapon-next-btn" class="adrenaline-select" style="width: 60px; font-weight: bold; cursor: pointer;">▶</button>
                        </div>
                    </div>
                </div>
            `;

            tableFloor.appendChild(overlay);

            log(`VYBER SI POČIATOČNÚ ZBRAŇ!`, true);

            function updateWeaponDisplay() {
                const activeWeapon = INITIAL_WEAPONS[currentWeaponIndex];
                document.getElementById("weapon-display-name").innerText = activeWeapon.toUpperCase();

                const statsGrid = document.getElementById("weapon-stats-grid");
                statsGrid.innerHTML = "";

                // Prehľadáme WEAPON_LIST a vytiahneme štatistiky (kategórie a DMG) pre vizuálny výpis
                let foundStats = [];
                for (const category in WEAPON_LIST) {
                    if (WEAPON_LIST[category] && WEAPON_LIST[category][activeWeapon] !== undefined) {
                        foundStats.push({
                            cat: category,
                            dmg: WEAPON_LIST[category][activeWeapon]
                        });
                    }
                }

                if (foundStats.length > 0) {
                    foundStats.forEach(stat => {
                        statsGrid.innerHTML += `
                            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                                <span>KATEGÓRIA (${stat.cat}):</span>
                                <span style="color: var(--hybrid-green); font-weight: bold;">+${stat.dmg} DMG</span>
                            </div>`;
                    });
                } else {
                    statsGrid.innerHTML = `<div style="color: #777; grid-column: span 2; text-align: center; padding: 10px 0;">Štatistiky nedostupné</div>`;
                }
            }

            // Inicializačné zobrazenie prvej zbrane
            updateWeaponDisplay();

            // Cyklické rotovanie v zozname zbraní
            document.getElementById("weapon-prev-btn").onclick = () => {
                currentWeaponIndex = (currentWeaponIndex - 1 + INITIAL_WEAPONS.length) % INITIAL_WEAPONS.length;
                updateWeaponDisplay();
            };

            document.getElementById("weapon-next-btn").onclick = () => {
                currentWeaponIndex = (currentWeaponIndex + 1) % INITIAL_WEAPONS.length;
                updateWeaponDisplay();
            };

            // Potvrdenie výberu zbrane
            document.getElementById("weapon-confirm-btn").onclick = () => {
                document.removeEventListener('keydown', weaponKeyHandler);  // ← add this line
                const chosenWeapon = INITIAL_WEAPONS[currentWeaponIndex];

                if (!HERO.weapons || !Array.isArray(HERO.weapons)) {
                    HERO.weapons = [];
                }
                if (!HERO.defaultWeapons || !Array.isArray(HERO.defaultWeapons)) {
                    HERO.defaultWeapons = [];
                }

                if (!HERO.weapons.includes(chosenWeapon)) {
                    HERO.weapons.push(chosenWeapon);
                }
                // Also set as default — this is the hero's starting weapon
                if (!HERO.defaultWeapons.includes(chosenWeapon)) {
                    HERO.defaultWeapons.push(chosenWeapon);
                }

                if (INITIAL_AMMO && INITIAL_AMMO[chosenWeapon] !== undefined) {
                    HERO["ammo"][chosenWeapon] = (HERO["ammo"][chosenWeapon] || 0) + INITIAL_AMMO[chosenWeapon];
                    // Also set as default ammo
                    if (!HERO.defaultAmmo) HERO.defaultAmmo = {};
                    HERO["defaultAmmo"][chosenWeapon] = (HERO["defaultAmmo"][chosenWeapon] || 0) + INITIAL_AMMO[chosenWeapon];
                    log(`Pridaná munícia pre ${chosenWeapon.toUpperCase()}: +${INITIAL_AMMO[chosenWeapon]} ks.`, "success-msg", true);
                }

                overlay.remove();
                populateWeaponDropdown();
                log(`Získavaš zbraň: ${chosenWeapon.toUpperCase()}`, "success-msg", true);
                hero_selected = true;
                // After the weapon/ammo are assigned to HERO:
                const saved = JSON.parse(localStorage.getItem('characters')) || [];
                const idx = saved.findIndex(c => c.name.toUpperCase() === HERO.name.toUpperCase());
                if (idx !== -1) {
                    saved[idx].defaultWeapons = [...HERO.defaultWeapons];
                    saved[idx].defaultAmmo    = {...HERO.defaultAmmo};
                    localStorage.setItem('characters', JSON.stringify(saved));
                }
                toggleBuilder(true);
                showGeneralPrompt("POČIATOČNÁ FÁZA \n \n Máš k dispozícii 40 bodov rastu (BR) určených na DANOSTI (Sila, IQ, Obratnosť...). Môžeš si pridať 1 až 6 daností. \n \n Keď minieš všetkých 40 bodov, odomknú sa schopnosti.")
            };
            // ── after the existing onclick assignments for prev/next/confirm ──

            function weaponKeyHandler(e) {
                // 1. General prompt always has first priority
                const gp = document.getElementById('general-prompt');
                if (gp && gp.style.display !== 'none') {
                    if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        document.getElementById('gp-confirm-btn')?.click();
                    }
                    return; // arrow keys shouldn't navigate weapons while GP is open
                }

                if (e.key === 'ArrowLeft') {
                    currentWeaponIndex = (currentWeaponIndex - 1 + INITIAL_WEAPONS.length) % INITIAL_WEAPONS.length;
                    updateWeaponDisplay();
                } else if (e.key === 'ArrowRight') {
                    currentWeaponIndex = (currentWeaponIndex + 1) % INITIAL_WEAPONS.length;
                    updateWeaponDisplay();
                } else if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('weapon-confirm-btn')?.click();
                }
            }
            document.addEventListener('keydown', weaponKeyHandler);        
        }

        function populateWeaponDropdown() {
            const weaponDropdown = document.getElementById("player-weapon-dropdown");
            if (!weaponDropdown) return;
            const currentSelectedWeapon = weaponDropdown.value; 
            weaponDropdown.innerHTML = '<option value="placeholder">- ZBRAŇ - </option>';

            // Ak hrdina existuje a má pole zbraní (weapons), pridáme ich do dropdownu
            if (HERO && Array.isArray(HERO.weapons)) {
                HERO.weapons.forEach(weaponName => {
                    
                    // 1. Prehľadáme WEAPON_LIST a zistíme poškodenie (dmg) pre túto konkrétnu zbraň
                    let dmgValue = 0;
                    if (typeof WEAPON_LIST === "object") {
                        for (const category in WEAPON_LIST) {
                            if (WEAPON_LIST[category] && WEAPON_LIST[category][weaponName] !== undefined) {
                                dmgValue = WEAPON_LIST[category][weaponName];
                                break; // Zbraň sme našli, ukončíme hľadanie v kategóriách
                            }
                        }
                    }

                    // --- NOVÁ ČASŤ: Zistenie a formátovanie munície ---
                    let ammoText = "";
                    // Skontrolujeme, či táto zbraň využíva muníciu (buď je v INITIAL_AMMO, alebo ju už hrdina má v ammo)
                    const hasInitialAmmo = typeof INITIAL_AMMO !== "undefined" && INITIAL_AMMO[weaponName] !== undefined;
                    const hasHeroAmmo = HERO.ammo && HERO.ammo[weaponName] !== undefined;

                    if (hasInitialAmmo || hasHeroAmmo) {
                        const currentAmmo = (HERO.ammo && HERO.ammo[weaponName] !== undefined) ? HERO.ammo[weaponName] : 0;
                        ammoText = ` x${currentAmmo}`; // Použité emoji náboja/raketky a počet kusov
                    }
                    // ---------------------------------------------------

                    // 2. Vytvoríme option a pridáme k názvu aj hodnotu, napr. "PIŠTOĽ (+1) 🚀x10"
                    const option = document.createElement("option");
                    option.value = weaponName; // napr. "pištoľ"
                    option.textContent = `${weaponName.toUpperCase()} (+${dmgValue})${ammoText}`; 
                    
                    weaponDropdown.appendChild(option);
                });
            }
            if (Array.from(weaponDropdown.options).some(opt => opt.value === currentSelectedWeapon)) {
                weaponDropdown.value = currentSelectedWeapon;
                // re-sync global weapon
                let dmgValue = 0;
                for (const category in WEAPON_LIST) {
                    if (WEAPON_LIST[category][currentSelectedWeapon] !== undefined) {
                        dmgValue = WEAPON_LIST[category][currentSelectedWeapon];
                        break;
                    }
                }
                weapon = dmgValue;
            } else {
                weaponDropdown.value = "placeholder";
                weapon = 0;
            }
        }


        function toggleBuilder(show) {
            if (show) {
                if (is_conflict || is_action_phase || is_collapse_check || is_heal_check || is_elimination_check) {
                    log("Teraz nie je čas...");
                    return;
                }
                if (hero_selected != true) {
                    showGeneralPrompt("Najskôr si vyber hrdinu.");
                    return;
                }
            }

            const overlay = document.getElementById('builder-overlay');
            const iframe = document.getElementById('builder-iframe');
            
            if (overlay && iframe) {
                if (show) {
                    overlay.style.display = 'block';
                    
                    // 1. Zadefinujeme onload handler IBA pre prípad, že otvárame builder
                    iframe.onload = function() {
                        // Poistka: Ak iframe obsahuje "about:blank", nič nespúšťame
                        if (iframe.src && iframe.src.includes('builder/index.html')) {
                            if (typeof activeCharIdx !== 'undefined' && iframe.contentWindow && typeof iframe.contentWindow.syncCharacterFromParent === 'function') {
                                iframe.contentWindow.syncCharacterFromParent(activeCharIdx, SKILLS_DB);
                            }
                        }
                    };
                    
                    // 2. Až po naviazaní poistky zmeníme zdroj na builder
                    iframe.src = 'builder/index.html'; 
                    
                } else {
                    // Guard: read fresh from localStorage so we get the builder's latest saved value
                    const savedChars = JSON.parse(localStorage.getItem('characters')) || [];
                    const freshHero = savedChars.find(c => 
                        c.name.toUpperCase() === (HEROES[activeCharIdx]?.name || '').toUpperCase()
                    );
                    const activeHero = freshHero || HEROES[activeCharIdx];

                    if (activeHero && activeHero.isInitialPhase) {
                        showGeneralPrompt(
                            'Tvorba hrdinu nebola dokončená. Zmeny nebudú uložené. Naozaj chceš odísť?',
                            () => {
                                if (HEROES.length > 1) {
                                    deleteCharacterGlobally();
                                } else {
                                    // Can't delete the only hero — just clear the flag so close proceeds
                                    activeHero.isInitialPhase = false;
                                    if (HEROES[activeCharIdx]) HEROES[activeCharIdx].isInitialPhase = false;
                                    HERO.isInitialPhase = false;
                                    // Also persist the cleared flag
                                    const saved = JSON.parse(localStorage.getItem('characters')) || [];
                                    const idx = saved.findIndex(c => c.name.toUpperCase() === HERO.name.toUpperCase());
                                    if (idx !== -1) { saved[idx].isInitialPhase = false; localStorage.setItem('characters', JSON.stringify(saved)); }
                                }
                                updateHeroDisplay();
                                // Close directly — don't call toggleBuilder(false) recursively here
                                const overlay = document.getElementById('builder-overlay');
                                const iframe = document.getElementById('builder-iframe');
                                if (overlay) overlay.style.display = 'none';
                                if (iframe) iframe.src = 'about:blank';
                            }
                        );
                        return;
                    }

                    if (activeHero && !hero_created && activeHero.sp > 0) {
                        showGeneralPrompt(
                            'Ešte máš nejaké body rastu. Chceš si ich nechať na neskôr a ukončiť tvorbu hrdinu?',
                            () => {
                                hero_created = true;
                                toggleBuilder(false);
                            }
                        );
                        updateHeroDisplay();
                        return;
                    }
                    
                    updateHeroDisplay();
                    hero_created = true;

                    // Normal close logic
                    iframe.onload = null;

                    const savedCharacters = localStorage.getItem('characters');
                    if (savedCharacters) {
                        try {
                            const parsedCharacters = JSON.parse(savedCharacters);
                            if (parsedCharacters && parsedCharacters.length > 0) {
                                HEROES = parsedCharacters.map(char => ({
                                    name: char.name.toUpperCase(),
                                    sp: char.sp || 0,
                                    skills: char.skills || {},
                                    weapons: char.weapons !== undefined ? [...char.weapons] : (char.defaultWeapons ? [...char.defaultWeapons] : []),                                            
                                    ammo: char.ammo !== undefined ? {...char.ammo} : (char.defaultAmmo ? {...char.defaultAmmo} : {}),
                                    items: char.items !== undefined ? {...char.items} : (char.defaultItems ? {...char.defaultItems} : {}),
                                    stress_thresh: 8,
                                    stress: char.stress !== undefined ? char.stress : 0,
                                    weapon: 0,
                                    isInitialPhase: char.isInitialPhase !== undefined ? char.isInitialPhase : false,
                                    defaultWeapons: char.defaultWeapons || [...activeWeapons],
                                    defaultAmmo:    char.defaultAmmo    || {...activeAmmo},
                                    defaultItems:   char.defaultItems   || {...activeItems}
                                }));

                                if (typeof activeCharIdx !== 'undefined' && HEROES[activeCharIdx]) {
                                    const chosen = HEROES[activeCharIdx];
                                    for (let key in HERO) { delete HERO[key]; }
                                    Object.assign(HERO, chosen);
                                }
                            }
                        } catch (e) {
                            console.error("Chyba pri synchronizácii postáv z buildera:", e);
                        }
                    }

                    if (typeof updateUI === "function") {
                        try { updateUI(); } catch(e) { console.warn("updateUI zlyhalo, ale zatvárame okno:", e); }
                    }

                    overlay.style.display = 'none';
                    iframe.src = 'about:blank';
                }
            }
        }
        
        
        function syncHeroToStorage() {
            const saved = JSON.parse(localStorage.getItem('characters')) || [];
            const idx = saved.findIndex(c => c.name.toUpperCase() === HERO.name.toUpperCase());
            if (idx !== -1) {
                const existing = saved[idx];
                saved[idx] = {
                    ...existing,
                    ...HERO,
                    // Check HERO first so it doesn't get wiped out by missing existing properties
                    defaultWeapons: HERO.defaultWeapons || existing.defaultWeapons || [],
                    defaultAmmo:    HERO.defaultAmmo    || existing.defaultAmmo    || {},
                    defaultItems:   HERO.defaultItems   || existing.defaultItems   || {},
                    isInitialPhase: existing.isInitialPhase
                };
                localStorage.setItem('characters', JSON.stringify(saved));
            }
        }
        
        function deleteCharacterGlobally() {
            if (HEROES.length <= 1) {
                log("Nemôžeš odstrániť posledného hrdinu.", "danger-msg");
                return;
            }

            const heroName = HEROES[activeCharIdx].name;

            // Remove from HEROES array
            HEROES.splice(activeCharIdx, 1);

            // Adjust active index if we deleted the last item
            if (activeCharIdx >= HEROES.length) {
                activeCharIdx = HEROES.length - 1;
            }

            // Update HERO object to the new active character
            for (let key in HERO) delete HERO[key];
            Object.assign(HERO, HEROES[activeCharIdx]);

            // Save updated characters to localStorage
            const charactersForBuilder = HEROES.map(h => ({
                name: h.name,
                sp: h.sp,
                skills: h.skills,
                isInitialPhase: h.isInitialPhase !== undefined ? h.isInitialPhase : false,
                initialSkillsSnapshot: h.initialSkillsSnapshot || {},
                humanity: h.humanity || 50,
                stress: h.stress !== undefined ? h.stress : 0,
                items: h.items !== undefined ? h.items : {},
                weapons: h.weapons !== undefined ? h.weapons : [],
                ammo: h.ammo !== undefined ? h.ammo : {},      
                defaultWeapons: h.defaultWeapons || [],
                defaultAmmo:    h.defaultAmmo    || {},
                defaultItems:   h.defaultItems   || {}
            }));
            localStorage.setItem('characters', JSON.stringify(charactersForBuilder));

            // Refresh the hero card display inside the selectHero overlay
            const nameEl = document.getElementById("hero-display-name");
            const skillsGrid = document.getElementById("hero-skills-grid");
            if (nameEl && skillsGrid) {
                const activeHero = HEROES[activeCharIdx];
                nameEl.innerText = activeHero.name;
                skillsGrid.innerHTML = "";
                if (activeHero.skills && Object.keys(activeHero.skills).length > 0) {
                    for (const [skillName, val] of Object.entries(activeHero.skills)) {
                        skillsGrid.innerHTML += `
                            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                                <span>${skillName}:</span>
                                <span style="color: var(--hybrid-green); font-weight: bold;">${val}</span>
                            </div>`;
                    }
                } else {
                    skillsGrid.innerHTML = `<div style="color: #777; grid-column: span 2; text-align: center; padding: 10px 0;">Žiadne schopnosti</div>`;
                }
            }

            log(`Hrdina ${heroName} bol odstránený.`, "success-msg", true);
        }   

        function showGeneralPrompt(text, onConfirm = null, onCancel = null, input = false) {
            const prompt = document.getElementById('general-prompt');
            const confirmBtn = document.getElementById('gp-confirm-btn');
            const cancelBtn = document.getElementById('gp-cancel-btn');
            const gp_text = document.getElementById('general-prompt-text');
            const gp_input = document.getElementById('general-prompt-input');
            if (!prompt || !confirmBtn || !cancelBtn) return;

            gp_text.innerText = text;

            const messageOnly = !onConfirm && !onCancel && !input;
            const yesOnly = text && onConfirm && !onCancel && !input;

            if (messageOnly) {
                gp_input.style.display = 'none';
                confirmBtn.innerText = 'OK';
                cancelBtn.style.display = 'none';
            } else if (input) {
                gp_input.value = '';
                gp_input.style.display = 'block';
                confirmBtn.innerText = 'Potvrdiť';
                cancelBtn.style.display = 'block';
                cancelBtn.innerText = 'Zrušiť';
            } else if (text && onConfirm) {
                gp_input.style.display = 'none';
                confirmBtn.innerText = 'Áno.';
                cancelBtn.style.display = 'none';
                cancelBtn.style.display = 'block';
                cancelBtn.innerText = 'Zrušiť'
            } else {
                gp_input.style.display = 'none';
                confirmBtn.innerText = 'Áno.';
                cancelBtn.style.display = 'block';
                cancelBtn.innerText = 'Nie.';
            }

            // Clone buttons to strip any previously attached listeners
            const newConfirm = confirmBtn.cloneNode(true);
            const newCancel = cancelBtn.cloneNode(true);
            confirmBtn.replaceWith(newConfirm);
            cancelBtn.replaceWith(newCancel);

            newConfirm.addEventListener('click', () => {
                if (input && gp_input.value.trim() === '') return;
                prompt.style.display = 'none';
                if (typeof onConfirm === 'function') onConfirm(input ? gp_input.value.trim() : undefined);
            });
            newCancel.addEventListener('click', () => {
                prompt.style.display = 'none';
                if (typeof onCancel === 'function') onCancel();
            });

            prompt.style.display = 'flex';
            if (input) gp_input.focus();
        }

        
        function switchCharacterGlobally(newIdx) {
            // Zjednotíme indexy - hlavné okno bude používať activeCharIdx
            activeCharIdx = parseInt(newIdx);
            
            if (typeof HEROES !== 'undefined' && HEROES[activeCharIdx]) {
                const chosen = HEROES[activeCharIdx];
                
                // Bezpečne prepíšeme globálny objekt HERO
                for (let key in HERO) {
                    delete HERO[key];
                }
                Object.assign(HERO, chosen);
                
                if (HERO.stress_thresh === undefined) HERO.stress_thresh = 8;
                if (HERO.weapon === undefined) HERO.weapon = 0;
            }

            // Aktualizujeme herné UI hlavného okna, ak existuje
            if (typeof updateUI === "function") {
                try {
                    updateUI();
                } catch(e) {
                    console.warn("updateUI() zlyhalo, ale pokračujeme v synchronizácii:", e);
                }
            }

            // DELEGÁCIA DO IFRAME: Povieme builderu v iframe, aby sa prepol tieź
            const iframe = document.getElementById('builder-iframe');
            if (iframe && iframe.contentWindow) {
                try {
                    if (typeof iframe.contentWindow.syncCharacterFromParent === 'function') {
                        iframe.contentWindow.syncCharacterFromParent(activeCharIdx);
                    }
                } catch (e) {
                    console.log("Iframe buildera nie je pripravený alebo načítaný.");
                }
            }
        }

        function createNewCharacterGlobally(name) {
            const trimmedName = name ? name.trim().toUpperCase() : "";
            if (!trimmedName) return;

            // 1. Vytvoríme novú postavu v štruktúre, ktorú očakáva tvoj herný engine
            const newHero = {
                name: trimmedName,
                sp: 40,
                skills: {},
                weapons: [],
                ammo: {},
                stress_thresh: 8,
                stress: 0,
                items: {},
                weapon: 0,
                // Zachováme aj builder premenné, ak by ich neskôr potreboval
                isInitialPhase: true,
                initialSkillsSnapshot: {},
                humanity: 50,
                defaultWeapons: [],
                defaultAmmo: {},
                defaultItems: {}
            };

            hero_created = false;

            // 2. Tlačíme do globálneho poľa HEROES
            if (!Array.isArray(HEROES)) {
                HEROES = [];
            }
            HEROES.push(newHero);

            // 3. Nastavíme index na túto novovytvorenú postavu (posledný element v poli)
            activeCharIdx = HEROES.length - 1;

            // 4. Bezpečne prepíšeme globálny objekt HERO dátami novej postavy
            for (let key in HERO) {
                delete HERO[key];
            }
            Object.assign(HERO, newHero);

            // 5. SYNCHRONIZÁCIA: Uložíme zmenu do localStorage pre builder
            // Keďže builder očakáva čisté pole postáv (nie herný formát), 
            // premapujeme ho späť tak, ako ho má zadefinovaný builder
            const charactersForBuilder = HEROES.map(h => ({
                name: h.name,
                stress: h.stress !== undefined ? h.stress : 0,
                items: h.items !== undefined ? h.items : {},
                weapons: h.weapons !== undefined ? h.weapons : [],
                ammo: h.ammo !== undefined ? h.ammo : {},
                sp: h.sp,
                skills: h.skills,
                isInitialPhase: h.isInitialPhase || false,
                initialSkillsSnapshot: h.initialSkillsSnapshot || {},
                humanity: h.humanity || 50,
                defaultWeapons: h.defaultWeapons || [],
                defaultAmmo:    h.defaultAmmo    || {},
                defaultItems:   h.defaultItems   || {}
            }));
            
            localStorage.setItem('characters', JSON.stringify(charactersForBuilder));

            // 6. Aktualizujeme herné UI (dropdowny skillov, zbraní atď.)
            if (typeof updateUI === "function") {
                updateUI();
            }
            if (typeof populatePlayerSkillsDropdown === "function") {
                populatePlayerSkillsDropdown();
            }

            // 7. Ak je v tejto chvíli otvorený iframe buildera, povieme mu, aby sa okamžite prepol na novú postavu
            const iframe = document.getElementById('builder-iframe');
            if (iframe && iframe.contentWindow) {
                try {
                    // Najskôr povieme builderu, nech si znovu načíta characters z localStorage
                    if (typeof iframe.contentWindow.renderCharSelector === 'function') {
                        // Ak má builder funkciu na prečítanie/vykreslenie selektora, zavoláme ju
                        iframe.contentWindow.location.reload(); // Najistejšia cesta je rýchly reload iframu, ktorý si hneď natiahne čerstvé localStorage dáta
                    } else if (typeof iframe.contentWindow.syncCharacterFromParent === 'function') {
                        iframe.contentWindow.syncCharacterFromParent(activeCharIdx);
                    }
                } catch (e) {
                    // Iframe nemusí byť otvorený, ignorujeme log
                }
            }

            const nameEl = document.getElementById("hero-display-name");
            const skillsGrid = document.getElementById("hero-skills-grid");
            if (nameEl && skillsGrid) {
                nameEl.innerText = newHero.name;
                skillsGrid.innerHTML = `<div style="color: #777; grid-column: span 2; text-align: center; padding: 10px 0;">Žiadne schopnosti</div>`;
            }

            log(`Vytvorená nová postava: ${trimmedName}`, "success-msg", true);
            selectInitialWeapon()
        }

        function adjustHeroStress(amount) {
            HERO.stress = Math.max(0, (HERO.stress || 0) + amount);
            updateUI(); // this calls syncHeroToStorage, persisting it
        }

        document.getElementById("flip-cards-btn").addEventListener("click", function() {
            cards_are_flipped = !cards_are_flipped;
            
            const cards = document.querySelectorAll("#card-tray-container .card-container");
            cards.forEach(card => {
                card.classList.toggle("flipped", cards_are_flipped);
                
                // Target elements safely by their native structural order inside the card container
                const firstZone = card.children[0];  // Originally Defend / Top
                const secondZone = card.children[1]; // Originally Attack / Bottom
                
                if (cards_are_flipped) {
                    // Turn the first physical zone into the bottom visual slot (Attack/Red)
                    firstZone.className = "split-zone bottom";
                    firstZone.innerText = "ÚTOK";
                    firstZone.setAttribute("data-action", "A");
                    
                    // Turn the second physical zone into the top visual slot (Defend/Green)
                    secondZone.className = "split-zone top";
                    secondZone.innerText = "ČIN";
                    secondZone.setAttribute("data-action", "D");
                } else {
                    // Revert explicitly to baseline setup
                    firstZone.className = "split-zone top";
                    firstZone.innerText = "ČIN";
                    firstZone.setAttribute("data-action", "D");
                    
                    secondZone.className = "split-zone bottom";
                    secondZone.innerText = "ÚTOK";
                    secondZone.setAttribute("data-action", "A");
                }
            });
        });

        const cardTray = document.getElementById("card-tray-container");
        if (cardTray && isTouchDevice) {
            cardTray.addEventListener("touchstart", function(e) {
                if (inputs_frozen) return;
                const cardContainer = e.target.closest(".card-container");
                if (!cardContainer) {
                    if (touchHoverActive) {
                        clearCardHoverHighlight();
                    }
                    return;
                }

                const allCards = Array.from(cardTray.querySelectorAll(".card-container"));
                const touchedIndex = allCards.indexOf(cardContainer);
                if (touchedIndex === -1) return;

                if (touchPendingCardIdx !== touchedIndex) {
                    setCardHoverHighlight(touchedIndex);
                    touchClickSuppressed = true;
                } else {
                    touchClickSuppressed = false;
                }
            });

            document.addEventListener("touchstart", function(e) {
                if (inputs_frozen) return;
                if (!e.target.closest("#card-tray-container .card-container")) {
                    clearCardHoverHighlight();
                }
            });
        }

        document.getElementById("card-tray-container").addEventListener("click", function(e) {
            if (inputs_frozen) return;

            // =========================================================================
            // 1. PRIORITNÉ ZISTENIE ELEMENTOV (KARTA A ZÓNA) A SYNCHRONIZÁCIA
            // =========================================================================
            const cardContainer = e.target.closest(".card-container");
            if (!cardContainer) return; 
            
            const allCards = Array.from(document.querySelectorAll("#card-tray-container .card-container"));
            const cardIdx = allCards.indexOf(cardContainer);
            if (isTouchDevice && touchClickSuppressed && touchPendingCardIdx === cardIdx) {
                touchClickSuppressed = false;
                return; 
            }

            const cardCode = cardContainer.getAttribute("data-card");
            const zone = e.target.closest(".split-zone");

            currentSelectedCardIdx = cardIdx;
            if (zone) {
                currentSelectedActionType = zone.getAttribute("data-action");
            }
            updateCardKeyboardHighlight();

            // =========================================================================
            // 2. ŠPECIÁLNE REŽIMY (ČISTÉ HODY / BEZ KONTROLY ZBRANÍ)
            // =========================================================================
            if (is_collapse_check) {
                skill = 0; 
                resolveCollapseCheck(cardCode);
                return; 
            }

            if (is_heal_check) {
                resolveHealCheck(cardCode);
                return; 
            }

            // =========================================================================
            // 3. UNIVERZÁLNA PRÍPRAVA A VALIDÁCIA SCHOPNOSTÍ / ZBRANÍ (PRE BOJ AJ ELIMINÁCIU)
            // =========================================================================
            const actionType = zone ? zone.getAttribute("data-action") : currentSelectedActionType;
            const isEliminationAttack = is_elimination_check && actionType === "A";
            const skillDropdown = document.getElementById("player-skill-dropdown");
            const selectedSkillName = skillDropdown ? skillDropdown.value : "placeholder";
            const upperSkill = selectedSkillName.toUpperCase();
            const activeChallenge = CHALLENGES[current_challenge_key];
            const isPlaceholder = (selectedSkillName === "placeholder");

            const weaponDropdown = document.getElementById("player-weapon-dropdown");
            const selectedWeaponName = weaponDropdown ? weaponDropdown.value : "placeholder";

            // --- A. AKTUALIZÁCIA GLOBÁLNEJ PREMENNEJ weapon ---
            if (!selectedWeaponName || selectedWeaponName === "placeholder") {
                weapon = 0;
                if (is_conflict && typeof DEBUG !== 'undefined' && DEBUG === true) {
                    log("👊 Bojuješ holými rukami (INTENZITA: 0).", "system-msg");
                }
            } else {
                let foundDamage = 0;
                for (const category in WEAPON_LIST) {
                    if (WEAPON_LIST[category] && WEAPON_LIST[category][selectedWeaponName] !== undefined) {
                        foundDamage = WEAPON_LIST[category][selectedWeaponName];
                        break;
                    }
                }
                weapon = foundDamage;
            }

            // --- B. VALIDÁCIA SCHOPNOSTÍ A PRIRADENIE HODNOTY skill ---
            if (selectedSkillName && selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                const skillData = SKILLS_DB[selectedSkillName];
                const isDefenseSkill = DEFENSE_SKILLS.includes(upperSkill);
                const isCombatSkill = ATTACK_SKILLS.includes(upperSkill) || 
                                    (skillData && skillData[1] && skillData[1].toUpperCase().includes("BOJ"));                



                if (is_conflict && selectedSkillName.includes("ELIMIN")){
                    log(`⚠️ "${selectedSkillName}" nemôžeš počas boja.`, "error-msg");
                    skill = 0; 
                    return;
                }

                if (is_conflict && !isCombatSkill && !isDefenseSkill && !isPlaceholder) {
                    log(`⚠️ "${selectedSkillName}" nemôžeš použiť v boji.`, "error-msg");
                    skill = 0; 
                    return;
                }

                skill = HERO.skills[selectedSkillName] || 0;

            } else {
                skill = 0;
            }

            // --- C. KONTROLY KOMBINÁCIÍ (SPOLOČNÉ PRE BOJ AJ ELIMINÁCIU) ---
            if ((is_conflict  || isEliminationAttack) && selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                const skillData = SKILLS_DB[selectedSkillName];

                // Overenie Vrhania
                if (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY") {
                    if (!WEAPON_LIST["VRHACIE"] || WEAPON_LIST["VRHACIE"][selectedWeaponName] === undefined) {
                        log(`⚠️ ${upperSkill} vyžaduje vrhaciu zbraň!`, "error-msg");
                        return;
                    }
                }

                // Kontrola vyžadovania zbrane pre strelecké/zbraňové skilly
                if (skillData) {
                    const skillCategory = skillData[1] ? skillData[1].toUpperCase() : "";
                    if (skillCategory === "BOJ Z DIAĽKY" || upperSkill.includes("ZBRANE")) {
                        if (selectedWeaponName === "placeholder" || selectedWeaponName === "") {
                            log(`⚠️ Schopnosť ${upperSkill} vyžaduje zbraň!`, "error-msg");
                            return;
                        }
                    }
                }

                // Kontrola kombinácie sily zbrane (WEAPON_SKILLS) - iba v boji
                if (is_conflict && selectedWeaponName !== "placeholder") {
                    const weaponAllowed = WEAPON_SKILLS[String(weapon)] || [];
                    const allowedSkills = weaponAllowed.concat(ATTACK_SKILLS);
                    if (allowedSkills && !allowedSkills.includes(upperSkill)) {
                        log(`⚠️ Schopnosť ${upperSkill} nie je použiteľná s touto zbraňou (vyžaduje intenzitu ${weapon})!`, "error-msg");
                        return;
                    }
                }

                // Dynamické overenie kategórií zbraní a skillov (Blízko vs Diaľka)
                let weaponCategory = "";
                for (const category in WEAPON_LIST) {
                    if (WEAPON_LIST[category] && WEAPON_LIST[category][selectedWeaponName] !== undefined) {
                        weaponCategory = category.toUpperCase();
                        break;
                    }
                }

                // Pomocné premenné pre kontrolu vzdialenosti
                const isRanged = weaponCategory === "BOJ Z DIAĽKY";
                const isThrownWeapon = weaponCategory === "VRHACIE";
                const isThrownSkill = (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY");
                const canAttackAtDistance = isRanged || (isThrownWeapon && isThrownSkill);


                if (skillData && skillData[1]) {
                    const skillCategory = skillData[1].toUpperCase();
                    
                    if (weaponCategory === "BOJ Z DIAĽKY" && upperSkill !== "VRHANIE" && upperSkill !== "ŤAŽKÉ PREDMETY") {
                        if (!skillCategory.includes("BOJ Z DIAĽKY")) {
                            log(`⚠️ Zbraň na diaľku (${selectedWeaponName.toUpperCase()}) vyžaduje schopnosť pre BOJ Z DIAĽKY!`, "error-msg");
                            return;
                        }
                    }
                    
                    if (weaponCategory === "BOJ ZBLÍZKA") {
                        if (!skillCategory.includes("BOJ ZBLÍZKA")) {
                            log(`⚠️ Zbraň na blízko (${selectedWeaponName.toUpperCase()}) vyžaduje schopnosť pre BOJ ZBLÍZKA!`, "error-msg");
                            return;
                        }
                    }
                }
            }

            // --- D. SKUTOČNÁ KONTROLA A SPOTREBA MUNÍCIE ---
            
            if ((is_conflict  || isEliminationAttack) && actionType === "A" && typeof conflict_distance !== 'undefined' && conflict_distance > 0) {                
                if (selectedWeaponName === "placeholder" || selectedWeaponName === "") {
                    log(`⚠️ Na útok holými rukami je nepriateľ príliš ďaleko.`, "error-msg");
                    return;
                } else {
                    const isRanged = WEAPON_LIST["BOJ Z DIAĽKY"] && WEAPON_LIST["BOJ Z DIAĽKY"][selectedWeaponName] !== undefined;
                    const isThrownWeapon = WEAPON_LIST["VRHACIE"] && WEAPON_LIST["VRHACIE"][selectedWeaponName] !== undefined;
                    const isThrownSkill = (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY");
                    const canAttackAtDistance = isRanged || (isThrownWeapon && isThrownSkill);

                    if (!canAttackAtDistance) {
                        if (isThrownWeapon && !isThrownSkill) {
                            log(`⚠️ Nepriateľ je ešte ďaleko! Ak chceš zbraň hodiť, zvoľ si schopnosť VRHANIE / ŤAŽKÉ PREDMETY.`, "error-msg");
                        } else {
                            log(`⚠️ Nepriateľ je ešte ďaleko! Použi zbraň na diaľku.`, "error-msg");
                        }
                        return;
                    }
                }
            }


            if (((is_conflict && actionType === "A") || isEliminationAttack) && selectedWeaponName !== "placeholder") {
                if (typeof INITIAL_AMMO !== "undefined" && INITIAL_AMMO[selectedWeaponName] !== undefined) {
                    const isRangedWeapon = WEAPON_LIST["BOJ Z DIAĽKY"] && WEAPON_LIST["BOJ Z DIAĽKY"][selectedWeaponName] !== undefined;
                    const isThrownWeapon = WEAPON_LIST["VRHACIE"] && WEAPON_LIST["VRHACIE"][selectedWeaponName] !== undefined;
                    const isThrownSkill = (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY");

                    if (isRangedWeapon || (isThrownWeapon && isThrownSkill)) {
                        const currentAmmo = HERO["ammo"][selectedWeaponName];

                        if (currentAmmo === undefined || currentAmmo <= 0) {
                            log(`⚠️ Nemáš muníciu pre zbraň: ${selectedWeaponName.toUpperCase()}!`, "error-msg");
                            return; // Zastaví vykonanie kliknutia skôr, než sa zavolá engine
                        }

                        // Bezpečné odčítanie - všetky podmienky úspešne prešli!
                        HERO["ammo"][selectedWeaponName] = Math.max(0, currentAmmo - 1);
                        log(`Munícia pre zbraň ${selectedWeaponName.toUpperCase()}: ${HERO["ammo"][selectedWeaponName]} ks.`, "info-msg");
                    }
                }
            }

            // =========================================================================
            // 4. REŽIM ELIMINÁCIE
            // =========================================================================
            if (is_elimination_check) {
                resolveEliminationCheck(cardCode, actionType);
                return;
            }

            // =========================================================================
            // 5. ŠTANDARDNÝ REŽIM V CONFLIKTE / BOJI
            // =========================================================================
            if (is_conflict) {
                if (!zone) return; 

                if (selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                    const isDefenseSkill = DEFENSE_SKILLS.includes(upperSkill);
                    const skillData = SKILLS_DB[selectedSkillName];
                    const isCombatSkill = ATTACK_SKILLS.includes(upperSkill) || 
                                        (skillData && skillData[1] && skillData[1].toUpperCase().includes("BOJ"));                
                    
                    if (actionType === "A" && !isCombatSkill && isDefenseSkill) {
                        log(`⚠️ Nemôžeš použiť obrannú schopnosť (${selectedSkillName}) pri ÚTOKU!`, "error-msg");
                        return;
                    }
                    if (actionType === "D" && isCombatSkill && !isDefenseSkill) {
                        log(`⚠️ Nemôžeš použiť útočnú schopnosť (${selectedSkillName}) pri ČINE!`, "error-msg");
                        return;
                    }
                }
                
                
                if (chase_mode || player_escaping || enemy_escaping) {
                    if (player_escaping) {
                        if (actionType === "D" && selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                            if (!CHASE_SKILLS.includes(upperSkill)) {
                                log(`⚠️ Na únik nemôžeš použiť schopnosť ${upperSkill}!`, "error-msg");
                                return;
                            }
                        }
                        handleConflictInput(actionType, cardCode);
                        return;
                    }
                    
                    if (enemy_escaping) {
                        if (actionType === "D" && selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                            if (!CHASE_SKILLS.includes(upperSkill)) {
                                log(`⚠️ Na prenasledovanie nemôžeš použiť schopnosť ${upperSkill}!`, "error-msg");
                                return;
                            }
                        }
                        if (actionType === "A") {
                            if (selectedWeaponName === "placeholder" || selectedWeaponName === "") {
                                if (enemy_escape_counter >= 1) {
                                    log(`⚠️ Nemáš vybranú žiadnu zbraň na diaľku! Na útok päsťami je nepriateľ príliš ďaleko.`, "error-msg");
                                    return;
                                }
                            } else {
                                const isRanged = WEAPON_LIST["BOJ Z DIAĽKY"] && WEAPON_LIST["BOJ Z DIAĽKY"][selectedWeaponName] !== undefined;
                                const isThrownWeapon = WEAPON_LIST["VRHACIE"] && WEAPON_LIST["VRHACIE"][selectedWeaponName] !== undefined;
                                const isThrownSkill = (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY");
                                const canAttackAtDistance = isRanged || (isThrownWeapon && isThrownSkill);
                                
                                if (!(canAttackAtDistance || enemy_escape_counter < 1)) {
                                    if (isThrownWeapon && !isThrownSkill) {
                                        log(`⚠️ Nepriateľ je príliš ďaleko! Ak chceš zbraň hodiť, zvoľ si schopnosť VRHANIE / ŤAŽKÉ PREDMETY.`, "error-msg");
                                    } else {
                                        log(`⚠️ Nepriateľ je príliš ďaleko! Použi zbraň na diaľku.`, "error-msg");
                                    }
                                    return;
                                }
                            }
                        }
                        handleConflictInput(actionType, cardCode);
                        return;
                    }
                }

                handleConflictInput(actionType, cardCode);
            } 
            // =========================================================================
            else {
                if (is_action_phase) {
                    const skillRestricted = activeChallenge &&
                        Array.isArray(activeChallenge.skills) &&
                        activeChallenge.skills.length > 0;

                    if (skillRestricted && !isPlaceholder && !activeChallenge.skills.includes(selectedSkillName)) {
                        log(`⚠️ Schopnosť ${selectedSkillName} ti teraz nepomôže, skús jednu z týchto: (${activeChallenge.skills.join(', ')})`, "error-msg");
                        return;
                    }
                }

                resolveActionPhase(cardCode);
            }
        });


        document.getElementById("escape-btn").addEventListener("click", function() {
            // Ak prebieha vyhodnocovanie (kocky, animácie), na tlačidlo sa nedá kliknúť
            if (typeof move !== 'undefined' && move >= 2) return; 

            player_escaping = !player_escaping;
            
            if (player_escaping) {
                chase_mode = true;
                this.style.background = "#dc3545"; // Sčervená pri aktívnom úteku
                log("🏃 Pripravuješ sa na útek! Vyber si kartu (ČIN).", "info-msg");
            } else {
                chase_mode = false;
                player_escape_counter = 0;
                this.style.background = "#000"; // Návrat do čiernej
                log("⚔️ Zrušil si pokus o útek. Pokračuješ v boji.", "info-msg");
            }

            // Prekreslíme UI, aby sa zmeny aplikovali (ak schovávas/meníš nejaké prvky)
            if (typeof updateUI === "function") updateUI();
        });

        // Table Input Management Engine (Updated to update stress immediately)
        document.getElementById("adrenaline-track-row").addEventListener("click", function(e) {
            if (inputs_frozen) return;
            
            const clickedCell = e.target.closest(".ad-node.ad-playable");
            if (!clickedCell) return; // Ignore if user clicks a locked/gray cell
            
            // Get the structural index position of the chosen node (which equals the new stress level)
            const targetStressVal = parseInt(clickedCell.getAttribute("data-idx"));
            const targetAdrenalineVal = clickedCell.getAttribute("data-val");
            
            if (HERO.stress < 4 && (targetStressVal === 5 || targetStressVal === 6 || targetStressVal === 7)) {
                log("Ten istý bonus môžeš získať aj lacnejšie.", "danger-msg");
                return;
            }
            if (HERO.stress > 3 && (targetStressVal > HERO.stress+1)) {
                log("To je nevýhodná voľba. Môžeš získať väčší bonus pri menšom zvýšení stresu.", "danger-msg");
                return;
            }

            // Clear prior selection highlights
            document.querySelectorAll(".ad-node").forEach(node => node.classList.remove("ad-selected"));
            
            const currentSelectedValue = document.getElementById("adrenaline-select").value;
            if (currentSelectedValue === targetAdrenalineVal && HERO.stress === targetStressVal) {
                // If they click the exact same node again, do nothing or let them click another
                return;
            } else {
                // 1. Immediately update the game state stress variable to this column's value
                HERO.stress = targetStressVal;
                
                // 2. Lock in the selected visual highlight state
                clickedCell.classList.add("ad-selected");
                
                // 3. Update hidden input tracker value for the dice rolling engine
                document.getElementById("adrenaline-select").value = targetAdrenalineVal;
                
                log(`Adrenalín použitý! Stres sa ti zvyšuje na ${HERO.stress} a získavaš +${targetAdrenalineVal} k ďalšiemu hodu.`);
                
                // 4. Force a UI refresh to immediately shift the red 'S' track indicator to the new position
                updateUI();
            }
        });

        function selectAdrenalineNode(clickedCell) {
            if (!clickedCell || !clickedCell.classList.contains("ad-playable")) return;

            const targetStressVal = parseInt(clickedCell.getAttribute("data-idx"), 10);
            const targetAdrenalineVal = clickedCell.getAttribute("data-val");

            // Tvoje pôvodné ochranné kontroly proti nevýhodným ťahom
            if (HERO.stress < 4 && (targetStressVal === 5 || targetStressVal === 6 || targetStressVal === 7)) {
                log("⚠️ Ten istý bonus môžeš získať aj lacnejšie.", "danger-msg");
                return;
            }
            if (HERO.stress > 3 && (targetStressVal > HERO.stress + 1)) {
                log("⚠️ To je nevýhodná voľba. Môžeš získať väčší bonus pri menšom zvýšení stresu.", "danger-msg");
                return;
            }

            const adrenalineSelectEl = document.getElementById("adrenaline-select");
            const currentSelectedValue = adrenalineSelectEl ? adrenalineSelectEl.value : null;

            if (currentSelectedValue === targetAdrenalineVal && HERO.stress === targetStressVal) {
                // Ak klikli/zvolili presne tú istú bunku, nerobíme nič
                return;
            }

            // Vyčistenie predchádzajúcich visual highlightov
            document.querySelectorAll(".ad-node").forEach(node => node.classList.remove("ad-selected"));

            // 1. Aktualizácia stavu hrdinu
            HERO.stress = targetStressVal;

            // 2. Vizuálne zvýraznenie zvolenej bunky
            clickedCell.classList.add("ad-selected");

            // 3. Zápis do skrytého selectu pre dice engine
            if (adrenalineSelectEl) {
                adrenalineSelectEl.value = targetAdrenalineVal;
            }

            log(`Adrenalín použitý! Stres sa ti zvyšuje na ${HERO.stress} a získavaš +${targetAdrenalineVal} k ďalšiemu hodu.`, "success-msg");

            // 4. Prekreslenie UI (posun červeného 'S' indikátora)
            updateUI();
        }

        function clearCardHoverHighlight() {
            touchHoverActive = false;
            touchPendingCardIdx = null;
            touchClickSuppressed = false;
            document.querySelectorAll("#card-tray-container .card-container").forEach(card => {
                card.classList.remove("keyboard-hover");
                card.children[0].classList.remove("keyboard-hover-zone");
                card.children[1].classList.remove("keyboard-hover-zone");
            });
        }

        function setCardHoverHighlight(idx) {
            touchHoverActive = true;
            touchPendingCardIdx = idx;
            currentSelectedCardIdx = idx;
            updateCardKeyboardHighlight();
        }

        function updateCardKeyboardHighlight() {
            // 1. Vyčistíme všetky staré klávesové zvýraznenia
            document.querySelectorAll("#card-tray-container .card-container").forEach(card => {
                card.classList.remove("keyboard-hover");
                card.children[0].classList.remove("keyboard-hover-zone");
                card.children[1].classList.remove("keyboard-hover-zone");
            });

            const cards = document.querySelectorAll("#card-tray-container .card-container");
            if (cards.length === 0) return;

            // Korekcia indexu, ak by bol mimo rozsah
            if (currentSelectedCardIdx >= cards.length) currentSelectedCardIdx = cards.length - 1;
            if (currentSelectedCardIdx < 0) currentSelectedCardIdx = 0;

            const activeCard = cards[currentSelectedCardIdx];

            // 2. Aktivujeme "hover" efekt (zväčšenie/otočenie) na vybranej karte
            activeCard.classList.add("keyboard-hover");

            // 3. Ak je konflikt, musíme navyše nasvietiť správnu polovicu (zónu)
            if (is_conflict || is_elimination_check) {
                const zone1 = activeCard.children[0];
                const zone2 = activeCard.children[1];

                // Vyhľadáme zónu, ktorej dátová akcia ("A" / "D") zodpovedá vybranému typu klávesnice
                if (zone1.getAttribute("data-action") === currentSelectedActionType) {
                    zone1.classList.add("keyboard-hover-zone");
                } else if (zone2.getAttribute("data-action") === currentSelectedActionType) {
                    zone2.classList.add("keyboard-hover-zone");
                }
            } 
        }

        function exportNreload(statusType){
            if (isProcessingQueue) {
                console.log("TEST: terminal still processing queue, waiting");
                setTimeout(() => exportNreload(statusType), 200);
                return;
            }
            const terminal = document.getElementById("terminal-screen");
            const logText = terminal ? terminal.innerText : "";
            const timestamp = new Date().toISOString();

            // statusType now comes from the caller, captured at the moment
            // the decision was actually made — no re-read of moving globals.

            const lines = logText.trim() ? logText.trim().split('\n') : [];

            const newRunEntry = {
                id: crypto.randomUUID ? crypto.randomUUID() : "run-" + Date.now(),
                timestamp: timestamp,
                status: statusType,
                logCount: lines.length,
                terminalOutput: logText

            };

            
            // 2. Retrieve existing data structure, safely parse, append, and serialize back
            let parsedLogs = [];
            try {
                const existingRaw = localStorage.getItem("test_runs_json_log");
                if (existingRaw) {
                    parsedLogs = JSON.parse(existingRaw);
                    if (!Array.isArray(parsedLogs)) parsedLogs = [];
                }
            } catch (e) {
                console.error("Failed parsing log structure cache, resetting list.", e);
                parsedLogs = [];
            }
            
            parsedLogs.push(newRunEntry);
            
            try {
                localStorage.setItem("test_runs_json_log", JSON.stringify(parsedLogs));
            } catch (storageError) {
                console.error("LocalStorage full! Clean your logs.", storageError);
            }

            // Restart the window/session immediately without trigger-blocking delays
            window.location.reload();
        }


        // --- Exploratory test-mode choice selection ---
        // Tracks the stable id (choice.target) of every choice the test bot has actually clicked, in order.
        let test_choice_history = [];

        // Score = 10 minus how many times this id appears in the last 10 history entries.
        // Never-seen (or rarely-seen) choices score highest, so the bot is pushed to explore.
        function getExploratoryScore(choiceId) {
            const recentWindow = test_choice_history.slice(-10);
            const occurrences = recentWindow.filter(id => id === choiceId).length;
            return 10 - occurrences;
        }

        function pickExploratoryIndex(choiceIds) {
            const scores = choiceIds.map(id => getExploratoryScore(id));
            const maxScore = Math.max(...scores);
            const tiedIndices = scores
                .map((score, idx) => ({ score, idx }))
                .filter(s => s.score === maxScore)
                .map(s => s.idx);

            if (tiedIndices.length === 1) return tiedIndices[0];

            // Independent random draw per tied candidate; highest draw wins.
            // This avoids any positional bias (first/last/alphabetical) that could create a loop.
            let winnerIdx = tiedIndices[0];
            let winnerDraw = Math.random();
            for (let i = 1; i < tiedIndices.length; i++) {
                const draw = Math.random();
                if (draw > winnerDraw) {
                    winnerDraw = draw;
                    winnerIdx = tiedIndices[i];
                }
            }
            return winnerIdx;
        }

        function recordExploratoryChoice(choiceId) {
            test_choice_history.push(choiceId);
            // Only the last 10 entries ever matter for scoring, but keep a bigger trailing
            // buffer around so the array doesn't get reallocated/trimmed on every single push.
            if (test_choice_history.length > 300) {
                test_choice_history = test_choice_history.slice(-300);
            }
        }

        function test() {
            if (!keep_testing) {
                return;
            }
            if (isProcessingQueue) {
                console.log("TEST: terminal still processing queue, waiting");
                setTimeout(test, 300);
                return;
            }

            if (typeof is_conflict !== 'undefined' && is_conflict && !enemy) {
                console.log("TEST: combat state unstable (is_conflict=true but enemy=null), waiting for stabilization");
                setTimeout(test, 400); 
                return;
            }

            if (current_challenge_key.includes("GAME")) {
                setTimeout(() => exportNreload("GAME OVER"), 200);
                return;
            }
            if (HERO.stress > 8) {
                setTimeout(() => exportNreload("DEAD"), 200);
                return;
            }
            if (stuck_counter > 20) {
                setTimeout(() => exportNreload("STUCK"), 700);
            }


            if (prev_challenge !== current_challenge_key) {
                prev_challenge = current_challenge_key;
                stuck_counter = 0;
            } else if (!is_conflict) {
                stuck_counter += 1;
            }

            if (stuck_counter > 20) {
                log("STUCK");
                setTimeout(test, 2000);
                if (stuck_counter > 30) keep_testing = false;
                return;
            }

            const proceedPrompt = document.getElementById("proceed-prompt");
            const isProceedVisible = proceedPrompt && window.getComputedStyle(proceedPrompt).display !== "none";
            const choicePrompt = document.getElementById("choice-prompt");
            const isChoiceVisible = choicePrompt && window.getComputedStyle(choicePrompt).display !== "none";
            const overlayVisible = document.getElementById('hero-selection-overlay');
            const generalPrompt = document.getElementById('general-prompt');
            const isGeneralVisible = generalPrompt && window.getComputedStyle(generalPrompt).display !== "none";

            // If a general prompt is visible, press its confirm button and retry
            if (isGeneralVisible) {
                document.getElementById('gp-confirm-btn')?.click();
                log('TEST: general prompt visible - pressing confirm');
                setTimeout(test, 100);
                return;
            }

            if (overlayVisible) {
                console.log("TEST: waiting for hero selection overlay to close");
                setTimeout(test, 100);
                return;
            }

            if (isProceedVisible) {
                const proceedBtn = document.getElementById('proceed-btn');
                if (proceedBtn) {
                    proceedBtn.click();
                    setTimeout(test, 200);
                    return;
                }
            }

            else if (isChoiceVisible) {
                const buttons = choicePrompt.querySelectorAll(".adrenaline-select");
                if (buttons.length > 0) {
                    // Prefer the real choice.target as the stable id (set when the prompt was built),
                    // falling back to button text if userData isn't present for some reason.
                    const validChoices = choicePrompt.userData && choicePrompt.userData.validChoices;
                    const choiceIds = Array.from(buttons).map((btn, i) => {
                        if (validChoices && validChoices[i] && validChoices[i].target !== undefined) {
                            return JSON.stringify(validChoices[i].target);
                        }
                        return btn.innerText;
                    });

                    const selectedIndex = pickExploratoryIndex(choiceIds);
                    const selectedButton = buttons[selectedIndex];
                    const buttonText = selectedButton ? selectedButton.innerText : "<none>";
                    if (selectedButton) {
                        const scoreAtPick = getExploratoryScore(choiceIds[selectedIndex]);
                        selectedButton.click();
                        recordExploratoryChoice(choiceIds[selectedIndex]);
                        log(`TEST: selecting choice ${selectedIndex + 1} (score ${scoreAtPick}): ${buttonText}`);
                        setTimeout(test, 200);
                        return;
                    }
                } else {
                    log("TEST: choice prompt visible but no buttons found");
                }
            }

            else if (!inputs_frozen) {
                const cards = Array.from(document.querySelectorAll("#card-tray-container .card-container"));
                skill = 4;
                if (cards.length > 0) {
                    let targetCard = cards.find(card => card.getAttribute("data-card") === "S");
                    if (!targetCard) {
                        targetCard = cards[0];
                    }

                    const cardIdx = cards.indexOf(targetCard);
                    if (cardIdx >= 0) {
                        currentSelectedCardIdx = cardIdx;
                    }

                    if (is_conflict || is_elimination_check) {
                        if (is_collapse_check) {
                            // During collapse-check, only click once to resolve; then wait for engine to finish
                            if (collapse_action_done) {
                                console.log('TEST: collapse action already sent, waiting for resolution');
                                setTimeout(test, 200);
                                return;
                            }
                            collapse_action_done = true;
                            const zoneD = targetCard.querySelector('[data-action="D"]');
                            log(`TEST: collapse-check active, selecting zone D for card ${targetCard.getAttribute("data-card") || "?"}`);
                            if (zoneD) {
                                zoneD.click();
                            } else {
                                targetCard.click();
                            }
                        } else if (enemy_escape_counter > 0 || conflict_distance > 0) {
                            const zoneD = targetCard.querySelector('[data-action="D"]');
                            if (zoneD) {
                                zoneD.click();
                            } else {
                                targetCard.click();
                            }
                            log(`TEST: chasing, card ${targetCard.getAttribute("data-card") || "?"}, zone D`);
                        } else {
                            const zoneA = targetCard.querySelector('[data-action="A"]');
                            console.log(`TEST: conflict mode, selecting card ${targetCard.getAttribute("data-card") || "?"} and zone A`);
                            if (zoneA) {
                                zoneA.click();
                            } else {
                                targetCard.click();
                            }
                        }
                    } else {
                        console.log(`TEST: selecting card ${targetCard.getAttribute("data-card") || "?"}`);
                        targetCard.click();
                    }

                    setTimeout(test, 200);
                    return;
                }
            }

            console.log("TEST: no visible prompts or cards to act on, retrying");
            setTimeout(test, 200);
        }

        // Table Input Management Engine (Zjednodušený cez zdieľanú funkciu)
        document.getElementById("adrenaline-track-row").addEventListener("click", function(e) {
            if (inputs_frozen) return;
            
            const clickedCell = e.target.closest(".ad-node.ad-playable");
            if (!clickedCell) return; // Ignorujeme kliknutia mimo hrateľných buniek
            
            selectAdrenalineNode(clickedCell);
        });


        document.getElementById("player-weapon-dropdown").addEventListener("change", function(e) {
            const selectedWeaponName = e.target.value;
            if (!is_conflict && !is_elimination_check) {
                log("Teraz nepotrebuješ zbraň.", "system-msg");
                return
            }
            if (!selectedWeaponName || selectedWeaponName === "placeholder") {
                log("👊  👊 Bojuješ holými rukami (INTENZITA: 0).", "system-msg");
                return;
            }
            log(`Zbraň: ${selectedWeaponName.toUpperCase()} (INTENZITA: ${weapon})`, "success-msg");
        });

        // Keď používateľ hýbe myšou nad tray kontajnerom, zapneme mouse-active režim, ktorý schová klávesnicový hover
        document.getElementById("card-tray-container").addEventListener("mousemove", function() {
            this.classList.add("mouse-active");
        });



        let storageTimeout;

        window.addEventListener('storage', function(e) {
            if (e.key === 'characters') {
                clearTimeout(storageTimeout);

                storageTimeout = setTimeout(() => {
                    try {
                        const savedCharacters = JSON.parse(e.newValue);
                        if (!savedCharacters || savedCharacters.length === 0) return;

                        console.log('🔄 Spracovávam zmeny postáv na pozadí (Debounced)...');

                        const builderHeroes = savedCharacters.map(char => ({
                            name: char.name.toUpperCase(),
                            sp: char.sp || 0,
                            skills: char.skills || {},
                            weapons: char.weapons !== undefined ? [...char.weapons] : (char.defaultWeapons ? [...char.defaultWeapons] : []),
                            ammo: char.ammo !== undefined ? {...char.ammo} : (char.defaultAmmo ? {...char.defaultAmmo} : {}),
                            items: char.items !== undefined ? {...char.items} : (char.defaultItems ? {...char.defaultItems} : {}),
                            stress_thresh: 8,
                            stress: char.stress !== undefined ? char.stress : 0,
                            weapon: 0,
                            isInitialPhase: char.isInitialPhase !== undefined ? char.isInitialPhase : false,
                            defaultWeapons: char.defaultWeapons || [],
                            defaultAmmo:    char.defaultAmmo    || {},
                            defaultItems:   char.defaultItems   || {}
                        }));

                        if (typeof stockHeroesData !== 'undefined') {
                            HEROES = [...builderHeroes, ...stockHeroesData];
                        } else {
                            HEROES = builderHeroes;
                        }

                        if (typeof HERO !== 'undefined' && HERO.name) {
                            const updatedCurrentHero = savedCharacters.find(char => char.name.toUpperCase() === HERO.name.toUpperCase());
                            if (updatedCurrentHero) {
                                HERO.skills = updatedCurrentHero.skills || {};
                                HERO.sp = updatedCurrentHero.sp || 0;
                                HERO.isInitialPhase = updatedCurrentHero.isInitialPhase !== undefined ? updatedCurrentHero.isInitialPhase : false;
                                
                                // SAFE MUTATION PATCH: Ensure active equipment data syncs forward safely too!
                                if (updatedCurrentHero.weapons) HERO.weapons = [...updatedCurrentHero.weapons];
                                if (updatedCurrentHero.ammo) HERO.ammo = {...updatedCurrentHero.ammo};
                                if (updatedCurrentHero.items) HERO.items = {...updatedCurrentHero.items};

                                if (typeof HEROES !== 'undefined' && HEROES[activeCharIdx]) {
                                    HEROES[activeCharIdx].isInitialPhase = HERO.isInitialPhase;
                                }
                            }
                        }

                        // CRITICAL LAYOUT SHIELD: 
                        // Only run a full UI layout update if the game controls are NOT frozen,
                        // and the terminal engine is not processing text transitions right now!
                        if (typeof updateUI === 'function' && !inputs_frozen && !isProcessingQueue) {
                            updateUI();
                        }

                    } catch (error) {
                        console.error('Chyba pri spracovaní zmeny characters:', error);
                    }
                }, 250); 
            }
        });


    function setRealViewportVars() {
        const root = document.documentElement;
        root.style.setProperty('--real-vw', window.innerWidth + 'px');
        root.style.setProperty('--real-vh', window.innerHeight + 'px');
    } 

        Promise.all([
            fetch('./CHALLENGES.json').then(response => {
                if (!response.ok) throw new Error('Nepodarilo sa načítať súbor CHALLENGES.json');
                return response.json();
            }),
            fetch('./ENEMY_TYPES.json').then(response => {
                if (!response.ok) throw new Error('Nepodarilo sa načítať súbor ENEMY_TYPES.json');
                return response.json();
            }),
            fetch('./HEROES.json').then(response => {
                if (!response.ok) throw new Error('Nepodarilo sa načítať súbor HEROES.json');
                return response.json();
            }),
            // NAČÍTANIE SKILLS DB Z ROOTOVÉHO PRIEČINKA:
            fetch('./skillsDB.json').then(response => {
                if (!response.ok) throw new Error('Nepodarilo sa načítať súbor skillsDB.json');
                return response.json();
            }),
            fetch('./SETTINGS.json').then(response => {
                if (!response.ok) throw new Error('Nepodarilo sa načítať súbor SETTINGS.json');
                return response.json();
            })
        ])
        .then(([challengesData, enemyTypesData, heroesData, skillsDbData, settingsData]) => {
            CHALLENGES = challengesData;
            ENEMY_TYPES = enemyTypesData;
            SKILLS_DB = skillsDbData;
            stockHeroesData = heroesData;
            window.SKILLS_DB = skillsDbData;
            defaultSettings = settingsData;

            // --- SETTINGS LOADING LOGIC ---
            const localSettings = localStorage.getItem('SETTINGS');
            if (localSettings) {
                try {
                    SETTINGS = JSON.parse(localSettings);
                } catch (e) {
                    console.error("Chyba pri parsovaní SETTINGS z localStorage, nahrávam záložné nastavenia:", e);
                    if (settingsData) SETTINGS = settingsData;
                }
            } else if (settingsData) {
                SETTINGS = settingsData;
            }


            const savedCharacters = JSON.parse(localStorage.getItem('characters')) || [];
            const savedNames = new Set(savedCharacters.map(c => c.name.toUpperCase()));

            // Only add stock heroes whose names aren't already in localStorage
            const newStockHeroes = heroesData
                .filter(h => !savedNames.has(h.name.toUpperCase()))
                .map(h => ({
                    name: h.name,
                    sp: h.sp !== undefined ? h.sp : 40,
                    skills: h.skills || {},
                    weapons: h.defaultWeapons || h.weapons || [],
                    ammo: h.defaultAmmo || h.ammo || {},
                    stress_thresh: h.stress_thresh || 8,
                    stress: 0,
                    items: h.defaultItems || h.items || {},
                    weapon: 0,
                    isInitialPhase: h.isInitialPhase !== undefined ? h.isInitialPhase : false,
                    humanity: h.humanity || 50,
                    initialSkillsSnapshot: h.initialSkillsSnapshot || {},
                    defaultWeapons: h.defaultWeapons || h.weapons || [],
                    defaultAmmo:    h.defaultAmmo    || h.ammo    || {},
                    defaultItems:   h.defaultItems   || h.items   || {}
                }));

            if (newStockHeroes.length > 0) {
                const merged = [...savedCharacters, ...newStockHeroes];
                localStorage.setItem('characters', JSON.stringify(merged));
                HEROES = merged.map(char => ({
                    name: char.name.toUpperCase(),
                    sp: char.sp !== undefined ? char.sp : 40,
                    skills: char.skills || {},
                    weapons: char.defaultWeapons ? [...char.defaultWeapons] : [],
                    ammo:    char.defaultAmmo    ? {...char.defaultAmmo}    : {},
                    items:   char.defaultItems   ? {...char.defaultItems}   : {},                    
                    stress_thresh: char.stress_thresh || 8,
                    stress: 0,
                    weapon: 0,
                    isInitialPhase: char.isInitialPhase !== undefined ? char.isInitialPhase : false,
                    humanity: char.humanity || 50,
                    initialSkillsSnapshot: char.initialSkillsSnapshot || {},
                    defaultWeapons: char.defaultWeapons || [],
                    defaultAmmo:    char.defaultAmmo    || {},
                    defaultItems:   char.defaultItems   || {}
                }));
            } else {
                HEROES = savedCharacters.map(char => ({
                    name: char.name.toUpperCase(),
                    sp: char.sp !== undefined ? char.sp : 40,
                    skills: char.skills || {},
                    weapons: char.defaultWeapons ? [...char.defaultWeapons] : [],
                    ammo:    char.defaultAmmo    ? {...char.defaultAmmo}    : {},
                    items:   char.defaultItems   ? {...char.defaultItems}   : {},                    
                    stress: 0,
                    stress_thresh: char.stress_thresh || 8,
                    weapon: 0,
                    isInitialPhase: char.isInitialPhase !== undefined ? char.isInitialPhase : false,
                    humanity: char.humanity || 50,
                    initialSkillsSnapshot: char.initialSkillsSnapshot || {},
                    defaultWeapons: char.defaultWeapons ? [...char.defaultWeapons] : [],
                    defaultAmmo:    char.defaultAmmo    ? {...char.defaultAmmo}    : {},
                    defaultItems:   char.defaultItems   ? {...char.defaultItems}   : {}
                }));
            }
            if (test_mode){
                current_challenge_key = debug_start;
                welcome = false;
                selectHero();
                return;
            } else {
                handleChallengeTransition(current_challenge_key);
            }
        })
        .catch(error => {
            console.error("Chyba pri inicializácii hry:", error);
        });

function showTooltip(event) {
    console.log('showTooltip called', event.currentTarget);
    let tooltip = document.querySelector('.tooltip');
    if (!tooltip) {
        console.log('Creating tooltip');
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        document.body.appendChild(tooltip);
    }
    const desc = event.currentTarget.getAttribute('data-tooltip');
    console.log('Tooltip description:', desc);
    if (desc && tooltip) {
        tooltip.textContent = desc;
        tooltip.classList.add('visible');
        console.log('Tooltip visible, text:', desc);
    }
}

function moveTooltip(event) {
    const tooltip = document.querySelector('.tooltip');
    if (tooltip && tooltip.classList.contains('visible')) {
        let posX = event.clientX + 15;
        let posY = event.clientY - 15;
        
        if (posX + tooltip.offsetWidth > window.innerWidth) {
            posX = event.clientX - tooltip.offsetWidth - 15;
        }
        if (posY + tooltip.offsetHeight > window.innerHeight) {
            posY = event.clientY - tooltip.offsetHeight - 15;
        }
        
        tooltip.style.left = posX + 'px';
        tooltip.style.top = posY + 'px';
    }
}

function hideTooltip() {
    const tooltip = document.querySelector('.tooltip');
    if (tooltip) {
        tooltip.classList.remove('visible');
    }
}

function initTooltips() {
    let tooltip = document.querySelector('.tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        document.body.appendChild(tooltip);
    }

    document.body.addEventListener('mouseover', (event) => {
        const target = event.target.closest('[data-tooltip]');
        if (!target) return;

        const description = target.getAttribute('data-tooltip');
        if (!description || description.trim() === "") return;

        tooltip.textContent = description;
        tooltip.classList.add('visible');
    }, true); // true = capture phase

    document.body.addEventListener('mousemove', (event) => {
        if (!tooltip.classList.contains('visible')) return;

        const offsetX = 15;
        const offsetY = -15;

        let posX = event.clientX + offsetX;
        let posY = event.clientY + offsetY;

        if (posX + tooltip.offsetWidth > window.innerWidth) {
            posX = event.clientX - tooltip.offsetWidth - offsetX;
        }
        if (posY + tooltip.offsetHeight > window.innerHeight) {
            posY = event.clientY - tooltip.offsetHeight - offsetY;
        }

        tooltip.style.left = `${posX}px`;
        tooltip.style.top = `${posY}px`;
    }, true); // true = capture phase

    document.body.addEventListener('mouseout', (event) => {
        const target = event.target.closest('[data-tooltip]');
        if (!target) return;

        tooltip.classList.remove('visible');
    }, true); // true = capture phase
}

document.addEventListener('DOMContentLoaded', () => {
    initTooltips();
});