/* =====================================================================================
   AUDIO UI — navigačná vrstva pre nevidiacich hráčov
   =====================================================================================
   Pripája sa NAD existujúci script.js. Nemení pôvodné funkcie, len ich volá.
   Zapnutie/vypnutie: klávesa "V" (voice mode). Kým je aktívny, prevezme šípky/medzerník
   a zabráni ich spracovaniu pôvodným keydown handlerom (stopImmediatePropagation).

   ŠTRUKTÚRA (podľa zadania):
     SEKCIE (layer 1):  MENU | OVLÁDACÍ PANEL | SPRÁVY | DENNÍK
     PRVKY  (layer 2, len v OVLÁDACOM PANELI):
         Možnosti | Karty | Stres | Adrenalín | Zbrane | Schopnosti | Prvá pomoc | Únik

     Možnosti zahŕňa jednak text-voľby z choice-promptu (validChoices), jednak
     tlačidlá #proceed-btn / #back-button / #close-btn z #proceed-prompt - na
     obrazovke totiž fungujú ako jedna a tá istá skupina "možností na výber".
     Do zoznamu sa vždy zaradí len to, čo je práve viditeľné.
     PODVRSTVA (layer 3, tam kde treba, napr. Karty / Zbrane / Schopnosti / Adrenalín)

   OVLÁDANIE:
     ArrowLeft / ArrowRight  -> listovanie v aktuálnej vrstve (prehrá názov prvku)
     Space                   -> potvrdenie / vstup do prvku
     Escape / Backspace      -> späť o jednu vrstvu vyššie

   POZNÁMKA: HTML štruktúra menu (#menu-overlay a pod.) nebola k dispozícii, preto je
   načítanie položiek MENU urobené cez voliteľný selektor nižšie (MENU_SELECTOR) -
   uprav podľa skutočného markupu. Rovnako DENNÍK zatiaľ nemá obsah (podľa zadania).
   ===================================================================================== */

