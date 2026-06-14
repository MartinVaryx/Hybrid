        let CHALLENGES = {};
        let ENEMY_TYPES = {};
        let HEROES = [];
        let SKILLS_DB = {}; // <--- PRIDANÉ: Sem sa načítajú dáta zo skillsDB.json
        let activeCharIdx = 0;
        let hero_selected = false;
        let sequential_msgs_done = false;
        let hero_created = true;
        let gameOn = false;
        let stockHeroesData = [];
 
        const DEBUG = true;
        const conflict_difficulty = 6;
        const conflict_threat = 2;
        let current_challenge_key = "START"; 


        const DEFENSE_SKILLS = ["OBRATNOSŤ", "ODOLNOSŤ", "ZMYSLY", "ŠPRINT"];
        const ATTACK_SKILLS = ["SILA", "OBRATNOSŤ", "ZMYSLY"]
        const CHASE_SKILLS = ["OBRATNOSŤ", "ZMYSLY", "ŠPRINT", "ŠPLHANIE"];

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
                "description":"Nakopne, ale aj upokojí.",
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
        let pre_encounter_challenge_key = null; // Tracks where the player was before entering combat (for escape)
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
        const stress_thresh = 8;
        let skill = 0;
        let advantage = 0;
        let enemy_advantage = 0;
        let cards_are_flipped = false; 
        
        let player_action = null; 
        let enemy_action = null;  

        let is_action_phase = false;
        let is_conflict = false; 
        let chase_mode = false;
        let current_challenge = { difficulty: 7, threat: 2 };
        let inputs_frozen = false;
        let combat_starter = null;
        let challenge_history = [];

        let currentSelectedCardIdx = 0; // Index karty v tray (0, 1, 2...)
        let currentSelectedActionType = "D"; // Predvolene vrchná zóna ("D" alebo "A" podľa flipu)


        // Global state initialized outside the functions
        let logs_pending = [];
        let isProcessingQueue = false;
        let onTerminalFinishedCallback = null; 
        let activeLogTimeout = null; // NEW: Keeps track of the active waiting timer

        function log(message, className = "", extraSpacing = true, extraSpacingB = false) {
            // Removed ^ so it matches "danger-msg", "combat-danger", etc.
            if (/(danger|failure|error|success)/i.test(className)) {
                extraSpacing = false;
                extraSpacingB = false;
            }
            
            logs_pending.push({ message, className, extraSpacing, extraSpacingB });
            if (!isProcessingQueue) {
                isProcessingQueue = true; 
                processQueue();
            }
        }

        function processQueue() {
            if (logs_pending.length === 0) {
                isProcessingQueue = false;
                if (typeof onTerminalFinishedCallback === "function") {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null; 
                    callback(); 
                }
                return;
            }

            const currentLog = logs_pending.shift();
            
            // Fix the dead-zone: If this was the last log, turn off the processing flag right now!
            if (logs_pending.length === 0) {
                isProcessingQueue = false; 
            }

            const terminal = document.getElementById("terminal-screen");
            const scrollContainer = terminal.parentElement; 

            if (currentLog.message !== "") {
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
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }

            // Only schedule a delay lock if there are actually more logs waiting to print next
            if (logs_pending.length > 0) {
                const characterDelay = currentLog.message.length * 20; 
                const finalDelay = Math.max(600, 200 + characterDelay);
                activeLogTimeout = setTimeout(processQueue, finalDelay);
            } else {
                activeLogTimeout = null;
                if (typeof onTerminalFinishedCallback === "function") {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null; 
                    callback(); 
                }
            }
        }

        document.getElementById("proceed-btn").addEventListener("click", function() {
            if (!gameOn) return;

            if (document.getElementById('hero-selection-overlay')) {
                return;
            }

            const prompt = document.getElementById("proceed-prompt");
            
            if (logs_pending.length > 0) {
                if (activeLogTimeout) {
                    clearTimeout(activeLogTimeout);
                    activeLogTimeout = null;
                }
                processQueue();
            } else {
                if (activeLogTimeout) {
                    clearTimeout(activeLogTimeout);
                    activeLogTimeout = null;
                }
                isProcessingQueue = false;
                if (prompt) prompt.style.display = "none";            
                inputs_frozen = true;
                executeProceedTransition();
            }
        });

        // --- UNIFIED KEYBOARD CONTROLLER ---
        window.addEventListener('keydown', (e) => {
            if (!gameOn) return;

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

            if (!inputs_frozen && !isChoiceVisible && !narrative_phase && !isReadyVisible && !isProceedVisible && !isGeneralVisible){
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
                if (is_conflict && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
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

                    if (!is_conflict) {
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
            if (gameOn) {
                
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
                    
                    // If there is actual text waiting in line, just advance to the next single log
                    if (logs_pending.length > 0) {
                        if (activeLogTimeout) {
                            clearTimeout(activeLogTimeout);
                            activeLogTimeout = null;
                        }
                        processQueue();
                    } 
                    // If the array is empty, we don't care about the leftover delay timer. JUMP INSTANTLY.
                    else {
                        if (activeLogTimeout) {
                            clearTimeout(activeLogTimeout);
                            activeLogTimeout = null;
                        }
                        isProcessingQueue = false; 
                        proceedPrompt.style.display = "none";
                        inputs_frozen = true;
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
            if (e.code === 'ArrowRight' && isProcessingQueue && activeLogTimeout) {
                e.preventDefault();
                clearTimeout(activeLogTimeout);
                activeLogTimeout = null;
                processQueue();
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

        function restartGame() {
            showGeneralPrompt(
                'Zvýšené úrovne schopností ti zostanú, ale tvoj pokrok ani predmety nebudú uložené. \n Chceš začať odznova?',
                () => {            
                        log("🔄 Reštartujem hru...", "danger-msg", true);

                        inputs_frozen = true;
                        updateUI();
                        
                        // Okamžité vyčistenie a znovunačítanie pôvodného stavu hry
                        window.location.reload();
                    }
            );

        }

        function showMenu() {
            // Zobrazíme pripravený HTML panel pre reštart
            const main_menu = document.getElementById("main-menu");
            if (main_menu) {
                main_menu.style.display = "flex";
            }
        }



        function hideMenu() {
            // Zobrazíme pripravený HTML panel pre reštart
            document.getElementById('main-menu').style.display = 'none';
        }

        function ifCase(caseTarget){
            const parts = caseTarget.split('_else_');
            if (parts.length >= 1) {
                const ifPart = parts[0].substring(3); // Odstráni "if_"
                const falseTarget = parts[1] || null;

                let flagKey, operator, rawValue, trueTarget;

                // 1. Pokus o zachytenie plného zápisu s operátorom (napr. door-open==true_TARGET)
                const match = ifPart.match(/^([a-zA-Z0-9_-]+?)([:=<>\!]+)([^_]+)_(.+)$/);

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

                // Ak sme úspešne zosúladili buď plný alebo skrátený zápis
                if (flagKey) {
                    const currentFlagValue = (typeof FLAGS !== 'undefined' && flagKey in FLAGS) ? FLAGS[flagKey] : false;
                    let conditionPassed = false;

                    let processedCurrent = currentFlagValue;
                    let processedTarget = rawValue;

                    if (rawValue.toLowerCase() === 'true') processedTarget = true;
                    else if (rawValue.toLowerCase() === 'false') processedTarget = false;
                    else if (!isNaN(Number(rawValue))) processedTarget = Number(rawValue);

                    if (!isNaN(Number(currentFlagValue)) && typeof currentFlagValue !== 'boolean') {
                        processedCurrent = Number(currentFlagValue);
                    }

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

                    // Určíme cieľ na základe výsledku podmienky
                    const finalTarget = conditionPassed ? trueTarget : falseTarget;

                    if (finalTarget) {
                        const lowerFinal = finalTarget.toLowerCase();

                        // --- KLÚČOVÁ ÚPRAVA: Detekcia systémových príkazov (módov) ---
                        // Kontrola, či cieľový reťazec vyzerá ako príkaz pre executeMods
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
                            return; // Úspešne vykonané, končíme
                        }

                        // Ak to nie je mod, pokračujeme klasickým prechodom na scénu/výzvu
                        handleChallengeTransition(finalTarget);
                        return;
                    } else {
                        // Ak podmienka neprešla a neexistoval žiadny "_else_", ticho skočíme (časté pri sekvenčných if-och)
                        if (DEBUG === true) {
                            log(`[ifCase] Podmienka pre '${ifPart}' neprešla a chýba 'else' vetva. Pokračujem ďalej.`);
                        }
                        return;
                    }
                }
            }
        }
            

        function handleChallengeTransition(caseTarget) {
            if (!caseTarget) return;
            gameOn = true;

            document.querySelectorAll("#card-tray-container .card-container").forEach(card => {
                card.classList.remove("keyboard-hover");
                card.children[0].classList.remove("keyboard-hover-zone");
                card.children[1].classList.remove("keyboard-hover-zone");
            });

            // --- UPRAVENÝ BLOK PRE KONTROLU FLAGS (IF-ELSE PARSING) ---
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
                    log(`Warning: Invalid BACK_ACTION step count '${actualTarget}'`, "danger-msg", true);
                    return;
                }

                const stepsToTake = Math.min(steps, challenge_history.length);
                const targetHistoryIndex = challenge_history.length - stepsToTake;
                const destination = challenge_history[targetHistoryIndex];

                if (!destination) {
                    log(`Warning: BACK_ACTION went past the beginning of history.`, "danger-msg", true);
                    return;
                }

                // 1. Odrežeme históriu presne pred cieľovou lokáciou
                challenge_history.splice(targetHistoryIndex);
                
                // 2. Dočasne nastavíme current_challenge_key na cieľ.
                // Tým pádom podmienka (current_challenge_key !== actualTarget) zlyhá 
                // a engine nepushne žiadnu starú lokáciu späť do poľa histórie.
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

                        // Ak to bola modifikácia a v poli ešte zostali nejaké ďalšie prvky
                        if (isModification && i < caseTarget.length) {
                            updateUI();
                            onTerminalFinishedCallback = () => {
                                processNextElement();
                            };
                        } else {
                            // Ak to bol posledný prvok poľa (napríklad "CITY") a je to regulárna lokácia,
                            // musíme zaistiť, že sa neudeje žiadny automatický "skok" ďalej.
                            const lastTarget = caseTarget[i];
                            if (i === caseTarget.length - 1 && CHALLENGES[lastTarget] && CHALLENGES[lastTarget].choice_A) {
                                // Zavoláme prechod na lokáciu a natvrdo ukončíme slučku poľa
                                handleChallengeTransition(lastTarget);
                                inputs_frozen = false; // Uvoľníme menu pre hráča
                                return; 
                            }

                            // Inak pokračuj hneď na ďalší prvok v poli
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
                    instanceKey = actualTarget; 
                    pre_encounter_challenge_key = current_challenge_key; 

                    actualTarget = enemyType;   
                }
            }

            // 1. If target dictates an explicit Enemy Combat deployment
            if (actualTarget in ENEMY_TYPES) { 
                inputs_frozen = true;
                updateUI();

                document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());

                enemy = actualTarget;
                enemy_id = instanceKey ? instanceKey : actualTarget;
                enemy_stress = (instanceKey && CHALLENGES[instanceKey] && CHALLENGES[instanceKey].saved_stress)
                    ? CHALLENGES[instanceKey].saved_stress
                    : 0;
                enemy_escaping = false;
                is_conflict = true;
                move = 0;
                combat_starter = null;

                const enemyContainer = document.getElementById("enemy-sprite-container");
                const enemyImg = document.getElementById("enemy-sprite");
                if (enemyContainer && enemyImg && ENEMY_TYPES[actualTarget].image) {
                    enemyImg.src = ENEMY_TYPES[actualTarget].image;
                    enemyContainer.style.display = "block";
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
                    log(`\n⚔️ Priprav sa na boj! Proti tebe stojí: ${actualTarget}`, "danger-msg", true);
                    
                    // Počkáme na jedno stlačenie Proceed, kým reálne spustíme bojové kolo
                    proceed(() => {
                        inputs_frozen = false;
                        updateUI();
                        gameloop(false);
                    });
                }
                // ========================================================================= 
                return;
            }

            // 2. If target moves the user forward to another challenge map node
            if (actualTarget in CHALLENGES) { 
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
                    return; 
                }
                
                // --- CLEANED: Replaced with clean centralized helper call ---
                renderChallengeChoices(activeChallenge);
                return;
            }

            // 3. If target string contains stat modifications (e.g. additions or assignments)
            if (typeof caseTarget === 'string') {
                modificationExecuted = executeMods(caseTarget)
                if (modificationExecuted) {
                    inputs_frozen = false;
                    updateUI();
                    return;
                }
            }

            log(`Warning: Unhandled routing instruction case reference '${caseTarget}'`, "danger-msg", true);
        }
        
        function executeMods(caseTarget){
            const lowerTarget = caseTarget.toLowerCase();
            let modificationExecuted = false;

            if (lowerTarget.startsWith("flag_")) {
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
            else if (lowerTarget.startsWith("set_")) {
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
                            const state = CHALLENGES["ACTIVE"][challengeName];
                            log(`Stav výzvy ${challengeName} bol zmenený na ${booleanState}.`);
                        }
                    }
                }
            }

            // --- Handle incremental modifications using '+' or '-' ---
            if (lowerTarget.includes("+") || lowerTarget.includes("-")) {
                const isAddition = lowerTarget.includes("+");
                const parts = isAddition ? caseTarget.split("+") : caseTarget.split("-");
                const amount = parts[1] ? parseInt(parts[1]) : 1;
                const modifier = isAddition ? amount : -amount; 

                if (lowerTarget.includes("stress")) {
                    HERO.stress += modifier;
                    if(modifier <0) flashRed();
                    if (HERO.stress < 0) HERO.stress = 0; 
                    
                    if (modifier > 0) {
                        log(`Stúpol ti stres o ${amount}!`, "danger-msg");
                    } else {
                        log(`Stres ti klesol o ${amount}.`, "success-msg");
                    }
                    
                    if (HERO.stress > stress_thresh) {
                        inputs_frozen = true;
                        log("💀 Stres presiahol hodnotu kolapsu. KONIEC HRY.", "failure-msg", true);
                        restartGame();
                        return;
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
                        // Nájdeme postavu v localStorage podľa mena (ignorujeme veľkosť písmen)
                        const charIndex = savedCharacters.findIndex(char => char.name.toUpperCase() === HERO.name.toUpperCase());
                        
                        if (charIndex !== -1) {
                            // Inicializácia sp v databáze, ak neexistuje, a pripočítanie modifikátora
                            const currentDbSp = savedCharacters[charIndex].sp || 0;
                            savedCharacters[charIndex].sp = currentDbSp + modifier;
                            if (savedCharacters[charIndex].sp < 0) savedCharacters[charIndex].sp = 0;

                            // Uloženie aktualizovaného poľa postáv späť do localStorage
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
                    const weaponName = lowerTarget.split("weapon+")[1].trim().split(" ")[0].toLowerCase();
                    
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
            else if (
                    (() => {
                        const targetWeaponName = parts[0].trim().toLowerCase();
                        // 2. Prejdeme WEAPON_LIST a zistíme, či táto zbraň vôbec existuje
                        for (const category in WEAPON_LIST) {
                            if (WEAPON_LIST[category] && WEAPON_LIST[category][targetWeaponName] !== undefined) {
                                return true; // Našli sme ju, podmienka platí
                            }
                        }
                        return false; // Nie je to zbraň, táto vetva sa preskočí
                    })()
                ) {
                    // Keďže vieme, že podmienka prešla, môžeme bezpečne vykonať úpravu munície
                    const targetWeaponName = parts[0].trim().toLowerCase();
                    const currentWeaponAmmo = HERO["ammo"][targetWeaponName] || 0;
                    const newAmmoValue = Math.max(0, currentWeaponAmmo + modifier);
                    
                    HERO["ammo"][targetWeaponName] = newAmmoValue;

                    if (modifier > 0) {
                        log(`Získavaš muníciu pre ${targetWeaponName.toUpperCase()}: +${amount} ks. (Celkovo: ${newAmmoValue})`, "success-msg");
                    } else {
                        log(`Strácaš muníciu pre ${targetWeaponName.toUpperCase()}: -${amount} ks. (Celkovo: ${newAmmoValue})`, "danger-msg");
                    }

                    modificationExecuted = true;
                }
                else if (lowerTarget.includes("item_")) {
                    const itemName = parts[0].split("item_")[1].trim().toUpperCase();

                    if (!HERO.items || typeof HERO.items !== 'object') {
                        HERO.items = {};
                    }

                    if (ITEM_LIST[itemName] !== undefined) {
                        const current = HERO.items[itemName] || 0;
                        const newVal = Math.max(0, current + modifier);
                        HERO.items[itemName] = newVal;

                        if (modifier > 0) {
                            log(`Získavaš predmet: ${itemName} (${newVal})!`, "success-msg");
                        } else {
                            log(`Strácaš predmet: ${itemName} (zostatok: ${newVal}).`, "danger-msg");
                        }
                    } else if (DEBUG === true) {
                        log(`Predmet ${itemName} neexistuje v ITEM_LIST.`, "danger-msg");
                    }

                    modificationExecuted = true;
                }
            }

            if (modificationExecuted) {
                return true;
            }
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
                if(modifier<0) flashRed();
                log(modifier < 0 
                    ? `Stres ti klesol o ${amount}. (${HERO.stress})` 
                    : `Stres ti stúpol o ${amount}. (${HERO.stress})`, 
                    modifier < 0 ? "success-msg" : "danger-msg");
            } 
            else if (effectTarget === "advantage") {
                advantage = Math.max(0, advantage + modifier);
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

            const preloadUrls = suffixes
            .map(suff => activeChallenge[`case_${suff}`])
            .filter(target => target && CHALLENGES[target]?.image)
            .map(target => CHALLENGES[target].image);

            if (preloadUrls.length > 0) {
                preloadImages(preloadUrls); 
            }

            if (activeChallenge.back === true && challenge_history.length > 0) {
                validChoices.push({
                    text: "⬅",
                    target: "BACK_ACTION_1", 
                    isBack: true
                });
            }

            suffixes.forEach(suff => {
                if (activeChallenge[`choice_${suff}`] && activeChallenge[`case_${suff}`]) {
                    const target = activeChallenge[`case_${suff}`];
                    if (CHALLENGES["ACTIVE"] && CHALLENGES["ACTIVE"][target] === false) {
                        return; 
                    }
                    validChoices.push({
                        text: activeChallenge[`choice_${suff}`],
                        target: target
                    });
                }
            });

            const hasRealChoices = suffixes.some(suff => activeChallenge[`choice_${suff}`]);

            if (validChoices.length > 0 && (hasRealChoices || activeChallenge.difficulty === undefined)) {
                inputs_frozen = true;
                narrative_phase = true; 
                document.getElementById("player-turn-indicator").innerText = "VYBER SI MOŽNOSŤ";
                
                let choicePrompt = document.getElementById("choice-prompt");
                if (!choicePrompt) {
                    choicePrompt = document.createElement("div");
                    choicePrompt.id = "choice-prompt";
                    choicePrompt.style.cssText = `
                        position: absolute; bottom: 2%; left: 0; right: 0; margin: 0 auto;
                        padding: 10px; display: flex; flex-wrap: wrap;
                        justify-content: center; gap: 10px; z-index: 200; max-width: 650px;
                    `;
                    document.querySelector(".gaming-table-floor").appendChild(choicePrompt);
                }

                choicePrompt.innerHTML = "";
                activeChoiceIndex = 0; // Reset index to the first choice automatically

                // Store a structural reference directly on the container element so our key listener can access it safely
                choicePrompt.userData = { validChoices: validChoices };

                validChoices.forEach((choice, index) => {
                    const btn = document.createElement("button");
                    btn.className = "adrenaline-select";
                    
                    // Set base styling matching your custom specs
                    if (choice.isBack) {
                        btn.style.cssText = `
                            position: absolute; bottom: 10px; left: -20px; height: 46px;
                            white-space: nowrap; padding: 0 16px; border-radius: 9px;
                            background: rgb(0, 0, 0); border: 3px solid rgba(201, 201, 201, 0.96);
                            color: rgb(224, 224, 224); font-size: 1.2em; cursor: pointer;
                        `;
                    } else {
                        btn.style.cssText = `
                            height: 46px; white-space: nowrap; padding: 0 16px; border-radius: 9px;
                            background: rgb(231, 231, 231); backdrop-filter: blur(6px);
                            -webkit-backdrop-filter: blur(6px); border: 3px solid rgba(25, 25, 25, 0.96);
                            color: rgb(0, 0, 0); font-size: 1.1em; cursor: pointer;
                        `;
                    }

                    btn.innerText = choice.text;
                    
                    // Mouse Hover switches active keyboard focus seamlessly
                    btn.onmouseenter = () => {
                        activeChoiceIndex = index;
                        updateVisualChoiceHighlights();
                    };

                    btn.onclick = () => {
                        choicePrompt.style.display = "none";
                        narrative_phase = false;
                        handleChallengeTransition(choice.target);
                    };
                    
                    choicePrompt.appendChild(btn);
                });

                choicePrompt.style.display = "flex";
                updateVisualChoiceHighlights(); // Apply initial first element highlight state
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

        function runActionPhase() {
            enemy = null;
            is_conflict = false;
            player_action = null;
            enemy_action = null;
            move = 0;
            hidecards(true);

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

            // This helper executes the UI setup and logic flow
            const proceedWithPhase = () => {
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

                const challengeDisplay = document.getElementById("challenge-stats-display");
                if (challengeDisplay) {
                    if (activeChallenge.difficulty !== undefined && activeChallenge.threat !== undefined) {
                        challengeDisplay.style.display = "flex";
                        is_action_phase = true;
                        challengeDisplay.innerHTML = `
                            <div class="stat-item"><img src="assets/DIFFICULTY.png" class="stat-icon"> <span>${current_challenge.difficulty}</span></div>
                            <div class="stat-item"><img src="assets/THREAT.png" class="stat-icon"> <span>${current_challenge.threat}</span></div>
                        `;
                    } else {
                        is_action_phase = false;
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
                    updateUI();
                    let currentMsgIdx = 0;

                    const showNextNarrativeMessage = () => {
                        log(sequentialMsgs[currentMsgIdx], "narrative-msg", true);
                        if (currentMsgIdx === sequentialMsgs.length - 1) {
                            if (activeChallenge && activeChallenge.next) {
                                proceed(() => {
                                    inputs_frozen = false;
                                    updateUI();
                                    handleChallengeTransition(activeChallenge.next);
                                });
                            } else {
                                inputs_frozen = false;
                                updateUI();
                                renderChallengeChoices(activeChallenge);
                            }
                        } else {
                            currentMsgIdx++;
                            proceed(showNextNarrativeMessage);
                        }
                    };
                    proceed(showNextNarrativeMessage);
                }
            };

            // --- Image asset management ---
            if (tableFloor && activeChallenge.image) {
                const newUrl = activeChallenge.image;
                
                // 1. Check if it's already the current one
                if (tableFloor.style.getPropertyValue('--bg-image') === `url('${newUrl}')`) {
                    proceedWithPhase();
                } else {
                    // 2. Create a temporary image to force a clean decode
                    const tempImg = new Image();
                    tempImg.onload = () => {
                        tableFloor.style.setProperty('--bg-image', `url('${newUrl}')`);
                        tableFloor.classList.add('fade-in');
                        proceedWithPhase(); // Now proceed with UI/logic
                    };
                    tempImg.src = newUrl; 
                }
            } else {
                if (tableFloor) tableFloor.style.removeProperty('--bg-image');
                proceedWithPhase();
            }
        }


        // Sledovanie výberu schopnosti hráčom (mimo boja aj počas boja)
        document.getElementById("player-skill-dropdown").addEventListener("change", function(e) {
            const selectedSkillName = e.target.value;
            let chosenSkillValue = 0;
            // --- REŽIM BOJA (COMBAT) ---
            if (enemy) {
                const skillData = SKILLS_DB[selectedSkillName];
                const isDefenseSkill = DEFENSE_SKILLS.includes(selectedSkillName.toUpperCase());
                const isCombatSkill = ATTACK_SKILLS.includes(selectedSkillName.toUpperCase()) || 
                        (skillData && skillData[1] && skillData[1].toUpperCase().includes("BOJ"));                
                let isPlaceholder = false;
                if (selectedSkillName == "placeholder") isPlaceholder = true;
                // PRVÝ KROK: Ak schopnosť nie je bojová a nie je ani v obranných, vyhodíme ju
                if (!isCombatSkill && !isDefenseSkill && !isPlaceholder) {
                    log(`⚠️ "${selectedSkillName}" nemôžeš použiť v boji.`, "error-msg");
                    return;
                }
            }
            // --- REŽIM VÝZVY (CHALLENGE) ---
            const activeChallenge = CHALLENGES[current_challenge_key];
            const actualHeroValue = HERO.skills[selectedSkillName] || 0;

            if (activeChallenge && activeChallenge.skills && activeChallenge.skills.length > 0) {
                if (!activeChallenge.skills.includes(selectedSkillName)) {
                    log(`⚠️ Schopnosť ${selectedSkillName} ti teraz nepomôže, skús jednu z týchto: (${activeChallenge.skills.join(', ')})`, "error-msg");
                } else {
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

            let currentIndex = el.selectedIndex;
            let nextIndex = currentIndex;

            // Cyklujeme indexy, ignorujeme iba explicitne zakázané (disabled) možnosti, ak nejaké sú
            do {
                nextIndex = (nextIndex + direction + options.length) % options.length;
                if (nextIndex === currentIndex) break;
            } while (options[nextIndex].disabled);

            if (nextIndex !== currentIndex) {
                el.selectedIndex = nextIndex;
                // Spustíme zmenu (change event), aby náš tray listener vedel okamžite reagovať
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
                placeholder.textContent = "- ŽIADNA SCHOPNOSŤ -";
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
                if (val <= HERO.stress) {
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
                    const activeChallenge = CHALLENGES[current_challenge_key];
                    if (activeChallenge && activeChallenge.difficulty !== undefined && activeChallenge.threat !== undefined) {
                        challengeDisplay.style.display = "flex";
                        is_action_phase = true
                    } else {
                        is_action_phase = false;
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
                
                if (tableFloor) tableFloor.classList.add("combat-mode");
                if (challengeDisplay) challengeDisplay.style.display = "none";
                is_action_phase = false;
                if (enemyHeading) enemyHeading.innerText = enemy;
            }

            if (inputs_frozen ) {
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
                    log(`${activeChallenge.threat_avoided_msg || "Vyhneš sa hrozbe."} (KOCKY HROZBY: ${threat_roll} <= TVOJA OPATRNOSŤ: ${caution_threshold})`, "success-msg");
                }
            }

            resetAdrenalineSelection();

            // 3. Process execution route updates based on cleanly updated state flags
            inputs_frozen = false;

            // Ak sa naplnila hrozba, aplikujeme jej efekty priamo tu
            if (threat_realized) {
                if (activeChallenge.case_threat_delayed) {
                    if (Array.isArray(activeChallenge.case_threat_delayed)) {
                        DELAYED.push(...activeChallenge.case_threat_delayed);
                    } else {
                        DELAYED.push(activeChallenge.case_threat_delayed);
                    }
                }

                // Handle case_threat as either a string or an array of mod strings
                if (typeof activeChallenge.case_threat === 'string') {
                    if (typeof DEBUG !== 'undefined' && DEBUG === true) {
                        const executed = executeMods(activeChallenge.case_threat);
                        if (executed) {
                            log("DEBUG: Threat modifications executed.");
                        } else {
                            log(`DEBUG: Threat modifications not executed. Case threat: ${activeChallenge.case_threat}`, "info-msg");
                        }
                    } else {
                        executeMods(activeChallenge.case_threat);
                    }
                    updateUI();

                } else if (Array.isArray(activeChallenge.case_threat)) {
                    let i = 0;
                    const threatMods = activeChallenge.case_threat;

                    function processNextThreatMod() {
                        if (i >= threatMods.length) {
                            updateUI();
                            return;
                        }

                        const mod = threatMods[i];
                        const isModification = typeof mod === 'string' &&
                            (mod.includes('+') || mod.includes('-') || mod.includes('=') || mod.toLowerCase().includes('weapon+'));

                        if (typeof DEBUG !== 'undefined' && DEBUG === true) {
                            let executed = executeMods(mod);
                            if (executed) {
                                log("DEBUG: Threat modifications executed.");
                            } else {
                                log(`DEBUG: Threat modifications not executed. Case threat: ${mod}`, "info-msg");
                            }
                        } else {
                            executeMods(mod);
                        }

                        i++;

                        if (isModification && i < threatMods.length) {
                            inputs_frozen = true;
                            updateUI();
                            // Sync loop continuation with the terminal line duration clearing
                            onTerminalFinishedCallback = () => {
                                inputs_frozen = false;
                                processNextThreatMod();
                            };
                        } else {
                            processNextThreatMod();
                        }
                    }

                    processNextThreatMod();
                }
            }

            // Bezpečne posielame hráča na výslednú lokáciu hneď po odovzdaní textu do fronty
            if (success) {
                HERO.sp = Math.max(0, (HERO.sp || 0) + 1);
                log("Získavaš 1 BR!");
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
        }

        function gameloop(success = true) {
            if (enemy === null) {
                if (success) {
                    setTimeout(() => {
                    runActionPhase();
                    },500)
                } else {
                    // Fail-safe fallback if state engine defaults
                    enemy = "Skautka";
                    enemy_stress = 0;
                    enemy_escaping = false;
                    is_conflict = true;
                    move = 0;
                    combat_starter = null;
                    setTimeout(() => {
                    runConflictTurn();
                    },1000)
                }
            } else {
                setTimeout(() => {
                runConflictTurn();
                },300)
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
            log(`TY: ${player_roll}${p_mods}   ⚔️   ${enemy.toUpperCase()}: ${enemy_roll}${e_mods}`, "error-msg", true);

            enemy_roll += enemy_advantage;
            player_roll += (advantage + adrenaline); 

            resetAdrenalineSelection();


            // CHASE REŽIM A LOGIKA ÚTEKOV (NOVÁ VERZIA)
            // ==========================================
            // Ak sú v režime chase obaja na úteku (Hráč klikol na Čin "D" a nepriateľ si vylosoval Čin "D")
            if (chase_mode && player_escaping && enemy_escaping && player_action[0] === "D" && enemy_action[0] === "D") {
                log(`\n🏃‍♂️ Obojstranný útek! Ty aj nepriateľ utekáte opačným smerom. Konflikt končí!`, "info-msg", true);
                
                enemy_escape_counter += 2; // Nepriateľ získava okamžitý útek
                log(`🏃 ${enemy.toUpperCase()} ti definitívne mizne z dohľadu!`, "danger-msg");
                
                inputs_frozen = true;
                updateUI();
                
                // Remove inputs_frozen or update UI elements if necessary, then hook into the terminal finish
                onTerminalFinishedCallback = () => {
                    const enemyContainer = document.getElementById("enemy-sprite-container");
                    if (enemyContainer) enemyContainer.style.display = "none";
                    
                    let activeChallenge = CHALLENGES[current_challenge_key];
                    
                    // Zapíšeme prípadné delayed efekty z úteku nepriateľa
                    if (activeChallenge && activeChallenge.enemy_escape_delayed) {
                        if (Array.isArray(activeChallenge.enemy_escape_delayed)) {
                            DELAYED.push(...activeChallenge.enemy_escape_delayed);
                        } else if (activeChallenge.enemy_escape_delayed !== "") {
                            DELAYED.push(activeChallenge.enemy_escape_delayed);
                        }
                    }

                    // Kompletný bezpečný reset bojových premenných
                    enemy = null; enemy_stress = 0; enemy_escaping = false; player_escaping = false; chase_mode = false;
                    player_escape_counter = 0; enemy_escape_counter = 0;
                    enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                    player_action = null; enemy_action = null; is_conflict = false;

                    // Posun v hre na vetvu úteku nepriateľa alebo pokračovanie scenára
                    if (activeChallenge && activeChallenge.enemy_escape) {
                        proceed(activeChallenge.enemy_escape);
                    } else if (pending_challenge_key) {
                        let nextChallenge = pending_challenge_key; 
                        pending_challenge_key = null; 
                        proceed(nextChallenge);
                    } else {
                        proceed(activeChallenge.case_success);
                    }
                };

                // If there are no log prints running right now, trigger the callback immediately 
                if (!isProcessingQueue) {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null;
                    callback();
                }
                
                return; // 🛑 KLÚČOVÉ: Ukončíme resolveConflict, nepokračujeme na kocky ani zranenia!
            }
            // PRED-VYHODNOTENIE: Skontrolujeme, či strana, ktorá uniká, nezvolila ÚTOK. 
            // Ak unikajúca strana zaútočí, chase_mode okamžite končí a vraciame sa do normálneho konfliktu.
            if (chase_mode) {
                if (player_escaping && player_action[0] === "A") {
                    log(`\n⚔️ Zaútočil si počas úteku! Rušíš útek a prechádzaš späť do tvrdého boja.`, "info-msg");
                    chase_mode = false;
                    player_escaping = false;
                    player_escape_counter = 0;
                    // Necháme kód pretiecť nižšie do štandardného vyhodnotenia zranení
                }
                else if (enemy_escaping && enemy_action[0] === "A") {
                    log(`\n⚔️ Protivník sa otočil a útočí na teba!`, "info-msg");
                    chase_mode = false;
                    enemy_escaping = false;
                    enemy_escape_counter = 0;
                    // Necháme kód pretiecť nižšie do štandardného vyhodnotenia zranení
                }
            }

            // AK AJ PO KONTROLE VYŠŠIE ZOSTAL CHASE_MODE AKTÍVNY, VYHODNOCUJEME COUNTERY:
            if (chase_mode) {
                
                // ----------------------------------------------------
                // SCENÁR 1: UNIKÁ HRÁČ (player_escaping === true)
                // ----------------------------------------------------
                if (player_escaping) {
                    // Výhra hráča -> Úspešný krok k úniku
                    if (player_roll > enemy_roll) {
                        player_escape_counter++;
                        log(`🏃 Úspešný únikový manéver! (Únik: ${player_escape_counter}/2)`, "success-msg");
                    } 
                    // Výhra nepriateľa (prenasledovateľa)
                    else if (enemy_roll > player_roll) {
                        // Výnimka: Ak prenasledujúci nepriateľ útočil z diaľky ("A"), counter to neovplyvní (len schytáš zranenie)
                        if (enemy_action[0] === "A") {
                            if (player_escape_counter<1) {
                            log(`🎯 Protivník ťa zasiahol počas úteku!`, "warning-msg");
                            } else {
                                log(`🎯 Protivník ťa trafil nadiaľku počas úteku!`, "warning-msg");
                            }
                        } else {
                            player_escape_counter = Math.max(0, player_escape_counter - 1);
                            log(`⚠️ Protivník ťa dobieha! (Únik: ${player_escape_counter}/2)`, "danger-msg");
                        }
                    }
                    // Remíza pri úteku hráča -> Counter sa nemení
                    else {
                        log(`🏃 Prenasledovanie pokračuje, držíš si odstup. (Únik: ${player_escape_counter}/2)`, "info-msg");
                    }

                    // KONTROLA DOSIAHNUTIA LIMITU 2 PRE HRÁČA
                    if (player_escape_counter >= 2) {
                        log(`\n Úspešne ujdeš z boja!`, "success-msg");
                        inputs_frozen = true;
                        updateUI();
                        
                        // Bind everything safely to your terminal output sequence completion
                        onTerminalFinishedCallback = () => {
                            const enemyContainer = document.getElementById("enemy-sprite-container");
                            if (enemyContainer) enemyContainer.style.display = "none";
                            let activeChallenge = CHALLENGES[current_challenge_key];

                            // Pamäť nepriateľa: ak má wrapper, uložíme jeho aktuálny stres
                            if (enemy_id && CHALLENGES[enemy_id] && CHALLENGES[enemy_id].type) {
                                CHALLENGES[enemy_id].saved_stress = enemy_stress;
                            }
                            
                            // Kompletný reset bojových premenných
                            const bothEscaping = player_escaping && enemy_escaping;
                            enemy = null; enemy_stress = 0; enemy_escaping = false; player_escaping = false; chase_mode = false;
                            player_escape_counter = 0; enemy_escape_counter = 0;
                            enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                            player_action = null; enemy_action = null; is_conflict = false;

                            // Výnimka: Ak aj nepriateľ unikal, hráč pokračuje dopredu ako pri víťazstve
                            if (bothEscaping) {
                                pre_encounter_challenge_key = null;
                                if (pending_challenge_key) {
                                    let nextChallenge = pending_challenge_key; 
                                    pending_challenge_key = null; 
                                    proceed(nextChallenge);
                                } else if (activeChallenge && activeChallenge.case_success) {
                                    proceed(activeChallenge.case_success);
                                }
                            } 
                            // Bežný útek hráča cez BACK_ACTION históriu
                            else if (pre_encounter_challenge_key) {
                                let stepsToRetreat = 1; 
                                
                                // Ak bod odkiaľ sme prišli bol boj, ustúpime o 2 kroky namiesto 1
                                if (CHALLENGES[pre_encounter_challenge_key] && CHALLENGES[pre_encounter_challenge_key].type && CHALLENGES[pre_encounter_challenge_key].type in ENEMY_TYPES) {
                                    stepsToRetreat = 2;
                                }
                                
                                pre_encounter_challenge_key = null;
                                pending_challenge_key = null;

                                // Vyčistenie hracieho poľa
                                document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());
                                const enemyCardContainer = document.getElementById("enemy-card-container");
                                if (enemyCardContainer) enemyCardContainer.innerHTML = "";
                                const playerCardContainer = document.getElementById("player-card-container");
                                if (playerCardContainer) playerCardContainer.innerHTML = "";
                                
                                // Spustenie samotného ústupu
                                handleChallengeTransition('BACK_ACTION_' + stepsToRetreat);
                            } 
                            // Fallback navigácia dopredu, ak neexistuje pred-bojová história
                            else if (pending_challenge_key) {
                                let nextChallenge = pending_challenge_key; 
                                pending_challenge_key = null; 
                                proceed(nextChallenge);
                            } else if (activeChallenge && activeChallenge.case_success) {
                                proceed(activeChallenge.case_success);
                            }
                        };

                        // Fallback protection: If no text strings are being handled right now, run the callback instantly
                        if (!isProcessingQueue) {
                            const callback = onTerminalFinishedCallback;
                            onTerminalFinishedCallback = null;
                            callback();
                        }
                        return;
                    }
                }
                
                // ----------------------------------------------------
                // SCENÁR 2: UNIKÁ NEPRIATEĽ (enemy_escaping === true)
                // ----------------------------------------------------
                else if (enemy_escaping) {
                    // Výhra nepriateľa -> Úspešný krok k úniku
                    if (enemy_roll > player_roll) {
                        enemy_escape_counter++;
                        log(`🏃 ${enemy.toUpperCase()} sa ti vzďaľuje! (Únik nepriateľa: ${enemy_escape_counter}/2)`, "danger-msg");
                    } 
                    // Výhra hráča (prenasledovateľa)
                    else if (player_roll > enemy_roll) {
                        // Výnimka: Ak prenasledujúci hráč útočil z diaľky ("A"), counter nepriateľa to neovplyvní
                        if (player_action[0] === "A") {
                            log(`🎯 Triafaš unikajúceho nepriateľa!`, "success-msg");
                        } else {
                            enemy_escape_counter = Math.max(0, enemy_escape_counter - 1);
                            log(`🛑 Dobiehaš nepriateľa a skracuješ odstup! (Únik nepriateľa: ${enemy_escape_counter}/2)`, "success-msg");
                        }
                    }
                    // Remíza
                    else {
                        log(`🏃 Držíte si rovnaké tempo. (Únik nepriateľa: ${enemy_escape_counter}/2)`, "info-msg");
                    }

                    // KONTROLA DOSIAHNUTIA LIMITU 2 PRE NEPRIATEĽA
                    if (enemy_escape_counter >= 2) {
                        log(`\n🏃 ${enemy.toUpperCase()} ti definitívne mizne z dohľadu!`, "danger-msg");
                        HERO.sp = Math.max(0, (HERO.sp || 0) + 1);
                        log(`Získavaš 1 BR.`, "success-msg");
                        inputs_frozen = true;
                        updateUI();
                        // Bind the transition safely to your terminal output finish line
                        onTerminalFinishedCallback = () => {
                            const enemyContainer = document.getElementById("enemy-sprite-container");
                            if (enemyContainer) enemyContainer.style.display = "none";
                            let activeChallenge = CHALLENGES[current_challenge_key];
                            
                            // Zapíšeme prípadné delayed efekty z úteku nepriateľa
                            if (activeChallenge && activeChallenge.enemy_escape_delayed) {
                                if (Array.isArray(activeChallenge.enemy_escape_delayed)) {
                                    DELAYED.push(...activeChallenge.enemy_escape_delayed);
                                } else if (activeChallenge.enemy_escape_delayed !== "") {
                                    DELAYED.push(activeChallenge.enemy_escape_delayed);
                                }
                            }

                            // Kompletný bezpečný reset bojových premenných
                            enemy = null; enemy_stress = 0; enemy_escaping = false; player_escaping = false; chase_mode = false;
                            player_escape_counter = 0; enemy_escape_counter = 0;
                            enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                            player_action = null; enemy_action = null; is_conflict = false;

                            // Posun v hre na vetvu úteku nepriateľa alebo pokračovanie scenára
                            if (activeChallenge && activeChallenge.enemy_escape) {
                                proceed(activeChallenge.enemy_escape);
                            } else if (pending_challenge_key) {
                                let nextChallenge = pending_challenge_key; 
                                pending_challenge_key = null; 
                                proceed(nextChallenge);
                            } else {
                                proceed(activeChallenge.case_success);
                            }
                        };

                        // Fallback protection: If the text engine isn't running, execute instantly
                        if (!isProcessingQueue) {
                            const callback = onTerminalFinishedCallback;
                            onTerminalFinishedCallback = null;
                            callback();
                        }
                        return;
                    }
                }

                // Ak chase_mode pokračuje (nikto nedosiahol limit 2 a nikto nezaútočil, aby ho zrušil),
                // tak po aplikovaní prípadných zranení zo streľby nižšie sa posunieme do ďalšieho chase kola.
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
                log(`Zvyšuješ protivníkovi stres o ${potential_enemy_damage}.`, "success-msg");
                const enemyContainer = document.getElementById("enemy-sprite-container");
                if (enemyContainer) {
                    enemyContainer.classList.remove("enemy-hit");
                    void enemyContainer.offsetWidth; 
                    enemyContainer.classList.add("enemy-hit");
                }
            }

            if (potential_player_damage > 0) {
                HERO.stress += potential_player_damage;
                flashRed();
                log(`Stúpol ti stres o: ${potential_player_damage}.`, "failure-msg");
            }

            // --- 3. EVALUATE HEALTH THRESHOLDS (DEATH CHECKS) ---
            let player_dead = HERO.stress > stress_thresh;
            let enemy_dead = enemy_stress > ENEMY_TYPES[enemy]["stress_thresh"];

            // CASE A: Mutual Kill (Tie scenario where both exceed stress thresholds)
            if (player_dead && enemy_dead) {
                log(`\n💀 Ou! Zabili ste sa navzájom!`, "failure-msg", true);
                inputs_frozen = true;
                updateUI();
                // Bind the game restart directly to the completion of the terminal text sequence
                onTerminalFinishedCallback = () => {
                    restartGame();
                };

                // Fallback protection: If the text queue is already completely empty, restart immediately
                if (!isProcessingQueue) {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null;
                    callback();
                }
                return;
            }

            // CASE B: Only Player Collapses
            if (player_dead) {
                log(`💀 TVOJ STRES PREKROČIL HODNOTU KOLAPSU. KONIEC HRY.`, "failure-msg", true);
                inputs_frozen = true;
                updateUI();
                // Bind the game restart directly to the completion of the terminal text sequence
                onTerminalFinishedCallback = () => {
                    restartGame();
                };

                // Fallback protection: If the text queue is already completely empty, restart immediately
                if (!isProcessingQueue) {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null;
                    callback();
                }
                return;
            }

            // CASE C: Only Enemy Collapses
            if (enemy_dead) { 
                HERO.sp = Math.max(0, (HERO.sp || 0) + 1);
                log(`\n💥 ${enemy} JE DOLE! Získavaš 1 BR a môžeš pokračovať.`, "success-msg");
                inputs_frozen = true;
                updateUI();

                // Bind the container reset and challenge updates cleanly to the terminal text completion
                onTerminalFinishedCallback = () => {
                    const enemyContainer = document.getElementById("enemy-sprite-container");
                    if (enemyContainer) enemyContainer.style.display = "none";

                    let activeChallenge = CHALLENGES[current_challenge_key];
                    if (current_challenge_key) {
                        CHALLENGES["ACTIVE"][current_challenge_key] = false; 
                    }
                    
                    // Kompletný bezpečný reset bojových premenných
                    enemy = null; enemy_stress = 0; enemy_escaping = false; player_escaping = false; chase_mode = false;
                    enemy_advantage = 0; advantage = 0; move = 0; round += 1;
                    player_action = null; enemy_action = null; is_conflict = false;

                    // Posun v hre na ďalšiu výzvu alebo úspešný koniec vetvy výzvy
                    if (pending_challenge_key) {
                        let nextChallenge = pending_challenge_key;
                        pending_challenge_key = null; 
                        proceed(nextChallenge); 
                    } else {
                        proceed(activeChallenge.case_success); 
                    }
                };

                // Fallback protection: If the text loop engine is not running, fire instantly
                if (!isProcessingQueue) {
                    const callback = onTerminalFinishedCallback;
                    onTerminalFinishedCallback = null;
                    callback();
                }
                return;
            }

            // --- 4. ADVANTAGE DETERMINATION (If both survived) ---
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
                if ((player_roll > enemy_roll && player_action[0] === "D" && enemy_zero_counter > 1) || 
                    (player_roll === enemy_roll && player_action[0] === "D" && enemy_action[0] === "A" && enemy_zero_counter > 1)) {
                    advantage += 1;
                    log("Dostaneš sa do lepšej pozície a získavaš výhodu +1 do ďalšieho kola.");
                } 
            }
            if (!enemy_escaping){
                if ((player_roll < enemy_roll && enemy_action[0] === "D" && player_zero_counter > 1) || 
                (player_roll === enemy_roll && enemy_action[0] === "D" && player_action[0] === "A" && player_zero_counter > 1)) {
                    enemy_advantage += 1;
                    log(`🛡️ Nepriateľ uskočil do výhodnejšej pozície! Získava výhodu +1 do ďalšieho kola.`);
                }
            }
        

            if (player_action[0] === "D" && enemy_action[0] === "D") {
                const capturedPlayerAction = player_action;   
                const capturedEnemyAction = enemy_action;     
                const capturedPlayerRoll = player_roll;
                const capturedEnemyRoll = enemy_roll;

                // 1. Process Player Threat Check (Fires lines instantly to logs_pending)
                if (capturedPlayerRoll <= conflict_difficulty) {
                    checkConflictThreat(capturedPlayerRoll, false, capturedPlayerAction);
                }
                
                // 2. Process Enemy Threat Check (Fires lines instantly to logs_pending right behind player lines)
                if (capturedEnemyRoll <= conflict_difficulty) {
                    checkConflictThreat(capturedEnemyRoll, true, capturedEnemyAction);
                }
            }

            // Reset round statistics immediately
            move = 0;
            round += 1;
            player_action = null;
            enemy_action = null;

            // 3. SECURE GAMEFLOW COUPLING:
            setTimeout(() => {
                gameloop(false);
            },2000);

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
                            log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) \n ⚠️ Nepriateľ sa potkol!  Dobehneš ho.`, "danger-msg");
                        } else {
                            player_escape_counter += 1 ;
                            log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) \n ⚠️ Nepriateľ sa potkol!  Získavaš náskok.`, "danger-msg");
                        }
                    } else {
                        advantage += 1;
                        log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) \n ⚠️ Nepriateľ sa dostal do horšej pozície, získavaš výhodu.`, "danger-msg");
                    }
                } else {
                    if(chase_mode){
                        HERO.stress = Math.max(0, (HERO.stress || 0) + 1);
                        flashRed();
                        if(player_escaping){
                            player_escape_counter = Math.max(0, player_escape_counter - 1);
                            log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) \n ⚠️ Potkneš sa počas úteku! Nepriateľ ťa dobehne.`, "danger-msg");
                        } else {
                            enemy_escape_counter += 1;
                            log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) \n ⚠️ Potkneš sa!  Nepriateľ získava náskok.`, "danger-msg");
                        }
                    } else {
                        enemy_advantage += 1;
                        log(`(HROZBA: ${threat_roll} > OPATRNOSŤ: ${caution}) \n ⚠️ Dostaneš sa do horšej pozície, nepriateľ získava výhodu.`, "danger-msg");
                    }
                    if (HERO.stress > stress_thresh) {
                        inputs_frozen = true;
                        log("💀 Stres presiahol hodnotu kolapsu. KONIEC HRY.", "failure-msg", true);
                        restartGame();
                        return;
                    }
                }
            } else {
                const who = isEnemy ? "Nepriateľ sa vyhol hrozbe." : "Vyhneš sa hrozbe.";
                log(`${who} (HROZBA: ${threat_roll} <= OPATRNOSŤ: ${caution})`, "success-msg");
            }

            updateUI();
        }

        function ready() {
            log("Ok, pokračujeme...", "", true);
            
            inputs_frozen = true;
            updateUI();
            
            // Bind unfreezing and enemy execution directly to terminal output completion
            onTerminalFinishedCallback = () => {
                inputs_frozen = false;
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
            if (!gameOn) {
                return;
            }
            preloadImages(target);
            proceed_target = target; 
            inputs_frozen = true;
            
            const prompt = document.getElementById("proceed-prompt");
            if (prompt) {
                prompt.style.display = "flex";
            }
        }

        // Dedicated transition executor
        function executeProceedTransition() {
            if (proceed_target) {
                document.querySelectorAll('.dice-animation-pool').forEach(pool => pool.remove());

                const enemyCardContainer = document.getElementById("enemy-card-container");
                if (enemyCardContainer) {
                    enemyCardContainer.innerHTML = "";
                }

                const playerCardContainer = document.getElementById("player-card-container");
                if (playerCardContainer) {
                    playerCardContainer.innerHTML = "";
                }

                if (typeof proceed_target === 'function') {
                    proceed_target();
                } else {
                    handleChallengeTransition(proceed_target);
                }
            }
        }

        // Contextual Click listener matching the Spacebar behavior
        document.getElementById("proceed-btn").addEventListener("click", function() {
            const prompt = document.getElementById("proceed-prompt");
            if (!gameOn) return;
            
            if (isProcessingQueue && activeLogTimeout) {
                // If clicked while logs are printing, treat it as a log fast-forward line skip
                clearTimeout(activeLogTimeout);
                activeLogTimeout = null;
                processQueue();
            } else {
                // If logs are clear, clean up and transition
                if (prompt) prompt.style.display = "none";            
                inputs_frozen = true;
                executeProceedTransition();
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

                    function advanceRoundFlow() {
                        if (move == 1) {
                            enemyChoice();
                        } else {
                            setTimeout(() => {
                            proceed(ready);
                            },1000);
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
                        log("Si na ťahu (prenasleduješ).", "", true);
                    } else if (player_escaping) {
                        log("Si na ťahu (unikáš).", "", true);
                    } else {
                        log("Si na ťahu. Vyber si kartu a spôsob (ÚTOK/ČIN).", "", true);
                    }

                    inputs_frozen = true;
                    updateUI();

                    onTerminalFinishedCallback = () => {
                        inputs_frozen = false;
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
            if (typeof DEBUG !== 'undefined' && DEBUG === true) {
                log("DEBUG: spúšťam handleconflictinput.", "info-msg");
            }
            if (move === 0) {
                hidecards(true);
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
            // =========================================================================
            // ŠPECIÁLNA LOGIKA PRE PRENASLEDOVANIE (CHASE MODE)
            // =========================================================================
            if (chase_mode) {
                let choices = ["O", "R", "S", "B"];
                let randomCard = choices[Math.floor(Math.random() * choices.length)];

                if (enemy_escaping) {
                    if (Math.random() < 0.7) {
                        enemy_action = ["D", "B"]; 
                    } else {
                        enemy_action = ["A", randomCard]; 
                    }
                } 
                else if (player_escaping) {
                    let enemyData = ENEMY_TYPES[enemy];
                    let hasRanged = enemyData && enemyData["ranged"] === true;

                    if (hasRanged || player_escape_counter < 1) {
                        let choice = Math.random() < 0.5 ? "A" : "D";
                        enemy_action = [choice, randomCard];
                    } else {
                        enemy_action = ["D", randomCard];
                    }
                }
            }
            // =========================================================================
            // ŠTANDARDNÝ SÚBOJ
            // =========================================================================
            else {
                let pa = player_action;
                if (pa) {
                    if (pa[0] === "A") {
                        if (CARDS[pa[1]][1][0] + enemy_stress - 3 > ENEMY_TYPES[enemy]["stress_thresh"]) {
                            enemy_action = ["D", "B"];
                        } else if (HERO.stress > stress_thresh - 3) {
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
                    chase_mode = true; 
                } else {
                    let choices = ["O", "R", "S", "B"];
                    let choice = choices[Math.floor(Math.random() * choices.length)];
                    enemy_action = ["A", choice];
                }
            }

            // =========================================================================
            // UKONČENIE ŤAHU A VYKRESLENIE
            // =========================================================================
            move += 1;
            turn = "p";
            
            let escapeText = "";
            if (chase_mode) {
                escapeText = enemy_escaping ? `${enemy} zdrhá!` : `${enemy} ťa prenasleduje!`;
            } else if (enemy_escaping) {
                escapeText = `${enemy} sa snaží ujsť`;
            }
            
            if (escapeText) {
                log(`${escapeText} `, "", true);
                inputs_frozen = true;
                updateUI();
                
                onTerminalFinishedCallback = () => {
                    inputs_frozen = false;
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
            setTimeout(() => {gameloop(false, true)},1000);
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
            // 1. Ak je pole HEROES prázdne, pokúsime sa ho urgentne načítať z localStorage
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
                handleChallengeTransition(current_challenge_key);
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
                    width: 705px; 
                    height: 380px;
                    box-shadow: 0 0 15px rgba(0, 215, 0, 0.3);
                    display: flex;
                    flex-direction: column;
                    max-height: 90vh;
                ">
                    <!-- Scrollable content area -->
                    <div style="padding: 15px 15px 10px; text-align: center; overflow-y: auto; flex: 1;">
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
                        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
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


        // Funkcia na zobrazenie / skrytie Manažéra Hrdinu
        function toggleBuilder(show) {
            if (show) {
                if (is_conflict || is_action_phase) {
                    showGeneralPrompt("Teraz nie je čas...");
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

        document.getElementById("card-tray-container").addEventListener("click", function(e) {
            if (inputs_frozen) return;

            // --- SYNCHRONIZÁCIA KLÁVESNICE PODĽA MYŠI ---
            const clickedCard = e.target.closest(".card-container");
            if (clickedCard) {
                const allCards = Array.from(document.querySelectorAll("#card-tray-container .card-container"));
                currentSelectedCardIdx = allCards.indexOf(clickedCard);
                
                const clickedZone = e.target.closest(".split-zone");
                if (clickedZone) {
                    currentSelectedActionType = clickedZone.getAttribute("data-action");
                }
                updateCardKeyboardHighlight();
            }

            // Načítanie elementov dropdownov a ich hodnôt
            const skillDropdown = document.getElementById("player-skill-dropdown");
            const selectedSkillName = skillDropdown ? skillDropdown.value : "placeholder";
            const upperSkill = selectedSkillName.toUpperCase();

            const weaponDropdown = document.getElementById("player-weapon-dropdown");
            const selectedWeaponName = weaponDropdown ? weaponDropdown.value : "placeholder";

            if (is_conflict) {
                const zone = e.target.closest(".split-zone");
                if (!zone) return;
                const cardContainer = zone.closest(".card-container");
                const cardCode = cardContainer.getAttribute("data-card");
                let actionType = zone.getAttribute("data-action"); // "A" (Útok) alebo "D" (Čin/Obrana)

                // =========================================================================
                // 0. A. DELEGOVANÁ AKTUALIZÁCIA GLOBÁLNEJ PREMENNEJ weapon (ZBRAŇ)
                // =========================================================================
                if (!selectedWeaponName || selectedWeaponName === "placeholder") {
                    weapon = 0; // Globálna premenná zbrane sa vynuluje
                    if (typeof DEBUG !== 'undefined' && DEBUG === true) {
                        log("👊  👊 Bojuješ holými rukami (INTENZITA: 0).", "system-msg");
                    }
                } else {
                    let foundDamage = 0;
                    for (const category in WEAPON_LIST) {
                        if (WEAPON_LIST[category] && WEAPON_LIST[category][selectedWeaponName] !== undefined) {
                            foundDamage = WEAPON_LIST[category][selectedWeaponName];
                            break;
                        }
                    }
                    weapon = foundDamage; // Nastavenie intenzity do globálnej premennej
                    
                    if (typeof DEBUG !== 'undefined' && DEBUG === true) {
                        log(`⚔️ [DEBUG] Pripravená zbraň pre boj: ${selectedWeaponName.toUpperCase()} (INTENZITA: ${weapon})`, "system-msg");
                    }
                }

                // =========================================================================
                // 0. B. DELEGOVANÁ VALIDÁCIA SCHOPNOSTÍ PRE BOJ + PRIRADENIE HODNOTY skill
                // =========================================================================
                if (selectedSkillName && selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                    const skillData = SKILLS_DB[selectedSkillName];
                    const isDefenseSkill = DEFENSE_SKILLS.includes(upperSkill);
                    const isCombatSkill = ATTACK_SKILLS.includes(selectedSkillName.toUpperCase()) || 
                            (skillData && skillData[1] && skillData[1].toUpperCase().includes("BOJ"));                
                    let isPlaceholder = false;
                    if (selectedSkillName == "placeholder") isPlaceholder = true;

                    // Ak schopnosť nie je bojová a nie je ani v obranných, nepovolíme s ňou kliknúť na kartu
                    if (!isCombatSkill && !isDefenseSkill && !isPlaceholder) {
                        log(`⚠️ "${selectedSkillName}" nemôžeš použiť v boji.`, "error-msg");
                        skill = 0; 
                        return; // Zablokuje vykonanie ťahu
                    }

                    // Schopnosť prešla -> bezpečne priradíme jej reálnu číselnú hodnotu z hrdinu
                    const actualHeroValue = HERO.skills[selectedSkillName] || 0;
                    skill = actualHeroValue;

                    if (typeof DEBUG !== 'undefined' && DEBUG === true) {
                        log(`⚔️ [DEBUG] Pripravená schopnosť: ${selectedSkillName} (+${actualHeroValue})`, "system-msg");
                    }
                } else {
                    skill = 0; // Ak je vybraný placeholder/none, bonus k hodu je 0
                }

                // =========================================================================
                // STÁLE KONTROLY KOMBINÁCIÍ A PODMIENOK (KROKY 1 AŽ 4)
                // =========================================================================

                // --- NOVÁ FIXNÁ KONTROLA: Vrhanie striktne vyžaduje útok (A) a zbraň (nie placeholder) ---
                if (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY") {
                    if (!WEAPON_LIST["VRHACIE"] || WEAPON_LIST["VRHACIE"][selectedWeaponName] === undefined) {
                        log(`⚠️ ${upperSkill} vyžaduje vrhaciu zbraň (napr. nôž)!`, "error-msg");
                        return;
                    }
                }

                // --- 2. KROK: KONTROLA EXKLUZIVITY ÚTOK/OBRANA PO KLIKNUTÍ ---
                if (selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                    const isDefenseSkill = DEFENSE_SKILLS.includes(upperSkill);
                    const skillData = SKILLS_DB[selectedSkillName];
                    const isCombatSkill = ATTACK_SKILLS.includes(selectedSkillName.toUpperCase()) || 
                        (skillData && skillData[1] && skillData[1].toUpperCase().includes("BOJ"));                
                    // A. Ak hráč vybral ÚTOK ("A"), ale má navolený obranný skill (napr. Obratnosť)
                    if (actionType === "A" && !isCombatSkill && isDefenseSkill) {
                        log(`⚠️ Nemôžeš použiť obrannú schopnosť (${selectedSkillName}) pri ÚTOKU! Zmeň schopnosť alebo klikni na ČIN (Obranu).`, "error-msg");
                        return;
                    }

                    // B. Ak hráč vybral ČIN ("D"), ale má navolený útočný skill (napr. Boj zblízka) a nie je zároveň obranný
                    if (actionType === "D" && isCombatSkill && !isDefenseSkill) {
                        log(`⚠️ Nemôžeš použiť útočnú schopnosť (${selectedSkillName}) pri ČINE! Zmeň schopnosť alebo klikni na ÚTOK.`, "error-msg");
                        return;
                    }
                }
                
                // --- 3. KROK: KONTROLA KOMBINÁCIE ZBRANE A SCHOPNOSTI ---
                if (selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                    const skillData = SKILLS_DB[selectedSkillName];
                    
                    // --- ZABEZPEČENIE PROTI ÚTOKU BEZ ZBRANE ---
                    if (skillData) {
                        const skillCategory = skillData[1] ? skillData[1].toUpperCase() : "";
                        
                        if (skillCategory === "BOJ Z DIAĽKY" || upperSkill.includes("ZBRANE")) {
                            if (selectedWeaponName === "placeholder" || selectedWeaponName === "") {
                                log(`⚠️ Schopnosť ${upperSkill} vyžaduje zbraň!`, "error-msg");
                                return; // Zablokuje ťah
                            }
                        }
                    }

                    // Kontrola WEAPON_SKILLS - Či zvolená schopnosť prislúcha sile zbrane
                    if (selectedWeaponName !== "placeholder") {
                        // Využijeme už vypočítanú hodnotu premennej weapon z Kroku 0.A.
                        const weaponAllowed = WEAPON_SKILLS[String(weapon)] || [];
                        const allowedSkills = weaponAllowed.concat(ATTACK_SKILLS);
                        if (allowedSkills && !allowedSkills.includes(upperSkill)) {
                            log(`⚠️ Schopnosť ${upperSkill} nie je použiteľná s touto zbraňou (vyžaduje zbraň s intenzitou ${weapon})!`, "error-msg");
                            return;
                        }

                        if (skillData && skillData[1]) {
                            const skillCategory = skillData[1].toUpperCase();
                            
                            if (upperSkill !== "VRHANIE" && upperSkill !== "ŤAŽKÉ PREDMETY") {
                                if (skillCategory === "BOJ ZBLÍZKA" || skillCategory === "BOJ Z DIAĽKY") {
                                    if (!WEAPON_LIST[skillCategory] || WEAPON_LIST[skillCategory][selectedWeaponName] === undefined) {
                                        log(`⚠️ Zbraň ${selectedWeaponName.toUpperCase()} nie je vhodná pre schopnosť ${upperSkill}!`, "error-msg");
                                        return; // Zablokuje ťah
                                    }
                                }
                            }
                        }
                    }
                }

                // --- 4. KROK: KONTROLA MUNÍCIE ---
                if (actionType === "A" && selectedWeaponName !== "placeholder") {
                    if (typeof INITIAL_AMMO !== "undefined" && INITIAL_AMMO[selectedWeaponName] !== undefined) {
                        
                        const isRangedWeapon = WEAPON_LIST["BOJ Z DIAĽKY"] && WEAPON_LIST["BOJ Z DIAĽKY"][selectedWeaponName] !== undefined;
                        const isThrownWeapon = WEAPON_LIST["VRHACIE"] && WEAPON_LIST["VRHACIE"][selectedWeaponName] !== undefined;
                        const isThrownSkill = (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY");

                        if (isRangedWeapon || (isThrownWeapon && isThrownSkill)) {
                            const currentAmmo = HERO["ammo"][selectedWeaponName];

                            if (currentAmmo === undefined || currentAmmo <= 0) {
                                log(`⚠️ Nemáš muníciu (alebo zásobu) pre zbraň: ${selectedWeaponName.toUpperCase()}!`, "error-msg");
                                return;
                            }

                            HERO["ammo"][selectedWeaponName] = Math.max(0, currentAmmo - 1);
                            log(`Munície pre zbraň ${selectedWeaponName.toUpperCase()}: ${HERO["ammo"][selectedWeaponName]} ks.`, "info-msg");
                        }
                    }
                }
                
                // --- 5. KROK: REŽIMY PRENASLEDOVANIA A ÚNIKU (CHASE / ESCAPE) ---
                if (chase_mode || player_escaping || enemy_escaping) {

                    if (player_escaping) {
                        if (actionType === "D" && selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                            if (!CHASE_SKILLS.includes(upperSkill)) {
                                log(`⚠️ Na únik nemôžeš použiť schopnosť ${upperSkill}! \n Skús jednu z týchto: ${CHASE_SKILLS.join(", ")}.`, "error-msg");
                                return;
                            }
                        }
                        handleConflictInput(actionType, cardCode);
                        return;
                    }
                    
                    if (enemy_escaping) {
                        if (actionType === "D" && selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                            if (!CHASE_SKILLS.includes(upperSkill)) {
                                log(`⚠️ Na prenasledovanie nemôžeš použiť schopnosť ${upperSkill}! \n Skús jednu z týchto: ${CHASE_SKILLS.join(", ")}.`, "error-msg");
                                return;
                            }
                        }

                        if (actionType === "A") {
                            if (selectedWeaponName === "placeholder" || selectedWeaponName === "") {
                                if (enemy_escape_counter >= 1) {
                                    log(`⚠️ Nemáš vybranú žiadnu zbraň na diaľku! Na útok päsťami je nepriateľ príliš ďaleko. Vyber si zbraň alebo zvoľ ČIN.`, "error-msg");
                                    return;
                                }
                            } else {
                                const isRanged = WEAPON_LIST["BOJ Z DIAĽKY"] && WEAPON_LIST["BOJ Z DIAĽKY"][selectedWeaponName] !== undefined;
                                const isThrownWeapon = WEAPON_LIST["VRHACIE"] && WEAPON_LIST["VRHACIE"][selectedWeaponName] !== undefined;
                                const isThrownSkill = (upperSkill === "VRHANIE" || upperSkill === "ŤAŽKÉ PREDMETY");
                                const isThrownAttack = isThrownWeapon && isThrownSkill;
                                
                                const canAttackAtDistance = isRanged || isThrownAttack;
                                
                                if (canAttackAtDistance || enemy_escape_counter < 1) {
                                    // Útok povolený
                                } else {
                                    if (isThrownWeapon && !isThrownSkill) {
                                        log(`⚠️ Nepriateľ je príliš ďaleko! Ak chceš zbraň hodiť, zvoľ si schopnosť VRHANIE / ŤAŽKÉ PREDMETY.`, "error-msg");
                                    } else {
                                        log(`⚠️ Nepriateľ je príliš ďaleko! Použi zbraň na diaľku, alebo zvoľ ČIN.`, "error-msg");
                                    }
                                    return;
                                }
                            }
                        }
                        handleConflictInput(actionType, cardCode);
                        return;
                    }
                }

                // Vykonanie akcie za štandardných podmienok
                handleConflictInput(actionType, cardCode);
            } 
            else {
                // =========================================================================
                // REŽIM MIMO BOJA (KLIKNUTIE NA CELÚ KARTU)
                // =========================================================================
                const cardContainer = e.target.closest(".card-container");
                if (!cardContainer) return;
                const cardCode = cardContainer.getAttribute("data-card");
                
                // Aktualizácia premennej weapon mimo boja
                if (!selectedWeaponName || selectedWeaponName === "placeholder") {
                    weapon = 0;
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

                // Aktualizácia premennej skill mimo boja
                if (selectedSkillName && selectedSkillName !== "placeholder" && selectedSkillName !== "none") {
                    skill = HERO.skills[selectedSkillName] || 0;
                } else {
                    skill = 0;
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

            log(`⚡ Adrenalín použitý! Stres sa ti zvyšuje na ${HERO.stress} a získavaš +${targetAdrenalineVal} k ďalšiemu hodu.`, "success-msg");

            // 4. Prekreslenie UI (posun červeného 'S' indikátora)
            updateUI();
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
            if (is_conflict) {
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

        // Table Input Management Engine (Zjednodušený cez zdieľanú funkciu)
        document.getElementById("adrenaline-track-row").addEventListener("click", function(e) {
            if (inputs_frozen) return;
            
            const clickedCell = e.target.closest(".ad-node.ad-playable");
            if (!clickedCell) return; // Ignorujeme kliknutia mimo hrateľných buniek
            
            selectAdrenalineNode(clickedCell);
        });


        document.getElementById("player-weapon-dropdown").addEventListener("change", function(e) {
            const selectedWeaponName = e.target.value;
            if (!is_conflict) {
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

        // Voliteľné: Keď myš úplne odíde z plochy s kartami, môžeme klávesnicový hover opäť zobraziť
        document.getElementById("card-tray-container").addEventListener("mouseleave", function() {
            this.classList.remove("mouse-active");
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
            SKILLS_DB = skillsDbData;
            stockHeroesData = heroesData;
            window.SKILLS_DB = skillsDbData;

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

            selectHero();
        })
        .catch(error => {
            console.error("Chyba pri inicializácii hry:", error);
        });