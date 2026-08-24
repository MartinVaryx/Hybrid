    
    let isSyncing = false;
    let selectedItem = null;
    
    function selectItem(name) {
        selectedItem = (selectedItem === name) ? null : name;
        renderStats();
    }
    
    function toggleInfoOverlay(show) {
        const overlay = document.getElementById('info-panel-container');
        if (!overlay) return;

        const char = characters[activeCharIdx];
        const sp = char.sp || 0;
        
        document.getElementById('br-label').innerText = `BR: ${sp}`;


        if (show) {
            overlay.classList.add('active');
        } else {
            overlay.classList.remove('active');
        }
    }


    function updateGroupDropdown() {
        const builderSelect = document.getElementById('builder-group-filter');
        
        const char = characters[activeCharIdx];
        const allGroups = [...new Set(Object.values(skillsDB_new).map(s => s[1]))].sort();
        
        const builderGroups = (char && char.isInitialPhase)
            ? allGroups.filter(g => g === "DANOSTI")
            : allGroups;

        builderSelect.innerHTML = '<option value="">VŠETKY SKUPINY</option>' + builderGroups.map(g => `<option value="${g}">${g}</option>`).join('');
        if (char && char.isInitialPhase) builderSelect.value = "DANOSTI";
    }

    function renderRelTags() {
        const container = document.getElementById('edit-rels-container');
        container.innerHTML = '';
        editingRels.forEach(rel => {
            const span = document.createElement('span');
            span.className = 'tag';
            span.innerHTML = `<span class="tag-remove" onclick="removeRel('${rel}')">${rel}</span>`;
            container.appendChild(span);
        });
    }



    function exportSkills() {
        // Príprava dát do formátu JSON (s odsadením 4 medzery pre lepšiu čitateľnosť)
        const dataStr = JSON.stringify(skillsDB_new, null, 4);
        
        // Vytvorenie Blob objektu (súbor v pamäti)
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        // Vytvorenie dočasného odkazu na stiahnutie
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        
        link.setAttribute('href', url);
        link.setAttribute('download', 'skillsDB_new.json');
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Uvoľnenie pamäte
        URL.revokeObjectURL(url);
    }


    function selectSkill(name) {
        selectedSkill = name;
        document.querySelector('.control-box').classList.add('is-active');
        const char = characters[activeCharIdx];
        const data = skillsDB_new[name];
        const targetLvl = (char.skills[name] || 0) + 1;
        const baseCost = targetLvl * data[0];
        const sp = char.sp || 0;
        
        let discount = 0;
        let relDisplayStrings = [];

        if (data[2] && data[2].length > 0) {
            let relsWithLvls = data[2].map(r => ({ name: r, lvl: char.skills[r] || 0 }));
            let sortedForDiscount = [...relsWithLvls].sort((a,b) => b.lvl - a.lvl);
            discount = sortedForDiscount.slice(0, 3).reduce((sum, r) => sum + r.lvl, 0);

            relDisplayStrings = relsWithLvls.map(r => {
                const label = r.lvl > 0 ? `${r.name} (${r.lvl})` : r.name;
                const cls = r.lvl > 0 ? 'owned-rel' : '';
                return `<span class="${cls}">${label}</span>`;
            });
        }

        const finalCost = Math.max(targetLvl, baseCost - discount);
        document.getElementById('sel-skill-name').innerText = `${name+":"} ${targetLvl - 1} \u2192 ${targetLvl}`;
        document.getElementById('sel-skill-cat').innerText = `KATEGÓRIA: ${data[0]} | SKUPINA: ${data[1]}`;
        
        const relsBox = document.getElementById('sel-skill-rels');
        relsBox.innerHTML = relDisplayStrings.length ? "PRÍBUZNÉ SCHOPNOSTI: " + relDisplayStrings.join(", ") : "";
        
        const costCont = document.getElementById('cost-container');
        if (discount > 0) {
            costCont.style.display = 'inline-block';
            document.getElementById('cost-orig').innerText = `${baseCost} BR`;
        } else { costCont.style.display = 'none'; }
        
        document.getElementById('cost-disc').innerText = `${finalCost} BR`;
        document.getElementById('br-label').innerText = `BR: ${sp}`;
        renderStats();
    }

    function downgradeSkill() {
        if (!selectedSkill) return;
        const char = characters[activeCharIdx];
        if (!char || !char.skills) return;

        const currentLvl = char.skills[selectedSkill] || 0;
        if (currentLvl === 0) return;

        const data = skillsDB_new[selectedSkill];
        if (!data) return;

        // FÁZA 1 (Základných 40 bodov)
        if (char.isInitialPhase) {
            let relLevels = data[2].map(r => char.skills[r] || 0).sort((a,b) => b-a).slice(0,3);
            let discount = relLevels.reduce((a, b) => a + b, 0);
            const cost = Math.max(currentLvl, (currentLvl * data[0]) - discount);

            upgradeHistory.push({ skill: selectedSkill, type: 'downgrade', prevLvl: currentLvl, wasInitialPhase: true, prevSP: char.sp, prevHumanity: char.humanity });

            char.skills[selectedSkill]--;
            if (char.skills[selectedSkill] === 0) delete char.skills[selectedSkill];
            
            char.sp += cost;
            if (data[1] === "SOMORA") char.humanity = (char.humanity || 10) + cost;

            saveState(); renderStats(); filterBuilder(); if (selectedSkill) selectSkill(selectedSkill);
            return;
        }

        // FÁZA 2 (Pokročilá fáza s dynamickým SP)
        const snapshot = char.initialSkillsSnapshot || {};
        if (data[1] === "DANOSTI" && currentLvl <= (snapshot[selectedSkill] || 0)) {
            showCustomAlert("Nie je možné znížiť schopnosť pod úroveň z počiatočnej fázy.", "BLOKOVANÉ");
            return;
        }

        const beforeDetails = getOptimalCostsForPhase2(char, char.skills);

        let simulatedSkills = { ...char.skills };
        simulatedSkills[selectedSkill]--;
        if (simulatedSkills[selectedSkill] === 0) delete simulatedSkills[selectedSkill];

        const afterDetails = getOptimalCostsForPhase2(char, simulatedSkills);
        
        // Vypočítame celkový rozpočet postavy (základ 20 + všetky extra získané body z hry)
        const celkoveRozpätieSP = char.sp + beforeDetails.totalCost; 
        const simulatedSP = celkoveRozpätieSP - afterDetails.totalCost;

        if (simulatedSP < 0) {
            showCustomAlert("Zrušením schopnosti padnú zľavy. Build by prekročil tvoje dostupné body.", "BLOKOVANÉ");
            return;
        }

        // Uložíme akciu do histórie
        upgradeHistory.push({
            skill: selectedSkill,
            type: 'downgrade',
            prevLvl: currentLvl,
            wasInitialPhase: false
        });

        char.skills[selectedSkill]--;
        if (char.skills[selectedSkill] === 0) delete char.skills[selectedSkill];
        
        char.sp = simulatedSP;
        char.humanity = (char.humanity || 10) - (afterDetails.somoraCost - beforeDetails.somoraCost);

        saveState(); renderStats(); filterBuilder(); if (selectedSkill) selectSkill(selectedSkill);
    }

    function undoUpgrade() {
        if (upgradeHistory.length === 0) return;

        const lastAction = upgradeHistory.pop();
        const char = characters[activeCharIdx];

        // FÁZA 1: Cúvame klasicky lineárne
        if (lastAction.wasInitialPhase) {
            char.skills[lastAction.skill] = lastAction.prevLvl;
            if (char.skills[lastAction.skill] === 0) delete char.skills[lastAction.skill];
            char.sp = lastAction.prevSP;
            char.humanity = lastAction.prevHumanity;
            char.isInitialPhase = true;

            saveState(); renderStats(); filterBuilder(); if (selectedSkill) selectSkill(selectedSkill);
            return;
        }

        // FÁZA 2: Stavový prístup riadený algoritmom
        const beforeDetails = getOptimalCostsForPhase2(char, char.skills);

        if (lastAction.type === 'upgrade') {
            char.skills[lastAction.skill] = lastAction.prevLvl;
        } else if (lastAction.type === 'downgrade') {
            char.skills[lastAction.skill] = lastAction.prevLvl;
        }

        if (char.skills[lastAction.skill] === 0) {
            delete char.skills[lastAction.skill];
        }

        const afterDetails = getOptimalCostsForPhase2(char, char.skills);

        // Zistíme celkový rozpočet pred UNDO a aplikujeme novú cenu optimálneho buildu
        const celkoveRozpätieSP = char.sp + beforeDetails.totalCost;
        char.sp = celkoveRozpätieSP - afterDetails.totalCost;
        
        char.humanity = (char.humanity || 10) - (afterDetails.somoraCost - beforeDetails.somoraCost);

        saveState();
        renderStats();
        filterBuilder();
        if (selectedSkill) selectSkill(selectedSkill);
    }

    function upgradeSelected() {
        if (!selectedSkill) {
            console.log("No skill selected.");
            return};
        const char = characters[activeCharIdx];
        const currentLvl = char.skills[selectedSkill] || 0;
        
        const data = skillsDB_new[selectedSkill]; 
        if (!data) {
            console.log("Skill data not found for:", selectedSkill);
            return};

        if (window.parent.BIOLOGICAL_WEAPONS && window.parent.BIOLOGICAL_WEAPONS.includes(selectedSkill) && currentLvl > 0) {
            showCustomAlert("Túto zbraň už máš. Úroveň somorích zbraní sa nezvyšuje.");
            return;
        }

        const skillGroup = data[1]; 
        const targetLvl = currentLvl + 1;

        // 1. KONTROLA LIMITOV SCHOPNOSTÍ
        if (currentLvl === 0) {
            const learnedSkills = Object.values(char.skills).filter(lvl => lvl > 0);
            const learnedSkillsCount = learnedSkills.length;

            if (learnedSkillsCount >= 16) {
                showCustomAlert("Nie je možné pridať ďalšiu schopnosť.");
                return;
            }

            if (char.isInitialPhase && learnedSkillsCount >= 6) {
                showCustomAlert("V tejto fáze si nemôžeš pridať všetkých 7 daností.");
                return;
            }
        }

        // --- FÁZA 1: POČIATOČNÁ FÁZA ---
        if (char.isInitialPhase) {
            let relLevels = data[2].map(r => char.skills[r] || 0).sort((a,b) => b-a).slice(0,3);
            let discount = relLevels.reduce((a, b) => a + b, 0);
            const cost = Math.max(targetLvl, (targetLvl * data[0]) - discount);
            
            if (char.humanity <= cost && skillGroup === "SOMORA") {
                showCustomAlert("Máš príliš nízku ľudskosť.");
                return;
            }

            if (char.sp < cost) {
                showCustomAlert("NEDOSTATOK BODOV RASTU!");
                return;
            }
                
            if ((char.sp - cost) === 0) {
                showCustomAlert(
                    "Týmto uzavrieš fázu DANOSTÍ. Želáš si pokračovať?", 
                    "POTVRDENIE FÁZY", 
                    true, 
                    () => {
                        char.skills[selectedSkill] = targetLvl;
                        char.initialSkillsSnapshot = { ...char.skills };
                        
                        char.isInitialPhase = false;
                        char.sp = 20; // Prechod do fázy 2 nastaví základných 20
                        
                        if (skillGroup === "SOMORA") {
                            char.humanity = (char.humanity || 10) - cost;
                        }
                        upgradeHistory = [];
                        finishUpgrade(); 
                    }
                );
                return; 
            }

            upgradeHistory.push({
                skill: selectedSkill,
                type: 'upgrade',
                prevLvl: currentLvl,
                prevSP: char.sp,
                prevHumanity: char.humanity || 10,
                wasInitialPhase: true
            });

            char.sp -= cost;
            if (skillGroup === "SOMORA") {
                char.humanity = (char.humanity || 10) - cost;
            }

            char.skills[selectedSkill] = targetLvl;
            finishUpgrade();
            return;
        }

        // --- FÁZA 2: POKROČILÁ FÁZA ---
        const beforeDetails = getOptimalCostsForPhase2(char, char.skills);

        let simulatedSkills = { ...char.skills };
        simulatedSkills[selectedSkill] = targetLvl;

        const afterDetails = getOptimalCostsForPhase2(char, simulatedSkills);
        
        // Vypočítame absolútny zostatok bodov z celkového hrdinovho rozpočtu
        const celkoveRozpätieSP = char.sp + beforeDetails.totalCost;
        const simulatedSP = celkoveRozpätieSP - afterDetails.totalCost;

        if (simulatedSP < 0) {
            showCustomAlert("NEDOSTATOK BODOV RASTU!");
            return;
        }

        const addedSomoraCost = afterDetails.somoraCost - beforeDetails.somoraCost;
        if (addedSomoraCost > 0 && (char.humanity || 10) <= addedSomoraCost) {
            showCustomAlert("Máš príliš nízku ľudskosť pre túto úroveň schopnosti.", "BLOKOVANÉ");
            return;
        }

        upgradeHistory.push({
            skill: selectedSkill,
            type: 'upgrade',
            prevLvl: currentLvl,
            wasInitialPhase: false
        });

        char.skills[selectedSkill] = targetLvl;
        char.sp = simulatedSP;
        char.humanity = (char.humanity || 10) - addedSomoraCost;

        finishUpgrade();
    }

    // Zjednodušená pomocná funkcia bez volania neexistujúceho kódu
    function finishUpgrade() {
        saveState();
        renderStats();
        selectSkill(selectedSkill);
        updateGroupDropdown();
        filterBuilder();
    }

    function getOptimalCostsForPhase2(char, skillsState) {
        const snapshot = char.initialSkillsSnapshot || {};
        let initialSkillsState = { ...snapshot };
        let targetSkills = [];

        for (const [name, lvl] of Object.entries(skillsState)) {
            const baseLvl = snapshot[name] || 0;
            if (lvl > baseLvl) targetSkills.push(name);
        }

        if (targetSkills.length === 0) {
            return { totalCost: 0, somoraCost: 0 };
        }

        function calculateOrderDetails(skillOrder) {
            let currentSkills = { ...initialSkillsState };
            let totalCost = 0;
            let somoraCost = 0;

            for (const skill of skillOrder) {
                const targetLvl = skillsState[skill];
                const data = skillsDB_new[skill];
                const isSomora = data && data[1] === "SOMORA";
                const baseLvl = snapshot[skill] || 0;
                const skillCost = Number(data?.[0]) || 1;
                const relations = Array.isArray(data?.[2]) ? data[2] : [];

                for (let lvl = baseLvl + 1; lvl <= targetLvl; lvl++) {
                    const relLevels = relations.map(r => currentSkills[r] || 0).sort((a, b) => b - a).slice(0, 3);
                    const discount = relLevels.reduce((sum, l) => sum + l, 0);
                    const cost = Math.max(lvl, (lvl * skillCost) - discount);
                    
                    totalCost += cost;
                    if (isSomora) somoraCost += cost;
                    currentSkills[skill] = lvl;
                }
            }
            return { totalCost, somoraCost };
        }

        let bestCost = Infinity;
        let bestOrder = [];
        let pathsChecked = 0; // Ochrana proti zacykleniu / preťaženiu

        function findBestPath(currentOrder, remainingSkills, currentCost, currentSkillsState) {
            if (currentCost >= bestCost) return;
            
            // SPRESTNENIE: Ak sme skontrolovali už 100 kombinácií, tiahni s tým, čo máš.
            // Užívateľ nespozná rozdiel 1 BR, ale spozná 5-sekundový zásek.
            pathsChecked++;
            if (pathsChecked > 100) return; 

            if (remainingSkills.length === 0) {
                if (currentCost < bestCost) {
                    bestCost = currentCost;
                    bestOrder = [...currentOrder];
                }
                return;
            }

            let candidates = [...remainingSkills].sort((a, b) => {
                const aData = skillsDB_new[a];
                const bData = skillsDB_new[b];
                const aHelpsB = Array.isArray(aData?.[2]) && aData[2].includes(b);
                const bHelpsA = Array.isArray(bData?.[2]) && bData[2].includes(a);
                if (aHelpsB && !bHelpsA) return -1;
                if (bHelpsA && !aHelpsB) return 1;
                const catA = Number(aData?.[0]) || 0;
                const catB = Number(bData?.[0]) || 0;
                if (catA !== catB) return catA - catB;
                return a.localeCompare(b);
            });

            // Skúsime len top kandidátov, netreba prechádzať úplne všetky vetvy do hĺbky
            const limit = Math.min(candidates.length, 3); 
            for (let i = 0; i < limit; i++) {
                const skill = candidates[i];
                let nextSkillsState = { ...currentSkillsState };
                let costAdded = 0;
                const targetLvl = skillsState[skill];
                const data = skillsDB_new[skill];
                const baseLvl = snapshot[skill] || 0;

                const skillCost = Number(data?.[0]) || 1;
                const relations = Array.isArray(data?.[2]) ? data[2] : [];

                for (let lvl = baseLvl + 1; lvl <= targetLvl; lvl++) {
                    const relLevels = relations.map(r => nextSkillsState[r] || 0).sort((a, b) => b - a).slice(0, 3);
                    const discount = relLevels.reduce((sum, l) => sum + l, 0);
                    costAdded += Math.max(lvl, (lvl * skillCost) - discount);
                    nextSkillsState[skill] = lvl;
                }

                currentOrder.push(skill);
                const nextRemaining = remainingSkills.filter(s => s !== skill);
                findBestPath(currentOrder, nextRemaining, currentCost + costAdded, nextSkillsState);
                currentOrder.pop();
            }
        }

        findBestPath([], targetSkills, 0, { ...initialSkillsState });
        return calculateOrderDetails(bestOrder);
    }

        
    function renderStats() {
        const container = document.getElementById('character-stats');
        const char = characters[activeCharIdx];
        container.innerHTML = '';
    
    
        // --- PC VERZIA: MENO ---

            addSheetText(container, char.name, "6.29%", "10%", "1.4rem", "380px", "left", "name-field");
            addSheetText(container, char.sp.toString(), "5.53%", "94%", "1.8rem", "60px", "center", "br-field");
            
            const humanityVal = char.humanity !== undefined ? char.humanity : 10;
            addSheetText(container, humanityVal.toString(), "5.53%", "84.5%", "1.8rem", "60px", "center", "humanity-field");

    
        // --- SCHOPNOSTI DATA PREPARATION ---
        const learnedSkills = Object.entries(char.skills)
            .filter(([_, lvl]) => lvl > 0)
            .sort();
    

            // --- PC VERZIA: SCHOPNOSTI ---
            const slots = [];
            const maxRows = 8; 
            
            for (let col = 0; col < 2; col++) {
                for (let row = 0; row < maxRows; row++) {
                    slots.push({
                        x: col === 0 ? 4 : 37,
                        y: 33.17 + (row * 8.22)
                    });
                }
            }
    
            learnedSkills.forEach(([name, lvl], index) => {
                if (index < slots.length) {
                    const slot = slots[index];
                    const data = skillsDB_new[name] || [0, ""];
                    const displayName = truncateString(name, 18);
    
                    // Background with category and level labels
                    const div = document.createElement('div');
                    div.className = `skill-slot ${selectedSkill === name ? 'selected' : ''}`;
                    div.style.left = slot.x + "%";
                    div.style.top = slot.y + "%";
                    div.style.width = "29%"; 
                    div.style.height = "4.4%"; 
                    div.onclick = () => {
                        selectSkill(name);
                        toggleInfoOverlay(true);
                    };
                    div.setAttribute('data-description', data[3] || '');
    
                    div.innerHTML = `
                        <div class="skill-cat-box" style="position:absolute; left:0%; width:9%; text-align:left; font-weight:bold;">${data[0]}</div>
                        <div class="skill-name-text" style="position:absolute; left:15%; width:70%; white-space:nowrap; overflow:hidden;">${displayName}</div>
                        <div class="skill-lvl-box" style="position:absolute; right:6%; width:9%; text-align:center; font-weight:bold;">${lvl}</div>
                    `;
                    container.appendChild(div);

                    // Name button overlay
                    const nameButton = document.createElement('div');
                    nameButton.style.position = 'absolute';
                    nameButton.style.left = (slot.x + 3.6) + "%";
                    nameButton.style.top = (slot.y - 1.8) + "%";
                    nameButton.style.width = "19.5%"; 
                    nameButton.style.height = "7.4%";
                    nameButton.style.backgroundColor = 'rgba(151, 151, 151, 0.3)';
                    nameButton.style.cursor = 'pointer';
                    nameButton.style.border = '2px solid #999';
                    nameButton.style.borderRadius = '6px';
                    nameButton.style.transition = 'all 0.2s ease';
                    nameButton.style.zIndex = '1';
                    nameButton.setAttribute('data-description', data[3] || '');
                    nameButton.onclick = (e) => {
                        e.stopPropagation();
                        document.querySelector('.skill-tooltip')?.classList.remove('visible');
                        selectSkill(name);
                        toggleInfoOverlay(true);
                    };
                    
                    nameButton.onmouseover = () => {
                        nameButton.style.backgroundColor = 'rgba(151, 151, 151, 0.5)';
                        nameButton.style.borderColor = '#666';
                    };
                    nameButton.onmouseout = () => {
                        nameButton.style.backgroundColor = 'rgba(151, 151, 151, 0.3)';
                        nameButton.style.borderColor = '#999';
                    };
                    
                    container.appendChild(nameButton);
                }
            });
    
            // --- ADD "+" TO FIRST EMPTY SKILL SLOT ---
            if (learnedSkills.length < slots.length) {
                const emptySlotIndex = learnedSkills.length;
                const emptySlot = slots[emptySlotIndex];
    
                const addSkillDiv = document.createElement('div');
                addSkillDiv.className = 'skill-slot add-skill-slot';
                addSkillDiv.style.left = (emptySlot.x + 3.6) + "%";
                addSkillDiv.style.top = (emptySlot.y - 1.8) + "%";
                addSkillDiv.style.width = "19.5%"; 
                addSkillDiv.style.height = "7.4%";
                addSkillDiv.style.display = 'flex';
                addSkillDiv.style.alignItems = 'center';
                addSkillDiv.style.justifyContent = 'center';
                addSkillDiv.style.backgroundColor = 'rgba(151, 151, 151, 0.3)';
                addSkillDiv.style.cursor = 'pointer';
                addSkillDiv.style.border = '2px solid #999';
                addSkillDiv.style.borderRadius = '6px';
                addSkillDiv.style.transition = 'all 0.2s ease';
                addSkillDiv.onclick = () => {
                    toggleInfoOverlay(true);
                };
    
                // Hover effects
                addSkillDiv.onmouseover = () => {
                    addSkillDiv.style.backgroundColor = 'rgba(151, 151, 151, 0.5)';
                    addSkillDiv.style.borderColor = '#666';
                };
                addSkillDiv.onmouseout = () => {
                    addSkillDiv.style.backgroundColor = 'rgba(151, 151, 151, 0.3)';
                    addSkillDiv.style.borderColor = '#999';
                };
    
                addSkillDiv.innerHTML = `
                    <div id="new-skill" style="font-size: 2.4rem; font-weight: bold; color: #464646;">+</div>
                `;
                container.appendChild(addSkillDiv);
            }
        
    
        // --- ITEMS DATA PREPARATION ---
        const saved = JSON.parse(localStorage.getItem('characters')) || [];
        const savedChar = saved.find(c => c.name.toUpperCase() === char.name.toUpperCase());
        const items = char.items !== undefined ? char.items : (savedChar ? savedChar.items || {} : {});
        const weapons = char.weapons !== undefined ? char.weapons : (savedChar ? savedChar.weapons || [] : []);
        const ammo = char.ammo !== undefined ? char.ammo : (savedChar ? savedChar.ammo || {} : {});

        const weaponsToShow = weapons.filter(w => !(w in ammo));
        const ammoItems = Object.entries(ammo).filter(([_, qty]) => qty > 0);

        let allItems = Object.entries(items)
            .filter(([_, qty]) => qty > 0)
            .concat(ammoItems)
            .concat(weaponsToShow.map(w => [w, 1]));
        const ITEM_LIST = window.parent && window.parent.ITEM_LIST;

            // --- PC VERZIA: VYBAVENIE ---
            const itemSlots = [];
            const itemMaxRows = 6; 
            const itemStartY = 33.17;
            const itemSpacing = 8.25;
            const itemHeight = 4.4;
    
            for (let col = 0; col < 2; col++) {
                for (let row = 0; row < itemMaxRows; row++) {
                    itemSlots.push({
                        x: col === 0 ? 64.5 : 8,
                        y: itemStartY + (row * itemSpacing)
                    });
                }
            }
    
            const selectedItemData = (ITEM_LIST && selectedItem) ? ITEM_LIST[selectedItem.toUpperCase()] : null;
            const selectedItemHasEffect = !!(selectedItemData && selectedItemData.effect);
    
            if (selectedItem && selectedItemHasEffect) {
                // Calculate button position based on selected item's position
                let buttonY = itemStartY; // Default fallback
                
                // Find which slot the selected item is in
                const selectedItemIndex = allItems.findIndex(([name]) => name === selectedItem);
                if (selectedItemIndex !== -1 && selectedItemIndex < itemSlots.length) {
                    const selectedSlot = itemSlots[selectedItemIndex];
                    // Position button just below the selected item (top + height + small gap)
                    buttonY = selectedSlot.y; // 1% gap
                }
    
                const useBtn = document.createElement('button');
                useBtn.className = 'basic-btn';
                useBtn.innerText = 'POUŽIŤ';
                useBtn.style.cssText = `
                    position: absolute;
                    right: 5%;
                    top: ${buttonY}%;
                    width: 9%;
                    height: 5.5%;
                    background: var(--hybrid-green);
                    color: white;
                    border: 1px solid #fff;
                    border-radius: 12px;
                    font-weight: bold;
                    font-size: 0.9rem;
                    cursor: pointer;
                    z-index:10000;
                `;
                useBtn.onclick = () => {
                    useItemBuilder(selectedItem);
                    selectedItem = null;     // Clear selection
                    renderStats();           // Re-render to hide button
                };
                container.appendChild(useBtn);
            }
    
            allItems.forEach(([name, qty], index) => {
                if (index < itemSlots.length) {
                    const itemSlot = itemSlots[index];
                    const displayName = truncateString(name.toUpperCase(), 18);
    
                    const itemData = ITEM_LIST ? ITEM_LIST[name.toUpperCase()] : null;
                    const itemHasEffect = !!(itemData && itemData.effect);
    
                    // Background with quantity label
                    const div = document.createElement('div');
                    div.className = `skill-slot ${selectedItem === name ? 'selected' : ''}`;
                    div.style.left = itemSlot.x + "%";
                    div.style.top = itemSlot.y + "%";
                    div.style.width = "28.5%"; 
                    div.style.height = "4.4%"; 
                    div.onclick = () => selectItem(name);
                    div.setAttribute('data-description', itemData && itemData.description ? itemData.description : '');
                    
                    div.innerHTML = `
                        <div class="skill-name-text" style="position:absolute; left:15%; width:70%; white-space:nowrap; overflow:hidden;">${displayName}</div>
                        <div class="skill-lvl-box" style="position:absolute; right:-10%; width:9%; text-align:center; font-weight:bold;">${qty}</div>
                    `;
                    container.appendChild(div);

                    // Item name button overlay (only if has effect)
                    if (itemHasEffect) {
                        const nameButton = document.createElement('div');
                        nameButton.style.position = 'absolute';
                        nameButton.style.left = (itemSlot.x + 3.1) + "%";
                        nameButton.style.top = (itemSlot.y - 1.4) + "%";
                        nameButton.style.width = "24.4%"; 
                        nameButton.style.height = "6.6%";
                        nameButton.style.backgroundColor = 'rgba(151, 151, 151, 0.3)';
                        nameButton.style.cursor = 'pointer';
                        nameButton.style.border = '2px solid #999';
                        nameButton.style.borderRadius = '6px';
                        nameButton.style.transition = 'all 0.2s ease';
                        nameButton.style.zIndex = '1';
                        nameButton.setAttribute('data-description', itemData && itemData.description ? itemData.description : '');  
                        nameButton.onclick = (e) => {
                            e.stopPropagation();
                            document.querySelector('.skill-tooltip')?.classList.remove('visible');
                            selectItem(name);
                        };
                        
                        nameButton.onmouseover = () => {
                            nameButton.style.backgroundColor = 'rgba(151, 151, 151, 0.5)';
                            nameButton.style.borderColor = '#666';
                        };
                        nameButton.onmouseout = () => {
                            nameButton.style.backgroundColor = 'rgba(151, 151, 151, 0.3)';
                            nameButton.style.borderColor = '#999';
                        };
                        
                        container.appendChild(nameButton);
                    }
                }
            });
        
    }



    function addSheetText(container, text, top, left, size, width, align, extraClass = "") {
        const div = document.createElement('div');
        // Spojíme základnú triedu s prípadnou extra triedou
        div.className = 'sheet-field ' + extraClass;
        
        // Tieto štýly držia prvok na správnom mieste na papieri (PC)
        div.style.position = "absolute";
        div.style.top = top;
        div.style.left = left;
        div.style.width = width;
        div.style.fontSize = size;
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.justifyContent = align === "left" ? "flex-start" : "center";
        
        div.innerText = text;
        container.appendChild(div);
    }

    function truncateString(str, maxLen) {
        if (str.length > maxLen) {
            // Odreže reťazec a namiesto posledného znaku, ktorý by sa zmestil, dá bodku
            return str.substring(0, maxLen - 1) + "...";
        }
        return str;
    }


    function filterBuilder() {
        const list = document.getElementById('builder-list');
        const search = document.getElementById('builder-search').value.toUpperCase();
        const groupFilter = document.getElementById('builder-group-filter').value;
        const char = characters[activeCharIdx];
        list.innerHTML = '';
        
        const sortedKeys = Object.keys(skillsDB_new)
            .filter(name => {
                const skillGroup = skillsDB_new[name][1];
                if (char.isInitialPhase && skillGroup !== "DANOSTI") {
                    return false;
                }
                const matchesSearch = name.includes(search);
                const matchesGroup = !groupFilter || skillGroup === groupFilter;
                return matchesSearch && matchesGroup;
            })
            .sort((a, b) => {
                const gA = skillsDB_new[a][1].toUpperCase();
                const gB = skillsDB_new[b][1].toUpperCase();
                return gA.localeCompare(gB) || a.localeCompare(b);
            });

        let curG = "";
        sortedKeys.forEach(name => {
            const group = skillsDB_new[name][1].toUpperCase();
            if (group !== curG) {
                curG = group;
                const d = document.createElement('div');
                d.className = 'group-divider';
                d.innerText = curG;
                list.appendChild(d);
            }
            const div = document.createElement('div');
            div.className = 'skill-list-item';
            div.innerText = name;
            
            // PRIDANÉ: Uloženie popisu (index 3) do data-atribútu
            div.setAttribute('data-description', skillsDB_new[name][3] || '');
            
            div.onclick = () => selectSkill(name);
            list.appendChild(div);
        });
    }

    function saveState() {
        const saved = JSON.parse(localStorage.getItem('characters')) || [];
        characters.forEach(char => {
            const idx = saved.findIndex(c => c.name.toUpperCase() === char.name.toUpperCase());
            if (idx !== -1) {
                saved[idx] = { ...saved[idx], ...char };  // char wins for keys it has, rest survive
            } else {
                saved.push(char);  // new character
            }
        });
        localStorage.setItem('skillsDB_new', JSON.stringify(skillsDB_new));
        localStorage.setItem('characters', JSON.stringify(saved));

        if (window.parent && typeof window.parent.syncBuilderCharacterStateFromStorage === 'function') {
            window.parent.syncBuilderCharacterStateFromStorage();
        }
    }

    function refreshCharactersFromStorage() {
        const saved = JSON.parse(localStorage.getItem('characters')) || [];
        const refreshed = [...characters];

        saved.forEach(savedChar => {
            const idx = refreshed.findIndex(c => c.name.toUpperCase() === savedChar.name.toUpperCase());
            if (idx !== -1) {
                refreshed[idx] = {
                    ...refreshed[idx],
                    ...savedChar,
                    skills: savedChar.skills || refreshed[idx].skills || {},
                    items: savedChar.items || refreshed[idx].items || {},
                    weapons: savedChar.weapons !== undefined ? [...savedChar.weapons] : (refreshed[idx].weapons || []),
                    ammo: savedChar.ammo !== undefined ? { ...savedChar.ammo } : (refreshed[idx].ammo || {}),
                    defaultWeapons: savedChar.defaultWeapons || refreshed[idx].defaultWeapons || [],
                    defaultAmmo: savedChar.defaultAmmo || refreshed[idx].defaultAmmo || {},
                    defaultItems: savedChar.defaultItems || refreshed[idx].defaultItems || {},
                    isInitialPhase: savedChar.isInitialPhase !== undefined ? savedChar.isInitialPhase : refreshed[idx].isInitialPhase
                };
            } else {
                refreshed.push({
                    ...savedChar,
                    isInitialPhase: savedChar.isInitialPhase !== undefined ? savedChar.isInitialPhase : true
                });
            }
        });

        characters = refreshed;
        if (activeCharIdx >= characters.length) {
            activeCharIdx = Math.max(0, characters.length - 1);
        }
        return characters[activeCharIdx];
    }

    function useItemBuilder(name){
        if (window.parent && typeof window.parent.useItem === 'function') {
            window.parent.useItem(name);
        }
        setTimeout(() => {
            refreshCharactersFromStorage();
            renderStats();
            if (document.querySelector('#inventar table')) {
                renderInventar();
            }
        }, 250);
    }

    function renderInventar() {
        const table = document.querySelector("#inventar table");
        if (!table) return;

        const saved = JSON.parse(localStorage.getItem('characters')) || [];
        const savedChar = saved.find(c => c.name.toUpperCase() === characters[activeCharIdx].name.toUpperCase());
        const items = savedChar ? (savedChar.items || {}) : {};

        const ITEM_LIST = window.parent && window.parent.ITEM_LIST;
        if (!ITEM_LIST) return;

        const entries = Object.entries(items).filter(([name, qty]) => qty > 0);

        table.innerHTML = "";

        if (entries.length === 0) {
            table.innerHTML = `<tr><td colspan="3" style="padding:10px; color:#888; width:870px">Inventár je prázdny.</td></tr>`;
            return;
        }

        entries.forEach(([name, qty]) => {
            const itemData = ITEM_LIST[name.toUpperCase()];
            const description = itemData ? itemData.description : "";
            const hasEffect = itemData && itemData.effect;

            const useBtn = hasEffect
                ? `<button class="basic-btn" onclick="useItemBuilder('${name}')" 
                    style="background:var(--hybrid-green); color:white; border:1px solid #fff; 
                    height:40px; font-size:0.8rem; clip-path:none; margin:0; border-radius:12px; padding:10px;">
                    <strong>POUŽIŤ</strong></button>`
                : "";

            table.innerHTML += `
                <tr>
                    <td style="padding:10px; font-size:1.2rem; width:150px; border-bottom:1px solid #444;">
                        <strong>• ${name.toUpperCase()} (${qty}x)</strong>
                    </td>
                    <td style="padding:10px; font-size:1.2rem; border-bottom:1px solid #444; width:670px">
                        ${description}
                    </td>
                    <td style="padding:10px; border-bottom:1px solid #444;">
                        ${useBtn}
                    </td>
                </tr>`;
        });
    }

    function syncCharacterFromParent(parentCharIdx) {
        // Synchronizujeme lokálny index buildera s rodičom
        activeCharIdx = parentCharIdx;
        
        // Zosynchronizujeme aj lokálny HTML selector v builderi, ak existuje
        const charSelector = document.getElementById('char-selector');
        if (charSelector) {
            charSelector.value = parentCharIdx;
        }

        // Spustíme interný reštart stavu buildera pre novú postavu
        applyCharacterChange();
    }

    // 2. Spoločná logika, ktorá vyčistí stav buildera a prekreslí tabuľky
    function applyCharacterChange() {
        // 🛡️ HLAVNÁ POISTKA PROTI RACE CONDITION:
        // Ak je lokálna skillsDB_new prázdna, načítame ju z lokálneho storage alebo z explicitne určeného súboru sim/skillsDB.json.
        if (!skillsDB_new || Object.keys(skillsDB_new).length === 0) {
            skillsDB_new = JSON.parse(localStorage.getItem('skillsDB_new')) || JSON.parse(localStorage.getItem('skillsDB')) || {};
        }

        selectedSkill = null; 
        upgradeHistory = []; 
        
        
        const controlBox = document.querySelector('.control-box');
        if (controlBox) controlBox.classList.remove('is-active');

        const selSkillName = document.getElementById('sel-skill-name');
        if (selSkillName) selSkillName.innerText = "VYBERTE SCHOPNOSŤ";
        
        renderStats(); 

        // Vykreslíme filtre a schopnosti iba vtedy, ak už máme k dispozícii dáta
        if (skillsDB_new && Object.keys(skillsDB_new).length > 0) {
            updateGroupDropdown();
            filterBuilder();
        } else {
            console.warn("Builder zatiaľ nemá načítanú skillsDB_new, vykreslenie schopností sa odkladá.");
        }
    }

    // 3. Jediná a správna funkcia switchCharacter (tú starú duplicitnú vymaž!)
    function switchCharacter() { 
        const localIdx = parseInt(document.getElementById('char-selector').value);
        
        // Ak existuje hlavné okno, odovzdáme mu riadenie. Ono spätne aktualizuje náš iframe.
        if (window.parent && typeof window.parent.switchCharacterGlobally === 'function') {
            window.parent.switchCharacterGlobally(localIdx);
        } else {
            // Fallback: Ak by builder bežal samostatne bez iframe
            activeCharIdx = localIdx;
            applyCharacterChange();
        }
    }

    // 🔑 ŽIVOTNE DÔLEŽITÝ KROK: Sprístupníme tieto funkcie pre hlavný skript (rodiča)
    // Bez tohto ich hlavný skript nedokáže cez iframe zavolať, ak je kód v DOMContentLoaded scope.
    window.syncCharacterFromParent = syncCharacterFromParent;
    window.applyCharacterChange = applyCharacterChange;
    window.switchCharacter = switchCharacter;
    
    // Pomocná funkcia na porovnanie dvoch objektov (či sú databázy identické)
    function suSchopnostiIdenticke(obj1, obj2) {
        return JSON.stringify(obj1) === JSON.stringify(obj2);
    }


        
    async function zdielatVsetkoDiscord() {
        const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1501887111031164998/Si6ykPBshCLeWvpRQYlGEMFvbeJfd0biK7J9n25ObslmH2Hcid7JT8Zj2_dGEGNrlePx";
        
        if (DISCORD_WEBHOOK_URL.includes("TVOJA_WEBHOOK")) {
            showCustomAlert("Chyba: Nie je nastavená URL adresa Webhooku.");
            return;
        }

        // Pripravíme si FormData
        const formData = new FormData();
        const datum = new Date().toISOString().split('T')[0]; // Formát RRRR-MM-DD
        
        // 1. PRÍPRAVA VŠETKÝCH POSTÁV
        // Zabalíme celé pole characters do jedného súboru
        const allCharsData = JSON.stringify(characters, null, 4);
        const allCharsBlob = new Blob([allCharsData], { type: 'application/json' });
        
        // Pridáme súbor do formulára
        formData.append("file1", allCharsBlob, `kompletna_zaloha_postav_${datum}.json`);

        let sprava = `🚀 **Hromadné zdieľanie dát**\n`;
        sprava += `👥 **Počet postáv:** ${characters.length}\n`;
        sprava += `✅ Priložený súbor so všetkými postavami.\n`;

        // 2. FILTROVANIE LEN ZMENENÝCH SCHOPNOSTÍ (Globálne)
        let zmeny = {};
        let pocetZmien = 0;

        for (let kľúč in skillsDB_new) {
            if (!originalSkillsDB[kľúč] || JSON.stringify(skillsDB_new[kľúč]) !== JSON.stringify(originalSkillsDB[kľúč])) {
                zmeny[kľúč] = skillsDB_new[kľúč];
                pocetZmien++;
            }
        }

        // 3. KONTROLA A PRÍPRAVA SÚBORU ZMIEN
        if (pocetZmien > 0) {
            const zmenyData = JSON.stringify(zmeny, null, 4);
            const zmenyBlob = new Blob([zmenyData], { type: 'application/json' });
            formData.append("file2", zmenyBlob, `ZMENY_SKILLS_${datum}.json`);
            sprava += `⚠️ **ZISTENÉ ZMENY V DB (${pocetZmien}):** Priložený súbor s upravenými schopnosťami.`;
        } else {
            sprava += `ℹ️ Žiadne zmeny v globálnej databáze schopností.`;
        }

        formData.append("content", sprava);

        try {
            const response = await fetch(DISCORD_WEBHOOK_URL, {
                method: "POST",
                body: formData
            });

            if (response.ok) {
                showCustomAlert("Odoslané! Vďaka, že nám pomáhaš vylepšiť Hybrid!");
            } else {
                showCustomAlert("Chyba pri komunikácii s Discordom (Status: " + response.status + ")");
            }
        } catch (error) {
            console.error("Chyba:", error);
            showCustomAlert("Nepodarilo sa nadviazať spojenie s Discordom.");
        }
    }




    // Pomocná funkcia, ktorá neskáče hore-dole
    function forceView(viewType) {
        const introView = document.getElementById('view-intro');
        const builderView = document.getElementById('view-builder');
        const toggleBtn = document.getElementById('view-toggle');

        if (viewType === 'builder') {
            introView.classList.remove('active-view');
            builderView.classList.add('active-view');
            if (toggleBtn) toggleBtn.innerText = 'HLAVNÁ STRÁNKA';
        } else {
            builderView.classList.remove('active-view');
            introView.classList.add('active-view');
            if (toggleBtn) toggleBtn.innerText = 'VYTVOR SI HRDINU';
        }
    }


    function openTab(id, shouldUpdateHash = true) {
        // Ak už tab je aktívny, nič nerob (bráni preblikávaniu)
        const target = document.getElementById(id);
        if (!target) return;

        // Aktualizácia URL len ak je to žiadané (pri kliku, nie pri routingu)
        if (shouldUpdateHash && window.location.hash !== '#' + id) {
            window.location.hash = id;
        }

        // Klasické prepínanie tried
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

        target.classList.add('active');

        // Zvýraznenie tlačidla
        const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => 
            b.getAttribute('onclick')?.includes(`'${id}'`)
        );
        if (btn) btn.classList.add('active');
        if (id === 'inventar') renderInventar();
        if (id === 'builder') {
            renderStats();
            setTimeout(() => filterBuilder(), 50);
        }
        
    }

    
    function showStatus(text) {
        const msg = document.getElementById('status-message');
        msg.innerText = text;
        msg.style.display = 'block';
        setTimeout(() => { msg.style.display = 'none'; }, 3000);
    }


    function showCustomAlert(message, title = "UPOZORNENIE", isConfirm = false, callback = null) {
        const modal = document.getElementById('custom-modal');
        if (!modal) return; // safety

        // Build modal content matching the requested visual style
        modal.innerHTML = `
            <div style="position: relative; background: #1a1a1a; border: 2px solid var(--hybrid-red); padding: 25px; border-radius: 8px; width: 500px; text-align: center; box-shadow: 0 0 20px rgba(215,0,0,0.4);">
                <button id="custom-modal-close" style="position: absolute; top: 10px; right: 10px; background-color: var(--hybrid-red); color: white; width: 35px; height: 35px; padding: 0; margin: 0; cursor: pointer; font-weight: bold; border-radius: 4px;">X</button>
                <div id="modal-title" style="font-family: 'Archivo Black', sans-serif; font-size: 1.2rem; color: #fff; margin-bottom: 25px;">${title}</div>
                <div id="modal-message" style="font-family: 'Roboto Condensed', sans-serif; font-size: 1rem; color: #fff; margin-bottom: 15px;">${message}</div>
                <input id="modal-input" type="text" placeholder="" style="display: none; width: 80%; margin-bottom: 20px; padding: 8px 12px; font-family: 'Roboto Condensed', sans-serif; font-size: 1rem; background: #2a2a2a; color: #fff; border: 2px solid #555; border-radius: 4px; outline: none;">
                <div style="display: flex; flex-direction: row; gap: 10px; justify-content: center; width: 100%;">
                    <button id="modal-confirm" class="adrenaline-select" style="width: 80px; color: #ffffff; background: var(--hybrid-green);">Áno.</button>
                    <button id="modal-cancel" class="adrenaline-select" style="width: 80px; color: #ffffff; background: var(--hybrid-red);">Nie.</button>
                </div>
            </div>
        `;

        // Wire up actions
        const closeBtn = document.getElementById('custom-modal-close');
        if (closeBtn) closeBtn.onclick = closeModal;

        const confirmBtn = document.getElementById('modal-confirm');
        const cancelBtn = document.getElementById('modal-cancel');

        if (isConfirm) {
            if (confirmBtn) confirmBtn.onclick = () => { if (callback) callback(); closeModal(); };
            if (cancelBtn) cancelBtn.onclick = closeModal;
        } else {
            // Non-confirm: show single OK (use confirm button as OK)
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (confirmBtn) {
                confirmBtn.innerText = 'OK';
                confirmBtn.onclick = closeModal;
            }
        }

        modal.style.display = 'flex';
    }

    function closeModal() {
        document.getElementById('custom-modal').style.display = 'none';
    }



    async function init() {
        console.log("Inicializácia systému...");
            
        // 1. Načítaj dáta (Kritické)
        await loadSkills(); 
        updateGroupDropdown();
        filterBuilder();
        renderStats();
        renderEditorList();
        filterRelSearch();
        initSkillTooltips(); 

    }

    async function loadSkills() {
        try {
            const response = await fetch('../skillsDB.json', { cache: 'no-store' });
            if (!response.ok) throw new Error("Súbor nenájdený");
            skillsDB_new = await response.json();
            originalSkillsDB = JSON.parse(JSON.stringify(skillsDB_new));
            console.log("Dáta načítané z sim/skillsDB.json");
        } catch (error) {
            console.warn("Nepodarilo sa načítať sim/skillsDB.json, používam fallback z localStorage:", error);
            skillsDB_new = JSON.parse(localStorage.getItem('skillsDB_new')) || JSON.parse(localStorage.getItem('skillsDB')) || {};
            originalSkillsDB = JSON.parse(JSON.stringify(skillsDB_new));
        }
    }

    function toggleRelOverlay(show) {
        const container = document.getElementById('rel-add-container');
        if (show) {
            container.classList.add('active');
            // Optional: Prevent body scroll when overlay is open
            document.body.style.overflow = 'hidden';
        } else {
            container.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    }


    // Pomocná funkcia na dynamické načítanie html2canvas z CDN (ak ešte nie je v projekte)
    function zaistiHtml2Canvas() {
    return new Promise((resolve, reject) => {
        if (window.html2canvas) {
            resolve(window.html2canvas);
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => resolve(window.html2canvas);
        script.onerror = () => reject(new Error('Nepodarilo sa načítať externú knižnicu pre export.'));
        document.head.appendChild(script);
    });
}

// Bezpečná verzia statusu, ktorá nespadne, ak id="status-message" v HTML neexistuje
function bezpečnyStatus(text) {
    const msg = document.getElementById('status-message');
    if (msg) {
        msg.innerText = text;
        msg.style.display = 'block';
        setTimeout(() => { msg.style.display = 'none'; }, 3000);
    } else {
        console.log("STATUS:", text); // Záloha do konzoly, ak element chýba
    }
}


async function exportpng() {
    const container = document.getElementById('character-stats');
    if (!container) {
        alert("Chyba: Panel štatistík (#character-stats) nebol v HTML nájdený.");
        return;
    }

    let menoHrdinu = "hrdina";
    if (typeof characters !== 'undefined' && typeof activeCharIdx !== 'undefined' && characters[activeCharIdx]) {
        menoHrdinu = characters[activeCharIdx].name.replace(/[^a-zA-Z0-9]/g, "_");
    }

    const logujStatus = (text) => {
        if (typeof bezpečnyStatus === "function") bezpečnyStatus(text);
        else if (typeof showStatus === "function") showStatus(text);
    };

    const origOverflow = document.body.style.overflow;
    const origScrollTop = window.scrollY;

    try {
        logujStatus("Pripravujem čistú kartu na tlač...");
        
        const h2c = await zaistiHtml2Canvas();

        // FIX: Add '.mobile-header-row' to the fields we hide during export!
        const poliaNaSkrytie = container.querySelectorAll('.skill-lvl-box, .humanity-field, .br-field, .mobile-header-row');
        poliaNaSkrytie.forEach(pole => { pole.style.visibility = 'hidden'; });

        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        let tempStyle = null;
        
        if (isMobile) {
            window.scrollTo(0, 0);
            document.body.style.overflow = 'hidden';

            tempStyle = document.createElement('style');
            tempStyle.id = 'html2canvas-mobile-fix';

            tempStyle.innerHTML = `
                #character-stats {
                    width: 1050px !important;
                    max-width: 1050px !important;
                    min-width: 1050px !important;
                    height: 1485px !important;
                    min-height: 1485px !important;
                    position: absolute !important; 
                    top: 0 !important;
                    left: 0 !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    display: block !important;
                    overflow: visible !important;
                    z-index: 999999 !important;
                    
                    background-position: top left !important;
                    background-size: 100% 100% !important;
                    background-origin: padding-box !important;
                    background-attachment: scroll !important;
                }

                #character-stats * {
                    box-sizing: border-box !important;
                    overflow: visible !important;
                }

                #character-stats .name-field,
                #character-stats .skill-slot,
                #character-stats .sheet-field {
                    position: absolute !important;
                }

                #character-stats .name-field {
                    font-size: 40px !important;
                    line-height: 0.9 !important; 
                    margin-top: -12px !important; 
                    display: block !important;
                }

                #character-stats .skill-name-text {
                    font-size: 30px !important;
                    line-height: 1.0 !important;
                    display: block !important;
                    padding: 0 !important;
                    white-space: nowrap !important;
                }

                #character-stats .skill-cat-box {
                    font-size: 30px !important;
                    line-height: 1.0 !important;
                    display: block !important;
                    padding: 0 !important;
                    white-space: nowrap !important;
                }

                #character-stats .skill-slot {
                    display: block !important;
                    overflow: visible !important;
                }
                
                /* Completely eliminate any structural height impact from the hidden mobile row */
                #character-stats .mobile-header-row {
                    display: none !important;
                }

                /* FIX: Shift the second column slightly to the right. 
                  Targets slots whose inline style left attribute begins with 5 (e.g. left: 54.5%)
                */
                #character-stats .skill-slot[style*="left: 5"],
                #character-stats .skill-slot[style*="left:5"] {
                    transform: translateX(10px) !important;
                }
            `;

            document.head.appendChild(tempStyle);

            await new Promise(resolve => setTimeout(resolve, 400));
        }

        const canvas = await h2c(container, {
            scale: isMobile ? 2 : 2, 
            useCORS: true,
            allowTaint: false,
            backgroundColor: null,
            logging: false,
            scrollX: 0,
            scrollY: 0,
            windowWidth: 1050,
            windowHeight: 1485
        });

        // Restore everything back to normal for live phone viewing
        poliaNaSkrytie.forEach(pole => { pole.style.visibility = 'visible'; });
        if (tempStyle) tempStyle.remove();
        
        document.body.style.overflow = origOverflow;
        if (isMobile) {
            window.scrollTo(0, origScrollTop);
        }

        const imgData = canvas.toDataURL('image/png');

        // Trigger Download
        const link = document.createElement('a');
        link.href = imgData;
        link.download = `${menoHrdinu}_dennik.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        logujStatus("ČISTÁ KARTA STIAHNUTÁ!");
    } catch (error) {
        console.error("Export zlyhal:", error);
        alert("Export zlyhal: " + error.message);
        document.body.style.overflow = origOverflow;
    }
}

// Pomocná funkcia, ktorá vráti živú stránku do pôvodného responzívneho stavu
function cleanUpExport(originalStyles) {
    const tempStyle = document.getElementById('html2canvas-desktop-override');
    if (tempStyle) tempStyle.remove();

    document.body.style.width = originalStyles.width;
    document.body.style.maxWidth = originalStyles.maxWidth;
    document.body.style.minWidth = originalStyles.minWidth;
    document.body.style.padding = originalStyles.padding;
    document.body.style.margin = originalStyles.margin;
    document.body.style.overflowX = originalStyles.overflowX;
    document.body.style.backgroundImage = originalStyles.backgroundImage;
    document.body.style.backgroundSize = originalStyles.backgroundSize;
    document.body.style.backgroundRepeat = originalStyles.backgroundRepeat;
    document.body.style.backgroundColor = originalStyles.backgroundColor;
}

function initSkillTooltips() {
    let tooltip = document.querySelector('.skill-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'skill-tooltip';
        document.body.appendChild(tooltip);
    }

    // Updated selector to catch both builder items AND renderStats items
    document.addEventListener('mouseover', (event) => {
        const target = event.target.closest('[data-description]');  // ← Changed this line
        if (!target) return;

        const description = target.getAttribute('data-description');
        if (!description || description.trim() === "") return;

        tooltip.textContent = description;
        tooltip.classList.add('visible');
    });

    document.addEventListener('mousemove', (event) => {
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
    });

    document.addEventListener('mouseout', (event) => {
        const target = event.target.closest('[data-description]');
        if (!target) return;

        tooltip.classList.remove('visible');
    });

    document.addEventListener('click', () => {
        tooltip.classList.remove('visible');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.parent && typeof window.parent.onIframeReady === 'function') {
        window.parent.onIframeReady();
    }
    initSkillTooltips();

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

    document.addEventListener('click', () => {
        tooltip.classList.remove('visible');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTooltips();
});