(function () {
    "use strict";

    // ---------------------------------------------------------------------------
    // 0. NASTAVENIA
    // ---------------------------------------------------------------------------
    const AUDIO_BASE_PATH = "audio/";     // priečinok, kam dáš .WAV súbory
    const AUDIO_EXT = ".WAV";             // tvoje súbory sú .WAV, nie .mp3
    // Overené podľa index.html: #main-menu obsahuje NASTAVENIA / POMOC / O HRE / ZMENIŤ HRDINU
    // + zatváracie tlačidlo "X" (onclick="hideMenu()"), ktoré do zoznamu položiek nechceme.
    const MENU_SELECTOR = '#main-menu button:not([onclick*="hideMenu"])';
    const audioCache = new Map();
    let isAudioReady = false;
    let audioUIActive = false;

    // ---------------------------------------------------------------------------
    // 1. PREHRÁVANIE ZVUKU - jednotná FRONTA (jeden zdieľaný <audio> aj jeden
    //    zdieľaný window.speechSynthesis pre CELÚ stránku, žiadne dva paralelné kanály).
    //
    //    Predtým mala interaktívna navigácia (playAudio/playAudioOrSpeak) vlastný
    //    <audio> element a samostatné čítanie nových záznamov v logu (playLogAudioOrSpeak)
    //    ďalší vlastný <audio> element - OBA ale volali window.speechSynthesis.cancel()/
    //    .speak() na TOM ISTOM, jedinom syntetizátore reči prehliadača. Keď teda hráč
    //    stlačil šípku práve vo chvíli, keď sa čítala nová hláška z logu (alebo naopak),
    //    obe strany si navzájom rušili prehrávanie a front sa vedel zaseknúť - presne
    //    hlásený "konflikt". Táto fronta to rieši tak, že úplne VŠETKO (interaktívne
    //    hlášky aj live-log) ide cez jedno miesto:
    //      - interaktívne volania (playAudio/playAudioOrSpeak) majú interrupt:true,
    //        takže hneď zastavia, čo práve hrá/hovorí, a idú prehrať ako prvé ĎALŠIE
    //        (predbehnú frontu), no NEMAŽÚ čakajúce záznamy z logu - tie doznejú potom.
    //      - automatické čítanie nových logov (enqueueLogNarration) sa len pridá na
    //        koniec fronty (interrupt:false) - ak logy pribúdajú rýchlejšie, než sa
    //        stíha prehrávať/hovoriť (viď poznámka v audio_manifest.json), jednoducho
    //        čakajú vo fronte a prehrajú sa všetky poporadku, len s oneskorením.
    //    `playToken` zabraňuje tomu, aby oneskorené onended/onerror z PRÁVE ZASTAVENÉHO
    //    prehrávania omylom posunuli frontu druhýkrát.
    // ---------------------------------------------------------------------------
    let audioQueue = [];
    let audioQueuePlaying = false;
    let currentAudioEl = null;
    let playToken = 0;

    // Nahraté súbory sú namrbytnuté hlasom "Slovak ViktoriaNeural" (Microsoft/Edge TTS).
    // Aby živé čítanie (Web Speech API fallback) znelo rovnako a nie mužským/iným hlasom,
    // hľadáme rovnaký hlas medzi hlasmi, čo ponúka prehliadač. Zoznam hlasov sa v niektorých
    // prehliadačoch načíta asynchrónne (voiceschanged), preto sa hľadanie cachuje/refreshuje.
    let cachedSkVoice = null;

    function pickSkFemaleVoice() {
        if (!window.speechSynthesis) return null;
        const voices = speechSynthesis.getVoices() || [];
        if (voices.length === 0) return null;
        // 1) presne ten istý hlas, akým sú namrbytnuté nahrávky
        let v = voices.find(function (v) { return /^sk/i.test(v.lang) && /viktoria/i.test(v.name); });
        if (v) return v;
        // 2) iný slovenský hlas výslovne označený ako ženský
        v = voices.find(function (v) { return /^sk/i.test(v.lang) && /female|žena/i.test(v.name); });
        if (v) return v;
        // 3) akýkoľvek slovenský hlas (lepšie ako default systémový/anglický)
        v = voices.find(function (v) { return /^sk/i.test(v.lang); });
        if (v) return v;
        return null;
    }

    function getSkVoice() {
        if (!cachedSkVoice) cachedSkVoice = pickSkFemaleVoice();
        return cachedSkVoice;
    }

    if (window.speechSynthesis) {
        speechSynthesis.onvoiceschanged = function () { cachedSkVoice = pickSkFemaleVoice(); };
    }

    function stopCurrentPlayback() {
        playToken++; // znehodnotí callbacky prehrávania, ktoré práve zastavujeme
        if (currentAudioEl) {
            try { currentAudioEl.pause(); currentAudioEl.currentTime = 0; } catch (e) {}
            currentAudioEl = null;
        }
        if (window.speechSynthesis) speechSynthesis.cancel();
    }

    function playQueueNext() {
        if (audioQueue.length === 0) { audioQueuePlaying = false; return; }
        audioQueuePlaying = true;
        const myToken = ++playToken;
        const item = audioQueue.shift();
        playQueueItem(item, myToken);
    }

    function playQueueItem(item, token) {
        const name = item.name || "no_audio";
        // `el.play()` môže na tom istom zlyhaní súboru (napr. chýbajúci/nenačítateľný .WAV)
        // vyvolať ZÁROVEŇ udalosť "error" na elemente AJ zamietnutie promisu z play().catch().
        // Bez tejto poistky by sa ttsFallback() spustil DVAKRÁT - raz z el.onerror, raz z
        // .catch() - čím by sa naraz rozbehli dve prehrávania (napr. nahrávka z druhého
        // pokusu cez frontu + živé čítanie), presne ten hlásený "hrajú cez seba" konflikt.
        let fallbackStarted = false;

        function advance() {
            if (token !== playToken) return; // zastarané volanie - medzičasom prišlo prerušenie
            currentAudioEl = null;
            playQueueNext();
        }

        function ttsFallback() {
            if (token !== playToken) return;
            if (fallbackStarted) return; // už spustené (pozri poznámku vyššie) - nespúšťaj druhý raz
            fallbackStarted = true;
            if (!item.text || !window.speechSynthesis) {
                if (name !== "no_audio") {
                    const fb = new Audio(AUDIO_BASE_PATH + "no_audio" + AUDIO_EXT);
                    currentAudioEl = fb;
                    fb.onended = advance;
                    fb.onerror = advance;
                    fb.play().catch(advance);
                } else {
                    advance();
                }
                return;
            }
            const utter = new SpeechSynthesisUtterance(item.text);
            utter.lang = "sk-SK";
            const voice = getSkVoice();
            if (voice) utter.voice = voice;
            utter.onend = advance;
            utter.onerror = advance;
            speechSynthesis.speak(utter);
        }

        const pathKey = AUDIO_BASE_PATH + name + AUDIO_EXT;
        const audioSrc = audioCache.get(name) || audioCache.get(pathKey) || pathKey;
        const el = new Audio(audioSrc);
        currentAudioEl = el;
        el.onended = advance;
        el.onerror = ttsFallback;
        el.play().catch(ttsFallback);
    }

    function enqueueAudio(fileNameNoExt, fallbackText, interrupt) {
        const name = fileNameNoExt || "no_audio";
        const item = { name: name, text: fallbackText || null };
        if (interrupt) {
            stopCurrentPlayback();
            audioQueue.unshift(item); // predbehne prípadné čakajúce live-log hlášky, ale nezmaže ich
            playQueueNext();
        } else {
            audioQueue.push(item);
            if (!audioQueuePlaying) playQueueNext();
        }
    }

    function stopAllAudio() {
        stopCurrentPlayback();
        audioQueue.length = 0;
        audioQueuePlaying = false;
    }

    // Okamžitá interaktívna hláška (šípky/medzerník) - zastaví, čo práve hrá, a hrá sa hneď.
    function playAudio(fileNameNoExt) {
        enqueueAudio(fileNameNoExt, null, true);
    }

    // Ako playAudio, ale ak nahraný súbor CHÝBA (typicky dynamická hláška s premenlivým
    // obsahom - meno hrdinu, číslo, text zo SPRÁV a pod.), namiesto tichého no_audio.WAV
    // fallbacku sa text rovno PREČÍTA nahlas cez Web Speech API (rovnaký sk hlas ako nahrávky).
    function playAudioOrSpeak(fileNameNoExt, fallbackText) {
        enqueueAudio(fileNameNoExt, fallbackText, true);
    }

    // Zaradí hlášku na KONIEC fronty bez prerušenia - používa automatické čítanie nových
    // záznamov v SPRÁVACH (viď sekcia 11b), aby sa rýchlo idúce hlášky prehrali poporadku.
    function enqueueLogNarrationAudio(fileNameNoExt, fallbackText) {
        enqueueAudio(fileNameNoExt, fallbackText, false);
    }

    // Niektoré hlášky (najmä pri HROZBE - viď threat_msg/threat_avoided_msg a "Vyhneš sa
    // hrozbe."/"Nepriateľ sa vyhol hrozbe." v script.js) dostanú PRIAMO DO TOHO ISTÉHO
    // reťazca, ešte pred zavolaním log(), prilepenú zátvorku s číslami hodu, napr.
    // "(HROZBA: 5 -  OPATRNOSŤ: 3)  \n Zdá sa, že to pomohlo." - ale LEN keď má hráč
    // zapnuté "zobrazovanie hodov" (rollsVisible()). Keďže manifest bol nahratý z
    // ČISTÉHO textu hlášky (bez tejto zátvorky), kľúč odvodený priamo z DOM textu by sa
    // menil pri KAŽDOM hode a nikdy by nesedel so súborom v manifeste - hláška by sa tak
    // vždy (pri zapnutom zobrazovaní hodov) prečítala len cez TTS namiesto nahrávky.
    // Táto funkcia zátvorku s hodmi odstráni PRED odvodením kľúča - fallback text na TTS
    // (keď súbor naozaj chýba) naďalej dostáva PÔVODNÝ text vrátane čísel.
    function stripRollAnnotations(text) {
        return text
            .replace(/^\s*\(\s*(?:HROZBA|OPATRNOSŤ|KOCKY HROZBY|NÁROČNOSŤ)\b[^)]*\)\s*/i, "")
            .replace(/\s*\(\s*(?:HROZBA|OPATRNOSŤ|KOCKY HROZBY|NÁROČNOSŤ)\b[^)]*\)\s*$/i, "")
            .trim();
    }

    // Slovenský slugify - "Šprint" -> "sprint", "Prvá pomoc" -> "prva_pomoc"
    // Používa sa na odvodenie mena súboru pre dynamický obsah (zbrane, schopnosti, karty...).
    function slugifySk(text) {
        if (!text) return "";
        const map = { á:'a', ä:'a', č:'c', ď:'d', é:'e', í:'i', ľ:'l', ĺ:'l',
                      ň:'n', ó:'o', ô:'o', ŕ:'r', š:'s', ť:'t', ú:'u', ý:'y', ž:'z' };
        return text.toLowerCase()
            .split("").map(function (ch) { return map[ch] || ch; }).join("")
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
    }

    // ---------------------------------------------------------------------------
    // 2. STATICKÉ MENO SÚBOROV (systémové hlášky, názvy sekcií a prvkov)
    // ---------------------------------------------------------------------------
    const AUDIO_MAP = {
        // Sekcie
        section_menu: "ui_section_menu",
        section_ovladaci_panel: "ui_section_ovladaci_panel",
        section_spravy: "ui_section_spravy",
        section_dennik: "ui_section_dennik",

        // Prvky ovládacieho panelu
        el_moznosti: "ui_element_moznosti",
        el_karty: "ui_element_karty",
        el_stres: "ui_element_stres",
        el_adrenalin: "ui_element_adrenalin",
        el_zbrane: "ui_element_zbrane",
        el_schopnosti: "ui_element_schopnosti",
        el_prva_pomoc: "ui_element_prva_pomoc",
        el_unik: "ui_element_unik",

        // Systémové
        back: "ui_back",
        empty_spravy: "ui_spravy_empty",
        oldest_spravy: "ui_spravy_zaciatok",
        newest_spravy: "ui_spravy_koniec",
        dennik_prazdny: "ui_dennik_prazdny",
        adrenalin_none: "adrenalin_none",
        weapon_empty: "weapon_empty",
        prva_pomoc_uspech: "prva_pomoc_uspech",
        prva_pomoc_neuspech: "prva_pomoc_neuspech",
        btn_spat: "btn_spat",
        btn_ukoncit: "btn_ukoncit",
        voice_mode_on: "ui_voice_mode_on",
        voice_mode_off: "ui_voice_mode_off",

        // Výber hrdinu (#hero-selection-overlay) / počiatočnej zbrane (#weapon-selection-overlay)
        hero_vyber: "ui_hero_vyber",
        weapon_vyber: "ui_zbran_vyber",
        btn_vybrat: "btn_vybrat",
        btn_novy_hrdina: "btn_novy_hrdina",
        btn_vymazat: "btn_vymazat",

        // Builder (editor postavy - #builder-overlay/#builder-iframe)
        builder_otvoreny: "ui_builder_otvoreny",
        grid_schopnosti: "ui_grid_schopnosti",
        pridat_schopnost: "pridat_schopnost",
        btn_zvysit_uroven: "btn_zvysit_uroven",
        btn_znizit_uroven: "btn_znizit_uroven",
        btn_vratit_zmenu: "btn_vratit_zmenu",

        // Stav kariet
        karty_neaktivne: "ui_karty_neaktivne",
        // Stav úniku (dostupný len počas sporu)
        unik_neaktivne: "ui_unik_neaktivne"
    };

    function speak(key) {
        playAudio(AUDIO_MAP[key] || key);
    }

    // ---------------------------------------------------------------------------
    // 3. STAV NAVIGÁCIE
    // ---------------------------------------------------------------------------
    const SECTIONS = ["MENU", "OVLADACI_PANEL", "SPRAVY", "DENNIK"];
    const SECTION_AUDIO_KEYS = {
        MENU: "section_menu",
        OVLADACI_PANEL: "section_ovladaci_panel",
        SPRAVY: "section_spravy",
        DENNIK: "section_dennik"
    };

    const PANEL_ELEMENTS = [
        { id: "MOZNOSTI", audio: "el_moznosti" },
        { id: "KARTY", audio: "el_karty" },
        { id: "STRES", audio: "el_stres" },
        { id: "ADRENALIN", audio: "el_adrenalin" },
        { id: "ZBRANE", audio: "el_zbrane" },
        { id: "SCHOPNOSTI", audio: "el_schopnosti" },
        { id: "PRVA_POMOC", audio: "el_prva_pomoc" },
        { id: "UNIK", audio: "el_unik" }
    ];

    const state = {
        layer: "section",     // "section" | "element" | "sub"
        sectionIdx: 0,
        elementIdx: 0,
        subMode: null,        // "moznosti" | "karty" | "adrenalin" | "zbrane" | "schopnosti"
        spravyIdx: 0          // 0 = najnovšia správa
    };

    function currentSection() { return SECTIONS[state.sectionIdx]; }
    function currentElement() { return PANEL_ELEMENTS[state.elementIdx]; }

    // ---------------------------------------------------------------------------
    // 4. SEKCIA: MENU
    //    TODO: uprav MENU_SELECTOR podľa reálneho markupu menu.
    // ---------------------------------------------------------------------------
    function getMenuOptions() {
        return Array.from(document.querySelectorAll(MENU_SELECTOR));
    }

    function announceMenuOption(idx) {
        const options = getMenuOptions();
        const opt = options[idx];
        if (!opt) { speak("section_menu"); return; }
        const label = opt.textContent.trim();
        playAudio("menu_" + slugifySk(label));
    }

    // ---------------------------------------------------------------------------
    // 5. SEKCIA: OVLÁDACÍ PANEL > Možnosti
    //    Hooks existujúci choice-prompt framework (validChoices) A ZÁROVEŇ zahŕňa
    //    tlačidlá #proceed-btn / #back-button / #close-btn z #proceed-prompt -
    //    na obrazovke sa totiž správajú ako tá istá skupina "možností na výber".
    //    Do zoznamu sa zaradí VŽDY len to, čo je práve viditeľné (style.display !== "none").
    // ---------------------------------------------------------------------------
    let moznostiCursor = 0;

    // Naivné `.style.display !== "none"` overuje LEN vlastný inline štýl elementu, nie skutočnú
    // viditeľnosť na obrazovke - napr. #proceed-btn nemá nikdy svoj vlastný display:none, iba jeho
    // WRAPPER #proceed-prompt sa takto skrýva/zobrazuje. Preto sa #proceed-btn (ĎALEJ/ZAČAŤ) predtým
    // vedel objaviť v zozname Možností, aj keď v hre vôbec nebol vidno (napr. počas výberu hrdinu),
    // čo blokovalo/mätúc posúvalo kurzor na neaktuálnu položku. Táto funkcia prejde celý reťazec
    // predkov a použije computed style, takže zachytí skrytie na ktorejkoľvek úrovni.
    function isElementVisible(el) {
        if (!el) return false;
        let node = el;
        while (node && node.nodeType === 1) {
            if (window.getComputedStyle(node).display === "none") return false;
            node = node.parentElement;
        }
        return true;
    }

    function getMoznostiItems() {
        const items = [];

        // 1) položky z choice-prompt (ak je viditeľný a má validné možnosti)
        const choicePrompt = document.getElementById("choice-prompt");
        const data = choicePrompt && choicePrompt.userData;
        if (choicePrompt && isElementVisible(choicePrompt) && data && data.validChoices) {
            data.validChoices.forEach(function (choice, idx) {
                items.push({
                    type: "choice",
                    choiceIndex: idx,
                    label: choice.isBack ? "Späť" : choice.text
                });
            });
        }

        // 2) proceed / back / close tlačidlá - zaradené len ak sú SKUTOČNE viditeľné
        //    (vrátane wrapperu #proceed-prompt, viď isElementVisible vyššie)
        const proceedDefs = [
            { el: document.getElementById("proceed-btn"), dynamic: true },
            { el: document.getElementById("back-button"), audioKey: "btn_spat" },
            { el: document.getElementById("close-btn"), audioKey: "btn_ukoncit" }
        ];
        proceedDefs.forEach(function (d) {
            if (d.el && isElementVisible(d.el)) {
                items.push({ type: "button", el: d.el, dynamic: d.dynamic, audioKey: d.audioKey });
            }
        });

        return items;
    }

    function moznostiAnnounceCurrent() {
        const items = getMoznostiItems();
        const item = items[moznostiCursor];
        if (!item) { playAudio("no_audio"); return; }

        if (item.type === "choice") {
            // udržiavame existujúci vizuálny highlight synchronizovaný pre vidiacich spoluhráčov
            if (typeof activeChoiceIndex !== "undefined") activeChoiceIndex = item.choiceIndex;
            if (typeof updateVisualChoiceHighlights === "function") updateVisualChoiceHighlights();
            playAudio("choice_" + slugifySk(item.label));
        } else if (item.dynamic) {
            const label = item.el.textContent.trim(); // "ZAČAŤ" alebo "ĎALEJ"
            playAudio("btn_" + slugifySk(label));
        } else {
            speak(item.audioKey);
        }
    }

    function moznostiLeft() {
        const items = getMoznostiItems();
        if (items.length === 0) { playAudio("no_audio"); return; }
        moznostiCursor = (moznostiCursor - 1 + items.length) % items.length;
        moznostiAnnounceCurrent();
    }

    function moznostiRight() {
        const items = getMoznostiItems();
        if (items.length === 0) { playAudio("no_audio"); return; }
        moznostiCursor = (moznostiCursor + 1) % items.length;
        moznostiAnnounceCurrent();
    }

    function moznostiSelect() {
        const items = getMoznostiItems();
        const item = items[moznostiCursor];
        if (!item) { goUp(); return; }

        if (item.type === "choice") {
            const choicePrompt = document.getElementById("choice-prompt");
            const buttons = choicePrompt.querySelectorAll(".adrenaline-select");
            if (buttons[item.choiceIndex]) buttons[item.choiceIndex].click();
        } else {
            item.el.click();
        }
        // Po výbere ostávame v Možnostiach - výber už sám o sebe je zmena stavu hry a
        // nemá automaticky "vystrkovať" hráča o vrstvu vyššie (a tým mu nič neohlasovať
        // navyše). Ak si praje ísť vyššie, urobí to sám cez Escape/Backspace.
    }

    // ---------------------------------------------------------------------------
    // 6. OVLÁDACÍ PANEL > Karty (hooks existujúci card-cycling framework)
    // ---------------------------------------------------------------------------

    // Presná kópia podmienky, ktorou script.js (UNIFIED KEYBOARD CONTROLLER) rozhoduje,
    // či sú karty práve použiteľné, alebo len vizuálne sivé/neaktívne (mimo boja/akčnej
    // fázy, počas rozhovoru, general-promptu a pod.) - viď audio_manifest.json / karty_neaktivne.
    function cardsAreActive() {
        const choicePrompt = document.getElementById("choice-prompt");
        const isChoiceVisible = choicePrompt && isElementVisible(choicePrompt) && choicePrompt.dataset.actionBack !== "true";
        const readyPrompt = document.getElementById("ready-prompt");
        const isReadyVisible = readyPrompt && isElementVisible(readyPrompt);
        const proceedPrompt = document.getElementById("proceed-prompt");
        const isProceedVisible = proceedPrompt && isElementVisible(proceedPrompt);
        const generalPrompt = document.getElementById("general-prompt");
        const isGeneralVisible = generalPrompt && isElementVisible(generalPrompt);
        return (typeof inputs_frozen === "undefined" || !inputs_frozen) &&
            (((!isChoiceVisible) && (typeof narrative_phase === "undefined" || !narrative_phase))
                || (typeof is_heal_check !== "undefined" && is_heal_check)
                || (typeof is_elimination_check !== "undefined" && is_elimination_check)
                || (typeof is_tutorial !== "undefined" && is_tutorial)) &&
            !isReadyVisible && !isProceedVisible && !isGeneralVisible;
    }

    // Zistí, ktorý card_*_d_tooltip / card_*_a_tooltip kľúč sa má prehrať pre kartu
    // s daným kódom ("o"/"s"/"b"). Mimo sporu/eliminačnej kontroly sa vždy hlási HORNÁ
    // strana ("d" - Opatrnosť), keďže tá je pri bežnom (nie bojovom) použití karty
    // relevantná. Počas sporu (is_conflict) alebo eliminačnej kontroly (is_elimination_check)
    // je vždy aktívna len JEDNA konkrétna strana (zóna) karty - tá, ktorú určuje
    // currentSelectedActionType ("A" = ÚTOK/dolná strana, "D" = ČIN/horná strana,
    // viď script.js) - preto sa vtedy prehráva tooltip práve tejto strany
    // (viď audio_manifest.json -> karty -> _note_side_tooltip).
    function kartyTooltipKey(code) {
        const side = (is_conflict || is_elimination_check)
            ? ((currentSelectedActionType === "A") ? "a" : "d")
            : "d";
        return "card_" + code + "_" + side + "_tooltip";
    }

    // Ohlásenie AKTUÁLNEJ karty/strany - volá sa pri vstupe do Kariet aj po každej
    // zmene šípkami (kartyLeft/kartyRight/kartyToggleSide nižšie). Hovorí rovno hodnoty
    // danej (v spore konkrétnej) strany karty namiesto len samotného mena karty
    function kartyAnnounceCurrent() {
        const cards = document.querySelectorAll("#card-tray-container .card-container");
        const card = cards[currentSelectedCardIdx];
        if (!card) { playAudio("no_audio"); return; }
        const code = (card.getAttribute("data-card") || "").toLowerCase();
        const actual_card = "card_" + code
        console.log(actual_card)
        speak(actual_card);
    }

    function kartyLeft() {
        const cards = document.querySelectorAll("#card-tray-container .card-container");
        if (cards.length === 0) return;
        currentSelectedCardIdx = (currentSelectedCardIdx - 1 + cards.length) % cards.length;
        updateCardKeyboardHighlight();
        kartyAnnounceCurrent();
    }

    function kartyRight() {
        const cards = document.querySelectorAll("#card-tray-container .card-container");
        if (cards.length === 0) return;
        currentSelectedCardIdx = (currentSelectedCardIdx + 1) % cards.length;
        updateCardKeyboardHighlight();
        kartyAnnounceCurrent();
    }

    // Prepnutie strany karty (šípky HORE/DOLE) - kópia logiky "2. PREPÍNANIE POLOVÍC
    // KARTY" z UNIFIED KEYBOARD CONTROLLER v script.js: mimo sporu/eliminačnej kontroly
    // strany neexistujú (celá karta je jeden klik), preto sa v tom prípade nič neprepína.
    function kartyToggleSide() {
        if (!is_conflict && !is_elimination_check) { playAudio("no_audio"); return; }
        currentSelectedActionType = (currentSelectedActionType === "A") ? "D" : "A";
        updateCardKeyboardHighlight();
        kartyAnnounceCurrent();
    }

    function kartySelect() {
        const cards = document.querySelectorAll("#card-tray-container .card-container");
        const activeCard = cards[currentSelectedCardIdx];
        if (!activeCard) return;
        if (!is_conflict && !is_elimination_check) {
            activeCard.click();
        } else {
            const zone1 = activeCard.children[0];
            const zone2 = activeCard.children[1];
            if (zone1.getAttribute("data-action") === currentSelectedActionType) zone1.click();
            else if (zone2.getAttribute("data-action") === currentSelectedActionType) zone2.click();
        }
        // Ostávame v Kartách - viď poznámka pri moznostiSelect(). Hráč tak môže hneď
        // pokračovať výberom ďalšej karty/zóny (napr. druhé kolo v konflikte) bez toho,
        // aby ho každý výber vracal o vrstvu vyššie a znova ohlasoval prvok.
    }

    // ---------------------------------------------------------------------------
    // 6b. AUTOMATICKÝ PRESUN FOKUSU NA KARTY POČAS AKČNEJ FÁZY (is_action_phase)
    //    Kým prebieha akčná fáza (script.js nastaví is_action_phase = true), pôvodné
    //    Možnosti (voľby z choice-promptu) už nie sú na obrazovke - ak by audio UI
    //    zostalo v Možnostiach, čítalo by staré/neaktuálne voľby (choicePrompt tam
    //    už nie je taký, aký bol). Namiesto reagovania až na ďalšie stlačenie klávesu
    //    (čo by hráč nemusel spraviť hneď) to sledujeme pravidelným pollingom - keďže
    //    is_action_phase je obyčajná JS premenná v script.js, nie DOM atribút, nedá sa
    //    na jej zmenu naviazať MutationObserver ako pri #terminal-screen vyššie.
    //
    //    Zásah je NEVTIERAVÝ: fokus presunieme len vtedy, ak bol hráč práve v
    //    Možnostiach (inak ho nerušíme, napr. keď si práve prezerá SPRÁVY); a späť do
    //    Možnostiach ho vrátime len vtedy, ak medzitým sám neodišiel z Kariet niekam
    //    inam (napr. pozrieť si STRES) - v tom prípade rešpektujeme, kde práve je.
    // ---------------------------------------------------------------------------
    let lastKnownActionPhase = false;
    let focusWasAutoMovedToKarty = false;

    function isFocusOnMoznosti() {
        if (state.layer === "element" && currentElement() && currentElement().id === "MOZNOSTI") return true;
        if (state.layer === "sub" && state.subMode === "moznosti") return true;
        return false;
    }

    function focusOnKartyForActionPhase() {
        state.sectionIdx = SECTIONS.indexOf("OVLADACI_PANEL");
        state.elementIdx = PANEL_ELEMENTS.findIndex(function (e) { return e.id === "KARTY"; });
        state.layer = "sub";
        state.subMode = "karty";
        currentSelectedCardIdx = 0;
        if (typeof updateCardKeyboardHighlight === "function") updateCardKeyboardHighlight();
        kartyAnnounceCurrent();
    }

    function returnFocusToMoznostiAfterActionPhase() {
        state.sectionIdx = SECTIONS.indexOf("OVLADACI_PANEL");
        state.elementIdx = PANEL_ELEMENTS.findIndex(function (e) { return e.id === "MOZNOSTI"; });
        state.layer = "element";
        state.subMode = null;
        speak("el_moznosti");
    }

    function checkActionPhaseTransition() {
        if (typeof is_action_phase === "undefined") return;
        if (!audioUIActive) { lastKnownActionPhase = is_action_phase; focusWasAutoMovedToKarty = false; return; }
        if (is_action_phase === lastKnownActionPhase) return;

        const turningOn = is_action_phase && !lastKnownActionPhase;
        const turningOff = !is_action_phase && lastKnownActionPhase;
        lastKnownActionPhase = is_action_phase;

        if (detectOverlay()) return; // výber hrdinu/zbrane/builder majú prioritu, nezasahujeme

        if (turningOn) {
            if (isFocusOnMoznosti()) {
                focusWasAutoMovedToKarty = true;
                focusOnKartyForActionPhase();
            }
        } else if (turningOff) {
            const stillOnKarty = state.layer === "sub" && state.subMode === "karty";
            if (focusWasAutoMovedToKarty && stillOnKarty) {
                returnFocusToMoznostiAfterActionPhase();
            }
            focusWasAutoMovedToKarty = false;
        }
    }

    setInterval(checkActionPhaseTransition, 200);

    // ---------------------------------------------------------------------------
    // 7. OVLÁDACÍ PANEL > Stres (jednoduchý readout)
    // ---------------------------------------------------------------------------
    function stresAnnounce() {
        const val = (typeof HERO !== "undefined" && HERO && typeof HERO.stress === "number") ? HERO.stress : 0;
        playAudio("stres_" + val);
    }

    // ---------------------------------------------------------------------------
    // 8. OVLÁDACÍ PANEL > Adrenalín (cyklovanie dostupných uzlov 3-0)
    //    Podľa index.html: riadok #adrenaline-track-row obsahuje bunky ".ad-node".
    //    Vyberateľné (dostupné) sú len tie s triedou "ad-playable" (ostatné sú
    //    uzamknuté/sivé). data-idx = cieľová hodnota STRESU, data-val = bonus
    //    ADRENALÍNU, ktorý bunka dáva - čítame preto data-val.
    // ---------------------------------------------------------------------------
    function getAdrenalineNodes() {
        return Array.from(document.querySelectorAll("#adrenaline-track-row .ad-node.ad-playable"));
    }

    let adrenalineCursor = 0;

    function adrenalinAnnounceCurrent() {
        const nodes = getAdrenalineNodes();
        const node = nodes[adrenalineCursor];
        if (!node) { speak("adrenalin_none"); return; }
        const val = node.getAttribute("data-val");
        playAudio("adrenalin_" + val);
    }

    function adrenalinLeft() {
        const nodes = getAdrenalineNodes();
        if (nodes.length === 0) { speak("adrenalin_none"); return; }
        adrenalineCursor = (adrenalineCursor - 1 + nodes.length) % nodes.length;
        adrenalinAnnounceCurrent();
    }

    function adrenalinRight() {
        const nodes = getAdrenalineNodes();
        if (nodes.length === 0) { speak("adrenalin_none"); return; }
        adrenalineCursor = (adrenalineCursor + 1) % nodes.length;
        adrenalinAnnounceCurrent();
    }

    function adrenalinSelect() {
        const nodes = getAdrenalineNodes();
        const node = nodes[adrenalineCursor];
        if (node) node.click(); // spustí existujúcu selectAdrenalineNode() logiku cez click handler
        // Ostávame v Adrenalíne - viď poznámka pri moznostiSelect().
    }

    // ---------------------------------------------------------------------------
    // 9. OVLÁDACÍ PANEL > Zbrane / Schopnosti (hooks existujúci cycleDropdown framework)
    // ---------------------------------------------------------------------------

    // Rozparsuje popisok <option>, presne tak, ako ho vypĺňa updateUI() v script.js:
    // zbrane "PIŠTOĽ (+1) x10" / "SEKERA (+2)" (munícia sa uvádza len pri zbraniach,
    // ktoré ju majú), schopnosti "SILA (4)". Číta sa vždy zo ŽIVÉHO DOM-u (rovnako ako
    // pri tooltipoch vyššie), aby audio-ui.js nemusel duplikovať hernú logiku
    // (WEAPON_LIST / INITIAL_AMMO / HERO.skills) na vlastnú päsť.
    function parseWeaponOptionLabel(label) {
        const m = /^(.*?)\s*\(\+(-?\d+)\)(?:\s*x(\d+))?$/.exec(label || "");
        if (!m) return null;
        return { name: m[1], intensity: m[2], ammo: (m[3] !== undefined ? m[3] : null) };
    }

    function parseSkillOptionLabel(label) {
        const m = /^(.*?)\s*\((-?\d+)\)$/.exec(label || "");
        if (!m) return null;
        return { name: m[1], level: m[2] };
    }

    function announceElement() {
        const el = currentElement();
        if (el.id === "MOZNOSTI" && getMoznostiItems().length === 1) {
            moznostiCursor = 0;
            moznostiAnnounceCurrent();
        } else {
            speak(el.audio);
        }
    }
    // Ohlási MENO zbrane/schopnosti (existujúci statický 'weapon_<slug>'/'skill_<slug>'
    // zvuk - preruší predošlé prehrávanie a začne hneď) a HNEĎ ZA NÍM (zaradené do frontu
    // BEZ prerušenia, aby obe hlášky zneli poporadku a nie cez seba) aj PRIRADENÚ HODNOTU
    // (INTENZITA + prípadná munícia pri zbrani, úroveň pri schopnosti). Hodnota nemá vopred
    // daný ohraničený rozsah (na rozdiel od STRES 0-15 / ADRENALÍN 0-3), preto sa - podobne
    // ako napr. meno hrdinu (viď hero_select) - vždy prečíta cez Web Speech fallback.
    function dropdownAnnounceCurrent(dropdownId, emptyKey) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown || dropdown.selectedIndex < 0 || dropdown.options.length === 0) {
            speak(emptyKey);
            return;
        }
        const option = dropdown.options[dropdown.selectedIndex];
        const isWeapon = dropdownId === "player-weapon-dropdown";
        if (option.value === "placeholder" || option.value === "none") {
            speak(emptyKey);
            return;
        }

        const label = option.textContent.trim();
        const prefix = isWeapon ? "weapon_" : "skill_";
        const parsed = isWeapon ? parseWeaponOptionLabel(label) : parseSkillOptionLabel(label);
        if (!parsed) { playAudioOrSpeak(prefix + slugifySk(label), label); return; }

        playAudio(prefix + slugifySk(parsed.name));

        let valueText;
        if (isWeapon) {
            valueText = "Intenzita " + parsed.intensity + ".";
            if (parsed.ammo !== null) valueText += " Munícia: " + parsed.ammo + ".";
        } else {
            valueText = "Úroveň " + parsed.level + ".";
        }
        enqueueLogNarrationAudio("hodnota_" + slugifySk(valueText.slice(0, 60)), valueText);
    }

    function zbraneLeft() { cycleDropdown("player-weapon-dropdown", -1); dropdownAnnounceCurrent("player-weapon-dropdown", "weapon_empty"); }
    function zbraneRight() { cycleDropdown("player-weapon-dropdown", 1); dropdownAnnounceCurrent("player-weapon-dropdown", "weapon_empty"); }

    function schopnostiLeft() { cycleDropdown("player-skill-dropdown", -1); dropdownAnnounceCurrent("player-skill-dropdown", "no_audio"); }
    function schopnostiRight() { cycleDropdown("player-skill-dropdown", 1); dropdownAnnounceCurrent("player-skill-dropdown", "no_audio"); }

    // Vráti popis schopnosti/biologickej zbrane zo skillsDB.json (4. pole záznamu, index 3),
    // ak existuje - nie každá schopnosť ho má (napr. "IQ", "KLEPETÁ" v skillsDB.json popis
    // nemajú). Zdroj je window.SKILLS_DB, ktorý si script.js naplní fetch-om pri štarte hry
    // (viď script.js, "NAČÍTANIE SKILLS DB Z ROOTOVÉHO PRIEČINKA").
    function getSkillDescription(skillName) {
        const db = (typeof window !== "undefined" && window.SKILLS_DB)
            || (typeof SKILLS_DB !== "undefined" ? SKILLS_DB : null);
        const entry = db && skillName && db[skillName.toUpperCase()];
        return (entry && typeof entry[3] === "string") ? entry[3] : null;
    }


    // ---------------------------------------------------------------------------
    // 10. OVLÁDACÍ PANEL > Prvá pomoc / Únik (priama akcia, žiadna podvrstva)
    // ---------------------------------------------------------------------------
    function prvaPomocSelect() {
        if (typeof runHealCheck === "function") runHealCheck();
        // Ostávame na prvku PRVÁ POMOC - viď poznámka pri moznostiSelect(). Predtým sem
        // hneď nasledoval goUp(), ktorý hráča vrátil až do sekcie OVLÁDACÍ PANEL a rovno
        // ohlásil jej názov, hoci hráč žiadnu zmenu sekcie nežiadal - len spustil kontrolu.
    }

    // Únik (rovnako ako karty vyššie) má zmysel len počas sporu (is_conflict) - escape-btn
    // je mimo sporu v DOM skrytý (display:none, viď script.js), takže mimo sporu ho
    // nemá zmysel ani skúšať klikať (mohol by ísť tichý no-op alebo v horšom prípade
    // spustiť logiku, ktorá počíta s tým, že spor prebieha).
    function unikIsActive() {
        return typeof is_conflict !== "undefined" && !!is_conflict;
    }

    // Na rozdiel od KARIET (ktoré aj mimo boja nesú informáciu a dá sa nimi listovať,
    // viď cardsAreActive() vyššie - preto ostávajú v cykle vždy) ÚNIK mimo sporu
    // neponúka vôbec nič - žiadne info, žiadnu akciu. Pri prechádzaní OVLÁDACÍM PANELOM
    // šípkami ho preto v tomto stave úplne PRESKOČÍME, aby zbytočne nerozptyľoval.
    function isElementSkippable(el) {
        return el.id === "UNIK" && !unikIsActive();
    }

    function unikSelect() {
        if (!unikIsActive()) { speak("unik_neaktivne"); return; }
        const escapeBtn = document.getElementById("escape-btn");
        if (escapeBtn) escapeBtn.click();
        // Ostávame na prvku ÚNIK - viď poznámka vyššie pri prvaPomocSelect().
    }

    // ---------------------------------------------------------------------------
    // 11. SEKCIA: SPRÁVY (číta posledný záznam logu, ArrowLeft = staršie správy)
    // ---------------------------------------------------------------------------
    function getLogLines() {
        const terminal = document.getElementById("terminal-screen");
        if (!terminal) return [];
        return Array.from(terminal.querySelectorAll(".terminal-line"));
    }

    function spravyAnnounceCurrent() {
        const lines = getLogLines();
        if (lines.length === 0) { speak("empty_spravy"); return; }
        // najnovšia správa = posledný prvok v DOM = index 0 v našom "history" číslovaní
        const idxFromEnd = lines.length - 1 - state.spravyIdx;
        const line = lines[idxFromEnd];
        if (!line) { speak("empty_spravy"); return; }
        // Skús najprv nahratý súbor (viď audio_manifest.json -> spravy.msg_hardcoded /
        // spravy.msg_prefix_static pre kompletný zoznam hlášok, ktoré sa dajú nahrať vopred).
        // Ak taký súbor neexistuje (typicky ide o dynamickú hlášku s premenlivým obsahom -
        // číslo, meno zbrane/hrdinu/schopnosti a pod.), audio-ui hlášku prečíta nahlas
        // cez Web Speech API namiesto tichého "Chýba audiosúbor".
        const fullText = line.textContent;
        // Kľúč sa odvodzuje z textu OČISTENÉHO od prípadnej zátvorky s číslami hodu
        // (viď stripRollAnnotations vyššie) - inak by sa napr. hlášky HROZBY nikdy
        // netrafili do pregenerovaného súboru, keď má hráč zapnuté zobrazovanie hodov.
        // TTS fallback naďalej dostáva pôvodný text s číslami.
        const keyText = stripRollAnnotations(fullText);
        playAudioOrSpeak("msg_" + slugifySk(keyText.slice(0, 60)), fullText);
    }

    function spravyLeft() { // staršie
        const lines = getLogLines();
        if (state.spravyIdx >= lines.length - 1) { speak("oldest_spravy"); return; }
        state.spravyIdx++;
        spravyAnnounceCurrent();
    }

    function spravyRight() { // novšie
        if (state.spravyIdx <= 0) { speak("newest_spravy"); return; }
        state.spravyIdx--;
        spravyAnnounceCurrent();
    }

    // ---------------------------------------------------------------------------
    // 11b. AUTOMATICKÉ ČÍTANIE NOVÝCH ZÁZNAMOV V LOGU (live narácia)
    //    Sleduje #terminal-screen a hneď, ako tam script.js pridá nový riadok
    //    (.terminal-line) alebo dopíše segment do práve prebiehajúceho riadku
    //    (.terminal-inline-segment, viď isInline vetva v log()/processQueue()),
    //    automaticky ho prečíta - bez toho, aby hráč musel ísť do SPRÁV ručne.
    //    Beží LEN kým je audioUIActive. Každý nový záznam sa len PRIDÁ na koniec
    //    jednotnej fronty (viď sekcia 1) - poradie a plynulé prehrávanie (bez
    //    prekrývania/rušenia) tak rieši samotná fronta, sekcia 11b už nemusí mať
    //    vlastnú kópiu tejto logiky.
    // ---------------------------------------------------------------------------
    function enqueueLogNarration(node) {
        if (!audioUIActive) return;
        const text = (node.innerText || node.textContent || "").trim();
        if (!text || text === "...") return; // "..." je len oddeľovač medzi inline segmentmi, nie hláška
        // Rovnaké čistenie ako v spravyAnnounceCurrent() - viď stripRollAnnotations vyššie.
        const keyText = stripRollAnnotations(text);
        enqueueLogNarrationAudio("msg_" + slugifySk(keyText.slice(0, 60)), text);
    }

    function initTerminalObserver() {
        const terminal = document.getElementById("terminal-screen");
        if (!terminal) {
            // Terminál ešte nie je v DOM (napr. beží sme pred vykreslením hlavnej hry) - skúsime znova.
            setTimeout(initTerminalObserver, 500);
            return;
        }
        const observer = new MutationObserver(function (mutations) {
            if (!audioUIActive) return;
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (node.nodeType !== 1) return;
                    if (node.classList && (node.classList.contains("terminal-line") || node.classList.contains("terminal-inline-segment"))) {
                        enqueueLogNarration(node);
                    }
                });
            });
        });
        observer.observe(terminal, { childList: true, subtree: true });
    }

    initTerminalObserver();

    // ---------------------------------------------------------------------------
    // 12. SEKCIA: DENNÍK (zatiaľ prázdne)
    // ---------------------------------------------------------------------------
    function dennikAnnounce() {
        speak("dennik_prazdny");
    }

    // ---------------------------------------------------------------------------
    // 13. PREKRYVY: VÝBER HRDINU / VÝBER POČIATOČNEJ ZBRANE / BUILDER / #general-prompt
    //    Tieto obrazovky prekrývajú celú hru (aj MENU/SPRÁVY vrstvy vyššie) a majú
    //    vlastnú, jednoduchšiu navigáciu nezávislú od state.layer - obsluhujeme
    //    tlačidlá, ktoré tam script.js/script_builder.js už vytvorili (rovnaká
    //    filozofia ako pri Možnostiach/Kartách vyššie).
    //
    //    DÔLEŽITÉ: meno hrdinu (aj text v #general-prompt/#custom-modal) je VOĽNE
    //    ZADANÝ HRÁČOM TEXT - nedá sa preň vopred nahrať súbor (nekonečne veľa
    //    možných mien). Preto sa VŽDY číta cez playAudioOrSpeak (Web Speech API),
    //    súbor 'hero_<slug>.WAV' sa skúša len ako prípadný bonus, ak by ho niekto
    //    napriek tomu nahral pre bežné meno - nikdy sa nečaká, že bude existovať.
    //
    //    #general-prompt je globálny modál nad úplne všetkým - kontroluje sa ako prvý.
    //    Builder beží vo vnorenom iframe (#builder-iframe, src="builder/index.html"),
    //    ktorý je same-origin, takže vieme pristupovať k jeho DOM-u priamo cez
    //    contentDocument/contentWindow.document.
    // ---------------------------------------------------------------------------

    function clickIfExists(id, doc) {
        const d = doc || document;
        const el = d.getElementById(id);
        if (el) el.click();
        return el;
    }

    function getBuilderDoc() {
        const iframe = document.getElementById("builder-iframe");
        if (!iframe) return null;
        try {
            const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
            if (!doc || !doc.getElementById("character-stats")) return null; // iframe je "about:blank" / ešte sa nenačítal
            return doc;
        } catch (e) {
            return null; // poistka pre prípad cross-origin
        }
    }

    function builderOverlayVisible() {
        const overlay = document.getElementById("builder-overlay");
        return !!(overlay && isElementVisible(overlay) && getBuilderDoc());
    }

    // Textové polia (meno hrdinu, vyhľadávanie schopností v builderi) musia dostať
    // klávesy normálne, inak by sa do nich nedalo písať.
    function isTypingTarget() {
        const ae = document.activeElement;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return true;
        const bdoc = getBuilderDoc();
        if (bdoc) {
            const bae = bdoc.activeElement;
            if (bae && (bae.tagName === "INPUT" || bae.tagName === "TEXTAREA")) return true;
        }
        return false;
    }

    // --- 13a. #general-prompt (meno hrdinu / potvrdenia typu "áno-nie") ---
    let generalPromptWasAnnounced = false;

    function generalPromptVisible() {
        const gp = document.getElementById("general-prompt");
        return !!(gp && isElementVisible(gp));
    }

    function handleGeneralPromptKeydown(e) {
        e.preventDefault();
        e.stopImmediatePropagation();

        if (!generalPromptWasAnnounced) {
            generalPromptWasAnnounced = true;
            const textEl = document.getElementById("general-prompt-text");
            const inputEl = document.getElementById("general-prompt-input");
            const msg = textEl ? textEl.textContent.trim() : "";
            playAudioOrSpeak("alert_" + slugifySk(msg.slice(0, 60)), msg);
            if (inputEl && isElementVisible(inputEl)) {
                inputEl.focus(); // rovno sa dá písať meno hrdinu bez myši/Tabu
            }
            return; // prvé stlačenie len ohlási hlásku (rovnaká konvencia ako enterSection/enterElement)
        }

        if (e.key === "Escape" || e.key === "Backspace") {
            const cancelBtn = document.getElementById("gp-cancel-btn");
            if (cancelBtn && isElementVisible(cancelBtn)) cancelBtn.click();
            else document.getElementById("gp-confirm-btn")?.click();
            generalPromptWasAnnounced = false;
            return;
        }
        if (e.key === " " || e.key === "Enter") {
            document.getElementById("gp-confirm-btn")?.click();
            generalPromptWasAnnounced = false;
            return;
        }
    }

    // --- 13b. #hero-selection-overlay (výber/vytvorenie hrdinu) ---
