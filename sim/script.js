        let CHALLENGES = {};
        let ENEMY_TYPES = {};
        let HEROES = {};
        let SKILLS_DB = {}; // <--- PRIDANÉ: Sem sa načítajú dáta zo skillsDB.json

        const DEFENSE_SKILLS = ["OBRATNOSŤ", "ODOLNOSŤ", "ZMYSLY", "ŠPRINT"];

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
            "weapons": [],
            "weapon": 1,
        };

        const DELAYED = [];

        const WEAPON_LIST = {
            "BOJ Z DIAĽKY": {
            "pištoľ":1,
            "samopal":2,
            },
            "BOJ ZBLÍZKA": {
                "nôž":1,
                "sekera":2,
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

        INITIAL_WEAPONS = ["nôž","pištoľ","sekera"]

        const WEAPON_SKILLS = {
            "1":["STREĽBA","VRHANIE","ELIMINÁCIA Z DIAĽKY","ĽAHKÉ ZBRANE","OMRÁČENIE","MUČENIE","TICHÁ ELIMINÁCIA"],
            "2":["ŤAŽKÉ STRELNÉ ZBRANE","ELIMINÁCIA Z DIAĽKY","ŤAŽKÉ ZBRANE","OMRÁČENIE","MUČENIE","TICHÁ ELIMINÁCIA"],
            "3":["ŠPECIÁLNE STRELNÉ ZBRANE","ELIMINÁCIA Z DIAĽKY","ŠPECIÁLNE ZBRANE","MUČENIE","OMRÁČENIE","TICHÁ ELIMINÁCIA"],
            "4":["BOJOVÉ STROJE","HROMADNÉ NIČENIE","ELIMINÁCIA Z DIAĽKY"]
        }


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
                let i = 0;

                function processNextElement() {
                    if (i >= caseTarget.length) return;
                    
                    const target = caseTarget[i];

                    // 1. Pozrieme sa, či target existuje v CHALLENGES a definuje špecifický "type" nepriateľa
                    if (typeof target === 'string' && CHALLENGES[target] && CHALLENGES[target].type) {
                        const enemyType = CHALLENGES[target].type;
                        if (enemyType in ENEMY_TYPES) {
                            const remainder = caseTarget.slice(i + 1);
                            if (remainder.length > 0) {
                                pending_challenge_key = remainder.length === 1 ? remainder[0] : remainder;
                            }
                            handleChallengeTransition(target);
                            return; // Zodpovedá pôvodnému 'break', ukončí spracovanie poľa, lebo začal boj
                        }
                    } 
                    // 2. Pôvodný fallback pre prípad, že v poli je priamo natvrdo napísané napr. "Skautka"
                    else if (target in ENEMY_TYPES) {
                        const remainder = caseTarget.slice(i + 1);
                        if (remainder.length > 0) {
                            pending_challenge_key = remainder.length === 1 ? remainder[0] : remainder;
                        }
                        handleChallengeTransition(target);
                        return; // Zodpovedá pôvodnému 'break', ukončí spracovanie poľa, lebo začal boj
                    } 
                    // 3. Bežný prvok (Lokácia alebo Modifikácia štatistík)
                    else {
                        // Zistíme, či tento konkrétny prvok je modifikáciou štatistík alebo zbrane
                        const isModification = typeof target === 'string' && 
                            (target.includes('+') || target.includes('-') || target.includes('=') || target.toLowerCase().includes('weapon+'));

                        handleChallengeTransition(target);

                        i++; // Posunieme sa na ďalší prvok

                        // Ak to bola modifikácia a v poli ešte zostali nejaké ďalšie prvky (napr. "CITY")
                        if (isModification && i < caseTarget.length) {
                            inputs_frozen = true;
                            updateUI();
                            
                            // Dáme hráčovi 1.5 sekundy na prečítanie logu, kým spracujeme ďalší prvok
                            setTimeout(() => {
                                inputs_frozen = false;
                                processNextElement();
                            }, 2500);
                        } else {
                            // Ak to nebola modifikácia, okamžite pokračujeme na ďalší prvok v poli
                            processNextElement();
                        }
                    }
                }

                processNextElement(); // Spustíme asynchrónnu reťaz
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
                }, 500); // 4-second reading delay
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
                    else if (lowerTarget.includes("weapon+")) {
                        // Rozdelíme reťazec a získame názov zbrane
                        const weaponName = lowerTarget.split("weapon+")[1].trim().split(" ")[0].toLowerCase();
                        
                        if (!HERO.weapons || !Array.isArray(HERO.weapons)) {
                            HERO.weapons = [];
                        }

                        if (!HERO.weapons.includes(weaponName)) {
                            HERO.weapons.push(weaponName);
                            log(`Získavaš novú zbraň: ${weaponName.toUpperCase()}!`, "success-msg", true);
                            
                            // Refresh zbraňového dropdownu
                            if (typeof populateWeaponDropdown === "function") {
                                populateWeaponDropdown();
                            }
                        } else {
                            log(`Zbraň ${weaponName.toUpperCase()} už máš vo svojom arzenáli.`, "system-msg", true);
                        }
                        modificationExecuted = true;
                    }
                }
    

                if (modificationExecuted) {
                    inputs_frozen = false;
                    updateUI();
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

            // --- Image asset straight to the CSS variable ---
            if (tableFloor) {
                if (activeChallenge.image) {
                    tableFloor.style.setProperty('--bg-image', `url('${activeChallenge.image}')`);
                } else {
                    tableFloor.style.removeProperty('--bg-image');
                }
            }

            // --- Check for and execute matched delayed triggers ---
            if (activeChallenge.trigger_delayed && Array.isArray(activeChallenge.trigger_delayed)) {
                for (const effect of activeChallenge.trigger_delayed) {
                    const delayedIndex = DELAYED.indexOf(effect);
                    if (delayedIndex !== -1) {
                        DELAYED.splice(delayedIndex, 1);
                        handleChallengeTransition(effect);
                        if (!effect.includes("+")) {
                            return; 
                        }
                    }
                }
            }

            // PÔVODNÝ BLOK VYHODNOCOVANIA DROPDOWNU SME ODTIETO VYMAZALI, 
            // PRETOŽE HO RIEŠI EVENT LISTENER PRI ZMENE POULOŽÍVATEĽOM.

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
            
            if (activeChallenge.difficulty !== undefined && activeChallenge.threat !== undefined) {
                log(`NÁROČNOSŤ: ${current_challenge.difficulty}  |  HROZBA: ${current_challenge.threat}`);
            }
            
            inputs_frozen = false;

            // TÁTO ČASŤ TU ZOSTÁVA: Na konci fázy (keď systém čaká na kartu) pripravíme dropdown na placeholder
            if (!enemy) { 
                const dropdown = document.getElementById("player-skill-dropdown");
                if (dropdown) {
                    dropdown.value = "placeholder"; // Nastaví vizuálne na placeholder
                }
                skill = 0; // Globálna hodnota skillu je zatiaľ 0, kým hráč reálne neklikne a nevyberie
            }
            updateUI();
        }

        // Sledovanie výberu schopnosti hráčom (mimo boja aj počas boja)
        document.getElementById("player-skill-dropdown").addEventListener("change", function(e) {
            const selectedSkillName = e.target.value;
            let chosenSkillValue = 0;

            // 1. Ak hráč vybral placeholder, skill je 0 a končíme
            if (!selectedSkillName || selectedSkillName === "placeholder" || selectedSkillName === "none") {
                skill = 0;
                return;
            }

            // --- REŽIM BOJA (COMBAT) ---
            if (enemy) {
                const skillData = SKILLS_DB[selectedSkillName];
                const isDefenseSkill = DEFENSE_SKILLS.includes(selectedSkillName.toUpperCase());
                // Skontrolujeme, či skupina schopnosti (index 1) obsahuje slovo "BOJ"
                const isCombatSkill = skillData && skillData[1] && skillData[1].toUpperCase().includes("BOJ");

                // PRVÝ KROK: Ak schopnosť nie je bojová a nie je ani v obranných, vyhodíme ju
                if (!isCombatSkill && !isDefenseSkill) {
                    log(`⚠️ Schopnosť "${selectedSkillName}" nemôžeš použiť v boji.`, "error-msg");
                    skill = 0;
                    e.target.value = "placeholder"; // Vrátime dropdown vizuálne späť
                    return;
                }

                // Ak prešla filtrom, priradíme jej reálnu hodnotu z hrdinu
                const actualHeroValue = HERO.skills[selectedSkillName] || 0;
                skill = actualHeroValue;
                log(`⚔️ Pripravená schopnosť pre boj: ${selectedSkillName} (+${actualHeroValue})`, "system-msg");
                return;
            }

            // --- REŽIM VÝZVY (CHALLENGE) ---
            const activeChallenge = CHALLENGES[current_challenge_key];
            const actualHeroValue = HERO.skills[selectedSkillName] || 0;

            if (activeChallenge && activeChallenge.skills && activeChallenge.skills.length > 0) {
                if (!activeChallenge.skills.includes(selectedSkillName)) {
                    log(`⚠️ Táto schopnosť ti teraz nepomôže, skús jednu z týchto: (${activeChallenge.skills.join(', ')})`, "error-msg");
                    chosenSkillValue = 0;
                    e.target.value = "placeholder";
                } else {
                    log(`✅ ${selectedSkillName} (+${actualHeroValue}) je vhodná schopnosť!`, "success-msg");
                    chosenSkillValue = actualHeroValue;
                }
            } else {
                log(`ℹ️ Táto výzva nevyžaduje žiadne schopnosti.`, "system-msg");
                chosenSkillValue = 0;
                e.target.value = "placeholder";
            }

            skill = chosenSkillValue;
        });

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
            
            log(`Celkový výsledok: ${roll_result} (+${adrenaline})`, "", true);
            
            roll_result += adrenaline; 

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

                    // Ak sa naplnila hrozba, aplikujeme jej efekty priamo tu, bez handleChallengeTransition
                    if (threat_realized) {
                        if (activeChallenge.case_threat_delayed) {
                            if (Array.isArray(activeChallenge.case_threat_delayed)) {
                                DELAYED.push(...activeChallenge.case_threat_delayed);
                            } else {
                                DELAYED.push(activeChallenge.case_threat_delayed);
                            }
                        }
                        
                        // Ručne spracujeme "stress+1" alebo iné úpravy premenných pre case_threat
                        if (typeof activeChallenge.case_threat === 'string') {
                            const lowerThreat = activeChallenge.case_threat.toLowerCase();
                            
                            if (lowerThreat.includes("stress+")) {
                                const amount = parseInt(lowerThreat.split("+")[1]) || 1;
                                stress += amount;
                                log(`Stúpol ti stres o ${amount}!`, "danger-msg");
                                
                                if (stress > stress_thresh) {
                                    log("💀 Stres presiahol hodnotu kolapsu. KONIEC HRY.", "failure-msg", true);
                                    restartGame();
                                    return;
                                }
                            }
                            // Prípadná podpora pre iné efekty hrozieb (napr. enemy_advantage+1)
                            else if (lowerThreat.includes("enemy_advantage+")) {
                                const amount = parseInt(lowerThreat.split("+")[1]) || 1;
                                enemy_advantage += amount;
                                log(`Nepriateľ získava výhodu +${amount}!`, "danger-msg");
                            }
                            else if (lowerThreat.includes("advantage+")) {
                                const amount = parseInt(lowerThreat.split("+")[1]) || 1;
                                advantage += amount;
                                log(`Získavaš výhodu +${amount}!`);
                            }
                            // === NOVÝ KOMPATIBILNÝ BLOK PRE ZBRANE Z HROZBY ===
                            else if (lowerThreat.includes("weapon+")) {
                                // Vytiahneme text za kľúčovým slovom "weapon+"
                                const weaponPart = lowerThreat.substring(lowerThreat.indexOf("weapon+"));
                                const weaponName = weaponPart.split("+")[1].trim().split(" ")[0].toLowerCase();

                                // Ošetrenie, aby pole zbraní u hrdinu naisto existovalo
                                if (!HERO.weapons || !Array.isArray(HERO.weapons)) {
                                    HERO.weapons = [];
                                }

                                // Ak zbraň ešte nemá, pridáme ju do poľa a prekreslíme dropdown
                                if (!HERO.weapons.includes(weaponName)) {
                                    HERO.weapons.push(weaponName);
                                    log(`V dôsledku hrozby získavaš zbraň: ${weaponName.toUpperCase()}!`, "success-msg", true);
                                    
                                    if (typeof populateWeaponDropdown === "function") {
                                        populateWeaponDropdown();
                                    }
                                } else {
                                    log(`Zbraň ${weaponName.toUpperCase()} už máš vo svojom arzenáli.`, "system-msg");
                                }
                            }
                        }
                        
                        // Prekreslíme UI, aby hráč hneď videl nárast stresu na lište
                        updateUI();
                    }

                    // Teraz bezpečne posielame hráča na výslednú lokáciu až PO kliknutí na tlačidlo proceed
                    if (success) {
                        if (activeChallenge.case_success_delayed) {
                            if (Array.isArray(activeChallenge.case_success_delayed)) {
                                DELAYED.push(...activeChallenge.case_success_delayed);
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

            // Oprava: Ak adrenalín nie je vybraný, vráti 0 (nie "")
            let adrenaline = parseInt(document.getElementById("adrenaline-select").value) || 0;
            let player_roll = rollDice(player_action[1], player_action[0] === "A", skill, false);

            // PRIDANÉ: Definovanie modifikátorov, ktoré v kóde chýbali
            let p_adv_mod = advantage;
            let p_ad_mod = adrenaline;
            let e_adv_mod = enemy_advantage;

            // Formátovanie textu modifikátorov
            let p_adv_text = p_adv_mod > 0 ? `+${p_adv_mod}` : "";
            let p_ad_text = p_ad_mod > 0 ? `+${p_ad_mod}` : "";
            let e_adv_text = e_adv_mod > 0 ? `+${e_adv_mod}` : "";

            // Spojenie modifikátorov (napr. " +1 +2", ak neexistujú, tak "")
            let p_mods = (p_adv_mod > 0 || p_ad_mod > 0) ? ` [${[p_adv_text, p_ad_text].filter(Boolean).join(" ")}]` : "";
            let e_mods = e_adv_mod > 0 ? ` [${e_adv_text}]` : "";

            // Logovanie do herného konzolového okna
            log(`TY: ${player_roll}${p_mods}   ⚔️   ${enemy.toUpperCase()}: ${enemy_roll}${e_mods}`, "", true);

            enemy_roll += enemy_advantage;
            player_roll += (advantage + adrenaline); 

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
                        }, 500);
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
                        }, 500);
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
                            }, 1000);
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

                    setTimeout(() => { gameloop(false); }, 1000);
                    return; // Ensure we exit resolveConflict entirely
                }
            }

            // --- 1. CALCULATE INCOMING/OUTGOING STRESS SIMULTANEOUSLY ---
            let potential_player_damage = 0;
            let potential_enemy_damage = 0;

            // Compute standard player attack damage
            if (player_roll >= enemy_roll && player_action[0] === "A") {
                let enemy_caution = enemy_action[0] === "D" ? CARDS[enemy_action[1]][0][0] : 0;
                potential_enemy_damage = Math.max(0, CARDS[player_action[1]][1][0] + weapon - enemy_caution); 
            }

            // Compute standard enemy attack damage
            if (player_roll <= enemy_roll && enemy_action[0] === "A") {
                let player_caution = player_action[0] === "D" ? CARDS[player_action[1]][0][0] : 0;
                potential_player_damage = Math.max(0, CARDS[enemy_action[1]][1][0] + ENEMY_TYPES[enemy]["weapon"] - player_caution);
            }

            // --- 2. APPLY STRESS MODIFICATIONS ---
            if (potential_enemy_damage > 0) {
                enemy_stress += potential_enemy_damage;
                log(`Zvýšil si protivníkovi stres o ${potential_enemy_damage}.`, "success-msg");
                const enemyContainer = document.getElementById("enemy-sprite-container");
                if (enemyContainer) {
                    enemyContainer.classList.remove("enemy-hit");
                    void enemyContainer.offsetWidth; 
                    enemyContainer.classList.add("enemy-hit");
                }
            }

            if (potential_player_damage > 0) {
                stress += potential_player_damage;
                log(`Stúpol ti stres o: ${potential_player_damage}.`, "failure-msg");
            }

            // --- 3. EVALUATE HEALTH THRESHOLDS (DEATH CHECKS) ---
            let player_dead = stress > stress_thresh;
            let enemy_dead = enemy_stress > ENEMY_TYPES[enemy]["stress_thresh"];

            // CASE A: Mutual Kill (Tie scenario where both exceed stress thresholds)
            if (player_dead && enemy_dead) {
                log(`\n💀 Ou! Zabili ste sa navzájom!`, "failure-msg", true);
                inputs_frozen = true;
                updateUI();
                setTimeout(() => {
                    restartGame();
                }, 1000);
                return;
            }

            // CASE B: Only Player Collapses
            if (player_dead) {
                log(`💀 TVOJ STRES PREKROČIL HODNOTU KOLAPSU. KONIEC HRY.`, "failure-msg", true);
                inputs_frozen = true;
                updateUI();
                setTimeout(() => {
                    restartGame();
                }, 1000);
                return;
            }

            // CASE C: Only Enemy Collapses
            if (enemy_dead) {
                log(`\n💥 ${enemy} JE DOLE! Môžeš pokračovať.`, "success-msg");
                
                inputs_frozen = true;
                updateUI();

                setTimeout(() => { 
                    const enemyContainer = document.getElementById("enemy-sprite-container");
                    if (enemyContainer) enemyContainer.style.display = "none";

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
                }, 1000); 
                return;
            }

            // --- 4. ADVANTAGE DETERMINATION (If both survived) ---
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
                        setTimeout(enemyChoice, 1000);
                    } else {
                        ready();
                    }
                } else {
                    updateUI();
                    player_turn_timeout = setTimeout(() => {
                        log("Si na ťahu. Vyber si kartu a spôsob (ÚTOK/ČIN).", "", true);
                        inputs_frozen = false;
                    }, 1000);
                }
            } else {
                inputs_frozen = true;
                updateUI();
                setTimeout(resolveConflict, 500);
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
                }, 500);
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

        let currentHeroIndex = 0; // Sledovanie indexu zobrazeného hrdinu

        // Funkcia na dynamické naplnenie dropdownu schopnosťami hrdinu
        function populatePlayerSkillsDropdown() {
            const dropdown = document.getElementById("player-skill-dropdown");
            if (!dropdown) return;

            dropdown.innerHTML = ""; // Vyčistenie

            // 1. Pridanie predvoleného placeholderu
            const placeholder = document.createElement("option");
            placeholder.value = "placeholder";
            placeholder.textContent = "-- VYBER SI SCHOPNOSŤ --";
            placeholder.selected = true;
            dropdown.appendChild(placeholder);

            // Zoznam biologických zbraní, ktoré filtrujeme preč zo skillov
            const BIOLOGICAL_WEAPONS = ["OSTNE", "HRYZADLÁ", "KLEPETÁ", "KYSELINA", "ŽIHADLO"];

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
            // Ak by z nejakého dôvodu neboli dáta načítané, fallback na štart hry
            if (!HEROES || HEROES.length === 0) {
                handleChallengeTransition(current_challenge_key);
                return;
            }

            const tableFloor = document.querySelector(".gaming-table-floor");
            if (!tableFloor) return;

            // Dynamické vytvorenie overlay elementu, ktorý prekryje hernú plochu
            const overlay = document.createElement("div");
            overlay.id = "hero-selection-overlay";
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
                z-index: 1000;
                color: white;
            `;

            // Vloženie HTML štruktúry pre výber
            overlay.innerHTML = `                
                <div id="hero-card-display" style="background: #1a1a1a; border: 2px solid var(--hybrid-green); padding: 15px; border-radius: 8px; width: 680px; text-align: center; box-shadow: 0 0 15px rgba(0, 215, 0, 0.3);">
                    <h3 id="hero-display-name" style="font-family: 'Archivo Black', sans-serif; margin: 0 0 15px 0; text-transform: uppercase; color: #fff;">-</h3>
                    
                    <div id="hero-display-skills" style="text-align: left; font-family: 'Roboto Condensed', sans-serif; font-size: 0.95rem; max-height: 240px; overflow-y: auto; background: #111; padding: 12px; border-radius: 4px; border: 1px solid #333;">
                        
                        <div id="hero-skills-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 30px;"></div>
                        
                        <div id="hero-other-stats"></div>
                        
                    </div>
                </div>
                
                <div style="display: flex; gap: 5px; margin-top: 10px;">
                    <button id="hero-prev-btn" class="adrenaline-select" style="width: 60px; font-weight: bold; cursor: pointer;">◀</button>
                    <button id="hero-confirm-btn" class="adrenaline-select" style="width: 140px; background: var(--hybrid-green); color: #000; font-weight: bold; cursor: pointer;">VYBRAŤ</button>
                    <button id="hero-next-btn" class="adrenaline-select" style="width: 60px; font-weight: bold; cursor: pointer;">▶</button>
                </div>
            `;

            tableFloor.appendChild(overlay);

            log(`VYBER SI HRDINU!`, true);

            function updateHeroDisplay() {
                const activeHero = HEROES[currentHeroIndex];
                document.getElementById("hero-display-name").innerText = activeHero.name;

                // Target pre 2-stĺpcový grid schopností
                const skillsGrid = document.getElementById("hero-skills-grid");
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

            // Inicializačné zobrazenie prvého hrdinu
            updateHeroDisplay();

            // Event listenery pre listovanie hrdinami (cyklické rotovanie dookola)
            document.getElementById("hero-prev-btn").onclick = () => {
                currentHeroIndex = (currentHeroIndex - 1 + HEROES.length) % HEROES.length;
                updateHeroDisplay();
            };

            document.getElementById("hero-next-btn").onclick = () => {
                currentHeroIndex = (currentHeroIndex + 1) % HEROES.length;
                updateHeroDisplay();
            };

            // Event listener na potvrdenie výberu hrdinu
            document.getElementById("hero-confirm-btn").onclick = () => {
                const chosen = HEROES[currentHeroIndex];

                // Bezpečne vymažeme staré atribúty konštanty HERO a naplníme ju novými dátami
                for (let key in HERO) {
                    delete HERO[key];
                }
                Object.assign(HERO, chosen);

                // Doplnenie chýbajúcich hodnôt dôležitých pre jadro simulátora (ak v JSON chýbajú)
                if (HERO.stress_thresh === undefined) HERO.stress_thresh = 8;
                if (HERO.weapon === undefined) HERO.weapon = 1;

                // Odstránenie celého overlay z DOM, aby zmizol z gaming tablefloor
                overlay.remove();

                populatePlayerSkillsDropdown();

                // Záznam do tvojho terminal screenu
                log(`Tvoj hrdina je: ${HERO.name}`, "success-msg", true);

                selectInitialWeapon();            };
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

            // Vloženie identickej HTML štruktúry upravenej pre zbrane
            overlay.innerHTML = `                
                <div id="weapon-card-display" style="background: #1a1a1a; border: 2px solid var(--hybrid-green); padding: 15px; border-radius: 8px; width: 680px; text-align: center; box-shadow: 0 0 15px rgba(0, 215, 0, 0.3);">
                    <h3 id="weapon-display-name" style="font-family: 'Archivo Black', sans-serif; margin: 0 0 15px 0; text-transform: uppercase; color: #fff;">-</h3>
                    
                    <div id="weapon-display-stats" style="text-align: left; font-family: 'Roboto Condensed', sans-serif; font-size: 0.95rem; max-height: 240px; overflow-y: auto; background: #111; padding: 12px; border-radius: 4px; border: 1px solid #333;">
                        <div id="weapon-stats-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 30px;"></div>
                    </div>
                </div>
                
                <div style="display: flex; gap: 5px; margin-top: 10px;">
                    <button id="weapon-prev-btn" class="adrenaline-select" style="width: 60px; font-weight: bold; cursor: pointer;">◀</button>
                    <button id="weapon-confirm-btn" class="adrenaline-select" style="width: 140px; background: var(--hybrid-green); color: #000; font-weight: bold; cursor: pointer;">VYBRAŤ</button>
                    <button id="weapon-next-btn" class="adrenaline-select" style="width: 60px; font-weight: bold; cursor: pointer;">▶</button>
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
                const chosenWeapon = INITIAL_WEAPONS[currentWeaponIndex];

                // Inicializujeme pole zbraní u hrdinu, ak náhodou neexistuje
                if (!HERO.weapons || !Array.isArray(HERO.weapons)) {
                    HERO.weapons = [];
                }

                // Ak hrdina zbraň ešte nemá, pridáme ju do jeho arzenálu
                if (!HERO.weapons.includes(chosenWeapon)) {
                    HERO.weapons.push(chosenWeapon);
                }

                // Odstránime overlay z obrazovky
                overlay.remove();

                // Novo naplníme herný dropdown zbraní, aby sa tam zbraň hneď objavila
                populateWeaponDropdown();

                log(`Získavaš zbraň: ${chosenWeapon.toUpperCase()}`, "success-msg", true);

                // Odovzdáme riadenie hre a spustíme prechod na mapu výzvy
                handleChallengeTransition(current_challenge_key);
            };
        }

        function populateWeaponDropdown() {
            const weaponDropdown = document.getElementById("player-weapon-dropdown");
            if (!weaponDropdown) return;

            weaponDropdown.innerHTML = '<option value="placeholder">👊PRÁZDNE RUKY👊</option>';

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

                    // 2. Vytvoríme option a pridáme k názvu aj hodnotu, napr. "NÔŽ (+1)"
                    const option = document.createElement("option");
                    option.value = weaponName; // napr. "nôž"
                    option.textContent = `${weaponName.toUpperCase()} (+${dmgValue})`; 
                    
                    weaponDropdown.appendChild(option);
                });
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
                let actionType = zone.getAttribute("data-action"); // "A" (Útok) alebo "D" (Čin/Obrana)
                
                // --- 2. KROK: KONTROLA EXKLUZIVITY ÚTOK/OBRANA PO KLIKNUTÍ ---
                const dropdown = document.getElementById("player-skill-dropdown");
                const selectedSkillName = dropdown ? dropdown.value : "placeholder";

                if (selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                    const isDefenseSkill = DEFENSE_SKILLS.includes(selectedSkillName.toUpperCase());
                    const skillData = SKILLS_DB[selectedSkillName];
                    const isCombatSkill = skillData && skillData[1] && skillData[1].toUpperCase().includes("BOJ");

                    // A. Ak hráč vybral ÚTOK ("A"), ale má navolený obranný skill (napr. Obratnosť)
                    if (actionType === "A" && isDefenseSkill) {
                        log(`⚠️ Nemôžeš použiť obrannú schopnosť (${selectedSkillName}) pri ÚTOKU! Zmeň schopnosť alebo klikni na ČIN (Obranu).`, "error-msg");
                        return;
                    }

                    // B. Ak hráč vybral ČIN ("D"), ale má navolený útočný skill (napr. Boj zblízka) a nie je zároveň obranný
                    if (actionType === "D" && isCombatSkill && !isDefenseSkill) {
                        log(`⚠️ Nemôžeš použiť útočnú schopnosť (${selectedSkillName}) pri ČINE (Obrane)! Zmeň schopnosť alebo klikni na ÚTOK.`, "error-msg");
                        return;
                    }
                }
                
                // --- 3. KROK: KONTROLA KOMBINÁCIE ZBRANE A SCHOPNOSTI (NOVÉ) ---
                const weaponDropdown = document.getElementById("player-weapon-dropdown");
                const selectedWeaponName = weaponDropdown ? weaponDropdown.value : "placeholder";

                // Kontrolu vykonáme iba vtedy, ak má hráč vybranú zbraň AJ schopnosť
                if (selectedSkillName !== "placeholder" && selectedSkillName !== "none" && selectedWeaponName !== "placeholder") {
                    const skillData = SKILLS_DB[selectedSkillName];
                    const upperSkill = selectedSkillName.toUpperCase();

                    // A. Zistíme číselnú hodnotu poškodenia zbrane z WEAPON_LIST
                    let dmgValue = null;
                    for (const category in WEAPON_LIST) {
                        if (WEAPON_LIST[category] && WEAPON_LIST[category][selectedWeaponName] !== undefined) {
                            dmgValue = WEAPON_LIST[category][selectedWeaponName];
                            break;
                        }
                    }

                    // B. Kontrola WEAPON_SKILLS - Či zvolená schopnosť prislúcha sile zbrane
                    if (dmgValue !== null) {
                        const allowedSkills = WEAPON_SKILLS[String(dmgValue)];
                        if (allowedSkills && !allowedSkills.includes(upperSkill)) {
                            log(`⚠️ Schopnosť ${upperSkill} nie je použiteľná s touto zbraňou (vyžaduje zbraň s intenzitou ${dmgValue})!`, "error-msg");
                            return; // Zablokuje ťah
                        }
                    }

                    // C. Kontrola WEAPON_LIST kategórie (Boj zblízka vs Boj z diaľky)
                    if (skillData && skillData[1]) {
                        const skillCategory = skillData[1].toUpperCase(); // napr. "BOJ ZBLÍZKA" alebo "BOJ Z DIAĽKY"
                        if (skillCategory === "BOJ ZBLÍZKA" || skillCategory === "BOJ Z DIAĽKY") {
                            if (!WEAPON_LIST[skillCategory] || WEAPON_LIST[skillCategory][selectedWeaponName] === undefined) {
                                log(`⚠️ Zbraň ${selectedWeaponName.toUpperCase()} nie je vhodná pre schopnosť ${upperSkill}!`, "error-msg");
                                return; // Zablokuje ťah
                            }
                        }
                    }

                    // D. ŠPECIÁLNY PRÍPAD - Vrhanie / Ťažké predmety
                    if (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY") {
                        if (!WEAPON_LIST["VRHACIE"] || WEAPON_LIST["VRHACIE"][selectedWeaponName] === undefined) {
                            log(`⚠️ Schopnosť ${upperSkill} vyžaduje vrhaciu zbraň (napr. nôž)!`, "error-msg");
                            return; // Zablokuje ťah
                        }
                    }
                }
                
                // Ak všetko prebehlo v poriadku alebo hráč hrá bez skillu/zbrane, pustíme ho ďalej:
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

        // Sledovanie výberu zbrane hráčom
        document.getElementById("player-weapon-dropdown").addEventListener("change", function(e) {
            const selectedWeaponName = e.target.value;

            // 1. Ak hráč zvolil prázdnu ruku / resetoval zbraň
            if (!selectedWeaponName || selectedWeaponName === "placeholder") {
                weapon = 0; // Globálna premenná zbrane sa vynuluje
                log("👊 Bojuješ holými rukami (INTENZITA: 0).", "system-msg");
                return;
            }

            // 2. Prehľadáme kategórie vo WEAPON_LIST a nájdeme poškodenie (damage) pre zvolenú zbraň
            let foundDamage = 0;
            
            for (const category in WEAPON_LIST) {
                // Skontrolujeme, či daná kategória obsahuje našu zbraň (napr. WEAPON_LIST["BOJ ZBLÍZKA"]["nôž"])
                if (WEAPON_LIST[category][selectedWeaponName] !== undefined) {
                    foundDamage = WEAPON_LIST[category][selectedWeaponName];
                    break; // Zbraň sme našli, môžeme ukončiť cyklus
                }
            }

            // 3. Priradenie nájdenej hodnoty do globálnej premennej weapon
            weapon = foundDamage;

            log(`Zbraň: ${selectedWeaponName.toUpperCase()} (INTENZITA: ${weapon})`, "success-msg");
            if (!is_conflict) {
                log("Teraz nepotrebuješ zbraň.", "system-msg");
            }
        });


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
            fetch('../skillsDB.json').then(response => {
                if (!response.ok) throw new Error('Nepodarilo sa načítať súbor skillsDB.json');
                return response.json();
            })
        ])
        .then(([challengesData, enemyTypesData, heroesData, skillsDbData]) => {
            CHALLENGES = challengesData;
            ENEMY_TYPES = enemyTypesData;
            SKILLS_DB = skillsDbData; // <--- Uložíme dáta do globálnej premennej
            
            const savedCharacters = JSON.parse(localStorage.getItem('characters'));
            if (savedCharacters && savedCharacters.length > 0) {
                const builderHeroes = savedCharacters.map(char => ({
                    name: char.name.toUpperCase(),
                    skills: char.skills || {},
                    weapons: [],
                    stress_thresh: 8,
                    weapon: 1
                }));
                HEROES = [...builderHeroes, ...heroesData];
            } else {
                HEROES = heroesData;
            }
            selectHero();
            populateWeaponDropdown();
        })
        .catch(error => {
            console.error("Chyba pri inicializácii hry:", error);
        });