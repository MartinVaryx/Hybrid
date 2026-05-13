    const articles = [
        {
            id: 'zaciatok',
            title: 'Ako to začalo',
            date: '11. 05. 2026',
            summary: 'O tom, čo viedlo ku vzniku Hybridu.',
            thumb: 'assets/articles/zaciatok.jpg',
            file: 'zaciatok.html'
        }
    ];
    
    function updateGroupDropdown() {
        const builderSelect = document.getElementById('builder-group-filter');
        const editorSelect = document.getElementById('edit-group');
        const relFilterSelect = document.getElementById('rel-group-filter'); // Nový filter v editore
        
        const groups = [...new Set(Object.values(skillsDB_new).map(s => s[1]))].sort();
        const optionsHtml = groups.map(g => `<option value="${g}">${g}</option>`).join('');
        
        builderSelect.innerHTML = '<option value="">VŠETKY SKUPINY</option>' + optionsHtml;
        editorSelect.innerHTML = optionsHtml;
        // Nový filter v editore má tiež možnosť "VŠETKY"
        relFilterSelect.innerHTML = '<option value="">VŠETKY SKUPINY</option>' + optionsHtml;
    }

    function renderEditorList() {
        const list = document.getElementById('editor-list');
        // Filter teraz berie text z políčka pre názov schopnosti
        const search = document.getElementById('edit-name').value.toUpperCase();
        list.innerHTML = '';
        
        const sortedKeys = Object.keys(skillsDB_new)
            .filter(name => name.includes(search)) // Toto zabezpečí filtrovanie podľa písania
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
        const groupFilter = document.getElementById('rel-group-filter').value; // Hodnota z nového filtra
        list.innerHTML = '';
        
        const sortedKeys = Object.keys(skillsDB_new)
            .filter(name => {
                const skillGroup = skillsDB_new[name][1];
                const matchesSearch = name.includes(search);
                const matchesGroup = !groupFilter || skillGroup === groupFilter; // Logika filtra skupín
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
            div.onclick = () => { 
                editingRels.push(name); 
                renderRelTags(); 
                // Po pridaní nevymažeme filter, len vyhľadávanie
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
        let group = document.getElementById('edit-group').value;
        if (!name || !group) return showCustomAlert("VYPLŇTE NÁZOV A SKUPINU.");
        skillsDB_new[name] = [cat, group, editingRels];
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
        document.getElementById('sel-skill-name').innerText = `${name} \u2192 ${targetLvl}`;
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

    function upgradeSelected() {
        if (!selectedSkill) return;
        const char = characters[activeCharIdx];
        const currentLvl = char.skills[selectedSkill] || 0;
        
        // Načítame dáta schopnosti hneď na začiatku, aby sme s nimi mohli pracovať
        const data = skillsDB_new[selectedSkill]; 
        const skillGroup = data[1]; // Skupina je na indexe 1
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

        // Výpočet ceny
        let relLevels = data[2].map(r => char.skills[r] || 0).sort((a,b) => b-a).slice(0,3);
        let discount = relLevels.reduce((a, b) => a + b, 0);
        const cost = Math.max(targetLvl, (targetLvl * data[0]) - discount);
        
        if (char.humanity <= cost && skillGroup === "SOMORA") {
            showCustomAlert("Máš príliš nízku ľudskosť.");
                return;
        }
        // 2. KONTROLA DOSTATKU BODOV
        if (char.sp >= cost) {
            
            // Prechod do druhej fázy
            if (char.isInitialPhase && (char.sp - cost) === 0) {
                showCustomAlert(
                    "Týmto uzavrieš fázu DANOSTÍ. Želáš si pokračovať?", 
                    "POTVRDENIE FÁZY", 
                    true, 
                    () => {
                        char.isInitialPhase = false;
                        char.sp = (char.sp - cost) + 20;
                        char.skills[selectedSkill] = targetLvl;
                        // Ak je to Somora, odčítame humanitu aj pri potvrdení
                        if (skillGroup === "SOMORA") {
                            char.humanity = (char.humanity || 10) - cost;
                        }
                        upgradeHistory = []; 
                        finishUpgrade(); 
                    }
                );
                return; 
            } 

            // BEŽNÝ PRÍPAD
            upgradeHistory.push({
                skill: selectedSkill,
                prevLvl: currentLvl,
                prevSP: char.sp,
                prevHumanity: char.humanity || 10, // Uložíme pre undo
                wasInitialPhase: char.isInitialPhase
            });

            char.sp -= cost;

            // LOGIKA PRE HUMANITU
            if (skillGroup === "SOMORA") {
                // Ak humanity neexistuje, nastavíme základ 10 a odčítame cost
                char.humanity = (char.humanity || 10) - cost;
            }

            char.skills[selectedSkill] = targetLvl;
            finishUpgrade();

        } else { 
            showCustomAlert("NEDOSTATOK BODOV RASTU!"); 
        }

        function finishUpgrade() {
            saveState();
            renderStats();
            selectSkill(selectedSkill);
            filterBuilder();
        }
    }

    function undoUpgrade() {
        if (upgradeHistory.length === 0) {
            showCustomAlert("ŽIADNE ĎALŠIE KROKY NA VRÁTENIE.");
            return;
        }

        const lastAction = upgradeHistory.pop(); // Vyberieme posledný uložený krok
        const char = characters[activeCharIdx];

        // Vrátime hodnoty späť
        char.skills[lastAction.skill] = lastAction.prevLvl;
        char.sp = lastAction.prevSP;
        char.isInitialPhase = lastAction.wasInitialPhase;

        saveState();
        renderStats();
        filterBuilder();
        if (selectedSkill) selectSkill(selectedSkill);
        
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
        const char = characters[activeCharIdx]; // Aktuálna postava
        list.innerHTML = '';
        
        const sortedKeys = Object.keys(skillsDB_new)
            .filter(name => {
                const skillGroup = skillsDB_new[name][1];
                
                // LOGIKA FÁZY: Ak je v prvej fáze, vidí len DANOSTI
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
            div.onclick = () => selectSkill(name);
            list.appendChild(div);
        });
    }

    function saveState() {
        localStorage.setItem('skillsDB_new', JSON.stringify(skillsDB_new));
        localStorage.setItem('characters', JSON.stringify(characters));
    }
    
    
    function renderCharSelector() {
        const s = document.getElementById('char-selector');
        s.innerHTML = characters.map((c, i) => `<option value="${i}" ${i === activeCharIdx ? 'selected' : ''}>${c.name}</option>`).join('');
    }

    function deleteCharacter() {
        if (characters.length <= 1) {
            showCustomAlert("NEMÔŽETE ODSTRÁNIŤ POSLEDNÉHO HRDINU.");
            return;
        }
        const charName = characters[activeCharIdx].name;
        showCustomAlert("Naozaj chcete odstrániť hrdinu?", "POTVRDENIE", true, () => {
            characters.splice(activeCharIdx, 1);
            activeCharIdx = 0; 
            saveState();
            renderCharSelector();
            switchCharacter();
        });        }


    function switchCharacter() { 
        activeCharIdx = parseInt(document.getElementById('char-selector').value); 
        selectedSkill = null; 
        upgradeHistory = []; // <--- TOTO PRIDAJ: Vymaže históriu pri zmene postavy
        
        document.querySelector('.control-box').classList.remove('is-active');

        document.getElementById('sel-skill-name').innerText = "VYBERTE SCHOPNOSŤ";
        renderStats(); 
        filterBuilder();
    }

    
    function createNewCharacter() {
        // Namiesto promptu len zobrazíme skrytý riadok
        document.getElementById('new-char-input-container').style.display = 'flex';
    }

    function confirmNewCharacter() {
        const input = document.getElementById('new-char-name');
        const n = input.value.trim();
        if(n) {
            characters.push({
                name: n.toUpperCase(), 
                sp: 40,
                skills: {}, 
                isInitialPhase: true,
                humanity: 50 
            }); 
            activeCharIdx = characters.length - 1; 
            saveState();
            renderCharSelector(); 
            switchCharacter();
            input.value = '';
            document.getElementById('new-char-input-container').style.display = 'none';
        }
    }

    function cancelNewCharacter() {
        document.getElementById('new-char-name').value = '';
        document.getElementById('new-char-input-container').style.display = 'none';
    }

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

    function toggleView() {
        // Zistíme, ktorá sekcia je momentálne aktívna
        const isIntro = document.getElementById('view-intro').classList.contains('active-view');
        if (isIntro) {
            switchView('builder');
        } else {
            switchView('intro');
        }
    }

    let currentView = 'intro'; 

    // --- OPRAVENÁ FUNKCIA SWITCHVIEW ---
    function switchView(viewId) {
        currentView = viewId;
        const toggleBtn = document.getElementById('view-toggle');

        // 1. Skryť všetky sekcie
        document.querySelectorAll('.view-section').forEach(view => {
            view.classList.remove('active-view');
        });
        
        // 2. Zobraziť vybranú sekciu
        const targetView = document.getElementById('view-' + viewId);
        if (targetView) {
            targetView.classList.add('active-view');
        }
        
        // 3. Logika pre tlačidlá a taby
        if (viewId === 'builder') {
            // Ak máme viacero tlačidiel s týmto ID (jedno v Intro, jedno v Builderi)
            document.querySelectorAll('#view-toggle').forEach(btn => btn.innerText = 'HLAVNÁ STRÁNKA');
            openTab('builder');
            renderStats();
            filterBuilder();
        } else {
            document.querySelectorAll('#view-toggle').forEach(btn => btn.innerText = 'VYTVOR SI HRDINU');
            openTab('uvod');
        }
    }



    function handleRouting() {
        const hash = window.location.hash.replace('#', '') || 'uvod';
        const builderTabs = ['builder', 'editor', 'navod'];
        
        // Zistíme, kde sa nachádzame (bez togglovania)
        const isArticle = hash.startsWith('novinky-');
        const targetTab = isArticle ? 'novinky' : hash;

        // 1. Správne prepnutie hlavného zobrazenia (Intro vs Builder)
        if (builderTabs.includes(targetTab)) {
            forceView('builder');
        } else {
            forceView('intro');
        }

        // 2. Logika pre články vs taby
        if (isArticle) {
            const articleId = hash.replace('novinky-', '');
            openTab('novinky', false); // false = neprepisuj hash, už tam je
            openArticle(articleId);
        } else {
            openTab(targetTab, false); // false = neprepisuj hash
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

        // Špecifická logika pre taby
        if (id === 'novinky') {
            ensureNewsStructure(); // Vždy priprav štruktúru
            if (!window.location.hash.includes('novinky-')) {
                renderNewsList(); // Zoznam vykresli len ak nie sme v článku
            }
        }
        
        if (id === 'editor') renderEditorList();
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

    // Funkcia na načítanie obsahu konkrétneho tabu
    async function loadTabContent(tabId) {
        try {
            const response = await fetch(`tabs/${tabId}.html`);
            if (!response.ok) throw new Error(`Nepodarilo sa načítať tab: ${tabId}`);
            const html = await response.text();
            document.getElementById(tabId).innerHTML = html;
        } catch (error) {
            console.error(error);
        }
    }

    async function init() {
        console.log("Inicializácia systému...");
            
        // 1. Načítaj dáta (Kritické)
        await loadSkills(); 

        // 2. Načítaj statické HTML súbory (Kritické pre zobrazenie tabov)
        const staticTabs = ['uvod', 'o-projekte', 'demo', 'kontakt'];
        await Promise.all(staticTabs.map(tabId => loadTabContent(tabId)));

        // 3. Inicializácia rozhrania (Príprava prvkov v DOM)
        renderCharSelector();
        updateGroupDropdown();
        filterBuilder();
        renderStats();
        renderEditorList();
        filterRelSearch();

        // 4. JEDINÉ spustenie routingu pri štarte
        // Toto sa pozrie na URL (napr. #novinky-zaciatok) a otvorí čo treba
        handleRouting(); 

        // 5. Počúvanie na zmeny URL (keď používateľ kliká na "Späť" v prehliadači)
        window.addEventListener('hashchange', handleRouting);
    }

    async function loadSkills() {
        try {
            const response = await fetch('skillsDB.json');
            if (!response.ok) throw new Error("Súbor nenájdený");
            
            // Priradíme dáta do globálnej premennej (bez kľúčového slova 'let')
            skillsDB_new = await response.json();
            originalSkillsDB = JSON.parse(JSON.stringify(skillsDB_new));
            
            console.log("Dáta úspešne načítané");
        } catch (error) {
            console.error("Chyba pri načítaní JSON:", error);
            // Fallback: ak súbor chýba, skúsime localStorage alebo prázdny objekt
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

    function ensureNewsStructure() {
        const newsTab = document.getElementById('novinky');
        if (!newsTab) return;

        // Ak tam ešte nie je wrapper, vytvoríme ho (toto je ten chýbajúci kúsok)
        if (!document.getElementById('news-wrapper')) {
            newsTab.innerHTML = `
                <div id="news-wrapper" class="news-container" style="width:100%">
                    <div id="news-list-view">
                        <h2 class="section-title">NAJNOVŠIE SPRÁVY</h2>
                        <div id="news-feed"></div>
                    </div>
                    <div id="news-article-view" style="display: none;">
                        <button class="back-btn" onclick="renderNewsList()">← Späť na zoznam</button>
                        <div id="article-content"></div>
                    </div>
                </div>`;
        }
    }

    function renderNewsList() {
        ensureNewsStructure(); // Najprv sa uistíme, že máme kontajnery

        const listContainer = document.getElementById('news-list-view');
        const articleContainer = document.getElementById('news-article-view');
        const feed = document.getElementById('news-feed');

        listContainer.style.display = 'block';
        articleContainer.style.display = 'none';
        window.location.hash = 'novinky';

        feed.innerHTML = articles.map(a => `
            <div class="news-card" onclick="openArticle('${a.id}')">
                <img src="${a.thumb}" alt="${a.title}" onerror="this.src='assets/logo.png'">
                <div class="news-card-info">
                    <span class="news-date">${a.date}</span>
                    <h3 style="margin:5px 0;">${a.title}</h3>
                    <p style="margin:0; font-size:0.9rem; color: #555;">${a.summary}</p>
                </div>
            </div>
        `).join('');
    }

    async function openArticle(articleId) {
        ensureNewsStructure();
        const article = articles.find(a => a.id === articleId);
        if (!article) return;

        const listContainer = document.getElementById('news-list-view');
        const articleContainer = document.getElementById('news-article-view');
        const content = document.getElementById('article-content');

        // --- ZMENA: Najprv zobrazíme "načítavanie" ---
        content.innerHTML = "<p style='color:white; text-align:center;'>Načítavam článok...</p>";
        listContainer.style.display = 'none';
        articleContainer.style.display = 'block';
        
        window.location.hash = `novinky-${articleId}`;
        window.scrollTo(0, 0);

        try {
            const response = await fetch(`tabs/articles/${article.file}?t=${new Date().getTime()}`);
            if (!response.ok) throw new Error("Súbor nenájdený");
            
            const html = await response.text();
            // --- Vložíme obsah až keď je stiahnutý ---
            content.innerHTML = html;
        } catch (e) {
            content.innerHTML = `<p style='color:var(--hybrid-red);'>Chyba: Článok sa nepodarilo načítať. (${e.message})</p>`;
        }
    }