// --- 13b. #hero-selection-overlay (výber/vytvorenie hrdinu) ---

let heroSelectionStage = "hero"; // "hero" | "skills"
let heroSkillCursor = 0;

function getCurrentHeroForAudio() {
    if (
        typeof HEROES === "undefined" ||
        !Array.isArray(HEROES) ||
        HEROES.length === 0
    ) {
        return null;
    }

    if (
        typeof activeCharIdx === "undefined" ||
        activeCharIdx === null ||
        !HEROES[activeCharIdx]
    ) {
        return HEROES[0];
    }

    return HEROES[activeCharIdx];
}

function getCurrentHeroSkills() {
    const hero = getCurrentHeroForAudio();
    if (!hero || !hero.skills || typeof hero.skills !== "object") {
        return [];
    }

    return Object.entries(hero.skills)
        .filter(([name, level]) => {
            return name && level !== undefined && level !== null;
        })
        .map(([name, level]) => ({
            name: String(name),
            level: level
        }));
}

function heroSelectAnnounceCurrent() {
    const hero = getCurrentHeroForAudio();

    if (!hero) {
        playAudio("no_audio");
        return;
    }

    const name =
        hero.name ||
        document.getElementById("hero-display-name")?.textContent.trim() ||
        "";

    if (!name || name === "-") {
        playAudio("no_audio");
        return;
    }

    heroSelectionStage = "hero";
    heroSkillCursor = 0;

    playAudioOrSpeak(
        "hero_" + slugifySk(name),
        name
    );
}

