        let CHALLENGES = {};

        const CARDS = {
            "O": [[3, [10]], [1, [10, 4]]],
            "R": [[1, [12]], [2, [12]]],
            "S": [[0, [10, 4]], [3, [10]]],
            "B": [[-1, [10, 6]], [4, [8]]],
        };

        const HERO = {
            "skills": { "climb": 3, "sneak": 1 }, // Added example alternative skill for testing
            "stress_thresh": 8,
            "weapon": 1
        };

        const DELAYED = [];

        const ENEMY_TYPES = {
            "Skautka": {
                "skill": 2,
                "stress_thresh": 5,
                "weapon": 1,
                "image": "assets/SCOUT.png"
            },
            "Predátorka": {
                "skill": 3,
                "stress_thresh": 5,
                "weapon": 2,
                "image": "assets/PREDATOR.png"
            }
        };


        // --- Core Engine Architecture Variables ---
        let current_challenge_key = "START"; 
        let player_turn_timeout = null; // Sledovanie visiaceho časovača hlášky
        let pending_challenge_key = null;   
        let proceed_target = null; 
        let enemy = null;
        let enemy_id = null;
        let enemy_stress = 0;
        let enemy_escaping = false;
        let turn = "p";
        let round = 0;
        let move = 0;
        let weapon = 1;
        let stress = 0;
        const stress_thresh = 8;
        let skill = 3;
        let advantage = 0;
        let enemy_advantage = 0;
        let cards_are_flipped = false; 
        
        let player_action = null; 
        let enemy_action = null;  
        
        let is_conflict = false; 
        let current_challenge = { difficulty: 7, threat: 2 };
        let inputs_frozen = false;
        let combat_starter = null;

        function log(message, className = "", extraSpacing = false) {
            const terminal = document.getElementById("terminal-screen");
            const line = document.createElement("div");
            
            // Append the spacing class if extraSpacing is true
            line.className = `terminal-line ${className} ${extraSpacing ? 'spacing-top-4' : ''}`.trim();
            line.innerText = message;
            
            terminal.appendChild(line);
            terminal.scrollTop = terminal.scrollHeight;
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
                        
            dice_list.forEach(d => {
                let r = Math.floor(Math.random() * d) + 1;
                total_roll += r;
                //log(`  D${d}: ${r}`);
                rollsData.push({ type: `D${d}`, value: r, isSkillDie: false });
            });
            
            for (let i = 0; i < skillLevel; i++) {
                let r = Math.floor(Math.random() * 2); 
                total_roll += r;
                //log(`  DH: ${r}`);
                rollsData.push({ type: 'DH', value: r, isSkillDie: true });
            }
            
            // Forward identity check state down to display pipeline layer
            triggerDiceVisualAnimation(rollsData, isEnemy);
            
            return total_roll;
        }

        function restartGame() {
            // Zobrazíme pripravený HTML panel pre reštart
            const prompt = document.getElementById("restart-prompt");
            if (prompt) {
                prompt.style.display = "flex";
            }
        }

        // --- Event Listener pre tlačidlo "ÁNO" ---
        document.getElementById("restart-confirm-btn").addEventListener("click", function() {
            document.getElementById("restart-prompt").style.display = "none";
            log("🔄 Reštartujem hru...", "danger-msg", true);
            
            inputs_frozen = true;
            updateUI();
            
            // Okamžité vyčistenie a znovunačítanie pôvodného stavu hry
            window.location.reload();
        });

        // --- Event Listener pre tlačidlo "NIE" ---
        document.getElementById("restart-cancel-btn").addEventListener("click", function() {
            // Panel iba skryjeme a hráč pokračuje tam, kde prestal
            document.getElementById("restart-prompt").style.display = "none";
        });

        function handleChallengeTransition(caseTarget) {
            if (!caseTarget) return;

            if (typeof caseTarget === 'string' && caseTarget.toLowerCase().trim() === 'restart') {
                restartGame();
                return;
            }

            let actualTarget = caseTarget;
            let instanceKey = typeof caseTarget === 'string' ? caseTarget : null;

            // Kontrola pre pole (Array) - ak obsahuje odkaz na inštanciu nepriateľa
            if (Array.isArray(caseTarget)) {
                for (let i = 0; i < caseTarget.length; i++) {
                    const target = caseTarget[i];
                    
                    // Pozrieme sa, či target existuje v CHALLENGES a definuje špecifický "type" nepriateľa
                    if (typeof target === 'string' && CHALLENGES[target] && CHALLENGES[target].type) {
                        const enemyType = CHALLENGES[target].type;
                        if (enemyType in ENEMY_TYPES) {
                            const remainder = caseTarget.slice(i + 1);
                            if (remainder.length > 0) {
                                pending_challenge_key = remainder.length === 1 ? remainder[0] : remainder;
                            }
                            
                            handleChallengeTransition(target);
                            break; 
                        }
                    } 
                    // Pôvodný fallback pre prípad, že v poli je priamo natvrdo napísané napr. "Skautka"
                    else if (target in ENEMY_TYPES) {
                        const remainder = caseTarget.slice(i + 1);
                        if (remainder.length > 0) {
                            pending_challenge_key = remainder.length === 1 ? remainder[0] : remainder;
                        }
                        
                        handleChallengeTransition(target);
                        break; 
                    } else {
                        handleChallengeTransition(target);
                    }
                }
                return; 
            }

            // Ak je target v CHALLENGES a má definovaný "type", presmerujeme ho na daného nepriateľa
            if (typeof actualTarget === 'string' && CHALLENGES[actualTarget] && CHALLENGES[actualTarget].type) {
                const enemyType = CHALLENGES[actualTarget].type;
                if (enemyType in ENEMY_TYPES) {
                    instanceKey = actualTarget; // "Skautka_2"
                    actualTarget = enemyType;   // "Skautka"
                }
            }

            // 1. If target dictates an explicit Enemy Combat deployment
            if (actualTarget in ENEMY_TYPES) { 
                
                inputs_frozen = true;
                updateUI();

                setTimeout(() => {
                // Hráč uvidí čistý názov z ENEMY_TYPES (Skautka)
                log(`\n⚔️ Priprav sa na boj! Proti tebe stojí: ${actualTarget}`, "danger-msg", true);
                document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());

                    // ZMENA: Rozdelenie na čistý typ (enemy) a unikátne ID (enemy_id)
                    enemy = actualTarget; 
                    enemy_id = instanceKey ? instanceKey : actualTarget; 
                    
                    enemy_stress = 0;
                    enemy_escaping = false;
                    is_conflict = true;
                    move = 0;
                    combat_starter = null;
                    inputs_frozen = false;

                    // --- Display Enemy Image ---
                    const enemyContainer = document.getElementById("enemy-sprite-container");
                    const enemyImg = document.getElementById("enemy-sprite");
                    if (enemyContainer && enemyImg && ENEMY_TYPES[actualTarget].image) { 
                        enemyImg.src = ENEMY_TYPES[actualTarget].image; 
                        enemyContainer.style.display = "block"; 
                        
                        // Remove old classes and force animation reflow
                        enemyContainer.classList.remove("enemy-entrance", "enemy-hit");
                        void enemyContainer.offsetWidth; 
                        enemyContainer.classList.add("enemy-entrance");
                    }
                    // ---------------------------------

                    gameloop(false);
                }, 200); // 4-second reading delay
                return;
            }

            // 2. If target moves the user forward to another challenge map node
            if (actualTarget in CHALLENGES) { 
                current_challenge_key = actualTarget; 
                runActionPhase();

                if (current_challenge_key !== actualTarget) {
                    return; 
                }
                
                const activeChallenge = CHALLENGES[actualTarget];

                 if (activeChallenge && activeChallenge.next) {
                        proceed(activeChallenge.next);
                        return; 
                    }
                
                // --- Narrative Decision Nodes (Dynamické spracovanie 1 až 5 možností) ---
                const suffixes = ['A', 'B', 'C', 'D', 'E'];
                let validChoices = [];

                // Prejdeme zoznam a zistíme, ktoré voľby reálne existujú v JSON objekte
                suffixes.forEach(suff => {
                    if (activeChallenge[`choice_${suff}`] && activeChallenge[`case_${suff}`]) {
                        validChoices.push({
                            text: activeChallenge[`choice_${suff}`],
                            target: activeChallenge[`case_${suff}`]
                        });
                    }
                });

                if (validChoices.length > 0) {
                    inputs_frozen = true; 
                    document.getElementById("player-turn-indicator").innerText = "VYBER SI MOŽNOSŤ";
                    
                    let choicePrompt = document.getElementById("choice-prompt");
                    if (!choicePrompt) {
                        choicePrompt = document.createElement("div");
                        choicePrompt.id = "choice-prompt";
                        choicePrompt.style.cssText = `
                            position: absolute;
                            bottom: 2%;
                            right: 5%;
                            padding: 20px;
                            display: flex;
                            flex-direction: row;
                            flex-wrap: wrap;
                            justify-content: center;
                            gap: 12px;
                            z-index: 200;
                            width: 100%;
                            max-width: 650px;
                        `;
                        document.querySelector(".gaming-table-floor").appendChild(choicePrompt);
                    }

                    // Vyčistíme staré tlačidlá a nastavíme flex-direction podľa počtu možností
                    choicePrompt.innerHTML = "";
                    if (validChoices.length > 2) {
                        choicePrompt.style.flexDirection = "column"; // Ak je možností veľa, dáme ich pod seba
                    } else {
                        choicePrompt.style.flexDirection = "row";
                    }

                    // Dynamicky vygenerujeme tlačidlá pre všetky nájdené možnosti
                    validChoices.forEach((choice, index) => {
                        const btn = document.createElement("button");
                        btn.className = "adrenaline-select";
                        btn.style.cssText = "width: 100%; white-space: normal; padding: 12px; height: auto;";
                        btn.innerText = choice.text;
                        
                        btn.onclick = () => {
                            choicePrompt.style.display = "none";
                            handleChallengeTransition(choice.target);
                        };
                        
                        choicePrompt.appendChild(btn);
                    });

                    choicePrompt.style.display = "flex";
                }
                return;
            }

            // 3. If target string contains stat modifications (e.g. additions or assignments)
            if (typeof caseTarget === 'string') {
                const lowerTarget = caseTarget.toLowerCase();
                let modificationExecuted = false;

                // --- Handle assignment/reset rules using '=' ---
                if (lowerTarget.includes("=")) {
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

                // --- Handle incremental modifications using '+' or '-' ---
                if (lowerTarget.includes("+") || lowerTarget.includes("-")) {
                    const isAddition = lowerTarget.includes("+");
                    const parts = isAddition ? caseTarget.split("+") : caseTarget.split("-");
                    const amount = parts[1] ? parseInt(parts[1]) : 1;
                    const modifier = isAddition ? amount : -amount; 

                    if (lowerTarget.includes("stress")) {
                        stress += modifier;
                        if (stress < 0) stress = 0; 
                        
                        if (modifier > 0) {
                            log(`Stúpol ti stres o ${amount}!`, "danger-msg");
                        } else {
                            log(`Stres ti klesol o ${amount}.`, "success-msg");
                        }
                        
                        if (stress > stress_thresh) {
                            log("💀 Stres presiahol hodnotu kolapsu. KONIEC HRY.", "failure-msg", true);
                            restartGame();
                            return;
                        }
                        modificationExecuted = true;
                    }
                    else if (lowerTarget.includes("enemy_advantage")) {
                        enemy_advantage += modifier;
                        if (enemy_advantage < 0) enemy_advantage = 0; 
                        
                        if (modifier > 0) {
                            log(`Nepriateľ získava výhodu +${amount}!`, "danger-msg");
                        } else {
                            log(`Nepriateľovi klesla výhoda o ${amount}.`);
                        }
                        modificationExecuted = true;
                    }
                    else if (lowerTarget.includes("advantage")) {
                        advantage += modifier;
                        if (advantage < 0) advantage = 0; 
                        
                        if (modifier > 0) {
                            log(`Získavaš výhodu +${amount}!`);
                        } else {
                            log(`Klesla ti výhoda o ${amount}.`, "danger-msg");
                        }
                        modificationExecuted = true;
                    }
                    else if (lowerTarget.includes("difficulty")) {
                        current_challenge.difficulty += modifier;
                        if (current_challenge.difficulty < 0) current_challenge.difficulty = 0; 
                        
                        if (modifier > 0) {
                            log(`Náročnosť výzvy sa zvyšuje o ${amount}!`);
                        } else {
                            log(`Náročnosť výzvy klesá o ${amount}.`, "success-msg");
                        }
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
                }

                if (modificationExecuted) {
                    updateUI();
                    const activeChallenge = CHALLENGES[current_challenge_key];
                    
                    if (activeChallenge) {
                        if (activeChallenge.case_failure) {
                            handleChallengeTransition(activeChallenge.case_failure);
                        } else {
                            inputs_frozen = false;
                            updateUI();
                        }
                    }
                    return;
                }
            }

            log(`Warning: Unhandled routing instruction case reference '${caseTarget}'`, "danger-msg", true);
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

        function runActionPhase() {
            enemy = null;
            is_conflict = false;
            player_action = null;
            enemy_action = null;
            move = 0;
            hidecards(player = true);

            const enemyContainer = document.getElementById("enemy-sprite-container");
            if (enemyContainer) {
                enemyContainer.style.display = "none";
                enemyContainer.classList.remove("enemy-entrance", "enemy-hit");
            }

            const tableFloor = document.querySelector('.gaming-table-floor');
            if (tableFloor) {
                const enemyPool = tableFloor.querySelector('.dice-animation-pool.enemy-pool');
                if (enemyPool) enemyPool.remove();
            }

            const activeChallenge = CHALLENGES[current_challenge_key];
            current_challenge.difficulty = activeChallenge.difficulty;
            current_challenge.threat = activeChallenge.threat;

        // --- UPDATED: Pass image asset straight to the CSS variable ---
            if (tableFloor) {
                if (activeChallenge.image) {
                    // Feeds the dynamic image straight into our dark tinted layer engine
                    tableFloor.style.setProperty('--bg-image', `url('${activeChallenge.image}')`);
                } else {
                    // Safely strips the overlay out entirely if no asset exists
                    tableFloor.style.removeProperty('--bg-image');
                }
            }
            // -------------------------------------------------------------

            // --- NEW: Check for and execute matched delayed triggers ---
            if (activeChallenge.trigger_delayed && Array.isArray(activeChallenge.trigger_delayed)) {
                for (const effect of activeChallenge.trigger_delayed) {
                    const delayedIndex = DELAYED.indexOf(effect);
                    if (delayedIndex !== -1) {
                        // Remove from delayed registry instantly
                        DELAYED.splice(delayedIndex, 1);
                        
                        // Redirect engine to the delayed event / adjustment
                        handleChallengeTransition(effect);
                        
                        // FIX: Only halt if it was a full node transition detour!
                        // If it's a stat modification string (like "enemy_advantage+1"), 
                        // let the function continue initializing this challenge's text and choices.
                        if (!effect.includes("+")) {
                            return; 
                        }
                    }
                }
            }

            let highestSkillValueFound = 0;
            if (activeChallenge.skills && activeChallenge.skills.length > 0) {
                activeChallenge.skills.forEach(s => {
                    let characterSkillLevel = HERO.skills[s] || 0;
                    if (characterSkillLevel > highestSkillValueFound) {
                        highestSkillValueFound = characterSkillLevel;
                    }
                });
            }
            skill = highestSkillValueFound;
            document.getElementById("player-skill").innerText = skill;
            
            const challengeDisplay = document.getElementById("challenge-stats-display");
            if (challengeDisplay) {
                if (activeChallenge.difficulty !== undefined && activeChallenge.threat !== undefined) {
                    challengeDisplay.style.display = "flex";
                    challengeDisplay.innerHTML = `
                        <div class="stat-item"><img src="assets/DIFFICULTY.png" class="stat-icon"> <span>${current_challenge.difficulty}</span></div>
                        <div class="stat-item"><img src="assets/THREAT.png" class="stat-icon"> <span>${current_challenge.threat}</span></div>
                    `;
                } else {
                    challengeDisplay.style.display = "none";
                }
            }

            if (activeChallenge.initial_msg) {
                log(activeChallenge.initial_msg, "system-msg", true);
            } else {
                log(`${current_challenge_key}`, "system-msg");
            }
            
            // --- UPDATED: Conditionally log difficulty and threat to the terminal ---
            if (activeChallenge.difficulty !== undefined && activeChallenge.threat !== undefined) {
                log(`NÁROČNOSŤ: ${current_challenge.difficulty}  |  HROZBA: ${current_challenge.threat}`);
            }
            
            inputs_frozen = false;
            updateUI();
        }

        function updateUI() {
            document.getElementById("player-advantage").innerText = advantage;
            
            const tray = document.getElementById("card-tray-container");
            const enemyHeading = document.getElementById("enemy-heading-type");
            const challengeDisplay = document.getElementById("challenge-stats-display");
            const tableFloor = document.querySelector('.gaming-table-floor'); // Target the table floor

            // Stress, Adrenaline //
            document.querySelectorAll(".track-cell").forEach(cell => {
                cell.classList.remove("active-stress", "filled-stress", "ad-playable", "ad-locked");
            });

            // Loop through all stress nodes and color them based on current stress
            document.querySelectorAll(".stress-node").forEach(cell => {
                const val = parseInt(cell.getAttribute("data-val"));
                if (val <= stress) {
                    if (val === stress) {
                        cell.classList.add("active-stress"); // The leading edge (pops out)
                    } else {
                        cell.classList.add("filled-stress"); // The trailing edge (stays red)
                    }
                }
            });

            document.querySelectorAll(".ad-node").forEach(cell => {
                const idx = parseInt(cell.getAttribute("data-idx"));
                if (idx > stress) {
                    cell.classList.add("ad-playable");
                } else {
                    cell.classList.add("ad-locked");
                }
            });

            // Clean Display-Driven Enemy Render States
            if (enemy === null) {
                is_conflict = false;
                document.getElementById("enemy-panel").style.display = "none";
                tray.className = "card-tray challenge-mode";
                
                // Remove the dark tint overlay during normal challenges
                if (tableFloor) tableFloor.classList.remove("combat-mode");
                
                // Show challenge stats when not in conflict
                if (challengeDisplay) {
                    const activeChallenge = CHALLENGES[current_challenge_key];
                    if (activeChallenge && activeChallenge.difficulty !== undefined && activeChallenge.threat !== undefined) {
                        challengeDisplay.style.display = "flex";
                    } else {
                        challengeDisplay.style.display = "none";
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
                
                // Add the dark tint overlay during combat encounters
                if (tableFloor) tableFloor.classList.add("combat-mode");
                
                // Hide challenge stats during conflict
                if (challengeDisplay) challengeDisplay.style.display = "none";
                
                if (enemyHeading) enemyHeading.innerText = enemy;
            }

            if (inputs_frozen) {
                document.getElementById("player-turn-indicator").innerText = "ČAKAJ...";
            } else if (!is_conflict) {
                document.getElementById("player-turn-indicator").innerText = "VYBER SI KARTU";
            } else {
                if (turn === "p") {
                    document.getElementById("player-turn-indicator").innerText = "IDEŠ";
                } else {
                    document.getElementById("player-turn-indicator").innerText = "Waiting";
                }
            }
        }

        function resolveActionPhase(card) {
            inputs_frozen = true;
            updateUI();

            const activeChallenge = CHALLENGES[current_challenge_key];
            let adrenaline = parseInt(document.getElementById("adrenaline-select").value) || 0;
            let roll_result = rollDice(card, false, skill);
            roll_result += adrenaline; 
            
            log(`Celkový výsledok: ${roll_result} (Zahŕňa +${adrenaline} za adrenalín)`, "", true);

            let success = roll_result >= current_challenge.difficulty;
            let is_tie_or_failure = roll_result <= current_challenge.difficulty;
            let threat_realized = false;

            // 1. Log baseline success or failure text
            if (success) {
                log(activeChallenge.success_msg || "💪 Úspech!", "success-msg");
            } else {
                log(activeChallenge.failure_msg || "❌ Zlyhanie!", "failure-msg");
            }

            // 2. Core Fix: Threat is ONLY rolled/evaluated in case of a tie or a flat-out failure
            if (is_tie_or_failure) {
                let threat_roll = 0;
                let threatRollsData = []; // NEW: Array to capture visual dice metadata
                
                for (let n = 0; n < current_challenge.threat; n++) {
                    let r = Math.floor(Math.random() * 2);
                    threat_roll += r;
                    threatRollsData.push({ type: "DH", value: r, isSkillDie: true }); 
                }

                // NEW: Trigger the animation pool using the 'enemy' layout slot (top-right space)
                triggerDiceVisualAnimation(threatRollsData, true);

                // Realized ONLY if threat roll strictly exceeds the player card's caution threshold
                let caution_threshold = CARDS[card][0][0];
                if (threat_roll > caution_threshold) {
                    log(`${activeChallenge.threat_msg || "⚠️ Hrozba sa naplnila!"} \n (KOCKY HROZBY: ${threat_roll} > TVOJA OPATRNOSŤ: ${caution_threshold})`, "danger-msg");
                    threat_realized = true;
                } else {
                    log(`${activeChallenge.threat_avoided_msg || "Vyhol si sa hrozbe."} (KOCKY HROZBY: ${threat_roll} <= TVOJA OPATRNOSŤ: ${caution_threshold})`, "success-msg");
                }
            }

            resetAdrenalineSelection();

            // 3. Process execution route updates based on cleanly updated state flags
            setTimeout(() => {
                    inputs_frozen = false;

                    // Threat consequences take absolute priority if tripped
                    if (threat_realized) {
                        if (activeChallenge.case_threat_delayed) {
                            if (Array.isArray(activeChallenge.case_threat_delayed)) {
                                DELAYED.push(...activeChallenge.case_threat_delayed);
                            } else {
                                DELAYED.push(activeChallenge.case_threat_delayed);
                            }
                        }
                        proceed(activeChallenge.case_threat);
                    }

                    // Direct success or failure movement splits routed via proceed prompt
                    if (success) {
                        if (activeChallenge.case_success_delayed) {
                            if (Array.isArray(activeChallenge.case_success_delayed)) {
                                DELAYED.push(...activeChallenge.case_success_delayed); // Rozbalí pole na samostatné texty
                            } else {
                                DELAYED.push(activeChallenge.case_success_delayed);
                            }
                        }
                        proceed(activeChallenge.case_success);
                    } else {
                        if (activeChallenge.case_failure_delayed) {
                            if (Array.isArray(activeChallenge.case_failure_delayed)) {
                                DELAYED.push(...activeChallenge.case_failure_delayed);
                            } else {
                                DELAYED.push(activeChallenge.case_failure_delayed);
                            }
                        }
                        proceed(activeChallenge.case_failure);
                    }
                }, 300);
        }

        function gameloop(success = true) {
            if (enemy === null) {
                if (success) {
                    runActionPhase();
                } else {
                    // Fail-safe fallback if state engine defaults
                    enemy = "Skautka";
                    enemy_stress = 0;
                    enemy_escaping = false;
                    is_conflict = true;
                    move = 0;
                    combat_starter = null;
                    runConflictTurn();
                }
            } else {
                runConflictTurn();
            }
        }

        function resolveConflict() {
            let enemy_roll = rollDice(enemy_action[1], enemy_action[0] === "A", ENEMY_TYPES[enemy]["skill"], true);
            enemy_roll += enemy_advantage;
            log(`${enemy}: ${enemy_roll} (VÝHODA: +${enemy_advantage}).`, "", true);

            let adrenaline = parseInt(document.getElementById("adrenaline-select").value) || 0;
            let player_roll = rollDice(player_action[1], player_action[0] === "A", skill, false);
            player_roll += (advantage + adrenaline); 
            
            log(`TY: ${player_roll} (VÝHODA: +${advantage}   ADRENALÍN: +${adrenaline} ).`);

            resetAdrenalineSelection();

            if (enemy_escaping) {
                
                // --- SCENARIO A: Enemy wins cleanly ---
                if (enemy_roll > player_roll) {
                    log(`\n🏃 ${enemy} úspešne uteká z boja!`, "danger-msg");
                    inputs_frozen = true;
                    updateUI();

                    setTimeout(() => {
                        const enemyContainer = document.getElementById("enemy-sprite-container");
                        if (enemyContainer) enemyContainer.style.display = "none";
                        document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());

                        let activeChallenge = CHALLENGES[current_challenge_key];
                        
                        if (activeChallenge && activeChallenge.enemy_escape_delayed) {
                            if (Array.isArray(activeChallenge.enemy_escape_delayed)) {
                                DELAYED.push(...activeChallenge.enemy_escape_delayed);
                            } else if (activeChallenge.enemy_escape_delayed !== "") {
                                DELAYED.push(activeChallenge.enemy_escape_delayed);
                            }
                        }
                        
                        enemy = null; enemy_stress = 0; enemy_escaping = false;
                        enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                        player_action = null; enemy_action = null; is_conflict = false;

                        if (activeChallenge && activeChallenge.enemy_escape) {
                            proceed(activeChallenge.enemy_escape);
                        } else if (pending_challenge_key) {
                            let nextChallenge = pending_challenge_key;
                            pending_challenge_key = null;
                            proceed(nextChallenge);
                        } else {
                            proceed(activeChallenge.case_success);
                        }
                    }, 2000);
                    return;
                }
                
                // --- SCENARIO B: Tie on Escape (Against Attack or Defense) ---
                else if (enemy_roll === player_roll) {
                    let enemy_caution = CARDS[enemy_action[1]][0][0];
                    let attackValue = player_action[0] === "A" ? CARDS[player_action[1]][1][0] : 0;
                    let stressDmg = player_action[0] === "A" ? Math.max(0, attackValue + weapon - enemy_caution) : 0;
                    // Check if this tie-damage completely defeats them before they can run
                    if (stressDmg + enemy_stress >= ENEMY_TYPES[enemy]["stress_thresh"]) {
                        log(`\n💥 Zasiahol si utekajúceho nepriateľa na poslednú chvíľu! ${enemy} JE DOLE!`, "success-msg");
                        enemy_stress += stressDmg; 
                        inputs_frozen = true;
                        updateUI();

                        setTimeout(() => {
                            const enemyContainer = document.getElementById("enemy-sprite-container");
                            if (enemyContainer) enemyContainer.style.display = "none";
                            document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());

                            let activeChallenge = CHALLENGES[current_challenge_key];
                            enemy = null; enemy_stress = 0; enemy_escaping = false;
                            enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                            player_action = null; enemy_action = null; is_conflict = false;

                            if (activeChallenge && activeChallenge.enemy_escape) {
                                proceed(activeChallenge.enemy_escape);
                            } else if (pending_challenge_key) {
                                let nextChallenge = pending_challenge_key;
                                pending_challenge_key = null;
                                proceed(nextChallenge);
                            } else {
                                proceed(activeChallenge.case_success);
                            }
                        }, 200);
                        return;
                    } 
                    // If they survive the tie damage (or if you played defense and dealt 0 damage), they escape!
                    else {
                        enemy_stress += stressDmg;
                        
                        if (stressDmg > 0) {
                            log(`Zasiahol si unikajúceho nepriateľa, ale napriek tomu ušiel!`, "danger-msg");
                            const enemyContainer = document.getElementById("enemy-sprite-container");
                            if (enemyContainer) {
                                enemyContainer.classList.remove("enemy-hit");
                                void enemyContainer.offsetWidth; 
                                enemyContainer.classList.add("enemy-hit");
                            }
                        } else {
                            log(`\n🏃 Snažil si sa zadržať protivníka, ale vytrhol sa a uniká!`, "danger-msg");
                        }
                        
                        inputs_frozen = true;
                        updateUI();

                        setTimeout(() => {
                            const enemyContainer = document.getElementById("enemy-sprite-container");
                            if (enemyContainer) enemyContainer.style.display = "none";
                            document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());

                            let activeChallenge = CHALLENGES[current_challenge_key];
                            
                            if (activeChallenge && activeChallenge.enemy_escape_delayed) {
                                if (Array.isArray(activeChallenge.enemy_escape_delayed)) {
                                    DELAYED.push(...activeChallenge.enemy_escape_delayed);
                                } else if (activeChallenge.enemy_escape_delayed !== "") {
                                    DELAYED.push(activeChallenge.enemy_escape_delayed);
                                }
                            }
                            
                            enemy = null; enemy_stress = 0; enemy_escaping = false;
                            enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                            player_action = null; enemy_action = null; is_conflict = false;

                            if (pending_challenge_key) {
                                let nextChallenge = pending_challenge_key;
                                pending_challenge_key = null; 
                                proceed(nextChallenge); 
                            } else {
                                proceed(activeChallenge.case_success); 
                            }
                        }, 200);
                        return;
                    }
                }

                // --- SCENARIO C: Player wins cleanly (Prevents escape!) ---
                else if (player_roll > enemy_roll) {
                    if (player_action[0] === "A") {
                        let enemy_caution = CARDS[enemy_action[1]][0][0]; // Escape action uses their played card profile
                        let stressDmg = Math.max(0, CARDS[player_action[1]][1][0] + weapon - enemy_caution);

                        if (stressDmg + enemy_stress >= ENEMY_TYPES[enemy]["stress_thresh"]) {
                            log(`\n💥 Zastavil si útek a zrazil nepriateľa k zemi! ${enemy} JE DOLE!`, "success-msg");
                            enemy_stress += stressDmg;
                            inputs_frozen = true;
                            updateUI();

                            setTimeout(() => {
                                const enemyContainer = document.getElementById("enemy-sprite-container");
                                if (enemyContainer) enemyContainer.style.display = "none";
                                document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());

                                let activeChallenge = CHALLENGES[current_challenge_key];
                                enemy = null; enemy_stress = 0; enemy_escaping = false;
                                enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                                player_action = null; enemy_action = null; is_conflict = false;

                                if (pending_challenge_key) {
                                    let nextChallenge = pending_challenge_key;
                                    pending_challenge_key = null;
                                    proceed(nextChallenge);
                                } else {
                                    proceed(activeChallenge.case_success);
                                }
                            }, 2000);
                            return;
                        } else {
                            enemy_stress += stressDmg;
                            log(`🛑 Prekazil si útek! Zasiahol si ${enemy} za ${stressDmg} stresu a zostáva v boji.`, "success-msg");
                            const enemyContainer = document.getElementById("enemy-sprite-container");
                            if (enemyContainer) {
                                enemyContainer.classList.remove("enemy-hit");
                                void enemyContainer.offsetWidth;
                                enemyContainer.classList.add("enemy-hit");
                            }
                        }
                    } else {
                        // Player blocked with a D card
                        advantage += 1;
                        log(`🛡️ Zabránil si protivníkovi uniknúť a získavaš výhodu +1.`);
                    }

                    // Reset actions and prepare next round because escape failed
                    move = 0;
                    round += 1;
                    player_action = null;
                    enemy_action = null;

                    setTimeout(() => { gameloop(false); }, 2000);
                    return; // Ensure we exit resolveConflict entirely
                }
            }

            // 1. STANDARD PLAYER ATTACKS (Succeeds or Ties)
            if (player_roll >= enemy_roll && player_action[0] === "A") {
                let enemy_caution = enemy_action[0] === "D" ? CARDS[enemy_action[1]][0][0] : 0;
                let stressDmg = Math.max(0, CARDS[player_action[1]][1][0] + weapon - enemy_caution); 

                if (stressDmg + enemy_stress > ENEMY_TYPES[enemy]["stress_thresh"]) {
                    log(`\n💥 ${enemy} JE DOLE! Môžeš pokračovať.`, "success-msg");
                    
                    inputs_frozen = true;
                    updateUI();

                    setTimeout(() => { 
                        const enemyContainer = document.getElementById("enemy-sprite-container");
                        if (enemyContainer) enemyContainer.style.display = "none";
                        
                        document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());

                        let activeChallenge = CHALLENGES[current_challenge_key];
                        enemy = null; enemy_stress = 0; enemy_escaping = false;
                        enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                        player_action = null; enemy_action = null; is_conflict = false;

                        if (pending_challenge_key) {
                            let nextChallenge = pending_challenge_key;
                            pending_challenge_key = null; 
                            proceed(nextChallenge); 
                        } else {
                            proceed(activeChallenge.case_success); 
                        }
                    }, 500); 
                    return;
                } else {
                    enemy_stress += stressDmg;
                    log(`Zvýšil si protivníkovi stres o ${stressDmg}.`, "success-msg");
                    const enemyContainer = document.getElementById("enemy-sprite-container");
                    if (enemyContainer) {
                        enemyContainer.classList.remove("enemy-hit");
                        void enemyContainer.offsetWidth; 
                        enemyContainer.classList.add("enemy-hit");
                    }
                }
            }

            // 2. STANDARD ENEMY ATTACKS (Succeeds or Ties)
            if (player_roll <= enemy_roll && enemy_action[0] === "A") {
                let player_caution = 0;
                if (player_action[0] === "D") {
                    player_caution = CARDS[player_action[1]][0][0];
                }
                let stressDmg = CARDS[enemy_action[1]][1][0] + ENEMY_TYPES[enemy]["weapon"] - player_caution;
                stressDmg = Math.max(0, stressDmg); 

                if (stressDmg + stress > stress_thresh) {
                    log(`💀 TVOJ STRES PREKROČIL HODNOTU KOLAPSU. KONIEC HRY.`, "failure-msg");
                    restartGame();
                    return;
                } else {
                    stress += stressDmg;
                    log(`Stúpol ti stres o: ${stressDmg}.`, "failure-msg");
                }
            }

            // 3. ADVANTAGE DETERMINATION
            if ((player_roll > enemy_roll && player_action[0] === "D") || 
                (player_roll === enemy_roll && player_action[0] === "D" && enemy_action[0] === "A")) {
                advantage += 1;
                log("Dostaneš sa do lepšej pozície a získavaš výhodu +1 do ďalšieho kola.");
            } 
            
            if ((player_roll < enemy_roll && enemy_action[0] === "D") || 
                (player_roll === enemy_roll && enemy_action[0] === "D" && player_action[0] === "A")) {
                enemy_advantage += 1;
                log(`🛡️ Nepriateľ uskočil do výhodnejšej pozície! Získava výhodu +1 do ďalšieho kola.`);
            }

            move = 0;
            round += 1;
            player_action = null;
            enemy_action = null;

            setTimeout(() => { gameloop(false); }, 2000);
        }

        function ready() {
            const prompt = document.getElementById("ready-prompt");
            prompt.style.display = "flex";
        }

        document.getElementById("ready-btn").addEventListener("click", function() {
            document.getElementById("ready-prompt").style.display = "none";
            log("Ok, pokračujeme...", "", true);
            
            inputs_frozen = true;
            updateUI();
            
            setTimeout(() => {
                inputs_frozen = false;
                enemyChoice();
            }, 500);
        });

        function proceed(target) {
            // Save the target to our global tracker so the event listener can see it
            proceed_target = target; 

            
            const prompt = document.getElementById("proceed-prompt");
            if (prompt) {
                prompt.style.display = "flex";
            }
        }

        document.getElementById("proceed-btn").addEventListener("click", function() {
            const prompt = document.getElementById("proceed-prompt");
            if (prompt) prompt.style.display = "none";            
            
            inputs_frozen = true;
            
            // Safely execute the transition using our saved tracker variable
            if (proceed_target) {
                document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());

                const enemyCardContainer = document.getElementById("enemy-card-container");
                if (enemyCardContainer) {
                    enemyCardContainer.innerHTML = "";
                }

                // 3. Vyčistenie vizuálnych kariet hráča
                const playerCardContainer = document.getElementById("player-card-container");
                if (playerCardContainer) {
                    playerCardContainer.innerHTML = "";
                }

                handleChallengeTransition(proceed_target);
            }
        });

        function runConflictTurn() {
            if (move === 0) {
                if (combat_starter === null) {
                    combat_starter = Math.random() < 0.5 ? "p" : "e";
                } else {
                    combat_starter = (combat_starter === "p") ? "e" : "p";
                }
                
                turn = combat_starter;
                log(`${turn === "p" ? "Začínaš ty." : "Začína " + enemy + "."}`);
            }

            updateUI();

            if (move < 2) {
                if (turn === "e") {
                    inputs_frozen = true;
                    updateUI();
                    if (move == 1) {
                        setTimeout(enemyChoice, 200);
                    } else {
                        ready();
                    }
                } else {
                    updateUI();
                    player_turn_timeout = setTimeout(() => {
                        log("Si na ťahu. Vyber si kartu a spôsob (ÚTOK/ČIN).", "", true);
                        inputs_frozen = false;
                    }, 3000);
                }
            } else {
                inputs_frozen = true;
                updateUI();
                setTimeout(resolveConflict, 300);
            }
        }


        function handleConflictInput(actionType, cardCode) {
            if (player_turn_timeout) {
                clearTimeout(player_turn_timeout);
                player_turn_timeout = null;
            }
            if (move === 0) {
                hidecards(player = true);
                const tableFloor = document.querySelector('.gaming-table-floor');
                const existingPools = tableFloor.querySelectorAll('.dice-animation-pool');
                existingPools.forEach(pool => pool.remove());
            }
            // IF a new round is starting and player goes first, slide the old card away
            const playerDisplay = document.getElementById("player-card-display");
            const rotClass = actionType === "D" ? "rotate-player-D" : "rotate-player-A";
                
                // Build card with 'table-card' class to separate from tray behavior
                playerDisplay.innerHTML = `
                    <div class="card-container table-card ${rotClass}">
                        <img src="assets/${cardCode}.png" class="card-img">
                    </div>`;
                
            playerDisplay.classList.add("show");



            player_action = [actionType, cardCode];
            //log(`You chose: [${actionType === "A" ? "Attack" : "Defend"}, Card ${cardCode}]`);
            move += 1;
            turn = "e";
            
            runGameloopCycle();
        }

        function enemyChoice() {
            const container = document.getElementById("enemy-card-container");
            const isCardShowing = container && container.classList.contains("show");

            // IF a new round is starting, enemy goes first, and an old card is visible:
            // Slide it up first, then wait 500ms for the CSS transition before dropping the new one.
            if (move === 0 && isCardShowing) {
                hidecards(player = true);
                const tableFloor = document.querySelector('.gaming-table-floor');
                const existingPools = tableFloor.querySelectorAll('.dice-animation-pool');
                existingPools.forEach(pool => pool.remove());
                setTimeout(proceedWithEnemyChoice, 500);
            } else {
                proceedWithEnemyChoice();
            }
        }

        function proceedWithEnemyChoice() {
            let pa = player_action;
            if (pa) {
                if (pa[0] === "A") {
                    if (CARDS[pa[1]][1][0] + enemy_stress - 3 > ENEMY_TYPES[enemy]["stress_thresh"]) {
                        enemy_action = ["D", "B"];
                    } else if (stress > stress_thresh - 3) {
                        enemy_action = ["D", "B"];
                    } else if (enemy_stress > ENEMY_TYPES[enemy]["stress_thresh"] - 2) {
                        let choice = Math.random() < 0.5 ? "A" : "D";
                        enemy_action = [choice, "O"];
                    } else {
                        let choices = ["O", "R", "S", "B"];
                        let choice = choices[Math.floor(Math.random() * choices.length)];
                        enemy_action = ["A", choice];
                    }
                } else {
                    enemy_action = ["A", "O"]; 
                    let choices = ["O", "R", "S", "B"];
                    for (let c of choices) {
                        if (CARDS[c][1][0] + ENEMY_TYPES[enemy]["weapon"] > CARDS[pa[1]][0][0]) {
                            enemy_action = ["A", c];
                            break;
                        }
                    }
                }
            } else if (enemy_stress >= ENEMY_TYPES[enemy]["stress_thresh"] - 1) {
                enemy_action = ["D", "B"];
                enemy_escaping = true;
            } else {
                let choices = ["O", "R", "S", "B"];
                let choice = choices[Math.floor(Math.random() * choices.length)];
                enemy_action = ["A", choice];
            }

            move += 1;
            turn = "p";
            let escapeText = enemy_escaping ? `${enemy} sa snaží ujsť` : "";
            
            if (escapeText) {
                log(`${escapeText} `, "", true);
                inputs_frozen = true;
                updateUI();
                
                setTimeout(() => {
                    inputs_frozen = false;
                    displayEnemyCard(enemy_action[0], enemy_action[1]);
                    runGameloopCycle();
                }, 400);
            } else {
                displayEnemyCard(enemy_action[0], enemy_action[1]);
                runGameloopCycle();
            }
        }

        function runGameloopCycle() {
            gameloop(false, true);
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

        function hidecards(player = false) {
            const container = document.getElementById("enemy-card-container");
            if (container) {
                container.classList.remove("show");
            }
            const playerDisplay = document.getElementById("player-card-display");
            if (playerDisplay && player) {
                playerDisplay.classList.remove("show");
            }
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

        document.getElementById("card-tray-container").addEventListener("click", function(e) {
            if (inputs_frozen) return;

            if (is_conflict) {
                const zone = e.target.closest(".split-zone");
                if (!zone) return;
                const cardContainer = zone.closest(".card-container");
                const cardCode = cardContainer.getAttribute("data-card");
                let actionType = zone.getAttribute("data-action");
                
                // FIXED: Removed the faulty 'if (cards_are_flipped)' inversion logic from here
                
                handleConflictInput(actionType, cardCode);
            } 
            else {
                const cardContainer = e.target.closest(".card-container");
                if (!cardContainer) return;
                const cardCode = cardContainer.getAttribute("data-card");
                
                resolveActionPhase(cardCode);
            }
        });

        // --- OVLÁDANIE KLÁVESNICOU (MEDZERNÍK) ---
        document.addEventListener("keydown", function(event) {
            // Skontrolujeme, či hráč stlačil medzerník (Space)
            if (event.key === " " || event.code === "Space") {
                
                // 1. REAKCIA PRE TLAČIDLO "POKRAČOVAŤ"
                const proceedPrompt = document.getElementById("proceed-prompt");
                if (proceedPrompt && window.getComputedStyle(proceedPrompt).display !== "none") {
                    event.preventDefault(); // Zabráni scrollu stránky dole pri stlačení Space
                    
                    const proceedBtn = document.getElementById("proceed-btn");
                    if (proceedBtn) {
                        proceedBtn.click(); // Nasimuluje kliknutie na POKRAČOVAŤ
                        return; // Ukončíme funkciu, aby sme nepokračovali na ďalší check
                    }
                }
                
                // 2. REAKCIA PRE TLAČIDLO "SOM READY!"
                const readyPrompt = document.getElementById("ready-prompt");
                if (readyPrompt && window.getComputedStyle(readyPrompt).display !== "none") {
                    event.preventDefault(); // Zabráni scrollu stránky dole pri stlačení Space
                    
                    const readyBtn = document.getElementById("ready-btn");
                    if (readyBtn) {
                        readyBtn.click(); // Nasimuluje kliknutie na SOM READY!
                        return; // Ukončíme funkciu
                    }
                }
            }
        });

        // Table Input Management Engine (Updated to update stress immediately)
        document.getElementById("adrenaline-track-row").addEventListener("click", function(e) {
            if (inputs_frozen) return;
            
            const clickedCell = e.target.closest(".ad-node.ad-playable");
            if (!clickedCell) return; // Ignore if user clicks a locked/gray cell
            
            // Get the structural index position of the chosen node (which equals the new stress level)
            const targetStressVal = parseInt(clickedCell.getAttribute("data-idx"));
            const targetAdrenalineVal = clickedCell.getAttribute("data-val");
            
            // Clear prior selection highlights
            document.querySelectorAll(".ad-node").forEach(node => node.classList.remove("ad-selected"));
            
            const currentSelectedValue = document.getElementById("adrenaline-select").value;
            if (currentSelectedValue === targetAdrenalineVal && stress === targetStressVal) {
                // If they click the exact same node again, do nothing or let them click another
                return;
            } else {
                // 1. Immediately update the game state stress variable to this column's value
                stress = targetStressVal;
                
                // 2. Lock in the selected visual highlight state
                clickedCell.classList.add("ad-selected");
                
                // 3. Update hidden input tracker value for the dice rolling engine
                document.getElementById("adrenaline-select").value = targetAdrenalineVal;
                
                log(`Adrenalín použitý! Stres sa ti zvyšuje na ${stress} a získavaš +${targetAdrenalineVal} k ďalšiemu hodu.`);
                
                // 4. Force a UI refresh to immediately shift the red 'S' track indicator to the new position
                updateUI();
            }
        });

        // Init Core
        // Init Core

        fetch('./CHALLENGES.json')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Nepodarilo sa načítať súbor CHALLENGES.json');
                }
                return response.json();
            })
            .then(data => {
                CHALLENGES = data; // Uložíme načítané dáta do premennej
                
                // AŽ TERAZ, keď sú dáta stiahnuté, bezpečne naštartujeme hru
                handleChallengeTransition(current_challenge_key);
            })
            .catch(error => {
                console.error("Chyba v hre:", error);
                log("Kritická chyba: Nepodarilo sa načítať príbehový súbor JSON.", "danger-msg");
            });