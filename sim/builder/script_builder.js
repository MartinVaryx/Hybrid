    
    let isSyncing = false;
    
    function updateGroupDropdown() {
        const builderSelect = document.getElementById('builder-group-filter');
        const editorSelect = document.getElementById('edit-group');
        const relFilterSelect = document.getElementById('rel-group-filter');
        
        const char = characters[activeCharIdx];
        const allGroups = [...new Set(Object.values(skillsDB_new).map(s => s[1]))].sort();
        
        const builderGroups = (char && char.isInitialPhase)
            ? allGroups.filter(g => g === "DANOSTI")
            : allGroups;

        builderSelect.innerHTML = '<option value="">VŠETKY SKUPINY</option>' + builderGroups.map(g => `<option value="${g}">${g}</option>`).join('');
        editorSelect.innerHTML = allGroups.map(g => `<option value="${g}">${g}</option>`).join('');
        relFilterSelect.innerHTML = '<option value="">VŠETKY SKUPINY</option>' + allGroups.map(g => `<option value="${g}">${g}</option>`).join('');
    }

    function renderEditorList() {
        const list = document.getElementById('editor-list');
        const nameInput = document.getElementById('edit-name');
        const search = nameInput.value.toUpperCase();
        list.innerHTML = '';
        
        if (!skillsDB_new[search]) {
            document.getElementById('edit-cat').value = '';
            document.getElementById('edit-group').value = '';
            
            const descInput = document.getElementById('edit-desc');
            if (descInput) descInput.value = '';
            
            editingRels = [];
            renderRelTags();
            filterRelSearch();
        } else {
            const data = skillsDB_new[search];
            document.getElementById('edit-cat').value = data[0];
            document.getElementById('edit-group').value = data[1];
            
            // PRIDANÉ: Automatické načítanie popisu pri presnej zhode
            const descInput = document.getElementById('edit-desc');
            if (descInput) descInput.value = data[3] || '';
            
            editingRels = [...data[2]];
            renderRelTags();
            filterRelSearch();
        }

        const sortedKeys = Object.keys(skillsDB_new)
            .filter(name => name.includes(search))
            .sort((a, b) => {
                const gA = skillsDB_new[a][1].toUpperCase();
                const gB = skillsDB_new[b][1].toUpperCase();
                return gA.localeCompare(gB) || a.localeCompare(b);
            });

        let curG = "";
        sortedKeys.forEach(name => {
            if (skillsDB_new[name][1].toUpperCase() !== curG) {
                curG = skillsDB_new[name][1].toUpperCase();
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
            
            div.onclick = () => loadToEditor(name);
            list.appendChild(div);
        });
    }

    // Aby ti fungovalo prepojenie, pridaj aj tento alias (ak ho tvoj kód vyžaduje)
    function filterEditorList() {
        renderEditorList();
    }

    function loadToEditor(name) {
        const data = skillsDB_new[name];
        document.getElementById('edit-name').value = name;
        document.getElementById('edit-cat').value = data[0];
        document.getElementById('edit-group').value = data[1];
        editingRels = [...data[2]];
        
        // PRIDANÉ: Načítanie popisu do textového poľa (ak neexistuje, dáme prázdny text)
        const descInput = document.getElementById('edit-desc');
        if (descInput) {
            descInput.value = data[3] || '';
        }

        renderRelTags();
        filterRelSearch();
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

    function filterRelSearch() {
        const list = document.getElementById('rel-add-list');
        const search = document.getElementById('rel-search').value.toUpperCase();
        const groupFilter = document.getElementById('rel-group-filter').value;
        list.innerHTML = '';
        
        const sortedKeys = Object.keys(skillsDB_new)
            .filter(name => {
                const skillGroup = skillsDB_new[name][1];
                const matchesSearch = name.includes(search);
                const matchesGroup = !groupFilter || skillGroup === groupFilter;
                const isNotAlreadyAdded = !editingRels.includes(name);
                
                return matchesSearch && matchesGroup && isNotAlreadyAdded;
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
            
            // PRIDANÉ: Uloženie popisu (index 3) do data-atribútu (pre zoznam príbuzných schopností)
            div.setAttribute('data-description', skillsDB_new[name][3] || '');
            
            div.onclick = () => { 
                editingRels.push(name); 
                renderRelTags(); 
                document.getElementById('rel-search').value = ''; 
                filterRelSearch(); 
            };
            list.appendChild(div);
        });
    }
    function removeRel(name) { editingRels = editingRels.filter(r => r !== name); renderRelTags(); }

    function saveSkill() {
        const name = document.getElementById('edit-name').value.trim().toUpperCase();
        const cat = parseInt(document.getElementById('edit-cat').value);
        const descInput = document.getElementById('edit-desc');
        const description = descInput ? descInput.value.trim() : '';
        let group = document.getElementById('edit-group').value;
        if (!name || !group) return showCustomAlert("VYPLŇTE NÁZOV A SKUPINU.");
        skillsDB_new[name] = [cat, group, editingRels, description];
        saveState();
        renderEditorList();
        updateGroupDropdown();
        filterBuilder();
        showStatus("SCHOPNOSŤ ULOŽENÁ.");
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

    function deleteSkill() {
        const name = document.getElementById('edit-name').value.toUpperCase();
        
        // Najprv overíme, či schopnosť vôbec v databáze je
        if (!skillsDB_new[name]) {
            showCustomAlert("Schopnosť nebola nájdená.", "CHYBA");
            return;
        }

        // Vyvoláme modálne okno s potvrdením
        showCustomAlert(
            `Naozaj chcete natrvalo ZMAZAŤ schopnosť ${name}?`, 
            "POTVRDENIE ZMAZANIA", 
            true, 
            () => {
                // Táto časť sa vykoná len po kliknutí na ÁNO
                delete skillsDB_new[name];
                
                // Aktualizácia stavu a rozhrania
                saveState();
                renderEditorList();
                updateGroupDropdown();
                filterBuilder();
                
                // Vyčistíme políčka v editore po zmazaní
                document.getElementById('edit-name').value = '';
                document.getElementById('edit-cat').value = '';
                editingRels = [];
                renderRelTags();
                
                showCustomAlert(`Schopnosť ${name} bola odstránená.`, "ZMAZANÉ");
            }
        );
    }

    function selectSkill(name) {
        selectedSkill = name;
        document.querySelector('.control-box').classList.add('is-active');
        const char = characters[activeCharIdx];
        const data = skillsDB_new[name];
        const targetLvl = (char.skills[name] || 0) + 1;
        const baseCost = targetLvl * data[0];
        
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
        if (!selectedSkill) return;
        const char = characters[activeCharIdx];
        const currentLvl = char.skills[selectedSkill] || 0;
        
        const data = skillsDB_new[selectedSkill]; 
        if (!data) return;
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

                for (let lvl = baseLvl + 1; lvl <= targetLvl; lvl++) {
                    const relLevels = data[2].map(r => currentSkills[r] || 0).sort((a, b) => b - a).slice(0, 3);
                    const discount = relLevels.reduce((sum, l) => sum + l, 0);
                    const cost = Math.max(lvl, (lvl * data[0]) - discount);
                    
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
                const aHelpsB = skillsDB_new[b][2]?.includes(a);
                const bHelpsA = skillsDB_new[a][2]?.includes(b);
                if (aHelpsB && !bHelpsA) return -1;
                if (bHelpsA && !aHelpsB) return 1;
                const catA = skillsDB_new[a][0];
                const catB = skillsDB_new[b][0];
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

                for (let lvl = baseLvl + 1; lvl <= targetLvl; lvl++) {
                    const relLevels = data[2].map(r => nextSkillsState[r] || 0).sort((a, b) => b - a).slice(0, 3);
                    const discount = relLevels.reduce((sum, l) => sum + l, 0);
                    costAdded += Math.max(lvl, (lvl * data[0]) - discount);
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

        //MENO - pozícia na hárku
        addSheetText(container, char.name, "13%", "17.5%", "1.2rem", "380px", "left", "name-field");

        // Zistíme, či sme v mobilnom zobrazení (napr. šírka pod 768px)
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            // --- MOBILNÁ VERZIA ---
            const headerRow = document.createElement('div');
            headerRow.className = "mobile-header-row";
            headerRow.style.cssText = "display: flex; flex-direction: column; gap: 10px; padding: 10px; background: #eee; border-bottom: 2px solid #000; margin-bottom: 10px;";

            // Meno
            const nameDiv = document.createElement('div');
            nameDiv.className = "name-field";
            nameDiv.style.fontSize = "1.4rem";
            nameDiv.style.fontWeight = "bold";
            headerRow.appendChild(nameDiv);

            // Kontajner pre BR a Ľudskosť vedľa seba
            const statsRow = document.createElement('div');
            statsRow.style.cssText = "display: flex; justify-content: space-between; align-items: center;";

            const humanityVal = char.humanity !== undefined ? char.humanity : 50;

            statsRow.innerHTML = `
                <div class="humanity-field" style="font-weight: bold;"> ${humanityVal}</div>
                <div class="br-field" style="font-weight: bold;">${char.sp}</div>
            `;
            
            headerRow.appendChild(statsRow);
            container.appendChild(headerRow); // Pridáme hlavičku ako prvú

        } else {
            // PC VERZIA: Pôvodné absolútne umiestnenie na hárku
            addSheetText(container, char.sp.toString(), "25%", "90%", "1.8rem", "60px", "center", "br-field");
            
            const humanityVal = char.humanity !== undefined ? char.humanity : 10;
            addSheetText(container, humanityVal.toString(), "25%", "76.5%", "1.8rem", "60px", "center", "humanity-field");
        }

        //SCHOPNOSTI - Limit 6 na stĺpec (spolu 12)
        const learnedSkills = Object.entries(char.skills)
            .filter(([_, lvl]) => lvl > 0)
            .sort();

        const slots = [];
        const maxRows = 8; 
        
        // Generovanie pozícií pre PC papier
        for (let col = 0; col < 2; col++) {
            for (let row = 0; row < maxRows; row++) {
                slots.push({
                    x: col === 0 ? 6.5 : 54,
                    y: 40.5 + (row * 4.73) 
                });
            }
        }

        learnedSkills.forEach(([name, lvl], index) => {
            if (index < slots.length) {
                const slot = slots[index];
                const data = skillsDB_new[name] || [0, ""];
                
                // Limit 18 znakov (pre PC verziu, aby text nepretiekol)
                const displayName = truncateString(name, 18);

                const div = document.createElement('div');
                // Pridávame triedu vybraného slotu
                div.className = `skill-slot ${selectedSkill === name ? 'selected' : ''}`;
                
                // Štýlovanie pre PC (tieto hodnoty CSS media query na mobile prepíše)
                div.style.left = slot.x + "%";
                div.style.top = slot.y + "%";
                div.style.width = "42.5%"; 
                div.style.height = "4.4%"; 
                
                div.onclick = () => selectSkill(name);

                // Vnútro slotu: Kategória | Názov | Úroveň
                // Dôležité: Kategória je v prvom div, ktorý na mobile skrývame cez display:none
                div.innerHTML = `
                    <div class="skill-cat-box" style="position:absolute; left:0%; width:9%; text-align:left; font-weight:bold;">${data[0]}</div>
                    <div class="skill-name-text" style="position:absolute; left:15%; width:70%; white-space:nowrap; overflow:hidden;">${displayName}</div>
                    <div class="skill-lvl-box" style="position:absolute; right:6%; width:9%; text-align:center; font-weight:bold;">${lvl}</div>
                `;
                container.appendChild(div);
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
    }

    function useItemBuilder(name){
        window.parent.useItem(name);
        setTimeout(() => {
            renderInventar()
        }, 500);
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
        // Ak je lokálna skillsDB_new prázdna, skúsime ju ihneď naplniť z hlavného okna (rodiča)
        if (!skillsDB_new || Object.keys(skillsDB_new).length === 0) {
            if (window.parent && window.parent.SKILLS_DB && Object.keys(window.parent.SKILLS_DB).length > 0) {
                skillsDB_new = window.parent.SKILLS_DB;
            }
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
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-message').innerText = message;
        
        const btnContainer = document.getElementById('modal-buttons');
        if (!btnContainer) return; // Bezpečnostná poistka
        
        btnContainer.innerHTML = ''; 

        if (isConfirm) {
            const yesBtn = document.createElement('button');
            yesBtn.className = 'tab-btn';
            yesBtn.style.cssText = 'clip-path:none; background:var(--hybrid-green); color:white; margin: 5px;';
            yesBtn.innerText = 'ÁNO';
            yesBtn.onclick = () => { if(callback) callback(); closeModal(); };
            
            const noBtn = document.createElement('button');
            noBtn.className = 'tab-btn';
            noBtn.style.cssText = 'clip-path:none; background:var(--hybrid-red); color:white; margin: 5px;';
            noBtn.innerText = 'NIE';
            noBtn.onclick = closeModal;

            btnContainer.appendChild(yesBtn);
            btnContainer.appendChild(noBtn);
        } else {
            const okBtn = document.createElement('button');
            okBtn.className = 'tab-btn';
            okBtn.style.cssText = 'clip-path:none; background:var(--hybrid-red); color:white;';
            okBtn.innerText = 'OK';
            okBtn.onclick = closeModal;
            btnContainer.appendChild(okBtn);
        }

        document.getElementById('custom-modal').style.display = 'flex';
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
        // ✅ Fast path: parent already has the DB loaded (avoids duplicate fetch)
        if (window.parent && window.parent.SKILLS_DB && Object.keys(window.parent.SKILLS_DB).length > 0) {
            skillsDB_new = window.parent.SKILLS_DB;
            originalSkillsDB = JSON.parse(JSON.stringify(skillsDB_new));
            console.log("Dáta načítané z rodiča (parent.SKILLS_DB)");
            return;
        }

        // Fallback: load independently if running standalone or parent not ready yet
        try {
            const response = await fetch('skillsDB.json');
            if (!response.ok) throw new Error("Súbor nenájdený");
            skillsDB_new = await response.json();
            originalSkillsDB = JSON.parse(JSON.stringify(skillsDB_new));
            console.log("Dáta úspešne načítané zo súboru");
        } catch (error) {
            console.error("Chyba pri načítaní JSON:", error);
            skillsDB_new = JSON.parse(localStorage.getItem('skillsDB')) || {};
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
                    z-index: 99999 !important;
                    
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
    // Vytvoríme jeden globálny div pre tooltip v dokumente, ak ešte neexistuje
    let tooltip = document.querySelector('.skill-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'skill-tooltip';
        document.body.appendChild(tooltip);
    }

    // Delegovanie udalosti na celý dokument (bude fungovať aj po premazaní a znovuvykreslení zoznamov)
    document.addEventListener('mouseover', (event) => {
        const target = event.target.closest('.skill-list-item');
        if (!target) return;

        const description = target.getAttribute('data-description');
        // Ak schopnosť nemá popis (index 3 je prázdny), tooltip nezobrazujeme
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

        // Ošetrenie, aby rámček nevyliezol mimo obrazovku vpravo alebo dole
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
        const target = event.target.closest('.skill-list-item');
        if (!target) return;

        tooltip.classList.remove('visible');

        
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.parent && typeof window.parent.onIframeReady === 'function') {
        window.parent.onIframeReady();
    }
});