function heroSelectAnnounceSkill() {
    const skills = getCurrentHeroSkills();

    if (skills.length === 0) {
        playAudioOrSpeak(
            "hero_no_skills",
            "Hrdina nemá žiadne schopnosti."
        );
        return;
    }

    if (heroSkillCursor >= skills.length) {
        heroSkillCursor = 0;
    }

    const skill = skills[heroSkillCursor];

    // Skill name
    playAudioOrSpeak(
        "skill_" + slugifySk(skill.name),
        skill.name
    );

    // Skill level
    playNumericValue(skill.level);
}

function playNumericValue(value) {
    const n = Number(value);

    if (Number.isInteger(n) && n >= 0 && n <= 15) {
        enqueueAudio(
            "hodnota_" + n,
            null,
            false
        );
        return true;
    }

    enqueueAudio(
        "no_audio",
        String(value),
        false
    );

    return false;
}

function heroSelectEnterSkills() {
    const skills = getCurrentHeroSkills();

    if (skills.length === 0) {
        // Nothing to browse; keep the hero selected.
        heroSelectionStage = "skills";
        heroSkillCursor = 0;
        playAudioOrSpeak(
            "hero_no_skills",
            "Hrdina nemá žiadne schopnosti."
        );
        return;
    }

    heroSelectionStage = "skills";
    heroSkillCursor = 0;


    // Announce the first skill.
    heroSelectAnnounceSkill();
}

function heroSelectLeaveSkillsAndChange(direction) {
    const heroCount =
        (typeof HEROES !== "undefined" && Array.isArray(HEROES))
            ? HEROES.length
            : 0;

    if (!heroCount) {
        playAudio("no_audio");
        return;
    }

    activeCharIdx =
        (activeCharIdx + direction + heroCount) % heroCount;

    heroSelectionStage = "hero";
    heroSkillCursor = 0;


    // This also calls updateHeroDisplay(), so the visual card follows
    // the keyboard selection.
    updateHeroDisplay();

    heroSelectAnnounceCurrent();
}

function heroSelectSkillLeft() {
    const skills = getCurrentHeroSkills();

    if (skills.length === 0) {
        playAudio("no_audio");
        return;
    }

    heroSkillCursor =
        (heroSkillCursor - 1 + skills.length) % skills.length;

    heroSelectAnnounceSkill();
}

function heroSelectSkillRight() {
    const skills = getCurrentHeroSkills();

    if (skills.length === 0) {
        playAudio("no_audio");
        return;
    }

    heroSkillCursor =
        (heroSkillCursor + 1) % skills.length;

    heroSelectAnnounceSkill();
}

function handleHeroKeydown(e) {

    // ---------------------------------------------------------
    // HERO BROWSING
    // ---------------------------------------------------------
    if (heroSelectionStage === "hero") {

        if (e.key === "ArrowLeft") {
            e.preventDefault();
            e.stopImmediatePropagation();

            const heroCount =
                (typeof HEROES !== "undefined" && Array.isArray(HEROES))
                    ? HEROES.length
                    : 0;

            if (!heroCount) {
                playAudio("no_audio");
                return;
            }

            activeCharIdx =
                (activeCharIdx - 1 + heroCount) % heroCount;

            updateHeroDisplay();
            heroSelectAnnounceCurrent();
            return;
        }

        if (e.key === "ArrowRight") {
            e.preventDefault();
            e.stopImmediatePropagation();

            const heroCount =
                (typeof HEROES !== "undefined" && Array.isArray(HEROES))
                    ? HEROES.length
                    : 0;

            if (!heroCount) {
                playAudio("no_audio");
                return;
            }

            activeCharIdx =
                (activeCharIdx + 1) % heroCount;

            updateHeroDisplay();
            heroSelectAnnounceCurrent();
            return;
        }

        if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            e.stopImmediatePropagation();

            // First Space = select/highlight hero and inspect skills.
            heroSelectEnterSkills();
            return;
        }

        return;
    }


    // ---------------------------------------------------------
    // SKILL BROWSING
    // ---------------------------------------------------------
    if (heroSelectionStage === "skills") {

        if (e.key === "ArrowLeft") {
            e.preventDefault();
            e.stopImmediatePropagation();

            heroSelectSkillLeft();
            return;
        }

        if (e.key === "ArrowRight") {
            e.preventDefault();
            e.stopImmediatePropagation();

            heroSelectSkillRight();
            return;
        }

        if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            e.stopImmediatePropagation();

            // Second Space = actually start with this hero.
            speak("btn_vybrat");
            clickIfExists("hero-confirm-btn");
            lastOverlay = null;
            return;
        }

        return;
    }
}

    // --- 13c. #weapon-selection-overlay (výber počiatočnej zbrane) ---
    function weaponSelectAnnounceCurrent() {
        const nameEl = document.getElementById("weapon-display-name");
        const label = nameEl && nameEl.textContent.trim();
        if (!label || label === "-") { playAudio("no_audio"); return; }
        playAudioOrSpeak("weapon_" + slugifySk(label), label);
    }

    function handleWeaponKeydown(e) {
        if (e.key === "ArrowLeft") { clickIfExists("weapon-prev-btn"); weaponSelectAnnounceCurrent(); return; }
        if (e.key === "ArrowRight") { clickIfExists("weapon-next-btn"); weaponSelectAnnounceCurrent(); return; }
        if (e.key === " " || e.key === "Enter") { speak("btn_vybrat"); clickIfExists("weapon-confirm-btn"); lastOverlay = null; return; }
        // Escape/Backspace: výber počiatočnej zbrane je povinný krok - no-op.
    }

    // --- 13d. Builder (#builder-overlay > #builder-iframe) ---
    // builderNav.stage:      "grid" (mriežka naučených schopností postavy) | "editor" (#info-panel-container)
    // builderNav.editorSub:  "browse" (listovanie zoznamom schopností) | "actions" (zvýšiť/znížiť/vrátiť)
    const builderNav = {
        stage: "grid",
        editorSub: "browse",
        listCursor: 0,
        actionCursor: 0
    };

    function resetBuilderNav() {
        builderNav.stage = "grid";
        builderNav.editorSub = "browse";
        builderNav.listCursor = 0;
        builderNav.actionCursor = 0;
    }

    let lastBuilderModalMsg = null;

    function getBuilderGridSlots(doc) {
        return Array.from(doc.querySelectorAll("#character-stats .skill-slot"));
    }

    function builderGridAnnounceCurrent() {
        const doc = getBuilderDoc();
        if (!doc) { playAudio("no_audio"); return; }
        const slots = getBuilderGridSlots(doc);
        const slot = slots[builderNav.listCursor];
        if (!slot) { speak("grid_schopnosti"); return; }
        if (slot.classList.contains("add-skill-slot")) { speak("pridat_schopnost"); return; }
        const nameEl = slot.querySelector(".skill-name-text");
        const label = nameEl ? nameEl.textContent.trim() : "";
        if (!label) { playAudio("no_audio"); return; }
        playAudioOrSpeak("skill_" + slugifySk(label), label);
    }

    function handleBuilderGridKeydown(doc, e) {
        const slots = getBuilderGridSlots(doc);
        if (e.key === "ArrowLeft") {
            if (slots.length === 0) { playAudio("no_audio"); return; }
            builderNav.listCursor = (builderNav.listCursor - 1 + slots.length) % slots.length;
            builderGridAnnounceCurrent();
            return;
        }
        if (e.key === "ArrowRight") {
            if (slots.length === 0) { playAudio("no_audio"); return; }
            builderNav.listCursor = (builderNav.listCursor + 1) % slots.length;
            builderGridAnnounceCurrent();
            return;
        }
        if (e.key === " " || e.key === "Enter") {
            const slot = slots[builderNav.listCursor];
            if (slot) slot.click(); // spustí selectSkill()+toggleInfoOverlay(true), resp. len toggleInfoOverlay(true) pre "+"
            return; // prechod do editora zachytí handleBuilderKeydown pri ďalšom stlačení
        }
        if (e.key === "Escape" || e.key === "Backspace") {
            clickIfExists("close-builder", doc); // window.parent.toggleBuilder(false)
            lastOverlay = null;
            return;
        }
    }

    function getBuilderListItems(doc) {
        return Array.from(doc.querySelectorAll("#builder-list .skill-list-item"));
    }

    function builderEditorAnnounceCurrent(doc) {
        const items = getBuilderListItems(doc);
        const item = items[builderNav.listCursor];
        if (!item) { playAudio("no_audio"); return; }
        const label = item.textContent.trim();
        playAudioOrSpeak("skill_" + slugifySk(label), label);
    }

    function builderActionsAnnounceCurrent() {
        const actions = ["btn_zvysit_uroven", "btn_znizit_uroven", "btn_vratit_zmenu"];
        speak(actions[builderNav.actionCursor]);
    }

    function handleBuilderEditorKeydown(doc, e) {
        if (builderNav.editorSub === "browse") {
            const items = getBuilderListItems(doc);
            if (e.key === "ArrowLeft") {
                if (items.length === 0) { playAudio("no_audio"); return; }
                builderNav.listCursor = (builderNav.listCursor - 1 + items.length) % items.length;
                builderEditorAnnounceCurrent(doc);
                return;
            }
            if (e.key === "ArrowRight") {
                if (items.length === 0) { playAudio("no_audio"); return; }
                builderNav.listCursor = (builderNav.listCursor + 1) % items.length;
                builderEditorAnnounceCurrent(doc);
                return;
            }
            if (e.key === " " || e.key === "Enter") {
                const item = items[builderNav.listCursor];
                if (!item) { playAudio("no_audio"); return; }
                item.click(); // selectSkill(name) - naplní control-box (cena, úroveň, príbuzné schopnosti)
                builderNav.editorSub = "actions";
                builderNav.actionCursor = 0;
                builderActionsAnnounceCurrent();
                return;
            }
            if (e.key === "Escape" || e.key === "Backspace") {
                const closeBtn = doc.querySelector("#info-panel-container .info-panel-close-btn");
                if (closeBtn) closeBtn.click(); // toggleInfoOverlay(false)
                builderNav.stage = "grid";
                return;
            }
        } else { // "actions" - ZVÝŠIŤ ÚROVEŇ / ZNÍŽIŤ ÚROVEŇ (↓) / VRÁTIŤ (⤺)
            if (e.key === "ArrowLeft") {
                builderNav.actionCursor = (builderNav.actionCursor - 1 + 3) % 3;
                builderActionsAnnounceCurrent();
                return;
            }
            if (e.key === "ArrowRight") {
                builderNav.actionCursor = (builderNav.actionCursor + 1) % 3;
                builderActionsAnnounceCurrent();
                return;
            }
            if (e.key === " " || e.key === "Enter") {
                const buttons = doc.querySelectorAll("#skill-btn-container button");
                const btn = buttons[builderNav.actionCursor];
                if (btn) btn.click();
                builderEditorAnnounceCurrent(doc); // spätná väzba: znova prehráme meno vybranej schopnosti
                return;
            }
            if (e.key === "Escape" || e.key === "Backspace") {
                builderNav.editorSub = "browse";
                builderEditorAnnounceCurrent(doc);
                return;
            }
        }
    }

    function handleBuilderModalKeydown(doc, modal, e) {
        const msgEl = doc.getElementById("modal-message");
        const msg = msgEl ? msgEl.textContent.trim() : "";
        if (msg !== lastBuilderModalMsg) {
            lastBuilderModalMsg = msg;
            playAudioOrSpeak("alert_" + slugifySk(msg.slice(0, 60)), msg);
            return; // prvé stlačenie len ohlási hlásku
        }
        if (e.key === " " || e.key === "Enter") {
            doc.getElementById("modal-confirm")?.click();
            lastBuilderModalMsg = null;
            return;
        }
        if (e.key === "Escape" || e.key === "Backspace") {
            const cancelBtn = doc.getElementById("modal-cancel");
            if (cancelBtn && cancelBtn.style.display !== "none") cancelBtn.click();
            else doc.getElementById("modal-confirm")?.click();
            lastBuilderModalMsg = null;
            return;
        }
    }

    function handleBuilderKeydown(doc, e) {
        // #custom-modal (napr. hlášky BLOKOVANÉ pri downgradeSkill) má vždy prioritu
        const modal = doc.getElementById("custom-modal");
        if (modal && modal.style.display !== "none") {
            handleBuilderModalKeydown(doc, modal, e);
            return;
        }
        lastBuilderModalMsg = null;

        // #info-panel-container.active = editor konkrétnej schopnosti nad mriežkou postavy
        const infoPanel = doc.getElementById("info-panel-container");
        const editorOpen = !!(infoPanel && infoPanel.classList.contains("active"));

        if (editorOpen && builderNav.stage !== "editor") {
            builderNav.stage = "editor";
            builderNav.editorSub = "browse";
            builderNav.listCursor = 0;
        }
        if (!editorOpen && builderNav.stage === "editor") {
            builderNav.stage = "grid";
        }

        if (builderNav.stage === "editor") handleBuilderEditorKeydown(doc, e);
        else handleBuilderGridKeydown(doc, e);
    }

    // --- 13e. Spoločný dispečer prekryvov ---
    let lastOverlay = null;

    function detectOverlay() {
        if (document.getElementById("weapon-selection-overlay")) return "weapon";
        if (document.getElementById("hero-selection-overlay")) return "hero";
        if (builderOverlayVisible()) return "builder";
        return null;
    }

    function announceOverlayEntry(overlay) {
        if (overlay === "hero") { heroSelectAnnounceCurrent(); return; }
        if (overlay === "weapon") { weaponSelectAnnounceCurrent(); return; }
        if (overlay === "builder") { builderGridAnnounceCurrent(); return; }
    }

    function handleOverlayKeydown(overlay, e) {
        e.preventDefault();
        e.stopImmediatePropagation();

        if (overlay !== lastOverlay) {
            lastOverlay = overlay;
            if (overlay === "builder") resetBuilderNav();
            announceOverlayEntry(overlay); // prvé stlačenie len ohlási obrazovku (rovnako ako enterSection/enterElement)
            return;
        }

        if (e.key === "i" || e.key === "I") {
            readTooltipForCurrentFocus();
            return;
        }

        if (overlay === "hero") { handleHeroKeydown(e); return; }
        if (overlay === "weapon") { handleWeaponKeydown(e); return; }
        if (overlay === "builder") {
            const doc = getBuilderDoc();
            if (!doc) { lastOverlay = null; return; } // builder sa medzičasom zavrel
            handleBuilderKeydown(doc, e);
            return;
        }
    }

    // ---------------------------------------------------------------------------
    // 14. NAVIGÁCIA MEDZI VRSTVAMI
    // ---------------------------------------------------------------------------
    function goUp() {
        if (state.layer === "sub") {
            state.layer = "element";
            state.subMode = null;
            announceElement();
        } else if (state.layer === "element") {
            if (currentSection() === "MENU" && typeof hideMenu === "function") hideMenu();
            state.layer = "section";
            speak(SECTION_AUDIO_KEYS[currentSection()]);
        }
    }


    
    function enterSection() {
        const section = currentSection();
        if (section === "OVLADACI_PANEL") {
            state.layer = "element";
            state.elementIdx = 0;
            announceElement();
        } else if (section === "MENU") {
            if (typeof showMenu === "function") showMenu();
            state.layer = "element";
            state.elementIdx = 0;
            announceMenuOption(0);
        } else if (section === "SPRAVY") {
            state.layer = "sub";
            state.subMode = "spravy";
            state.spravyIdx = 0;
            spravyAnnounceCurrent();
        } else if (section === "DENNIK") {
            dennikAnnounce();
        }
    }

    function enterElement() {
        const section = currentSection();
        if (section === "MENU") {
            const options = getMenuOptions();
            const opt = options[state.elementIdx];
            if (opt) opt.click();
            return;
        }
        const el = currentElement();
        switch (el.id) {
            case "MOZNOSTI":
                const items = getMoznostiItems();
                if (items.length === 1) {
                    moznostiCursor = 0;
                    moznostiSelect();
                } else {
                    state.layer = "sub";
                    state.subMode = "moznosti";
                    moznostiCursor = 0;
                    moznostiAnnounceCurrent();
                }
                break;
            case "KARTY":
                state.layer = "sub"; state.subMode = "karty";
                if (!cardsAreActive()) speak("karty_neaktivne");
                else kartyAnnounceCurrent();
                break;
            case "STRES":
                stresAnnounce();
                break;
            case "ADRENALIN":
                state.layer = "sub"; state.subMode = "adrenalin";
                adrenalineCursor = 0;
                adrenalinAnnounceCurrent();
                break;
            case "ZBRANE":
                state.layer = "sub"; state.subMode = "zbrane";
                dropdownAnnounceCurrent("player-weapon-dropdown", "weapon_empty");
                break;
            case "SCHOPNOSTI":
                state.layer = "sub"; state.subMode = "schopnosti";
                dropdownAnnounceCurrent("player-skill-dropdown", "no_audio");
                break;
            case "PRVA_POMOC":
                prvaPomocSelect();
                break;
            case "UNIK":
                unikSelect();
                break;
        }
    }

    // ---------------------------------------------------------------------------
    // 15. TOOLTIPY (klávesa "I") - prečíta popis PRÁVE VYBRANÉHO prvku.
    //     Zdroj textu sa berie VŽDY naživo z DOM-u ('data-tooltip', pri schopnostiach
    //     aj 'data-description' - rovnaká vrstva, akú pri myši ukazuje .tooltip/.skill-tooltip
    //     v index.html AJ builder/index.html). Keďže hlavná hra aj builder majú svoj
    //     index.html súbor pod ROVNAKÝM MENOM (len v inom priečinku) a text na rovnako
    //     pomenovanom prvku môže byť iný, nikdy sa nepredpokladá pevný zoznam vopred -
    //     kľúč sa odvodí zo ZNENIA popisu (rovnaký vzor ako 'msg_'/'choice_'/'alert_',
    //     viď audio_manifest.json -> tooltips_dynamic). KARTY sú výnimka: nemajú v DOM
    //     žiadny tooltip atribút, preto majú vlastné pevné kľúče card_o_tooltip /
    //     card_s_tooltip / card_b_tooltip (audio_manifest.json -> karty).
    //
    //     STAVOVÉ TOOLTIPY (STATE_TOOLTIPS nižšie): keď VYBRANÝ PRVOK žiadny vlastný popis
    //     nemá (napr. prvky ovládacieho panela ako KARTY/STRES/ZBRANE nemajú v DOM žiadny
    //     data-tooltip, alebo sme na obrazovke bez "vybraného prvku" ako výber hrdinu/zbrane),
    //     "I" doteraz iba potichu prehrala no_audio. Namiesto toho teraz povie, KDE hráč je
    //     a ČO tam môže urobiť. Všetky texty sú pohromade v JEDNOM objekte nižšie, nech sa
    //     dajú ľahko nájsť/upraviť. Kľúče kopírujú existujúce identifikátory v kóde (SECTIONS,
    //     PANEL_ELEMENTS[].id, state.subMode), takže sa dajú odvodiť automaticky bez ručného
    //     mapovania - viď použitie nižšie v readTooltipForCurrentFocus().
    // ---------------------------------------------------------------------------
    const STATE_TOOLTIPS = {
        // --- SEKCIE (vrstva "section") - kľúč = "SECTION_" + položka zo SECTIONS ---
        SECTION_MENU: "Si v sekcii Menu. Šípkami vľavo a vpravo prepínaš medzi sekciami Menu, Ovládací panel, Správy a Denník. Medzerníkom vstúpiš do vybranej sekcie.",
        SECTION_OVLADACI_PANEL: "Si v sekcii Ovládací panel. Medzerníkom vstúpiš dovnútra a šípkami budeš listovať jednotlivými prvkami: Možnosti, Karty, Stres, Adrenalín, Zbrane, Schopnosti, Prvá pomoc a Únik.",
        SECTION_SPRAVY: "Si v sekcii Správy. Medzerníkom vstúpiš do zoznamu hlásení a šípkami budeš listovať staršími a novšími správami.",
        SECTION_DENNIK: "Si v sekcii Denník.",

        // --- PRVKY OVLÁDACIEHO PANELA (vrstva "element") - kľúč = "ELEMENT_" + PANEL_ELEMENTS[].id ---
        ELEMENT_MOZNOSTI: "Si na položke Možnosti. Medzerníkom vstúpiš do zoznamu aktuálne dostupných možností a šípkami medzi nimi budeš listovať.",
        ELEMENT_KARTY: "Si na položke Karty. Medzerníkom vstúpiš k listovaniu kartami, šípkami vľavo a vpravo meníš kartu a šípkami hore a dole, počas sporu, meníš stranu karty.",
        ELEMENT_STRES: "Si na položke Stres. Hodnota sa prečítala automaticky, medzerník tu nič nevyvolá.",
        ELEMENT_ADRENALIN: "Si na položke Adrenalín. Medzerníkom vstúpiš dovnútra, šípkami meníš hodnotu adrenalínu a medzerníkom ju potvrdíš.",
        ELEMENT_ZBRANE: "Si na položke Zbrane. Medzerníkom vstúpiš dovnútra a šípkami budeš listovať zbraňami, ktoré má hrdina k dispozícii.",
        ELEMENT_SCHOPNOSTI: "Si na položke Schopnosti. Medzerníkom vstúpiš dovnútra a šípkami budeš listovať schopnosťami hrdinu.",
        ELEMENT_PRVA_POMOC: "Si na položke Prvá pomoc. Medzerníkom ju použiješ.",
        ELEMENT_UNIK: "Si na položke Únik. Medzerníkom ho použiješ - dostupné len počas sporu.",
        ELEMENT_MENU_OPTION: "Si na položke menu. Medzerníkom ju potvrdíš.",

        // --- PODVRSTVY (vrstva "sub") - kľúč = "SUB_" + state.subMode ---
        SUB_MOZNOSTI: "Listuješ možnosťami. Šípkami vľavo a vpravo meníš možnosť, medzerníkom ju potvrdíš, klávesou Escape sa vrátiš späť.",
        SUB_KARTY: "Listuješ kartami. Šípkami vľavo a vpravo meníš kartu, počas sporu šípkami hore a dole meníš jej stranu, medzerníkom kartu vyberieš, klávesou Escape sa vrátiš späť.",
        SUB_ADRENALIN: "Nastavuješ adrenalín. Šípkami vľavo a vpravo meníš hodnotu, medzerníkom ju potvrdíš, klávesou Escape sa vrátiš späť.",
        SUB_ZBRANE: "Listuješ zbraňami. Šípkami vľavo a vpravo meníš zbraň, klávesou Escape sa vrátiš späť.",
        SUB_SCHOPNOSTI: "Listuješ schopnosťami. Šípkami vľavo a vpravo meníš schopnosť, klávesou Escape sa vrátiš späť.",
        SUB_SPRAVY: "Listuješ správami. Šípkami vľavo a vpravo prechádzaš medzi staršími a novšími hláseniami, klávesou Escape sa vrátiš späť.",

        // --- PREKRYVY (výber hrdinu / zbrane / builder / #general-prompt) ---
        OVERLAY_HERO_BROWSE: "Si vo výbere hrdinu. Šípkami vľavo a vpravo prechádzaš medzi uloženými hrdinami, medzerníkom hrdinu označíš a prejdeš k jeho schopnostiam.",
        OVERLAY_HERO_SKILLS: "Prezeráš schopnosti hrdinu. Šípkami vľavo a vpravo prechádzaš medzi jeho schopnosťami, medzerníkom ho potvrdíš a začneš hru, klávesou Escape sa vrátiš k výberu hrdinu.",
        OVERLAY_WEAPON: "Si vo výbere počiatočnej zbrane. Šípkami vľavo a vpravo prechádzaš medzi dostupnými zbraňami, medzerníkom zbraň potvrdíš.",
        OVERLAY_BUILDER_GRID: "Si v builderi, v prehľade naučených schopností. Šípkami prechádzaš medzi políčkami, medzerníkom políčko otvoríš, klávesou Escape builder zavrieš.",
        OVERLAY_BUILDER_EDITOR: "Si v builderi, v zozname schopností. Šípkami prechádzaš medzi schopnosťami, medzerníkom prejdeš k akciám (zvýšiť, znížiť, vrátiť), klávesou Escape sa vrátiš späť.",
        OVERLAY_BUILDER_ACTIONS: "Si v builderi, medzi akciami pre vybranú schopnosť. Šípkami prechádzaš medzi možnosťami zvýšiť úroveň, znížiť úroveň a vrátiť zmenu, medzerníkom akciu potvrdíš.",
        GENERAL_PROMPT: "Zobrazuje sa výzva na potvrdenie. Medzerníkom alebo klávesou Enter ju potvrdíš, klávesou Escape ju zrušíš."
    };

    // Prehrá stavový tooltip: skúsi statický 'state_<kľúč>' zvuk (kľúč malými písmenami),
    // inak text z STATE_TOOLTIPS prečíta cez Web Speech fallback - rovnaký vzor ako všade
    // inde v tomto súbore (napr. tooltip_/msg_/skill_), takže stačí neskôr nahrať konkrétny
    // audio/state_<kľúč>.WAV a automaticky sa použije namiesto TTS.
    function speakStateTooltip(key) {
        const text = STATE_TOOLTIPS[key];
        if (!text) { playAudio("no_audio"); return; }
        playAudioOrSpeak("state_" + key.toLowerCase(), text);
    }

    function speakTooltipText(text) {
        if (!text || !text.trim()) { playAudio("no_audio"); return; }
        const clean = text.trim();
        playAudioOrSpeak("tooltip_" + slugifySk(clean.slice(0, 60)), clean);
    }

    // Prečíta tooltip z DOM elementu: skúsi najprv 'data-tooltip' (bežné popisky),
    // potom 'data-description' (popis schopnosti naplnený zo skillsDB.json data[3]/
    // description - viď script_builder.js). Skúša aj najbližšieho predka, pre prípad,
    // že sa aktuálne vybraný prvok líši od toho, na ktorom je atribút v skutočnosti
    // nastavený (napr. vnorený text/label vnútri tlačidla). Ak vybraný prvok žiadny
    // popis nemá, prehrá sa - namiesto potichu no_audio - STAVOVÝ tooltip odovzdaný
    // ako fallbackStateKey (kľúč do STATE_TOOLTIPS vyššie), ak bol daný.
    function getElementTooltipText(el) {
        if (!el) return null;
        const withTooltip = el.hasAttribute("data-tooltip") ? el : el.closest && el.closest("[data-tooltip]");
        const withDesc = el.hasAttribute("data-description") ? el : el.closest && el.closest("[data-description]");
        const text = (withTooltip && withTooltip.getAttribute("data-tooltip"))
            || (withDesc && withDesc.getAttribute("data-description"));
        return (text && text.trim()) ? text.trim() : null;
    }

    function speakElementTooltip(el, fallbackStateKey) {
        const text = getElementTooltipText(el);
        if (text) { speakTooltipText(text); return; }
        if (fallbackStateKey) { speakStateTooltip(fallbackStateKey); return; }
        playAudio("no_audio");
    }

    // Tooltip pre <option> v dropdowne Zbrane/Schopnosti. Tie v DOM nemajú
    // data-tooltip/data-description (viď updateUI() v script.js - option.textContent
    // sa len prepíše na "MENO (+hodnota)", žiadny popisný atribút sa nenastavuje),
    // takže sa popis skúša najprv priamo zo skillsDB.json (funguje pre schopnosti AJ pre
    // biologické zbrane ako OSTNE/ŽIHADLO, ktoré sú v skillsDB.json tiež). Ak sa nenájde
    // (napr. bežná manuálna zbraň ako PIŠTOĽ, alebo schopnosť bez popisu v skillsDB.json,
    // napr. IQ), skúsi sa ešte štandardná DOM cesta (pre prípad, že by option niekedy
    // predsa len dostal data-tooltip/data-description) a napokon stavový tooltip.
    function speakSkillOrWeaponTooltip(option, fallbackStateKey) {
        if (!option) {
            if (fallbackStateKey) speakStateTooltip(fallbackStateKey); else playAudio("no_audio");
            return;
        }
        const desc = getSkillDescription(option.value);
        if (desc) { speakTooltipText(desc); return; }
        speakElementTooltip(option, fallbackStateKey);
    }

    function readTooltipForCurrentFocus() {
        // --- Builder (vlastný, jednoduchší kontext - viď sekcia 13d) ---
        if (detectOverlay() === "builder") {
            const doc = getBuilderDoc();
            if (!doc) { playAudio("no_audio"); return; }
            let el = null;
            let fallbackKey;
            if (builderNav.stage === "editor") {
                if (builderNav.editorSub === "actions") {
                    el = doc.querySelectorAll("#skill-btn-container button")[builderNav.actionCursor];
                    fallbackKey = "OVERLAY_BUILDER_ACTIONS";
                } else {
                    el = getBuilderListItems(doc)[builderNav.listCursor];
                    fallbackKey = "OVERLAY_BUILDER_EDITOR";
                }
            } else {
                el = getBuilderGridSlots(doc)[builderNav.listCursor];
                fallbackKey = "OVERLAY_BUILDER_GRID";
            }
            speakElementTooltip(el, fallbackKey);
            return;
        }

        // Výber hrdinu / počiatočnej zbrane a #general-prompt nemajú jasne definovaný
        // "vybraný prvok" s popisom - namiesto no_audio sa prehrá stavový tooltip
        // (kde hráč je a čo tam môže urobiť, viď STATE_TOOLTIPS vyššie).
        if (detectOverlay() === "hero") {
            speakStateTooltip(heroSelectionStage === "skills" ? "OVERLAY_HERO_SKILLS" : "OVERLAY_HERO_BROWSE");
            return;
        }
        if (detectOverlay() === "weapon") { speakStateTooltip("OVERLAY_WEAPON"); return; }
        if (generalPromptVisible()) { speakStateTooltip("GENERAL_PROMPT"); return; }

        if (state.layer === "element") {
            if (currentSection() === "MENU") {
                speakElementTooltip(getMenuOptions()[state.elementIdx], "ELEMENT_MENU_OPTION");
            } else {
                // Prvky ovládacieho panela (Možnosti/Karty/Stres/...) nemajú v DOM vlastný
                // data-tooltip, preto sa rovno ozve stavový tooltip pre daný prvok
                // (kľúč "ELEMENT_" + PANEL_ELEMENTS[].id sa odvodí automaticky).
                speakStateTooltip("ELEMENT_" + currentElement().id);
            }
            return;
        }

        if (state.layer === "sub") {
            if (state.subMode === "karty") {
                const cards = document.querySelectorAll("#card-tray-container .card-container");
                const card = cards[currentSelectedCardIdx];
                const code = card && (card.getAttribute("data-card") || "").toLowerCase();
                if (code === "o" || code === "s" || code === "b") speak(kartyTooltipKey(code));
                else speakStateTooltip("SUB_KARTY");
            } else if (state.subMode === "moznosti") {
                const items = getMoznostiItems();
                const item = items[moznostiCursor];
                if (!item) { speakStateTooltip("SUB_MOZNOSTI"); return; }
                if (item.type === "choice") {
                    const choicePrompt = document.getElementById("choice-prompt");
                    const buttons = choicePrompt ? choicePrompt.querySelectorAll(".adrenaline-select") : [];
                    speakElementTooltip(buttons[item.choiceIndex], "SUB_MOZNOSTI");
                } else {
                    speakElementTooltip(item.el, "SUB_MOZNOSTI");
                }
            } else if (state.subMode === "adrenalin") {
                speakElementTooltip(getAdrenalineNodes()[adrenalineCursor], "SUB_ADRENALIN");
            } else if (state.subMode === "zbrane") {
                const dropdown = document.getElementById("player-weapon-dropdown");
                speakSkillOrWeaponTooltip(dropdown && dropdown.options[dropdown.selectedIndex], "SUB_ZBRANE");
            } else if (state.subMode === "schopnosti") {
                const dropdown = document.getElementById("player-skill-dropdown");
                speakSkillOrWeaponTooltip(dropdown && dropdown.options[dropdown.selectedIndex], "SUB_SCHOPNOSTI");
            } else if (state.subMode === "spravy") {
                speakStateTooltip("SUB_SPRAVY");
            } else {
                playAudio("no_audio");
            }
            return;
        }

        if (state.layer === "section") {
            speakStateTooltip("SECTION_" + currentSection());
            return;
        }

        playAudio("no_audio");
    }

    // ---------------------------------------------------------------------------
    // 16. HLAVNÝ KEYDOWN HANDLER PRE AUDIO UI
    // ---------------------------------------------------------------------------
    function handleAudioUIKeydown(e) {
        if (!audioUIActive) return;

        if (e.key === "v" || e.key === "V") {
            // necháme prejsť nižšie - toggle sa rieši mimo tejto funkcie
            return;
        }

        // #ready-prompt (index.html) blokuje pokračovanie hry, kým sa neklikne #ready-btn.
        // Musí sa odchytiť PREDštandardným layer-based dispatchom nižšie, inak by medzerník/Enter
        // len zbytočne zavolal e.stopImmediatePropagation() bez toho, aby čokoľvek urobil, a hra by
        // sa v audio móde zaseknutá na tomto mieste vôbec nedala ovládať klávesnicou.
        if (e.key === " " || e.key === "Enter") {
            const readyPrompt = document.getElementById("ready-prompt");
            if (readyPrompt && isElementVisible(readyPrompt)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                playAudio("ui_ready_priprav_sa");
                const readyBtn = document.getElementById("ready-btn");
                if (readyBtn) readyBtn.click();
                return;
            }
        }

        // Textové pole je práve focusnuté (meno hrdinu, vyhľadávanie v builderi) -
        // klávesy prepúšťame ďalej, inak by sa do neho nedalo písať. Enter/Escape
        // nad #general-prompt aj tak obslúžime, aby sa dalo potvrdiť/zrušiť bez myši.
        if (isTypingTarget()) {
            const gp = document.getElementById("general-prompt");
            const gpOpen = !!(gp && isElementVisible(gp));
            if (gpOpen && e.key === "Enter") {
                e.preventDefault();
                document.getElementById("gp-confirm-btn")?.click();
                generalPromptWasAnnounced = false;
                return;
            }
            if (gpOpen && e.key === "Escape") {
                e.preventDefault();
                const cancelBtn = document.getElementById("gp-cancel-btn");
                if (cancelBtn && isElementVisible(cancelBtn)) cancelBtn.click();
                generalPromptWasAnnounced = false;
                return;
            }
            if (!gpOpen && e.key === "Escape") {
                // Odfocusujeme textové pole (napr. vyhľadávanie v builderi), aby pokračovala šípková navigácia.
                e.preventDefault();
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                const bdoc = getBuilderDoc();
                if (bdoc && bdoc.activeElement && bdoc.activeElement.blur) bdoc.activeElement.blur();
                return;
            }
            return;
        }

        // #general-prompt je globálny modál nad úplne všetkým ostatným.
        if (generalPromptVisible()) { handleGeneralPromptKeydown(e); return; }
        if (generalPromptWasAnnounced) generalPromptWasAnnounced = false;

        // Výber hrdinu / počiatočnej zbrane / builder majú vlastnú navigáciu (viď sekcia 13).
        const overlay = detectOverlay();
        if (overlay) { handleOverlayKeydown(overlay, e); return; }
        if (lastOverlay !== null) lastOverlay = null;

        e.preventDefault();
        e.stopImmediatePropagation();

        if (e.key === "Escape" || e.key === "Backspace") {
            goUp();
            return;
        }

        if (e.key === "i" || e.key === "I") {
            readTooltipForCurrentFocus();
            return;
        }

        if (e.key === " " || e.key === "Enter") {
            if (state.layer === "section") { enterSection(); return; }
            if (state.layer === "element") { enterElement(); return; }
            if (state.layer === "sub") {
                if (state.subMode === "moznosti") moznostiSelect();
                else if (state.subMode === "karty") kartySelect();
                else if (state.subMode === "adrenalin") adrenalinSelect();
                else if (state.subMode === "zbrane" || state.subMode === "schopnosti") goUp();
            }
            return;
        }

        if (e.key === "ArrowLeft") {
            if (state.layer === "section") {
                state.sectionIdx = (state.sectionIdx - 1 + SECTIONS.length) % SECTIONS.length;
                speak(SECTION_AUDIO_KEYS[currentSection()]);
            } else if (state.layer === "element") {
                if (currentSection() === "MENU") {
                    state.elementIdx = (state.elementIdx - 1 + getMenuOptions().length) % getMenuOptions().length;
                    announceMenuOption(state.elementIdx);
                } else {
                    let steps = 0;
                    do {
                        state.elementIdx = (state.elementIdx - 1 + PANEL_ELEMENTS.length) % PANEL_ELEMENTS.length;
                        steps++;
                    } while (isElementSkippable(currentElement()) && steps < PANEL_ELEMENTS.length);
                    announceElement();
                }
            } else if (state.layer === "sub") {
                if (state.subMode === "moznosti") moznostiLeft();
                else if (state.subMode === "karty") kartyLeft();
                else if (state.subMode === "adrenalin") adrenalinLeft();
                else if (state.subMode === "zbrane") zbraneLeft();
                else if (state.subMode === "schopnosti") schopnostiLeft();
                else if (state.subMode === "spravy") spravyLeft();
            }
            return;
        }

        if (e.key === "ArrowRight") {
            if (state.layer === "section") {
                state.sectionIdx = (state.sectionIdx + 1) % SECTIONS.length;
                speak(SECTION_AUDIO_KEYS[currentSection()]);
            } else if (state.layer === "element") {
                if (currentSection() === "MENU") {
                    state.elementIdx = (state.elementIdx + 1) % getMenuOptions().length;
                    announceMenuOption(state.elementIdx);
                } else {
                    let steps = 0;
                    do {
                        state.elementIdx = (state.elementIdx + 1) % PANEL_ELEMENTS.length;
                        steps++;
                    } while (isElementSkippable(currentElement()) && steps < PANEL_ELEMENTS.length);
                    announceElement();
                }
            } else if (state.layer === "sub") {
                if (state.subMode === "moznosti") moznostiRight();
                else if (state.subMode === "karty") kartyRight();
                else if (state.subMode === "adrenalin") adrenalinRight();
                else if (state.subMode === "zbrane") zbraneRight();
                else if (state.subMode === "schopnosti") schopnostiRight();
                else if (state.subMode === "spravy") spravyRight();
            }
            return;
        }

        // Prepínanie polovíc karty (ÚTOK/ČIN) - len v Kartách, zrkadlí "ŠÍPKY HORE/DOLE"
        // z UNIFIED KEYBOARD CONTROLLER v script.js (mimo sporu nemá efekt, viď kartyToggleSide()).
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            if (state.layer === "sub" && state.subMode === "karty") kartyToggleSide();
            return;
        }
    }

    // Zapnutie/vypnutie audio UI módu klávesou "V"
    window.addEventListener("keydown", function (e) {
        if (e.key === "v" || e.key === "V") {
            audioUIActive = !audioUIActive;
            if (audioUIActive) {
                state.layer = "section";
                state.sectionIdx = 0;
                lastOverlay = null;
                generalPromptWasAnnounced = false;
                lastBuilderModalMsg = null;
                lastKnownActionPhase = (typeof is_action_phase !== "undefined") ? is_action_phase : false;
                focusWasAutoMovedToKarty = false;
                speak("voice_mode_on");
            } else {
                stopAllAudio();
                speak("voice_mode_off");
            }
        }
    }, true);

    // Zachytávame v CAPTURE fáze, aby sme predbehli pôvodný keydown handler v script.js
    window.addEventListener("keydown", handleAudioUIKeydown, true);




    /**
     * audio_manifest.json nie je plochý zoznam - je to STROM kategórií (system/sections/
     * spravy/spravy.msg_hardcoded/... - viď _readme v súbore), kde skutočné páry súboru
     * nájdeš až na listových úrovniach ako "nazov_suboru.WAV": "text nahrávky". Kľúče
     * začínajúce podčiarkovníkom (_note, _readme, _note_proceed_prompt...) sú len
     * komentáre pre ľudí a NIE SÚ to súbory - tie sa preskakujú. Táto funkcia prejde
     * strom rekurzívne a vráti plochú mapu { "nazov_suboru_bez_pripony" -> filePath }.
     * Predtým sa robilo len Object.entries(manifest) na najvyššej úrovni, čo dávalo
     * dvojice ako ["spravy", {...celá vnorená sekcia...}] - fetch() potom dostal namiesto
     * cesty k súboru celý objekt, zlyhal, a TAKMER NIČ sa v skutočnosti nepreload-lo/
     * necachovalo. Každé prehratie tak muselo najprv urobiť sieťový fetch nanovo, čo bol
     * zdroj počuteľnej pauzy medzi dvoma po sebe idúcimi hláškami (napr. názov schopnosti
     * a hneď za ním jej úroveň pri listovaní schopnosťami vo výbere hrdinu).
     */
    function flattenManifest(node, out) {
        if (!node || typeof node !== "object") return out;
        Object.keys(node).forEach(function (key) {
            if (key.indexOf("_") === 0) return; // _note / _readme a pod. - nie sú to súbory
            const value = node[key];
            if (value && typeof value === "object") {
                flattenManifest(value, out); // vnorená kategória (napr. spravy.msg_hardcoded)
            } else if (/\.wav$/i.test(key)) {
                out[key] = AUDIO_BASE_PATH + key; // key = skutočný názov súboru v audio/
            }
        });
        return out;
    }

    /**
     * Fetches the audio manifest and preloads all listed audio files into memory.
     * @param {string} manifestPath - Path to the manifest JSON file.
     */
    async function initAudioCache(manifestPath = 'audio_manifest.json') {
    try {
        const response = await fetch(manifestPath);
        if (!response.ok) throw new Error(`Manifest HTTP error: ${response.status}`);

        const manifest = await response.json();

        // Podporuje aj plochý manifest ako pole ['file1.WAV', 'file2.WAV'] pre spätnú
        // kompatibilitu, inak (bežný prípad) rekurzívne rozbalí vnorený strom kategórií.
        const fileEntries = Array.isArray(manifest)
        ? manifest.map(function (path) { return [path, AUDIO_BASE_PATH + path]; })
        : Object.entries(flattenManifest(manifest, {}));

        console.log(`[Audio UI] Preloading ${fileEntries.length} audio assets...`);

        // Fetch all audio files concurrently
        await Promise.all(
        fileEntries.map(async ([fileName, filePath]) => {
            try {
            const res = await fetch(filePath);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);

            // Kľúč bez prípony (rovnaký formát, aký používa playQueueItem cez `name`),
            // s príponou, aj plná cesta - nech sedí s obidvomi variantmi, ktoré skúša
            // audioCache.get() pri prehrávaní.
            const nameNoExt = fileName.replace(/\.wav$/i, "");
            audioCache.set(nameNoExt, objectUrl);
            audioCache.set(fileName, objectUrl);
            audioCache.set(filePath, objectUrl);
            } catch (fileErr) {
            console.warn(`[Audio UI] Failed to cache file: ${filePath}`, fileErr);
            }
        })
        );

        isAudioReady = true;
        console.log('[Audio UI] All manifest audio files cached successfully.');
    } catch (err) {
        console.error('[Audio UI] Manifest loading failed:', err);
        // Fallback to direct network playback or TTS if caching fails
        isAudioReady = true;
    }
    }

    /**
     * Plays an audio asset from cache if available, falling back to direct URL.
     * @param {string} keyOrPath - Manifest key or relative audio path.
     */
    function playCachedAudio(keyOrPath) {
        const src = audioCache.get(keyOrPath) || keyOrPath;
        const audio = new Audio(src);
        
        // Interrupt previous sound if using single-channel audio queue
        if (window.currentAudio) {
            window.currentAudio.pause();
            window.currentAudio.currentTime = 0;
        }

        window.currentAudio = audio;
        audio.play().catch(err => console.warn(`Playback blocked or failed: ${err.message}`));
        }

        // Automatically trigger preloading on script execution or DOMContentLoaded
        if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initAudioCache());
        } else {
        initAudioCache();
        }

})();