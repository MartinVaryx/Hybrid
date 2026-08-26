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
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const bufferCache = new Map(); // Stores decoded AudioBuffers: key -> AudioBuffer
    let currentSourceNode = null;

    // Helper to fetch and decode audio files into AudioBuffers
    async function getAudioBuffer(name) {
        if (bufferCache.has(name)) return bufferCache.get(name);

        const path = AUDIO_BASE_PATH + name + AUDIO_EXT;
        try {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            bufferCache.set(name, audioBuffer);
            return audioBuffer;
        } catch (e) {
            return null;
        }
    }
    let isAudioReady = false;
    let audioUIActive = false;

    // Rýchlosť prehrávania (nahrávky aj Web Speech fallback) - nastavuje sa v Nastaveniach
    // (#voice-speed-select, viď index.html/script.js) a ukladá sa do SETTINGS.voiceSpeed
    // (rovnaký localStorage mechanizmus ako ostatné nastavenia hry). Číta sa VŽDY NAŽIVO
    // pri každom spustení novej hlášky (nie raz pri štarte), takže zmena v Nastaveniach
    // sa prejaví okamžite aj na položkách, čo už čakajú vo fronte.
    function getVoiceSpeed() {
        const raw = (typeof SETTINGS !== "undefined" && SETTINGS && SETTINGS.voiceSpeed) ? Number(SETTINGS.voiceSpeed) : 1;
        if (!isFinite(raw) || raw <= 0) return 1;
        // Rovnaké medze, aké dovoľuje Web Speech API (utterance.rate) - AudioBufferSourceNode
        // by zvládol aj viac, ale nad 3x už nie je reč rozumne zrozumiteľná.
        return Math.min(3, Math.max(0.5, raw));
    }

    // AudioBufferSourceNode.playbackRate je NAIVNÝ time-domain resampling - okrem skrátenia
    // dĺžky zároveň zdvihne aj výšku hlasu (efekt "čipmank"), čo pri ROVNAKEJ číselnej
    // rýchlosti pôsobí citeľne agresívnejšie/rýchlejšie, než rovnaká rate hodnota u
    // speechSynthesis (tá si tempo prerátava interne, bez tohto vedľajšieho efektu na výšku
    // hlasu). Aby obe cesty (nahrávky aj TTS fallback) pôsobili pri rovnakom nastavení v
    // Nastaveniach subjektívne rovnako rýchlo, odchýlku od 1x pre PREHRÁVANIE NAHRÁVOK
    // stlmíme (vydelíme) - TTS (utterance.rate) naďalej používa getVoiceSpeed() bez zmeny.
    function getBufferPlaybackRate() {
        const raw = getVoiceSpeed();
        return 1 + (raw - 1) / 1.5;
    }

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
    let playToken = 0;

    // Ak vo fronte čaká viac ako AUDIO_QUEUE_LIMIT ešte neprehratých položiek, najstaršie
    // z nich (tie na ZAČIATKU fronty - teda tie, čo čakajú najdlhšie a sú na rade ako
    // ĎALŠIE na prehratie) sa jednoducho PRESKOČIA (zahodia bez prehratia). Bez tohto
    // limitu by pri rýchlo pribúdajúcich hláseniach (napr. veľa logov naraz počas
    // búrlivého konfliktu) audio UI donekonečna zaostávalo za skutočným dianím - každé
    // ďalšie enqueueLogNarrationAudio() by len predlžovalo frontu, hráč by počul čoraz
    // staršie a menej relevantné hlášky. Zahodením najstarších sa fronta udrží krátka
    // a hráč sa časom (aj keď so stratou pár hlášok) dobehne k aktuálnemu stavu hry.
    const AUDIO_QUEUE_LIMIT = 8;

    function enforceAudioQueueLimit() {
        while (audioQueue.length > AUDIO_QUEUE_LIMIT) {
            audioQueue.shift();
        }
    }

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
        playToken++; // Znehodnotí callbacky prehrávania
        if (currentSourceNode) {
            try {
                currentSourceNode.onended = null; // Zruší callback aby nesposobil advance()
                currentSourceNode.stop();
            } catch (e) {}
            currentSourceNode = null;
        }
        if (window.speechSynthesis) speechSynthesis.cancel();
    }

    function ttsFallback(item, token, advance) {
        if (!item || !item.text || !window.speechSynthesis) {
            advance();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(item.text);
        const voice = getSkVoice();
        if (voice) utterance.voice = voice;
        utterance.lang = "sk-SK";
        utterance.rate = getVoiceSpeed();

        utterance.onend = function () {
            if (token === playToken) advance();
        };
        utterance.onerror = function () {
            if (token === playToken) advance();
        };

        speechSynthesis.speak(utterance);
    }

    // Warm up the cache for all items currently waiting in line
    function preloadQueue(queue) {
        queue.forEach(item => {
            if (item.name && !bufferCache.has(item.name)) {
                getAudioBuffer(item.name); // Fire-and-forget fetch/decode
            }
        });
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
    const OVERLAP_SEC = 0.8; // 800ms early start (pri 1x rýchlosti - viď škálovanie nižšie)
    let advanced = false;

    function advance() {
        if (token !== playToken || advanced) return;
        advanced = true;
        playQueueNext();
    }

    // Helper to start the AudioBufferSourceNode immediately
    function startNode(buffer) {
        try {
            const source = audioCtx.createBufferSource();
            source.buffer = buffer;
            const rate = getBufferPlaybackRate();
            source.playbackRate.value = rate;
            source.connect(audioCtx.destination);

            // Fallback in case the buffer ends earlier than expected
            source.onended = advance;
            currentSourceNode = source;
            source.start(0);

            // Trigger the next queued file trochu PRED koncom - buffer.duration je NATÍVNA
            // dĺžka nahrávky, skutočná dĺžka prehrávania pri zmenenej rýchlosti je
            // buffer.duration / rate, preto sa ňou delí aj tu. OVERLAP_SEC sa DELÍ tou istou
            // rate (nie odčítava ako fixný čas) - inak by pri vysokej rýchlosti krátka
            // skutočná dĺžka klipu (buffer.duration / rate) bola menšia než samotný fixný
            // overlap, čo pri Math.max(0, ...) klaplo na 0ms a ďalší klip sa spustil OKAMŽITE,
            // teda prakticky celý súbežne s ešte dohrávajúcim predošlým (počuteľné "cez seba").
            // Delením sa pomer overlapu k reálnej dĺžke klipu udrží konštantný pri hocijakej
            // rýchlosti - overlap teda ostáva rovnakou ČASŤOU klipu, nie fixným počtom ms.
            const realDuration = buffer.duration / rate;
            const realOverlap = OVERLAP_SEC / rate;
            const advanceDelayMs = Math.max(0, (realDuration - realOverlap) * 1000);
            setTimeout(advance, advanceDelayMs);

        } catch (e) {
            advance();
        }
    }

    // Ensure AudioContext is running
    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }

    // FAST PATH: Play instantly without async micro-task delays if cached
    if (bufferCache.has(name)) {
        startNode(bufferCache.get(name));
        return;
    }

    // SLOW PATH: Fetch/decode if not cached, then trigger
    getAudioBuffer(name).then(buffer => {
        if (token !== playToken) return;
        if (buffer) {
            startNode(buffer);
        } else {
            ttsFallback(item, token, advance);
        }
    });
}

    function enqueueAudio(fileNameNoExt, fallbackText, interrupt, tag) {
        const name = fileNameNoExt || "no_audio";
        const item = { name: name, text: fallbackText || null, tag: tag || null };
        if (interrupt) {
            stopCurrentPlayback();
            audioQueue.unshift(item); // predbehne prípadné čakajúce live-log hlášky, ale nezmaže ich
            playQueueNext(); // rovno vyberie (shift()) práve pridanú položku z frontu na prehratie
            enforceAudioQueueLimit(); // orezanie AŽ TERAZ - práve pridaná položka je už mimo frontu, netýka sa jej
        } else {
            audioQueue.push(item);
            enforceAudioQueueLimit();
            if (!audioQueuePlaying) playQueueNext();
        }
    }

    // Odstráni z FRONTY (nie z práve prehrávanej položky) všetky doteraz nezahrané
    // položky s daným tagom - viď enqueueTaggedAudio nižšie.
    function removeQueuedByTag(tag) {
        for (let i = audioQueue.length - 1; i >= 0; i--) {
            if (audioQueue[i].tag === tag) audioQueue.splice(i, 1);
        }
    }

    // Ako enqueueLogNarrationAudio (koniec fronty, bez prerušenia), ale navyše OZNAČÍ
    // položku daným tagom a PRED pridaním zmaže prípadné PREDCHÁDZAJÚCE, ešte neprehraté
    // položky s tým istým tagom. Použitie: hlášky, ktoré dopĺňajú PRÁVE PREHRÁVANÚ
    // interaktívnu hlášku (napr. "Čin."/"Útok." za menom karty) - meno karty sa vďaka
    // interrupt:true v playAudio() vždy správne nahradí najnovším pri rýchlom prechádzaní,
    // ale jeho doplnok zaradený samostatne na koniec fronty by sa inak len HROMADIL
    // (viď kartyAnnounceCurrent - pri rýchlom prechádzaní kartami šípkami by sa tak na
    // konci nahromadilo "Čin. Čin. Čin." namiesto jedinej aktuálnej strany).
    function enqueueTaggedAudio(fileNameNoExt, fallbackText, tag) {
        removeQueuedByTag(tag);
        enqueueAudio(fileNameNoExt, fallbackText, false, tag);
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
        section_zacat: "ui_section_zacat",

        // Prvky ovládacieho panelu
        el_moznosti: "ui_element_moznosti",
        el_karty: "ui_element_karty",
        el_stres: "ui_element_stres",
        el_adrenalin: "ui_element_adrenalin",
        el_zbrane: "ui_element_zbrane",
        el_schopnosti: "ui_element_schopnosti",
        el_prva_pomoc: "ui_element_prva_pomoc",
        el_unik: "ui_element_unik",
        el_vyzva: "ui_element_vyzva",
        el_nepriatel: "ui_element_nepriatel",

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
        gp_confirm_enter_hint: "gp_confirm_enter_hint",
        gp_input_empty: "gp_input_empty",

        // Builder (editor postavy - #builder-overlay/#builder-iframe) = obsah sekcie DENNÍK
        builder_otvoreny: "ui_builder_otvoreny",
        grid_schopnosti: "ui_grid_schopnosti",
        grid_zbrane_prazdne: "ui_grid_zbrane_prazdne",
        pridat_schopnost: "pridat_schopnost",
        btn_zvysit_uroven: "btn_zvysit_uroven",
        btn_znizit_uroven: "btn_znizit_uroven",
        btn_vratit_zmenu: "btn_vratit_zmenu",
        // Prehľad postavy (sekcia HLAVIČKA v DENNÍKU)
        prehlad_postavy: "ui_prehlad_postavy",
        label_body_rastu: "label_body_rastu",
        label_ludskost: "label_ludskost",
        // Predmety vo výbave (sekcia ZBRANE v DENNÍKU)
        btn_pouzit: "btn_pouzit",
        // Editor schopnosti - aktuálna úroveň, cena a spätná väzba po zmene
        label_aktualna_uroven: "label_aktualna_uroven",
        label_cena: "label_cena",
        level_zvysena_na: "level_zvysena_na",
        level_znizena_na: "level_znizena_na",
        level_vratena_na: "level_vratena_na",
        label_aktualne_body_rastu: "label_aktualne_body_rastu",

        // Stav kariet
        karty_neaktivne: "ui_karty_neaktivne"
    };

    function speak(key) {
        playAudio(AUDIO_MAP[key] || key);
    }

    // Ako speak(), ale NEPRERUŠÍ práve prehrávanú frontu - použité keď má hláška nadväzovať
    // na niečo, čo sme tesne predtým sami zaradili (napr. "Aktuálna úroveň:" + číslo).
    function speakQueued(key) {
        enqueueAudio(AUDIO_MAP[key] || key, null, false);
    }

    // ---------------------------------------------------------------------------
    // 3. STAV NAVIGÁCIE
    // ---------------------------------------------------------------------------
    const SECTIONS_STANDARD = ["MENU", "OVLADACI_PANEL", "SPRAVY", "DENNIK"];
    // Pred stlačením "ZAČAŤ" (WELCOME obrazovka, viď proceedBtn.innerText v script.js,
    // handleChallengeTransition()) OVLÁDACÍ PANEL aj DENNÍK ešte nedávajú zmysel (hra
    // sa ešte nerozbehla, karty/zbrane/schopnosti/denník sú prázdne/neaktívne) - preto sa
    // v tomto momente z hlavného zoznamu sekcií vynechajú a namiesto nich pribudne vlastná
    // sekcia ZAČAŤ (predtým súčasť Možností v Ovládacom paneli, viď getMoznostiItems()).
    // MENU aj SPRÁVY zostávajú dostupné vždy.
    //
    // Zoznam sa POČÍTA NAŽIVO pri KAŽDOM prístupe (živou kontrolou tlačidla #proceed-btn cez
    // zacatButtonVisible() nižšie), nie raz pri zapnutí audio UI - vďaka tomu funguje správne
    // aj vtedy, keď hráč zapne audio UI (klávesa V) až KEDYKOĽVEK POČAS HRY, dávno po tom, čo
    // tlačidlo "ZAČAŤ" už zmizlo: dostane rovno bežný 4-sekciový zoznam, žiadny jednorazový
    // "hra sa ešte nezačala" príznak nastavený len pri štarte audio UI by mu inak mohol
    // navždy blokovať prístup k OVLÁDACIEMU PANELU/DENNÍKU.
    function zacatButtonVisible() {
        const btn = document.getElementById("proceed-btn");
        return !!(btn && isElementVisible(btn) && btn.textContent.trim() === "ZAČAŤ");
    }

    function getSections() {
        return zacatButtonVisible() ? ["MENU", "ZACAT", "SPRAVY"] : SECTIONS_STANDARD;
    }

    function currentSection() {
        const sections = getSections();
        return sections[state.sectionIdx % sections.length] || sections[0];
    }
    const SECTION_AUDIO_KEYS = {
        MENU: "section_menu",
        OVLADACI_PANEL: "section_ovladaci_panel",
        SPRAVY: "section_spravy",
        DENNIK: "section_dennik",
        ZACAT: "btn_zacat"
    };

    // ÚNIK (escape-btn) TU ZÁMERNE CHÝBA - presunutý do Kariet ako "ďalšia karta"
    // na konci zoznamu (rovnako, ako je vizuálne umiestnený priamo v lište kariet
    // v pôvodnej verzii hry), viď sekcia 6 nižšie (kartyUnikSelected a okolie).
    const PANEL_ELEMENTS = [
        { id: "MOZNOSTI", audio: "el_moznosti" },
        { id: "KARTY", audio: "el_karty" },
        { id: "STRES", audio: "el_stres" },
        { id: "ADRENALIN", audio: "el_adrenalin" },
        { id: "ZBRANE", audio: "el_zbrane" },
        { id: "SCHOPNOSTI", audio: "el_schopnosti" },
        { id: "PRVA_POMOC", audio: "el_prva_pomoc" }
    ];

    // Kým prebieha akčná fáza (is_action_phase), pribudne NA ZAČIATOK zoznamu dočasná
    // položka VÝZVA - Náročnosť/Hrozba aktuálnej výzvy (viď announceChallengeStats()
    // v sekcii 6b nižšie). Mimo akčnej fázy sa vôbec neobjaví - rovnaký vzor "živo
    // počítaného zoznamu" ako getSections()/ZAČAŤ vyššie.
    const PANEL_ELEMENT_VYZVA = { id: "VYZVA", audio: "el_vyzva" };

    // Rovnaký vzor ako VÝZVA vyššie, ale pre SPOR (is_conflict) - dočasná položka
    // NEPRIATEL na začiatku zoznamu, kým prebieha konflikt. Obsah (typ/stres/výhoda/
    // schopnosť/zbraň nepriateľa) je dynamický, viď announceEnemyStats() nižšie.
    const PANEL_ELEMENT_NEPRIATEL = { id: "NEPRIATEL", audio: "el_nepriatel" };

    function getPanelElements() {
        let elements = PANEL_ELEMENTS;
        if (typeof is_conflict !== "undefined" && is_conflict) {
            elements = [PANEL_ELEMENT_NEPRIATEL].concat(elements);
        }
        if (typeof is_action_phase !== "undefined" && is_action_phase) {
            elements = [PANEL_ELEMENT_VYZVA].concat(elements);
        }
        return elements;
    }

    const state = {
        layer: "section",     // "section" | "element" | "sub"
        sectionIdx: 0,
        elementIdx: 0,
        subMode: null,        // "moznosti" | "karty" | "adrenalin" | "zbrane" | "schopnosti"
        spravyIdx: 0          // 0 = najnovšia správa
    };

    function currentElement() {
        const elements = getPanelElements();
        return elements[state.elementIdx % elements.length] || elements[0];
    }

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
    // Voliteľný druhý parameter 'doc' je pre prvky VNÚTRI builder-iframe (viď handleBuilderKeydown
    // nižšie) - getComputedStyle sa musí volať cez OKNO TOHO DOKUMENTU, kde prvok reálne žije
    // (iframe má vlastné 'window'), inak by počítal štýly voči nesprávnemu view.
    function isElementVisible(el, doc) {
        if (!el) return false;
        const win = (doc && doc.defaultView) || window;
        let node = el;
        while (node && node.nodeType === 1) {
            if (win.getComputedStyle(node).display === "none") return false;
            node = node.parentElement;
        }
        return true;
    }

    function getMoznostiItems() {
        const items = [];

        // 1) položky z choice-prompt (ak je viditeľný a má validné možnosti)
        //    POZOR: script.js (updateActionBackButton) POČAS AKČNEJ FÁZY recykluje ten
        //    istý #choice-prompt element len na jediné tlačidlo "⬅" (dataset.actionBack
        //    === "true") - innerHTML sa vtedy prepíše, ALE choicePrompt.userData.validChoices
        //    NIE, takže by tam ostali navždy VOĽBY Z PREDOŠLÉHO narrative uzla. Presne to
        //    spôsobovalo čítanie "starých" možností (typicky hneď na začiatku sporu/akčnej
        //    fázy po naratívnom uzle) - zoznam sa staval z dávno neplatných validChoices,
        //    hoci na obrazovke bolo vidno len tlačidlo Späť. Preto v tomto stave userData
        //    ignorujeme úplne a zaradíme jedinú SKUTOČNE vykreslenú položku - tlačidlo Späť.
        const choicePrompt = document.getElementById("choice-prompt");
        if (choicePrompt && isElementVisible(choicePrompt)) {
            if (choicePrompt.dataset.actionBack === "true") {
                const backBtn = choicePrompt.querySelector(".adrenaline-select");
                if (backBtn) items.push({ type: "button", el: backBtn, audioKey: "btn_spat" });
            } else {
                const data = choicePrompt.userData;
                if (data && data.validChoices) {
                    data.validChoices.forEach(function (choice, idx) {
                        items.push({
                            type: "choice",
                            choiceIndex: idx,
                            label: choice.isBack ? "Späť" : choice.text
                        });
                    });
                }
            }
        }

        // 2) proceed / back / close tlačidlá - zaradené len ak sú SKUTOČNE viditeľné
        //    (vrátane wrapperu #proceed-prompt, viď isElementVisible vyššie)
        const proceedDefs = [
            { el: document.getElementById("proceed-btn"), dynamic: true },
            { el: document.getElementById("back-button"), audioKey: "btn_spat" },
            { el: document.getElementById("close-btn"), audioKey: "btn_ukoncit" }
        ];
        proceedDefs.forEach(function (d) {
            if (!d.el || !isElementVisible(d.el)) return;
            // "ZAČAŤ" (#proceed-btn pred prvým stlačením) má teraz VLASTNÚ sekciu ZACAT
            // (viď getSections()/enterSection() vyššie) - v Možnostiach sa preto neduplikuje.
            // "ĎALEJ" (ten istý #proceed-btn, iný text v ostatných fázach hry) v Možnostiach
            // naďalej ostáva ako predtým.
            if (d.el.id === "proceed-btn" && zacatButtonVisible()) return;
            items.push({ type: "button", el: d.el, dynamic: d.dynamic, audioKey: d.audioKey });
        });

        return items;
    }

    function moznostiAnnounceCurrent() {
        const items = getMoznostiItems();
        // Voľby medzičasom zmizli (napr. výber práve spustil prechod do sporu) - namiesto
        // mätúceho "Chýba audiosúbor." (no_audio) sa jednoducho vrátime o vrstvu vyššie,
        // presne tak, ako keby hráč sám stlačil Escape/Backspace.
        if (items.length === 0) { goUp(); return; }
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
        if (items.length === 0) { goUp(); return; }
        moznostiCursor = (moznostiCursor - 1 + items.length) % items.length;
        moznostiAnnounceCurrent();
    }

    function moznostiRight() {
        const items = getMoznostiItems();
        if (items.length === 0) { goUp(); return; }
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
    //
    //    ÚNIK (escape-btn) je odteraz SÚČASŤOU tohto zoznamu - presne tak, ako je
    //    umiestnený vo vizuálnej podobe pôvodnej verzie hry: escape-btn sa nachádza
    //    priamo v lište kariet (#card-tray-container), nie ako samostatný ovládací
    //    prvok. Preto ho aj audio navigácia teraz ponúka ako "ďalšiu kartu" na konci
    //    zoznamu - šípka vpravo za poslednou kartou naň naďalej ostáva, šípka vľavo
    //    pred prvou kartou naň prejde opačným smerom - namiesto toho, aby mal vlastnú
    //    položku ÚNIK v Ovládacom paneli (tá bola z PANEL_ELEMENTS odstránená).
    //    Rovnako ako predtým je dostupný len počas sporu (unikIsActive() nižšie) -
    //    mimo sporu sa v zozname kariet vôbec neobjaví (rovnako, ako je escape-btn
    //    mimo sporu v DOM skrytý, display:none, viď script.js).
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

    // Únik má zmysel len počas sporu (is_conflict) - escape-btn je mimo sporu v DOM
    // skrytý (display:none, viď script.js), takže mimo sporu ho nemá zmysel ani
    // skúšať klikať (mohol by ísť tichý no-op alebo v horšom prípade spustiť logiku,
    // ktorá počíta s tým, že spor prebieha).
    function unikIsActive() {
        return typeof is_conflict !== "undefined" && !!is_conflict;
    }

    // true = audio kurzor v Kartách je práve na virtuálnej POSLEDNEJ položke ÚNIK
    // (za poslednou skutočnou kartou); false = na jednej zo skutočných kariet
    // (currentSelectedCardIdx - zdieľaný priamo so script.js kvôli myšovému aj
    // klávesovému zvýrazneniu pre vidiacich spoluhráčov, viď kartyUpdateVisualHighlight
    // nižšie).
    let kartyUnikSelected = false;

    // Ak medzitým spor skončil (hráč unikol/vyhral/prehral) a audio kurzor pritom
    // ostal na ÚNIKU, ticho ho presunieme späť na poslednú skutočnú kartu - Únik v tej
    // chvíli reálne zmizne z obrazovky (escape-btn display:none), nemá preto zmysel
    // na ňom ostávať. Volá sa na začiatku každej Karty-operácie (Left/Right/Select/
    // Announce/ToggleSide/tooltip), aby stav nikdy nezostal nekonzistentný.
    function kartySyncUnikState() {
        if (kartyUnikSelected && !unikIsActive()) {
            kartyUnikSelected = false;
            const cards = document.querySelectorAll("#card-tray-container .card-container");
            if (currentSelectedCardIdx >= cards.length) currentSelectedCardIdx = Math.max(0, cards.length - 1);
        }
    }

    // Zosynchronizuje vizuálny (myšový/klávesový) highlight s aktuálnym kurzorom pre
    // vidiacich spoluhráčov. Na skutočnej karte deleguje na existujúce script.js
    // updateCardKeyboardHighlight() - to samo o sebe o Úniku nevie (vždy by highlight
    // vrátilo na currentSelectedCardIdx-tu kartu), preto sa naň spoliehame LEN keď
    // kurzor na Úniku nie je; keď je, zvýraznenie kariet ručne zrušíme a namiesto neho
    // pridáme rovnakú CSS triedu ("keyboard-hover") priamo na escape-btn.
    function kartyUpdateVisualHighlight() {
        const escapeBtn = document.getElementById("escape-btn");
        if (kartyUnikSelected) {
            document.querySelectorAll("#card-tray-container .card-container").forEach(function (card) {
                card.classList.remove("keyboard-hover");
                if (card.children[0]) card.children[0].classList.remove("keyboard-hover-zone");
                if (card.children[1]) card.children[1].classList.remove("keyboard-hover-zone");
            });
            if (escapeBtn) escapeBtn.classList.add("keyboard-hover");
        } else {
            if (escapeBtn) escapeBtn.classList.remove("keyboard-hover");
            if (typeof updateCardKeyboardHighlight === "function") updateCardKeyboardHighlight();
        }
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

    // Ohlásenie AKTUÁLNEJ karty/strany (alebo ÚNIKU, ak je práve vybraný) - volá sa
    // pri vstupe do Kariet aj po každej zmene šípkami (kartyLeft/kartyRight/
    // kartyToggleSide nižšie). Pre skutočnú kartu prehrá jej MENO (card_o/s/b -
    // "Opatrne."/"Smelo."/"Bezhlavo.") a - pokiaľ je karta PRÁVE ROZDELENÁ na dve
    // strany (spor/eliminačná kontrola, rovnaká podmienka ako v kartyTooltipKey()/
    // kartyToggleSide()) - hneď za ním (zaradené do frontu, aby to neznelo cez seba)
    // aj to, KTORÁ strana (ČIN/ÚTOK) je práve zvolená. Bez tohto doplnku by hráč bez
    // vizuálu nevedel rozlíšiť, ktorú z dvoch polovíc karty (s odlišnými hodnotami,
    // viď card_*_d_tooltip / card_*_a_tooltip) práve ovláda. Podrobný obsah danej
    // strany (Opatrnosť/Intenzita + Motivácia) sa naďalej prečíta až na požiadanie
    // klávesou "I" (viď kartyTooltipKey() nižšie).
    function kartyAnnounceCurrent() {
        kartySyncUnikState();
        kartyUpdateVisualHighlight();
        if (kartyUnikSelected) { playAudio(AUDIO_MAP.el_unik); return; }
        const cards = document.querySelectorAll("#card-tray-container .card-container");
        const card = cards[currentSelectedCardIdx];
        if (!card) { playAudio("no_audio"); return; }
        const code = (card.getAttribute("data-card") || "").toLowerCase();
        playAudio("card_" + code);
        if (is_conflict || is_elimination_check) {
            enqueueTaggedAudio((currentSelectedActionType === "A") ? "utok" : "cin", null, "karty_side");
        }
    }

    function kartyLeft() {
        kartySyncUnikState();
        const cards = document.querySelectorAll("#card-tray-container .card-container");
        if (cards.length === 0 && !kartyUnikSelected) return;
        if (kartyUnikSelected) {
            kartyUnikSelected = false;
            currentSelectedCardIdx = cards.length - 1;
        } else if (currentSelectedCardIdx === 0 && unikIsActive()) {
            kartyUnikSelected = true;
        } else {
            currentSelectedCardIdx = (currentSelectedCardIdx - 1 + cards.length) % cards.length;
        }
        kartyAnnounceCurrent();
    }

    function kartyRight() {
        kartySyncUnikState();
        const cards = document.querySelectorAll("#card-tray-container .card-container");
        if (cards.length === 0 && !kartyUnikSelected) return;
        if (kartyUnikSelected) {
            kartyUnikSelected = false;
            currentSelectedCardIdx = 0;
        } else if (currentSelectedCardIdx === cards.length - 1 && unikIsActive()) {
            kartyUnikSelected = true;
        } else {
            currentSelectedCardIdx = (currentSelectedCardIdx + 1) % cards.length;
        }
        kartyAnnounceCurrent();
    }

    // Prepnutie strany karty (šípky HORE/DOLE) - kópia logiky "2. PREPÍNANIE POLOVÍC
    // KARTY" z UNIFIED KEYBOARD CONTROLLER v script.js: mimo sporu/eliminačnej kontroly
    // strany neexistujú (celá karta je jeden klik), preto sa v tom prípade nič neprepína.
    // ÚNIK žiadne strany nemá vôbec - ak je práve vybraný, šípky hore/dole nemajú efekt.
    function kartyToggleSide() {
        kartySyncUnikState();
        if (kartyUnikSelected) { playAudio("no_audio"); return; }
        if (!is_conflict && !is_elimination_check) { playAudio("no_audio"); return; }
        currentSelectedActionType = (currentSelectedActionType === "A") ? "D" : "A";
        kartyAnnounceCurrent();
    }

    function kartySelect() {
        kartySyncUnikState();
        if (kartyUnikSelected) {
            const escapeBtn = document.getElementById("escape-btn");
            if (escapeBtn) escapeBtn.click();
            // Ostávame na ÚNIKU - viď poznámka nižšie pri skutočných kartách.
            return;
        }
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
    // 6b. VÝZVA - Náročnosť/Hrozba aktuálnej výzvy (dočasná položka VYZVA vyššie).
    //    Hodnoty sa VŽDY čítajú NAŽIVO z #challenge-stats-display (.stat-item span,
    //    spans[0] = Náročnosť, spans[1] = Hrozba - presne v tomto poradí a z tohto
    //    elementu ich vypĺňa toggleChallengeDisplay(show, data) v script.js), nikdy
    //    z JS premenných current_challenge.difficulty/.threat, aby hlásenie vždy
    //    zodpovedalo tomu, čo je AKTUÁLNE zobrazené na obrazovke.
    //
    //    Hláška sa skladá zo ŠTATICKÝCH kúskov (nahrané slová 'vyzva'/'narocnost'/
    //    'hrozba' + existujúce číselné súbory 'stres_0'..'stres_15' - tie sú čisté
    //    číslovky bez ohľadu na názov, viď audio_manifest.json -> stres), miesto
    //    jednej dlhej TTS vety - presne tak, ako si to autor hry vyžiadal. Súbory idú
    //    za sebou vo FRONTE (enqueueLogNarrationAudio, bez prerušovania), aby zneli
    //    poporadku a nie cez seba. Náročnosť/Hrozba MIMO rozsahu 0-15 (netypická/
    //    neceločíselná hodnota) sa namiesto chýbajúceho číselného súboru prečíta cez
    //    Web Speech fallback, aby hláška nikdy nezostala ticho na polceste.
    // ---------------------------------------------------------------------------
    function enqueueNumberAudio(text) {
        const isPlainInt = /^-?\d+$/.test((text || "").trim());
        const n = parseInt(text, 10);
        if (isPlainInt && n >= 0 && n <= 15) {
            enqueueLogNarrationAudio("stres_" + n, null);
        } else {
            enqueueLogNarrationAudio("cislo_" + slugifySk(text), text);
        }
    }

    // `chained` = true: prvý kúsok ("Výzva.") NEPRERUŠÍ to, čo práve hrá, len sa pripojí
    // na koniec fronty (používa sa pri vstupe do akčnej fázy nižšie, kde tejto hláške
    // predchádza vlastné interrupt-volanie - obe by inak hrali cez seba). Vráti
    // true/false, či sa vôbec dalo niečo prečítať (žiadne #challenge-stats-display
    // span-y = nedá sa, napr. mimo hry).
    function announceChallengeStats(chained) {
        const displayEl = document.getElementById("challenge-stats-display");
        const spans = displayEl ? displayEl.querySelectorAll(".stat-item span") : [];
        const difficulty = spans[0] ? spans[0].textContent.trim() : "";
        const threat = spans[1] ? spans[1].textContent.trim() : "";
        if (!difficulty && !threat) { if (!chained) playAudio("no_audio"); return false; }

        if (chained) enqueueLogNarrationAudio(AUDIO_MAP.el_vyzva, "Výzva.");
        else playAudio(AUDIO_MAP.el_vyzva);

        enqueueLogNarrationAudio("narocnost", "Náročnosť.");
        if (difficulty) enqueueNumberAudio(difficulty);

        enqueueLogNarrationAudio("hrozba", "Hrozba.");
        if (threat) enqueueNumberAudio(threat);

        return true;
    }

    // ---------------------------------------------------------------------------
    // 6b-bis. NEPRIATEĽ - stav súpera počas SPORU (dočasná položka NEPRIATEL vyššie).
    //    Rovnaký vzor ako announceChallengeStats(): hodnoty sa VŽDY čítajú NAŽIVO
    //    z #enemy-panel (enemy-heading-type/enemy-stress/enemy-advantage/enemy-skill/
    //    enemy-weapon - presne tie polia, ktoré vypĺňa updateUI() v script.js), nikdy
    //    z ENEMY_TYPES/enemy_stress/enemy_advantage priamo, aby hlásenie vždy
    //    zodpovedalo tomu, čo je AKTUÁLNE zobrazené na obrazovke.
    //
    //    Stres sa hlási ako dve čísla (Stres X. Kolaps Y. - druhá hodnota je hranica
    //    kolapsu nepriateľa, rovnaký rozklad "X / Y" ako vlastný Stres hráča, len sa
    //    lomka "/" nečíta a namiesto nej sa vloží slovo "Kolaps"), Výhoda/Schopnosť/
    //    Zbraň ako jedno číslo každé - všetko cez enqueueNumberAudio() (existujúce
    //    stres_0..stres_15 súbory + fallback).
    // ---------------------------------------------------------------------------
    // `silent` = true: ak dáta ešte nie sú v DOM-e k dispozícii (napr. panel ešte nebol
    // prekreslený), NEPREHRÁ sa "no_audio" - iba sa ticho vráti false, aby to volajúci
    // mohol skúsiť znova o chvíľu (viď checkConflictTransition() nižšie, kde sa is_conflict
    // v script.js nastaví SKÔR, ako sa #enemy-panel skutočne naplní štatistikami).
    function announceEnemyStats(chained, silent) {
        const panel = document.getElementById("enemy-panel");
        const visible = panel && panel.style.display !== "none";
        const typeEl = document.getElementById("enemy-heading-type");
        const stressEl = document.getElementById("enemy-stress");
        const advantageEl = document.getElementById("enemy-advantage");
        const skillEl = document.getElementById("enemy-skill");
        const weaponEl = document.getElementById("enemy-weapon");

        const type = (visible && typeEl) ? typeEl.textContent.trim() : "";
        const stressRaw = (visible && stressEl) ? stressEl.textContent.trim() : "";
        const advantage = (visible && advantageEl) ? advantageEl.textContent.trim() : "";
        const skill = (visible && skillEl) ? skillEl.textContent.trim() : "";
        const weapon = (visible && weaponEl) ? weaponEl.textContent.trim() : "";
        if (!type && !stressRaw) { if (!chained && !silent) playAudio("no_audio"); return false; }

        if (chained) enqueueLogNarrationAudio(AUDIO_MAP.el_nepriatel, "Nepriateľ.");
        else playAudio(AUDIO_MAP.el_nepriatel);

        if (type) enqueueLogNarrationAudio("typ_" + slugifySk(type), type);

        const stressParts = stressRaw.split("/").map(function (s) { return s.trim(); });
        enqueueLogNarrationAudio(AUDIO_MAP.el_stres, "Stres.");
        if (stressParts[0]) enqueueNumberAudio(stressParts[0]);
        if (stressParts[1]) {
            enqueueLogNarrationAudio("kolaps", "Kolaps.");
            enqueueNumberAudio(stressParts[1]);
        }

        enqueueLogNarrationAudio("vyhoda", "Výhoda.");
        if (advantage) enqueueNumberAudio(advantage);

        enqueueLogNarrationAudio("schopnost", "Schopnosť.");
        if (skill) enqueueNumberAudio(skill);

        enqueueLogNarrationAudio("zbran", "Zbraň.");
        if (weapon) enqueueNumberAudio(weapon);

        return true;
    }

    // ---------------------------------------------------------------------------
    // 6c. AUTOMATICKÝ PRESUN FOKUSU NA KARTY POČAS AKČNEJ FÁZY (is_action_phase)
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
    //
    //    Hlásenie VÝZVY (Náročnosť/Hrozba, viď 6b vyššie) sa PREHRÁ VŽDY, hneď ako
    //    akčná fáza začne - bez ohľadu na to, kde bol hráč predtým, keďže ide o
    //    dôležitú informáciu o práve začínajúcej výzve. Samotný presun fokusu na Karty
    //    je ale TICHÝ (rovnaký princíp ako autoselect ĎALEJ nižšie) - žiadnu kartu pri
    //    ňom NEHLÁSIME, aby sme nepresekli/nepreskočili VÝZVU ani inú práve prehrávanú
    //    hlášku (napr. NEPRIATEĽA či koniec predošlej narácie). Hráč meno prvej karty
    //    začuje bežným spôsobom, len čo sám pohne šípkou.
    // ---------------------------------------------------------------------------
    // ---------------------------------------------------------------------------
    // 6c. AUTOMATICKÝ PRESUN FOKUSU NA KARTY NA ZAČIATKU AKČNEJ FÁZY (is_action_phase)
    //    Keď sa akčná fáza začne a audio kurzor je práve VOĽNE v Možnostiach (viď
    //    isFocusOnMoznosti() nižšie - t.j. hráč tam nič konkrétne nerobí, len tam
    //    "stojí"), automaticky sa presunie na Karty a ostáva tam. Mimo Možností
    //    (SPRÁVY, DENNÍK, MENU, alebo hráč už sám v Kartách) sa fokus NEHÝBE - hráč
    //    nesmie byť vytrhnutý odtiaľ, kde si sám niečo prezerá.
    //
    //    NÁVRAT fokusu späť do Možností na konci akčnej fázy/keď karty prestanú byť
    //    použiteľné je ZÁMERNE ODSTRÁNENÝ (predtým returnFocusToMoznostiAfterActionPhase()
    //    nižšie prehrávala "Možnosti" a skákala tam aj vtedy, keď Možnosti boli v tej
    //    chvíli PRÁZDNE - typicky uprostred sporu, medzi jednotlivými kolami, kým ešte
    //    nestihlo doraziť ĎALEJ ani žiadna iná voľba). Namiesto toho fokus jednoducho
    //    OSTÁVA v Kartách (aj keď dočasne neaktívnych - pokus o výber vtedy len povie
    //    "Karty sú neaktívne", viď enterElement()/cardsAreActive()) a o presun ĎALEJ,
    //    keď sa objaví, sa už postará samostatný autoselect (6e nižšie).
    // ---------------------------------------------------------------------------
    let lastKnownActionPhase = false;

    function isFocusOnMoznosti() {
        if (state.layer === "element" && currentElement() && currentElement().id === "MOZNOSTI") return true;
        if (state.layer === "sub" && state.subMode === "moznosti") return true;
        return false;
    }

    function focusOnKartyForActionPhase() {
        state.sectionIdx = getSections().indexOf("OVLADACI_PANEL");
        state.elementIdx = getPanelElements().findIndex(function (e) { return e.id === "KARTY"; });
        state.layer = "sub";
        state.subMode = "karty";
        currentSelectedCardIdx = 0;
        kartyUnikSelected = false; // nová akčná fáza vždy začína na prvej skutočnej karte
        kartyUpdateVisualHighlight();
        // AUTOSELECT JE TICHÝ - žiadne hlásenie sa tu nespúšťa, viď poznámka vyššie.
    }

    function checkActionPhaseTransition() {
        if (typeof is_action_phase === "undefined") return;
        if (!audioUIActive) { lastKnownActionPhase = is_action_phase; return; }
        if (is_action_phase === lastKnownActionPhase) return;

        const turningOn = is_action_phase && !lastKnownActionPhase;
        lastKnownActionPhase = is_action_phase;

        if (!turningOn) return; // koniec akčnej fázy - fokus necháme tak, ako je (viď poznámka vyššie)
        if (detectOverlay()) return; // výber hrdinu/zbrane/builder majú prioritu, nezasahujeme

        announceChallengeStats(false);
        if (isFocusOnMoznosti()) focusOnKartyForActionPhase();
    }

    // ---------------------------------------------------------------------------
    // 6c-bis. AUTOMATICKÝ PRESUN FOKUSU NA KARTY MIMO AKČNEJ FÁZY (ostatné prípady,
    //    kedy sa karty stanú klikateľné bez is_action_phase - napr. is_heal_check,
    //    is_elimination_check, is_collapse_check po úspešnom hode, is_tutorial, alebo
    //    obyčajné odmrazenie po naračnej správe). cardsAreActive() (viď 6a vyššie) je
    //    presne tá istá podmienka, ktorou si aj vizuálne UI (script.js) samo rozhoduje,
    //    kedy sú karty použiteľné - preto ju používame ako spúšťač namiesto surového
    //    inputs_frozen (ktorý sa prepína aj mimo kariet, napr. počas ready/general
    //    promptu, viď cardsAreActive() vyššie).
    //
    //    Prípad is_action_phase je ZÁMERNE VYNECHANÝ (skip nižšie) - ten má vlastný,
    //    presnejšie časovaný mechanizmus v 6c vyššie (reťazenie za VÝZVU); tento poller
    //    dopĺňa len OSTATNÉ, dovtedy nepokryté prechody, aby platilo to isté pravidlo
    //    všade: "karty sa stali klikateľné -> ak je audio kurzor voľne v Možnostiach,
    //    presuň ho rovno na prvú kartu (Opatrne)". Rovnaký NEVTIERAVÝ princíp ako v 6c
    //    (fokus presunieme len z Možností) - a rovnako ako v 6c už NEROBÍ návrat späť
    //    do Možností, keď karty prestanú byť aktívne (viď poznámka pri 6c vyššie).
    // ---------------------------------------------------------------------------
    let lastKnownCardsActive = false;

    function checkCardsActiveTransition() {
        if (!audioUIActive) { lastKnownCardsActive = cardsAreActive(); return; }
        const nowActive = cardsAreActive();
        if (nowActive === lastKnownCardsActive) return;
        lastKnownCardsActive = nowActive;

        if (!nowActive) return; // karty prestali byť použiteľné - fokus necháme tak, ako je
        if (typeof is_action_phase !== "undefined" && is_action_phase) return; // má vlastný mechanizmus, viď 6c
        if (detectOverlay()) return; // výber hrdinu/zbrane/builder majú prioritu, nezasahujeme

        if (isFocusOnMoznosti()) focusOnKartyForActionPhase();
    }

    // ---------------------------------------------------------------------------
    // 6d. AUTOMATICKÉ OHLÁSENIE NEPRIATEĽA NA ZAČIATKU SPORU (is_conflict)
    //    Rovnaký vzor ako checkActionPhaseTransition() vyššie, ale pre is_conflict:
    //    hneď ako sa spor začne, prehrá sa stav súpera (announceEnemyStats()), bez
    //    ohľadu na to, kde bol hráč predtým - fokus sa (na rozdiel od VÝZVY) nikam
    //    automaticky nepresúva, keďže spor sa vždy ovláda cez existujúce Karty/Únik.
    //
    //    POZOR - RACE CONDITION: script.js nastaví is_conflict = true HNEĎ na začiatku
    //    (pred zobrazením úvodných hlášok "Priprav sa na boj..." a pred stlačením
    //    ĎALEJ/Proceed hráčom), ale #enemy-panel (typ/stres/výhoda/schopnosť/zbraň
    //    nepriateľa) sa reálne naplní až OMNOHO neskôr - vo vnútri updateUI(), ktoré sa
    //    zavolá až po tom, čo hráč preklikne všetky úvodné naračné hlášky cez ĎALEJ a
    //    boj sa reálne spustí (gameloop()). Keby sme sa o announceEnemyStats() pokúsili
    //    len RAZ, hneď pri zachytení is_conflict===true (ako predtým), panel by ešte
    //    bol prázdny/skrytý a namiesto stavu nepriateľa by sa nezmyselne ozvalo
    //    "Chýba audiosúbor." (no_audio) - to bol presne nahlásený bug. Namiesto toho
    //    teraz na "naplnenie" panela POČKÁME: zopakujeme pokus (potichu, bez no_audio)
    //    pri každom ďalšom tiku, kým sa dáta neobjavia, spor medzitým neskončí, alebo
    //    kým nevyprší bezpečnostný limit pokusov (aby sme v prípade nejakej inej
    //    nečakanej situácie nekontrolovali navždy).
    // ---------------------------------------------------------------------------
    let lastKnownConflict = false;
    let conflictAnnouncePending = false;
    let conflictAnnounceAttempts = 0;
    const CONFLICT_ANNOUNCE_MAX_ATTEMPTS = 75; // 75 * 200ms = 15s bezpečnostný limit

    function checkConflictTransition() {
        if (typeof is_conflict === "undefined") return;
        if (!audioUIActive) {
            lastKnownConflict = is_conflict;
            conflictAnnouncePending = false;
            conflictAnnounceAttempts = 0;
            return;
        }

        if (is_conflict !== lastKnownConflict) {
            const turningOn = is_conflict && !lastKnownConflict;
            lastKnownConflict = is_conflict;
            conflictAnnouncePending = turningOn;
            conflictAnnounceAttempts = 0;
            if (!turningOn) return; // spor sa skončil - niet čo ohlasovať
        }

        if (!conflictAnnouncePending) return;
        if (detectOverlay()) return; // výber hrdinu/zbrane/builder majú prioritu, skúsime znova nabudúce

        // Ak medzitým spor skončil skôr, ako sa panel stihol naplniť (napr. hráč
        // zrušil akciu), potichu prestaneme skúšať - nemá zmysel niečo ohlasovať.
        if (!is_conflict) { conflictAnnouncePending = false; return; }

        conflictAnnounceAttempts++;
        const announced = announceEnemyStats(false, true); // silent=true - žiadne "no_audio" počas čakania
        if (announced || conflictAnnounceAttempts >= CONFLICT_ANNOUNCE_MAX_ATTEMPTS) {
            conflictAnnouncePending = false;
        }
    }

    // ---------------------------------------------------------------------------
    // 6e. AUTOMATICKÉ VÝBER TLAČIDLA "ĎALEJ" (#proceed-btn)
    //    Rovnaký vzor pollingu ako VÝZVA/NEPRIATEĽ vyššie: hneď ako sa #proceed-btn
    //    zobrazí S TEXTOM "ĎALEJ" (nie "ZAČAŤ" - to má vlastnú úvodnú sekciu ZAČAŤ,
    //    viď getSections()/enterSection() vyššie), audio kurzor sa AUTOMATICKY presunie
    //    na položku ĎALEJ v Možnostiach (aby naň hráč hneď mohol nadviazať šípkami,
    //    keby chcel vidieť aj iné práve dostupné voľby).
    //
    //    ŽIADNE hlasové upozornenie sa tu NEPREHRÁVA - samotný presun kurzora stačí;
    //    keď hráč potom pohne šípkou (napr. doľava/doprava v Možnostiach), bežné
    //    ohlásenie položky ("Ďalej.") mu dá vedieť, kde sa nachádza. Predtým tu bol aj
    //    samostatný "ĎALEJ?" manifest kľúč/hláška navyše, ktorá sa pri rušnejšej fronte
    //    (najmä počas/po spore, keď ešte dobiehajú hlášky zo SPRÁV) vedela vsunúť do
    //    stredu tejto fronty namiesto na jej koniec - zámerne odstránené, aby k tomu
    //    už nemohlo dôjsť.
    //
    //    ZÁMERNE BEZ globálneho zachytávania MEDZERNÍKA (na rozdiel od #ready-prompt
    //    vyššie): #ready-prompt blokuje celú hru, kým sa nepotvrdí, takže mu Medzerník
    //    môže bez rizika patriť odkiaľkoľvek. ĎALEJ naopak môže byť viditeľné SÚČASNE
    //    s tým, že hráč práve prezerá zbrane/schopnosti (dropdown) alebo je v MENU -
    //    globálny listener by mu tam Medzerník "ukradol" a namiesto výberu položky by
    //    mu vždy len preskočil ĎALEJ. Preto zostáva len autoselect kurzora (vyššie) -
    //    Medzerník tlačidlo stlačí len vtedy, keď je naň kurzor SKUTOČNE nastavený
    //    (bežná cesta cez Možnosti/moznostiSelect), MENU aj listovanie zbraňami/
    //    schopnosťami tak zostávajú vždy dostupné bez kolízie.
    // ---------------------------------------------------------------------------
    function proceedButtonIsDalej() {
        const btn = document.getElementById("proceed-btn");
        const prompt = document.getElementById("proceed-prompt");
        return !!(btn && prompt && isElementVisible(prompt) && isElementVisible(btn) && btn.textContent.trim() === "ĎALEJ");
    }

    let lastKnownProceedDalejVisible = false;

    function checkProceedButtonTransition() {
        if (!audioUIActive) { lastKnownProceedDalejVisible = proceedButtonIsDalej(); return; }
        const nowVisible = proceedButtonIsDalej();
        if (nowVisible === lastKnownProceedDalejVisible) return;
        lastKnownProceedDalejVisible = nowVisible;
        if (!nowVisible) return; // zmizlo (hráč už stlačil, alebo prešiel inam) - niet čo ohlasovať
        if (detectOverlay()) return; // výber hrdinu/zbrane/builder majú prioritu, nezasahujeme

        // AUTOSELECT: presunieme audio kurzor na MOŽNOSTI a v nich rovno na položku ĎALEJ.
        state.sectionIdx = getSections().indexOf("OVLADACI_PANEL");
        state.elementIdx = getPanelElements().findIndex(function (e) { return e.id === "MOZNOSTI"; });
        state.layer = "sub";
        state.subMode = "moznosti";
        const items = getMoznostiItems();
        const idx = items.findIndex(function (it) { return it.dynamic && it.el && it.el.id === "proceed-btn"; });
        moznostiCursor = idx >= 0 ? idx : 0;
    }

    // ---------------------------------------------------------------------------
    // 6f. AUTOMATICKÉ OHLÁSENIE #general-prompt PRI OTVORENÍ S TEXTOVÝM POĽOM
    //    (zatiaľ jediné použitie: "Zadaj meno nového hrdinu:" cez #new-hero-btn,
    //    viď script.js).
    //
    //    showGeneralPrompt(..., input=true) SYNCHRÓNNE (v tom istom volaní, ktoré
    //    otvorenie promptu spôsobí) rovno aj FOKUSNE #general-prompt-input
    //    (gp_input.focus()). To znamená, že v momente, keď hráč stlačí ĎALŠÍ kláves
    //    (prvé písmeno mena), isTypingTarget() (viď handleAudioUIKeydown nižšie) je
    //    UŽ true - a keďže sa v hlavnom dispečeri kontroluje SKÔR ako
    //    generalPromptVisible()/handleGeneralPromptKeydown() (ktoré by inak na "prvé
    //    stlačenie" ohlásili hlášku aj hint "Meno hrdinu potvrdíš stlačením enter..."),
    //    táto vetva sa NIKDY nedostane k slovu - hint sa tak nikdy neprehral (presne
    //    toto bol nahlásený bug: "hint sa má prehrať po stlačení N, ale neprehráva sa").
    //
    //    Namiesto spoliehania sa na "prvé stlačenie klávesy" (čo tu principiálne
    //    nefunguje) preto tento poller detekuje PRIAMO OTVORENIE takéhoto promptu
    //    (prechod false -> true, KEĎ je zároveň viditeľné aj textové pole) a ohlási ho
    //    OKAMŽITE, nezávisle od klávesnice - rovnaký vzor pollingu ako #ready-prompt/
    //    ĎALEJ vyššie. Funguje tak rovnako spoľahlivo, či prompt otvoril hráč
    //    klávesou "N" (handleHeroKeydown), alebo naň klikol myšou vidiaci spoluhráč.
    // ---------------------------------------------------------------------------
    let lastKnownGeneralPromptInputOpen = false;

    function checkGeneralPromptInputTransition() {
        const gp = document.getElementById("general-prompt");
        const inputEl = document.getElementById("general-prompt-input");
        const nowOpen = !!(gp && isElementVisible(gp) && inputEl && isElementVisible(inputEl));
        if (!audioUIActive) { lastKnownGeneralPromptInputOpen = nowOpen; return; }
        if (nowOpen === lastKnownGeneralPromptInputOpen) return;
        lastKnownGeneralPromptInputOpen = nowOpen;
        if (!nowOpen) return; // zatvorilo sa - niet čo ohlasovať

        // Nastavíme rovno na true, aby prípadné handleGeneralPromptKeydown() (Enter/
        // Escape) už len KONALO, namiesto toho, aby sa na "prvé stlačenie" znova
        // pokúšalo (zbytočne duplicitne) ohlasovať - viď jeho vlastná podmienka vyššie.
        generalPromptWasAnnounced = true;
        const textEl = document.getElementById("general-prompt-text");
        const msg = textEl ? textEl.textContent.trim() : "";
        playAudioOrSpeak("alert_" + slugifySk(msg.slice(0, 60)), msg);
        enqueueLogNarrationAudio(AUDIO_MAP.gp_confirm_enter_hint, "Meno hrdinu potvrdíš stlačením enter. Stlačením CTRL si meno vypočuješ.");
    }

    setInterval(checkActionPhaseTransition, 200);
    setInterval(checkCardsActiveTransition, 200);
    setInterval(checkConflictTransition, 200);
    setInterval(checkProceedButtonTransition, 200);
    setInterval(checkGeneralPromptInputTransition, 200);

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
    // 10. OVLÁDACÍ PANEL > Prvá pomoc (priama akcia, žiadna podvrstva)
    //     ÚNIK sa už tu nenachádza - je teraz súčasťou Kariet, viď sekcia 6 vyššie.
    // ---------------------------------------------------------------------------
    function prvaPomocSelect() {
        if (typeof runHealCheck === "function") runHealCheck();
        // Ostávame na prvku PRVÁ POMOC - viď poznámka pri moznostiSelect(). Predtým sem
        // hneď nasledoval goUp(), ktorý hráča vrátil až do sekcie OVLÁDACÍ PANEL a rovno
        // ohlásil jej názov, hoci hráč žiadnu zmenu sekcie nežiadal - len spustil kontrolu.
    }

    // Keď Možnosti nemajú čo ponúknuť (žiadny choice-prompt s voľbami, žiadne viditeľné
    // ĎALEJ/Späť/Ukončiť tlačidlo), nemá zmysel prvok MOŽNOSTI vôbec ponúkať pri listovaní
    // panelom - inak by naň hráč narazil, vstúpil dnu, a len by počul "Chýba audiosúbor."
    // (no_audio), čo znie ako chyba, hoci ide o úplne bežný, prechodný stav (napr. tesne po
    // tom, čo handleChallengeTransition() skryje starý choice-prompt a nový ešte nie je
    // vykreslený). Skontroluje sa naživo pri každom prechode panelom.
    function isElementSkippable(el) {
        if (el.id === "MOZNOSTI" && getMoznostiItems().length === 0) return true;
        return false;
    }

    // Prvý prvok panela, ktorý NIE JE momentálne preskočiteľný (viď isElementSkippable
    // vyššie) - použité pri VSTUPE do OVLÁDACIEHO PANELA (enterSection), kde predtým
    // vždy natvrdo padol elementIdx = 0. Ak bol prvok na indexe 0 zrovna MOŽNOSTI bez
    // voľby (viď vyššie), hráč by pri vstupe počul práve MOŽNOSTI namiesto toho, aby
    // pristál rovno na prvom skutočne použiteľnom prvku - presne ten istý princíp, aký
    // ArrowLeft/ArrowRight už používajú pri listovaní (do-while s isElementSkippable).
    function firstPlayableElementIndex() {
        const elements = getPanelElements();
        for (let i = 0; i < elements.length; i++) {
            if (!isElementSkippable(elements[i])) return i;
        }
        return 0; // obranná záloha - nemalo by nastať, panel má vždy aspoň jeden dostupný prvok
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
    // 12. SEKCIA: DENNÍK = žurnál/karta postavy (builder, viď sekcia 13d)
    //    DENNÍK v skutočnosti nie je samostatná obrazovka - je to ten istý
    //    #builder-overlay/#builder-iframe, čo script.js otvára cez toggleBuilder(true)
    //    (napr. po výbere počiatočnej zbrane). Vstup do sekcie DENNÍK teda jednoducho
    //    zavolá toggleBuilder(true) - je to top-level funkcia v script.js zdieľanom
    //    globálnom scope, takže ju vieme zavolať priamo, netreba hľadať/klikať tlačidlo.
    //
    //    toggleBuilder(true) má VLASTNÉ blokovanie (spor/akčná fáza/kontroly, alebo
    //    ešte nevybraný hrdina) - v oboch prípadoch script.js sám buď zaloguje hlášku
    //    (prečíta ju automatické live-čítanie logu, sekcia 11b) alebo otvorí
    //    #general-prompt (ten už obsluhuje sekcia 13a) - netreba to tu duplikovať.
    //    Ak sa builder naozaj otvorí, ďalší keydown ho zachytí cez detectOverlay()
    //    (sekcia 13e) a odovzdá riadenie builderNav-u úplne rovnako, ako keby ho
    //    otvorilo samotné script.js.
    // ---------------------------------------------------------------------------
    function dennikAnnounce() {
        if (typeof toggleBuilder === "function") {
            toggleBuilder(true);
        } else {
            // Poistka pre prípad, že by toggleBuilder z nejakého dôvodu nebol dostupný.
            speak("dennik_prazdny");
        }
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
                // Textové pole - na rozdiel od zvyšku audio UI tu Medzerník NEPOTVRDZUJE
                // (musí sa dať napísať medzera priamo do mena), potvrdzuje sa len Enter.
                // Bez tohto upozornenia hráč zvykne skúsiť Medzerník ako všade inde a
                // "zasekne sa" - namiesto potvrdenia sa mu len vpíše medzera do textu.
                enqueueLogNarrationAudio(AUDIO_MAP.gp_confirm_enter_hint, "Meno hrdinu potvrdíš stlačením enter. Stlačením CTRL si meno vypočuješ.");
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

    // Mimo nahratého rozsahu (0-15) - Body rastu/Ľudskosť/cena schopnosti bežne presiahnu 15.
    // DÔLEŽITÉ: nesmie sa žiadať súbor "no_audio" priamo - ten SKUTOČNE existuje (je to práve
    // ten "Chýba audiosúbor." fallback), takže by sa vždy prehral ON namiesto TTS. Namiesto
    // toho žiadame súbor pre KONKRÉTNU hodnotu (napr. "hodnota_20.WAV"), ktorý pre čísla mimo
    // rozsahu zámerne neexistuje - jeho chýbanie/404 correctne spustí TTS s presnou hodnotou.
    const fileGuess = Number.isInteger(n) ? ("hodnota_" + n) : "hodnota_desatinne_cislo";
    enqueueAudio(
        fileGuess,
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

        // "N" = vytvoriť nového hrdinu (#new-hero-btn) - klávesová obdoba tlačidla
        // NOVÝ HRDINA vo vizuálnom UI. Manifest kľúč btn_novy_hrdina existoval už
        // predtým, no nič ho nikdy nevolalo - handleHeroKeydown na "n"/"N" vôbec
        // nereagoval a handleOverlayKeydown() volá e.stopImmediatePropagation() pre
        // KAŽDÝ kláves, kým je prekryv otvorený, takže sa stlačenie ani nedostalo
        // nikam ďalej (v script.js beztak žiadny "n" listener pre tento prekryv nie
        // je - tlačidlo je len klikacie, viď onclick pri #new-hero-btn).
        if (e.key === "n" || e.key === "N") {
            e.preventDefault();
            e.stopImmediatePropagation();
            const btn = document.getElementById("new-hero-btn");
            if (btn) { speak("btn_novy_hrdina"); btn.click(); }
            return;
        }

        return;
    }


    // ---------------------------------------------------------
    // SKILL BROWSING
    // ---------------------------------------------------------
    if (heroSelectionStage === "skills") {

        if (e.key === "Escape" || e.key === "Backspace") {
            e.preventDefault();
            e.stopImmediatePropagation();

            // Return to hero browsing stage
            heroSelectionStage = "hero";
            heroSkillCursor = 0;
            
            // Announce current hero
            heroSelectAnnounceCurrent();
            return;
        }

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
    // builderNav.stage:      "grid" (mriežka postavy) | "editor" (#info-panel-container)
    // builderNav.gridLayer:  (len keď stage === "grid") "section" (listovanie HLAVIČKA/
    //                        SCHOPNOSTI/ZBRANE ako mini-sekcie) | "items" (listovanie
    //                        položiek VNÚTRI zvolenej sekcie SCHOPNOSTI/ZBRANE)
    // builderNav.editorSub:  "browse" (listovanie zoznamom schopností) | "actions" (cena/
    //                        zvýšiť/znížiť/vrátiť)
    // builderNav.pendingDirectSkill: true medzi slot.click() na KONKRÉTNU (už naučenú)
    //                        schopnosť v mriežke (nie na "+") a najbližším keydown, ktorý
    //                        detekuje otvorenie editora - viď handleBuilderGridItemsKeydown
    //                        a handleBuilderKeydown nižšie.
    const BUILDER_GRID_SECTIONS = ["HLAVICKA", "SCHOPNOSTI", "ZBRANE"];
    const BUILDER_ACTION_IDS = ["cena", "zvysit", "znizit", "vratit"];
    const BUILDER_ACTION_BUTTON_INDEX = { zvysit: 0, znizit: 1, vratit: 2 };

    const builderNav = {
        stage: "grid",
        gridLayer: "section",
        gridSectionIdx: 0,
        itemCursor: 0,
        editorSub: "browse",
        editorListCursor: 0,
        actionCursor: 0,
        pendingDirectSkill: false
    };

    function resetBuilderNav() {
        builderNav.stage = "grid";
        builderNav.gridLayer = "section";
        builderNav.gridSectionIdx = 0;
        builderNav.itemCursor = 0;
        builderNav.editorSub = "browse";
        builderNav.editorListCursor = 0;
        builderNav.actionCursor = 0;
        builderNav.pendingDirectSkill = false;
    }

    let lastBuilderModalMsg = null;

    function getBuilderGridSlots(doc) {
        return Array.from(doc.querySelectorAll("#character-stats .skill-slot"));
    }

    // "add" = prázdny "+" slot na pridanie novej schopnosti, "skill" = naučená schopnosť
    // (má dieťa .skill-cat-box - kategória), "item" = predmet/zbraň/munícia vo výbave
    // (rovnaká trieda .skill-slot, ale BEZ .skill-cat-box - viď renderStats() v
    // script_builder.js, obe typy zdieľajú CSS triedu, líšia sa len obsahom).
    function builderSlotKind(slot) {
        if (slot.classList.contains("add-skill-slot")) return "add";
        if (slot.querySelector(".skill-cat-box")) return "skill";
        return "item";
    }

    // SlotY patriace pod aktuálne zvolenú mini-sekciu (SCHOPNOSTI = naučené schopnosti + "+",
    // ZBRANE = predmety/zbrane/munícia vo výbave). HLAVIČKA nemá žiadne sloty - je to čistý
    // prehľad (meno/BR/ľudskosť), viď builderAnnounceOverview().
    function getBuilderSectionSlots(doc) {
        const sectionId = BUILDER_GRID_SECTIONS[builderNav.gridSectionIdx];
        const all = getBuilderGridSlots(doc);
        if (sectionId === "SCHOPNOSTI") {
            return all.filter(function (s) { const k = builderSlotKind(s); return k === "skill" || k === "add"; });
        }
        if (sectionId === "ZBRANE") {
            return all.filter(function (s) { return builderSlotKind(s) === "item"; });
        }
        return [];
    }

    function builderAnnounceOverview(doc) {
        const nameEl = doc.querySelector("#character-stats .name-field");
        const brEl = doc.querySelector("#character-stats .br-field");
        const humanityEl = doc.querySelector("#character-stats .humanity-field");
        const name = nameEl ? nameEl.textContent.trim() : "";
        const br = brEl ? brEl.textContent.trim() : "";
        const humanity = humanityEl ? humanityEl.textContent.trim() : "";

        if (name) {
            playAudioOrSpeak("hero_" + slugifySk(name), name); // meno hrdinu - preruší, hrá sa prvé
        } else {
            speak("prehlad_postavy");
        }
        if (br !== "") {
            enqueueAudio("label_body_rastu", "Body rastu:", false);
            playNumericValue(br);
        }
        if (humanity !== "") {
            enqueueAudio("label_ludskost", "Ľudskosť:", false);
            playNumericValue(humanity);
        }
    }

    // Predmety v mriežke DENNÍKA zahŕňajú aj zbrane/muníciu z výbavy (renderStats() v
    // script_builder.js do rovnakého zoznamu pridáva items AJ weapons/ammo) - tie majú
    // rovnaké mená ako v ovládacom paneli (sekcia ZBRANE), takže pre ne znovupoužijeme
    // už existujúce 'weapon_<slug>.WAV' nahrávky namiesto vytvárania duplicitných 'item_'.
    function isKnownWeaponName(label) {
        return typeof WEAPON_LIST === "object" && WEAPON_LIST
            && Object.prototype.hasOwnProperty.call(WEAPON_LIST, label.toUpperCase());
    }

    // --- Úroveň "section" (HLAVIČKA / SCHOPNOSTI / ZBRANE) ---
    function builderGridSectionAnnounceCurrent(doc) {
        const sectionId = BUILDER_GRID_SECTIONS[builderNav.gridSectionIdx];
        if (sectionId === "HLAVICKA") { builderAnnounceOverview(doc); return; }
        if (sectionId === "SCHOPNOSTI") { speak("el_schopnosti"); return; }
        if (sectionId === "ZBRANE") { speak("el_zbrane"); return; }
    }

    function handleBuilderGridSectionKeydown(doc, e) {
        if (e.key === "ArrowLeft") {
            builderNav.gridSectionIdx = (builderNav.gridSectionIdx - 1 + BUILDER_GRID_SECTIONS.length) % BUILDER_GRID_SECTIONS.length;
            builderGridSectionAnnounceCurrent(doc);
            return;
        }
        if (e.key === "ArrowRight") {
            builderNav.gridSectionIdx = (builderNav.gridSectionIdx + 1) % BUILDER_GRID_SECTIONS.length;
            builderGridSectionAnnounceCurrent(doc);
            return;
        }
        if (e.key === " " || e.key === "Enter") {
            const sectionId = BUILDER_GRID_SECTIONS[builderNav.gridSectionIdx];
            if (sectionId === "HLAVICKA") { builderAnnounceOverview(doc); return; } // prehľad nemá čo "vstúpiť", len znova prečíta
            builderNav.gridLayer = "items";
            builderNav.itemCursor = 0;
            builderGridItemsAnnounceCurrent(doc);
            return;
        }
        if (e.key === "Escape" || e.key === "Backspace") {
            clickIfExists("close-builder", doc); // window.parent.toggleBuilder(false)
            lastOverlay = null;
            return;
        }
    }

    // --- Úroveň "items" (vnútri SCHOPNOSTI alebo ZBRANE) ---
    function builderGridItemsAnnounceCurrent(doc) {
        const slots = getBuilderSectionSlots(doc);
        const slot = slots[builderNav.itemCursor];
        if (!slot) {
            speak(BUILDER_GRID_SECTIONS[builderNav.gridSectionIdx] === "ZBRANE" ? "grid_zbrane_prazdne" : "grid_schopnosti");
            return;
        }

        const kind = builderSlotKind(slot);
        if (kind === "add") { speak("pridat_schopnost"); return; }

        const nameEl = slot.querySelector(".skill-name-text");
        const label = nameEl ? nameEl.textContent.trim() : "";
        if (!label) { playAudio("no_audio"); return; }

        const prefix = kind === "skill" ? "skill_" : (isKnownWeaponName(label) ? "weapon_" : "item_");
        enqueueAudio(prefix + slugifySk(label), label, true); // meno - preruší a hrá sa hneď

        const lvlEl = slot.querySelector(".skill-lvl-box");
        const lvlText = lvlEl ? lvlEl.textContent.trim() : "";
        if (lvlText !== "") playNumericValue(lvlText); // úroveň/počet kusov - pripojí sa hneď za meno

        if (kind === "item" && slot.classList.contains("selected")) {
            const hasUseBtn = !!doc.querySelector("#character-stats > .basic-btn");
            if (hasUseBtn) enqueueAudio("btn_pouzit", "Použiť.", false);
        }
    }

    function handleBuilderGridItemsKeydown(doc, e) {
        const slots = getBuilderSectionSlots(doc);

        if (e.key === "ArrowLeft") {
            if (slots.length === 0) { playAudio("no_audio"); return; }
            builderNav.itemCursor = (builderNav.itemCursor - 1 + slots.length) % slots.length;
            builderGridItemsAnnounceCurrent(doc);
            return;
        }
        if (e.key === "ArrowRight") {
            if (slots.length === 0) { playAudio("no_audio"); return; }
            builderNav.itemCursor = (builderNav.itemCursor + 1) % slots.length;
            builderGridItemsAnnounceCurrent(doc);
            return;
        }
        if (e.key === " " || e.key === "Enter") {
            const slot = slots[builderNav.itemCursor];
            if (!slot) { playAudio("no_audio"); return; }
            const kind = builderSlotKind(slot);

            if (kind === "item") {
                if (slot.classList.contains("selected")) {
                    // Predmet je už vybraný - ak má efekt, DRUHÉ stlačenie ho POUŽIJE
                    // (výsledok hlási sama hra do logu - automaticky ho prečíta sekcia 11b).
                    const useBtn = doc.querySelector("#character-stats > .basic-btn");
                    if (useBtn) { useBtn.click(); return; }
                    playAudio("no_audio"); // vybraný, ale bez efektu - niet čo použiť
                    return;
                }
                slot.click(); // selectItem(name) - prekreslí mriežku, prípadne pridá tlačidlo POUŽIŤ
                builderGridItemsAnnounceCurrent(doc); // znova prečíta ten istý index (teraz už ako vybraný predmet)
                return;
            }

            slot.click(); // schopnosť / "+" - spustí selectSkill()+toggleInfoOverlay(true), resp. len toggleInfoOverlay(true) pre "+"
            // Ak ide o KONKRÉTNU (už naučenú) schopnosť, nie o "+", editor sa má otvoriť
            // rovno v akciách pre TÚTO schopnosť (viď handleBuilderKeydown nižšie), nie
            // v browse-zozname všetkých schopností.
            builderNav.pendingDirectSkill = (kind === "skill");
            return; // prechod do editora zachytí handleBuilderKeydown pri ďalšom stlačení
        }
        if (e.key === "Escape" || e.key === "Backspace") {
            const slot = slots[builderNav.itemCursor];
            if (slot && builderSlotKind(slot) === "item" && slot.classList.contains("selected")) {
                slot.click(); // zruší výber predmetu, ostávame v ZBRANE (toggne selectItem naspäť na null)
                builderGridItemsAnnounceCurrent(doc);
                return;
            }
            builderNav.gridLayer = "section";
            builderGridSectionAnnounceCurrent(doc); // späť na cyklus HLAVIČKA/SCHOPNOSTI/ZBRANE
            return;
        }
    }

    // Spoločný vstupný bod pre "grid" stage (volá ho announceOverlayEntry aj I-tooltip).
    function builderGridAnnounceCurrent() {
        const doc = getBuilderDoc();
        if (!doc) { playAudio("no_audio"); return; }
        if (builderNav.gridLayer === "items") { builderGridItemsAnnounceCurrent(doc); return; }
        builderGridSectionAnnounceCurrent(doc);
    }

    function handleBuilderGridKeydown(doc, e) {
        if (builderNav.gridLayer === "items") { handleBuilderGridItemsKeydown(doc, e); return; }
        handleBuilderGridSectionKeydown(doc, e);
    }

    function getBuilderListItems(doc) {
        return Array.from(doc.querySelectorAll("#builder-list .skill-list-item"));
    }

    function builderEditorAnnounceCurrent(doc) {
        const items = getBuilderListItems(doc);
        const item = items[builderNav.editorListCursor];
        if (!item) { playAudio("no_audio"); return; }
        const label = item.textContent.trim();
        playAudioOrSpeak("skill_" + slugifySk(label), label);
    }

    // "#sel-skill-name" má po selectSkill(name) tvar "NÁZOV: A → B" (A = aktuálna úroveň,
    // B = úroveň PO prípadnom zvýšení) - viď script_builder.js. Toto je jediné miesto, kde je
    // aktuálna úroveň k dispozícii (údaje o postave žijú len vo vnútri iframe-u, mimo dosahu
    // audio-ui.js), preto ju parsujeme priamo z tohto textu namiesto počítania nanovo.
    function parseSkillLevelsFromEditor(doc) {
        const el = doc.getElementById("sel-skill-name");
        if (!el) return null;
        const m = (el.textContent || "").match(/:\s*(\d+)\s*\u2192\s*(\d+)/);
        if (!m) return null;
        return { current: parseInt(m[1], 10), target: parseInt(m[2], 10) };
    }

    // "#cost-disc" má tvar "<číslo> BR" - cena zvýšenia na ďalšiu úroveň.
    function parseSkillCostFromEditor(doc) {
        const el = doc.getElementById("cost-disc");
        if (!el) return null;
        const m = (el.textContent || "").match(/(-?\d+)/);
        return m ? parseInt(m[1], 10) : null;
    }

    // "#br-label" má tvar "BR: <číslo>" - CELKOVÉ dostupné body rastu postavy (nie cena).
    function parseTotalBrFromEditor(doc) {
        const el = doc.getElementById("br-label");
        if (!el) return null;
        const m = (el.textContent || "").match(/(-?\d+)/);
        return m ? parseInt(m[1], 10) : null;
    }

    // interrupt=true (predvolené) sa použije pri listovaní akciami šípkami (má prerušiť, čo
    // hralo predtým); interrupt=false pri nadväzovaní hneď za inú frontu (napr. po "Aktuálna
    // úroveň: X" pri prvom vstupe do akcií).
    function builderActionsAnnounceCurrent(doc, interrupt) {
        const doInterrupt = interrupt !== false;
        const actionId = BUILDER_ACTION_IDS[builderNav.actionCursor];
        if (actionId === "cena") {
            const cost = parseSkillCostFromEditor(doc);
            enqueueAudio(AUDIO_MAP.label_cena || "label_cena", "Cena:", doInterrupt);
            if (cost !== null) playNumericValue(cost);
            return;
        }
        const keyMap = { zvysit: "btn_zvysit_uroven", znizit: "btn_znizit_uroven", vratit: "btn_vratit_zmenu" };
        const mapKey = keyMap[actionId];
        enqueueAudio(AUDIO_MAP[mapKey] || mapKey, null, doInterrupt);
    }

    function handleBuilderEditorKeydown(doc, e) {
        if (builderNav.editorSub === "browse") {
            const items = getBuilderListItems(doc);
            if (e.key === "ArrowLeft") {
                if (items.length === 0) { playAudio("no_audio"); return; }
                builderNav.editorListCursor = (builderNav.editorListCursor - 1 + items.length) % items.length;
                builderEditorAnnounceCurrent(doc);
                return;
            }
            if (e.key === "ArrowRight") {
                if (items.length === 0) { playAudio("no_audio"); return; }
                builderNav.editorListCursor = (builderNav.editorListCursor + 1) % items.length;
                builderEditorAnnounceCurrent(doc);
                return;
            }
            if (e.key === " " || e.key === "Enter") {
                const item = items[builderNav.editorListCursor];
                if (!item) { playAudio("no_audio"); return; }
                item.click(); // selectSkill(name) - naplní control-box (cena, úroveň, príbuzné schopnosti)
                builderNav.editorSub = "actions";
                builderNav.actionCursor = 0;

                const levels = parseSkillLevelsFromEditor(doc);
                if (levels) {
                    enqueueAudio("label_aktualna_uroven", "Aktuálna úroveň:", true); // preruší, hrá sa prvé
                    playNumericValue(levels.current);
                }
                builderActionsAnnounceCurrent(doc, false); // nadviaže hneď za tým (napr. "Cena: X")
                return;
            }
            if (e.key === "Escape" || e.key === "Backspace") {
                const closeBtn = doc.querySelector("#info-panel-container .info-panel-close-btn");
                if (closeBtn) closeBtn.click(); // toggleInfoOverlay(false)
                builderNav.stage = "grid";
                return;
            }
        } else { // "actions" - Cena / ZVÝŠIŤ ÚROVEŇ / ZNÍŽIŤ ÚROVEŇ (↓) / VRÁTIŤ (⤺)
            if (e.key === "ArrowLeft") {
                builderNav.actionCursor = (builderNav.actionCursor - 1 + BUILDER_ACTION_IDS.length) % BUILDER_ACTION_IDS.length;
                builderActionsAnnounceCurrent(doc);
                return;
            }
            if (e.key === "ArrowRight") {
                builderNav.actionCursor = (builderNav.actionCursor + 1) % BUILDER_ACTION_IDS.length;
                builderActionsAnnounceCurrent(doc);
                return;
            }
            if (e.key === " " || e.key === "Enter") {
                const actionId = BUILDER_ACTION_IDS[builderNav.actionCursor];
                if (actionId === "cena") { builderActionsAnnounceCurrent(doc); return; } // len znova prečíta, nič sa nekliká

                const beforeLevels = parseSkillLevelsFromEditor(doc);
                const buttons = doc.querySelectorAll("#skill-btn-container button");
                const btn = buttons[BUILDER_ACTION_BUTTON_INDEX[actionId]];
                if (btn) btn.click();

                // Ak akcia zlyhala (napr. NEDOSTATOK BODOV RASTU pri ZVÝŠIŤ), script_builder.js
                // namiesto zmeny úrovne zobrazí #custom-modal s dôvodom a úroveň ostane
                // NEZMENENÁ. Preto sa musí najprv overiť, či sa úroveň skutočne zmenila (a
                // či sa medzičasom neobjavil modal) - inak by hráč počul falošné "Úroveň
                // zvýšená na X", hneď potom nasledované (jedinou pravdivou) hláškou modalu.
                const modal = doc.getElementById("custom-modal");
                const modalNowVisible = !!(modal && isElementVisible(modal, doc));
                if (modalNowVisible) {
                    handleBuilderModalKeydown(doc, modal, e); // ohlási dôvod zlyhania hneď teraz
                    return;
                }

                // upgradeSelected()/downgradeSkill()/undoUpgrade() v script_builder.js na konci
                // samy znova zavolajú selectSkill(selectedSkill) - #sel-skill-name aj #br-label
                // teda už odrážajú NOVÝ stav, môžeme ich hneď prečítať ako spätnú väzbu.
                const afterLevels = parseSkillLevelsFromEditor(doc);
                const levelChanged = !!(beforeLevels && afterLevels && beforeLevels.current !== afterLevels.current);
                if (!levelChanged) return; // akcia nemala žiadny efekt (napr. limit úrovne) - niet čo ohlásiť

                const totalBr = parseTotalBrFromEditor(doc);
                const verbKey = actionId === "zvysit" ? "level_zvysena_na"
                    : actionId === "znizit" ? "level_znizena_na"
                    : "level_vratena_na";

                enqueueAudio(verbKey, null, true); // preruší, hrá sa prvé
                playNumericValue(afterLevels.current);
                if (totalBr !== null) {
                    enqueueAudio("label_aktualne_body_rastu", "Aktuálne body rastu:", false);
                    playNumericValue(totalBr);
                }
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
        //
        // POZOR: kým script_builder.js (showCustomAlert) modal ešte ANI RAZ nezobrazil,
        // #custom-modal NEMÁ vlastný inline style.display - je skrytý LEN cez CSS triedu
        // "modal-overlay" (predvolene display:none v štýloch). `modal.style.display` je
        // vtedy prázdny reťazec, nie "none", takže naivné `!== "none"` ho OMYLOM vyhodnotí
        // ako viditeľný - presne to spôsobovalo, že audio UI hneď po vstupe do DENNÍKA
        // "skočilo" na modal so statickým placeholder textom priamo z index.html ("Tu sa
        // zobrazí správa...") a zaseklo sa tam: modal totiž v tomto stave ani nemá tlačidlá
        // #modal-confirm / #modal-cancel (tie script_builder.js vytvorí až vnútri
        // showCustomAlert), takže Enter/Escape nenašli čo kliknúť a modal (podľa tejto
        // chybnej podmienky) sa nikdy "nezavrel". Rovnaký problém, aký isElementVisible()
        // rieši pre hlavný dokument (viď vyššie) - tu len navyše treba počítať štýly cez
        // OKNO IFRAME-u (doc.defaultView), nie cez window nadradenej stránky.
        const modal = doc.getElementById("custom-modal");
        if (modal && isElementVisible(modal, doc)) {
            handleBuilderModalKeydown(doc, modal, e);
            return;
        }
        lastBuilderModalMsg = null;

        // #info-panel-container.active = editor konkrétnej schopnosti nad mriežkou postavy
        const infoPanel = doc.getElementById("info-panel-container");
        const editorOpen = !!(infoPanel && infoPanel.classList.contains("active"));

        if (editorOpen && builderNav.stage !== "editor") {
            builderNav.stage = "editor";

            if (builderNav.pendingDirectSkill) {
                // Otvorené kliknutím na KONKRÉTNU (už naučenú) schopnosť v mriežke, nie na
                // "+" - preskočí sa browse-zoznam a rovno sa vstúpi do akcií pre TÚTO
                // schopnosť (server-side selectSkill() už prebehol pri slot.click()).
                builderNav.pendingDirectSkill = false;
                builderNav.editorSub = "actions";
                builderNav.actionCursor = 0;

                // Zosynchronizuje editorListCursor s práve vybranou schopnosťou, aby
                // prípadný návrat Escape-om do browse-zoznamu ukázal na tú istú schopnosť,
                // nie na prvú v zozname.
                const items = getBuilderListItems(doc);
                const selEl = doc.getElementById("sel-skill-name");
                const selName = selEl ? (selEl.textContent || "").split(":")[0].trim() : "";
                const idx = items.findIndex(function (it) { return it.textContent.trim() === selName; });
                builderNav.editorListCursor = idx >= 0 ? idx : 0;

                const levels = parseSkillLevelsFromEditor(doc);
                if (levels) {
                    enqueueAudio("label_aktualna_uroven", "Aktuálna úroveň:", true); // preruší, hrá sa prvé
                    playNumericValue(levels.current);
                }
                builderActionsAnnounceCurrent(doc, false); // nadviaže hneď za tým (napr. "Cena: X")
                return; // toto stlačenie len ohlási vstup do akcií, nezúčastní sa navigácie
            }

            builderNav.editorSub = "browse";
            builderNav.editorListCursor = 0;
        }
        if (!editorOpen && builderNav.stage === "editor") {
            builderNav.stage = "grid";
        }

        if (builderNav.stage === "editor") handleBuilderEditorKeydown(doc, e);
        else handleBuilderGridKeydown(doc, e);
    }

    // --- 13e. Nastavenia (#settings) / O hre (#credits) ---
    //    Vlastné, jednoduchšie prekryvy nad celou hrou (rovnaká filozofia ako výber
    //    hrdinu/zbrane/builder vyššie) - dostupné z MENU cez položky NASTAVENIA / O HRE.
    //    Predtým vôbec neboli súčasťou stromu sekcií (viď manifest, '_note_nested' pri
    //    'menu_o_hre' vyššie) - po kliknutí na tieto položky MENU (enterElement() len
    //    zavolá opt.click()) audio UI "stratilo" hráča: obrazovka sa reálne otvorila, no
    //    žiadny ďalší kláves už nemal čo robiť - presne tá "chýbajúca vrstva", čo si
    //    autor hry všimol.
    const SETTINGS_ITEM_IDS = ["tutorial-checkbox", "audio-checkbox", "log-rolls-checkbox", "voice-speed-select", "mode-dropdown", "about-btn-back"];
    let settingsCursor = 0;

    function settingsOverlayVisible() {
        const el = document.getElementById("settings");
        return !!(el && isElementVisible(el));
    }

    function creditsOverlayVisible() {
        const el = document.getElementById("credits");
        return !!(el && isElementVisible(el));
    }

    function getSettingsItems() {
        return SETTINGS_ITEM_IDS.map(function (id) { return document.getElementById(id); }).filter(Boolean);
    }

    // Popisy jednotlivých prvkov (TUTORIÁL/AUDIO/LOGOVAŤ HODY majú <span> v spoločnom
    // <label>, RÝCHLOSŤ HLASU/NÁROČNOSŤ majú popis v predchádzajúcom súrodencovi - <span>
    // pred <select>, viď index.html) - v manifeste zatiaľ nemajú nahrávku (obrazovka
    // predtým nebola ozvučená vôbec), preto vždy idú cez Web Speech fallback.
    function settingsItemLabel(el) {
        if (!el) return "";
        if (el.id === "about-btn-back") return "Späť";
        if (el.tagName === "SELECT") {
            const prevSpan = el.parentElement ? el.parentElement.querySelector("span") : null;
            return prevSpan ? prevSpan.textContent.trim() : "";
        }
        const wrapLabel = el.closest("label");
        const span = wrapLabel ? wrapLabel.querySelector("span") : null;
        return span ? span.textContent.trim() : "";
    }

    function settingsAnnounceCurrent() {
        const items = getSettingsItems();
        const el = items[settingsCursor];
        if (!el) { playAudio("no_audio"); return; }
        const label = settingsItemLabel(el);

        if (el.id === "about-btn-back") { playAudio("btn_spat"); return; } // existujúca nahrávka ("Späť.")

        if (el.tagName === "SELECT") {
            const opt = el.options[el.selectedIndex];
            const value = opt ? opt.textContent.trim() : "";
            playAudioOrSpeak("nastavenia_" + slugifySk(label), label); // preruší, hrá sa prvé
            // Tagované ako "nastavenia_hodnota" - rovnaký princíp ako karty_side (viď
            // enqueueTaggedAudio vyššie): pri rýchlom prepínaní hodnôt (šípky na selecte,
            // zapnutie/vypnutie checkboxu) sa každá predchádzajúca, ešte neprehraté hodnota
            // najprv odstráni z fronty namiesto toho, aby sa tam hromadila.
            enqueueTaggedAudio("nastavenia_hodnota_" + slugifySk(value), value, "nastavenia_hodnota");
            return;
        }

        // checkbox (TUTORIÁL/AUDIO/LOGOVAŤ HODY)
        playAudioOrSpeak("nastavenia_" + slugifySk(label), label);
        enqueueTaggedAudio(el.checked ? "stav_zapnute" : "stav_vypnute", el.checked ? "Zapnuté." : "Vypnuté.", "nastavenia_hodnota");
        // Vlastný tag ("nastavenia_upozornenie"), nie "nastavenia_hodnota" - inak by
        // toto pridanie hneď zmazalo "Vypnuté."/"Zapnuté." pridané o riadok vyššie (obe
        // by mali rovnaký tag a removeQueuedByTag by zasiahol aj čerstvo pridanú položku).
        if (el.id === "log-rolls-checkbox") {
            if (el.checked) removeQueuedByTag("nastavenia_upozornenie"); // znova zapnuté - staré upozornenie už neplatí
            else enqueueTaggedAudio("nastavenia_upozornenie_logovat_hody", "Pozor: v audio verzii odporúčame nechať toto nastavenie zapnuté.", "nastavenia_upozornenie");
        }
    }

    function handleSettingsKeydown(e) {
        const items = getSettingsItems();
        const count = items.length;

        if (e.key === "ArrowLeft") {
            if (count === 0) { playAudio("no_audio"); return; }
            settingsCursor = (settingsCursor - 1 + count) % count;
            settingsAnnounceCurrent();
            return;
        }
        if (e.key === "ArrowRight") {
            if (count === 0) { playAudio("no_audio"); return; }
            settingsCursor = (settingsCursor + 1) % count;
            settingsAnnounceCurrent();
            return;
        }
        if (e.key === " " || e.key === "Enter") {
            const el = items[settingsCursor];
            if (!el) { playAudio("no_audio"); return; }
            if (el.tagName === "SELECT") {
                // cycleDropdown (zdieľaná funkcia zo script.js, viď ZBRANE/SCHOPNOSTI vyššie)
                // je bezpečná aj počas sporu - pre ľubovoľné iné id ako 'player-weapon-dropdown'/
                // 'player-skill-dropdown' jej validácia možností vždy skončí na "povolené".
                cycleDropdown(el.id, 1);
                settingsAnnounceCurrent();
                return;
            }
            el.click(); // checkbox prepne (onchange uloží), SPÄŤ zavolá backToMenu()
            if (el.id === "about-btn-back") { lastOverlay = null; return; } // #settings sa zavrelo
            settingsAnnounceCurrent(); // checkbox - hneď potvrdí nový stav
            return;
        }
        if (e.key === "Escape" || e.key === "Backspace") {
            clickIfExists("about-btn-back"); // backToMenu() - uloží NÁROČNOSŤ, zavrie #settings, ukáže MENU
            lastOverlay = null;
            return;
        }
    }

    // O HRE (#credits) je čisto informačná obrazovka (mená tvorcov, hudba, odkaz na web) -
    // bez interaktívnych prvkov okrem SPÄŤ, preto sa celá prečíta naraz cez Web Speech
    // namiesto položka-po-položke navigácie.
    function creditsAnnounce() {
        const container = document.querySelector("#credits > div");
        const text = container ? container.textContent.replace(/\s+/g, " ").trim() : "Informácie o tvorivom tíme.";
        playAudioOrSpeak("credits_o_hre", text);
    }

    function handleCreditsKeydown(e) {
        if (e.key === " " || e.key === "Enter" || e.key === "Escape" || e.key === "Backspace") {
            clickIfExists("about-btn-back"); // backToMenu()
            lastOverlay = null;
        }
    }

    // --- 13f. Spoločný dispečer prekryvov ---
    let lastOverlay = null;

    // #hero-selection-overlay sa pri VÝBERE UŽ EXISTUJÚCEHO hrdinu (confirmHeroSelection()
    // v script.js) po potvrdení rovno ODSTRÁNI z DOM-u (overlay.remove()) - od tej chvíle
    // ho `document.getElementById(...)` už navždy spoľahlivo nenájde, žiadna staleness
    // kontrola netreba. Pri TVORBE NOVÉHO hrdinu (createNewCharacterGlobally ->
    // selectInitialWeapon -> po potvrdení zbrane toggleBuilder(true) pre POČIATOČNÚ FÁZU)
    // sa ale NEODSTRÁNI - ostáva CELÝ ČAS visieť v DOM-e pod zbraňou aj builderom
    // (vyšší z-index), a to ZÁMERNE: presne toto je aj samotná hra vizuálne robí - keď
    // hráč dokončí tvorbu novej postavy v builderi a ten sa zavrie, spod neho sa vynorí
    // TÁ ISTÁ, stále živá #hero-selection-overlay (teraz už aj s novou postavou v
    // zozname), aby ju hráč mohol potvrdiť tlačidlom VYBRAŤ (čo ju KONEČNE odstráni,
    // viď vyššie) - alebo pokojne stlačil "N" znova a pridal ďalšieho člena družiny.
    //
    // PREDTÝM sa tu (namiesto poradia nižšie) používal príznak `hero_selected === true`
    // ako náhradná "stale" kontrola - ten sa ale nastaví na true HNEĎ po potvrdení
    // zbrane (ešte PRED otvorením buildera) a NIKDY sa nevracia späť na false, takže
    // od tej chvíle navždy blokoval aj úplne legitímne, neskoršie znovuobjavenie tej
    // istej obrazovky (viď vyššie) - presne toto hlásil bug "po zavretí buildera sa
    // audio UI nevráti do výberu hrdinu". Namiesto neho teraz jednoducho REŠPEKTUJEME
    // SKUTOČNÉ VIZUÁLNE PORADIE prekryvov (rovnaké, akým sú v DOM-e nad sebou otvárané):
    // ZBRAŇ je vždy nad HRDINOM (otvára sa z neho) a BUILDER je vždy nad HRDINOM (otvára
    // sa po zbrani) - stačí preto len kontrolovať zbraň/builder SKÔR ako hrdinu; kým je
    // čokoľvek z nich otvorené, vyhrá correctne ono, a hneď ako sa zatvorí, kontrola
    // prirodzene "prepadne" na #hero-selection-overlay (ak ešte v DOM-e je).
    function detectOverlay() {
        if (document.getElementById("weapon-selection-overlay")) return "weapon";
        if (builderOverlayVisible()) return "builder";
        if (document.getElementById("hero-selection-overlay")) return "hero";
        if (settingsOverlayVisible()) return "settings";
        if (creditsOverlayVisible()) return "credits";
        return null;
    }

    function announceOverlayEntry(overlay) {
        if (overlay === "hero") { heroSelectAnnounceCurrent(); return; }
        if (overlay === "weapon") { weaponSelectAnnounceCurrent(); return; }
        if (overlay === "builder") { builderGridAnnounceCurrent(); return; }
        if (overlay === "settings") { settingsCursor = 0; settingsAnnounceCurrent(); return; }
        if (overlay === "credits") { creditsAnnounce(); return; }
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
        if (overlay === "settings") { handleSettingsKeydown(e); return; }
        if (overlay === "credits") { handleCreditsKeydown(e); return; }
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
            state.elementIdx = firstPlayableElementIndex();
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
        } else if (section === "ZACAT") {
            // Rovnaký vzor ako výber zbrane (handleWeaponKeydown): najprv potvrdenie
            // hlasom, potom skutočný klik - odstránením #proceed-btn zo scény sa aj
            // zacatButtonVisible() vzápätí zmení na false, takže getSections() pri
            // ďalšom prístupe vráti už bežný 4-sekciový zoznam (viď getSections() vyššie).
            const btn = document.getElementById("proceed-btn");
            if (btn) { speak("btn_zacat"); btn.click(); }
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
                // Za normálnych okolností sa sem s 0 položkami nedostaneme (MOŽNOSTI sú
                // vtedy isElementSkippable, viď vyššie) - toto je len obrana proti
                // časovému pretekaniu (voľby zmiznú presne medzi ArrowLeft/Right a
                // stlačením medzerníka). Namiesto "Chýba audiosúbor." radšej mlčky
                // ostaneme vo vrstve prvkov, akoby k stlačeniu vôbec nedošlo.
                if (items.length === 0) {
                    break;
                }
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
            case "VYZVA":
                // Zostávame vo vrstve "element" (rovnaký vzor ako STRES vyššie) - VÝZVA
                // len znova prečíta Náročnosť/Hrozba, nič sa "nevyberá".
                announceChallengeStats(false);
                break;
            case "NEPRIATEL":
                announceEnemyStats(false);
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
        SECTION_MENU: "Si v sekcii Menu. Šípkami vľavo a vpravo prepínaš medzi jednotlivými sekciami. Medzerníkom vstúpiš do vybranej sekcie.",
        SECTION_OVLADACI_PANEL: "Si v sekcii Ovládací panel. Medzerníkom vstúpiš dovnútra a šípkami budeš listovať jednotlivými prvkami: Možnosti, Karty, Stres, Adrenalín, Zbrane, Schopnosti a Prvá pomoc.",
        SECTION_SPRAVY: "Si v sekcii Správy. Medzerníkom vstúpiš do zoznamu hlásení a šípkami budeš listovať staršími a novšími správami.",
        SECTION_DENNIK: "Si v sekcii Denník.",
        SECTION_ZACAT: "Si na položke Začať. Medzerníkom spustíš hru.",

        // --- PRVKY OVLÁDACIEHO PANELA (vrstva "element") - kľúč = "ELEMENT_" + PANEL_ELEMENTS[].id ---
        ELEMENT_MOZNOSTI: "Si na položke Možnosti. Medzerníkom vstúpiš do zoznamu aktuálne dostupných možností a šípkami medzi nimi budeš listovať.",
        ELEMENT_KARTY: "Si na položke Karty. Medzerníkom vstúpiš k listovaniu kartami, šípkami vľavo a vpravo meníš kartu (počas sporu je za poslednou kartou aj Únik) a šípkami hore a dole, počas sporu, meníš stranu karty.",
        ELEMENT_STRES: "Si na položke Stres. Hodnota sa prečítala automaticky, medzerník tu nič nevyvolá.",
        ELEMENT_ADRENALIN: "Si na položke Adrenalín. Medzerníkom vstúpiš dovnútra, šípkami meníš hodnotu adrenalínu a medzerníkom ju potvrdíš.",
        ELEMENT_ZBRANE: "Si na položke Zbrane. Medzerníkom vstúpiš dovnútra a šípkami budeš listovať zbraňami, ktoré má hrdina k dispozícii.",
        ELEMENT_SCHOPNOSTI: "Si na položke Schopnosti. Medzerníkom vstúpiš dovnútra a šípkami budeš listovať schopnosťami hrdinu.",
        ELEMENT_PRVA_POMOC: "Si na položke Prvá pomoc. Medzerníkom ju použiješ.",
        ELEMENT_MENU_OPTION: "Si na položke menu. Medzerníkom ju potvrdíš.",
        ELEMENT_VYZVA: "Si na položke Výzva. Medzerníkom si znova vypočuješ náročnosť a hrozbu aktuálnej výzvy.",
        ELEMENT_NEPRIATEL: "Si na položke Nepriateľ. Medzerníkom si znova vypočuješ stav súpera - typ, stres, výhodu, schopnosť a zbraň.",

        // --- PODVRSTVY (vrstva "sub") - kľúč = "SUB_" + state.subMode ---
        SUB_MOZNOSTI: "Listuješ možnosťami. Šípkami vľavo a vpravo meníš možnosť, medzerníkom ju potvrdíš, klávesou Escape sa vrátiš späť.",
        SUB_KARTY: "Listuješ kartami. Šípkami vľavo a vpravo meníš kartu, počas sporu je za poslednou kartou aj Únik, šípkami hore a dole meníš stranu karty, medzerníkom kartu (alebo Únik) vyberieš, klávesou Escape sa vrátiš späť.",
        SUB_KARTY_UNIK: "Si na Úniku - je zaradený za poslednou kartou. Medzerníkom sa oň pokúsiš, dostupné len počas sporu.",
        SUB_ADRENALIN: "Nastavuješ adrenalín. Šípkami vľavo a vpravo meníš hodnotu, medzerníkom ju potvrdíš, klávesou Escape sa vrátiš späť.",
        SUB_ZBRANE: "Listuješ zbraňami. Šípkami vľavo a vpravo meníš zbraň, klávesou Escape sa vrátiš späť.",
        SUB_SCHOPNOSTI: "Listuješ schopnosťami. Šípkami vľavo a vpravo meníš schopnosť, klávesou Escape sa vrátiš späť.",
        SUB_SPRAVY: "Listuješ správami. Šípkami vľavo a vpravo prechádzaš medzi staršími a novšími hláseniami, klávesou Escape sa vrátiš späť.",

        // --- PREKRYVY (výber hrdinu / zbrane / builder / #general-prompt) ---
        OVERLAY_HERO_BROWSE: "Si vo výbere hrdinu. Šípkami vľavo a vpravo prechádzaš medzi uloženými hrdinami, medzerníkom hrdinu označíš a prejdeš k jeho schopnostiam.",
        OVERLAY_HERO_SKILLS: "Prezeráš schopnosti hrdinu. Šípkami vľavo a vpravo prechádzaš medzi jeho schopnosťami, medzerníkom ho potvrdíš a začneš hru, klávesou Escape sa vrátiš k výberu hrdinu.",
        OVERLAY_WEAPON: "Si vo výbere počiatočnej zbrane. Šípkami vľavo a vpravo prechádzaš medzi dostupnými zbraňami, medzerníkom zbraň potvrdíš.",
        OVERLAY_BUILDER_OVERVIEW: "Si v builderi, na Hlavičke - meno, body rastu a ľudskosť. Šípkami prejdeš na Schopnosti a Zbrane, klávesou Escape builder zavrieš.",
        OVERLAY_BUILDER_GRID_SECTIONS: "Si v builderi, medzi časťami Hlavička, Schopnosti a Zbrane. Šípkami medzi nimi prechádzaš, medzerníkom vstúpiš dovnútra, klávesou Escape builder zavrieš.",
        OVERLAY_BUILDER_GRID: "Si v builderi, medzi políčkami v tejto časti. Šípkami prechádzaš medzi nimi, medzerníkom políčko otvoríš, klávesou Escape sa vrátiš na Hlavičku/Schopnosti/Zbrane.",
        OVERLAY_BUILDER_ITEM_SELECTED: "Predmet je vybraný a má použiteľný efekt. Medzerníkom ho použiješ, klávesou Escape výber zrušíš bez použitia.",
        OVERLAY_BUILDER_EDITOR: "Si v builderi, v zozname schopností. Šípkami prechádzaš medzi schopnosťami, medzerníkom prejdeš k akciám (cena, zvýšiť, znížiť, vrátiť), klávesou Escape sa vrátiš späť.",
        OVERLAY_BUILDER_ACTIONS: "Si v builderi, medzi akciami pre vybranú schopnosť. Šípkami prechádzaš medzi cenou, zvýšením úrovne, znížením úrovne a vrátením zmeny, medzerníkom akciu potvrdíš (cena sa len prečíta znova).",
        GENERAL_PROMPT: "Zobrazuje sa výzva na potvrdenie. Medzerníkom alebo klávesou Enter ju potvrdíš, klávesou Escape ju zrušíš.",
        GENERAL_PROMPT_INPUT: "Zobrazuje sa výzva na zadanie textu. Potvrdíš klávesou Enter, nie medzerníkom - ten sa vpíše ako medzera do textu. Klávesou Escape výzvu zrušíš."
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
                    const actionId = BUILDER_ACTION_IDS[builderNav.actionCursor];
                    el = actionId === "cena" ? null : doc.querySelectorAll("#skill-btn-container button")[BUILDER_ACTION_BUTTON_INDEX[actionId]];
                    fallbackKey = "OVERLAY_BUILDER_ACTIONS";
                } else {
                    el = getBuilderListItems(doc)[builderNav.editorListCursor];
                    fallbackKey = "OVERLAY_BUILDER_EDITOR";
                }
            } else {
                if (builderNav.gridLayer === "section") {
                    fallbackKey = BUILDER_GRID_SECTIONS[builderNav.gridSectionIdx] === "HLAVICKA"
                        ? "OVERLAY_BUILDER_OVERVIEW"
                        : "OVERLAY_BUILDER_GRID_SECTIONS";
                } else {
                    el = getBuilderSectionSlots(doc)[builderNav.itemCursor];
                    fallbackKey = (el && builderSlotKind(el) === "item" && el.classList.contains("selected"))
                        ? "OVERLAY_BUILDER_ITEM_SELECTED"
                        : "OVERLAY_BUILDER_GRID";
                }
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
        if (generalPromptVisible()) {
            const inputEl = document.getElementById("general-prompt-input");
            speakStateTooltip((inputEl && isElementVisible(inputEl)) ? "GENERAL_PROMPT_INPUT" : "GENERAL_PROMPT");
            return;
        }

        if (state.layer === "element") {
            if (currentSection() === "MENU") {
                speakElementTooltip(getMenuOptions()[state.elementIdx], "ELEMENT_MENU_OPTION");
            } else if (currentElement().id === "VYZVA") {
                // VÝZVA nemá popisný text, ale samotný ÚČEL prvku - namiesto všeobecného
                // stavového tooltipu preto rovno ZNOVA prečíta Náročnosť/Hrozbu ("read
                // these again"). Ak by z nejakého dôvodu nešlo nič prečítať (napr.
                // #challenge-stats-display medzičasom zmizol), padne späť na ELEMENT_VYZVA.
                if (!announceChallengeStats(false)) speakStateTooltip("ELEMENT_VYZVA");
            } else if (currentElement().id === "NEPRIATEL") {
                // Rovnaký vzor ako VÝZVA vyššie - NEPRIATEL rovno ZNOVA prečíta stav
                // súpera namiesto všeobecného stavového tooltipu.
                if (!announceEnemyStats(false)) speakStateTooltip("ELEMENT_NEPRIATEL");
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
                kartySyncUnikState();
                if (kartyUnikSelected) {
                    speakStateTooltip("SUB_KARTY_UNIK");
                } else {
                    const cards = document.querySelectorAll("#card-tray-container .card-container");
                    const card = cards[currentSelectedCardIdx];
                    const code = card && (card.getAttribute("data-card") || "").toLowerCase();
                    if (code === "o" || code === "s" || code === "b") speak(kartyTooltipKey(code));
                    else speakStateTooltip("SUB_KARTY");
                }
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
                playAudioOrSpeak("ui_ready_priprav_sa", "Priprav sa.");
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
            const gpInputEl = document.getElementById("general-prompt-input");
            // CTRL nad textovým poľom #general-prompt-input (napr. rozpísané meno hrdinu)
            // prečíta jeho AKTUÁLNY obsah nahlas - vždy cez TTS (playAudioOrSpeak s kľúčom,
            // ktorý nikdy nemá nahratý súbor), keďže ide o voľne písaný text hráča, ktorý sa
            // navyše priebežne mení počas písania.
            if (gpOpen && gpInputEl && isElementVisible(gpInputEl) && e.key === "Control") {
                e.preventDefault();
                const val = gpInputEl.value.trim();
                if (val) playAudioOrSpeak("gp_input_value_" + slugifySk(val.slice(0, 60)), val);
                else playAudioOrSpeak(AUDIO_MAP.gp_input_empty, "Prázdne.");
                return;
            }
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
                state.sectionIdx = (state.sectionIdx - 1 + getSections().length) % getSections().length;
                speak(SECTION_AUDIO_KEYS[currentSection()]);
            } else if (state.layer === "element") {
                if (currentSection() === "MENU") {
                    state.elementIdx = (state.elementIdx - 1 + getMenuOptions().length) % getMenuOptions().length;
                    announceMenuOption(state.elementIdx);
                } else {
                    const count = getPanelElements().length;
                    let steps = 0;
                    do {
                        state.elementIdx = (state.elementIdx - 1 + count) % count;
                        steps++;
                    } while (isElementSkippable(currentElement()) && steps < count);
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
                state.sectionIdx = (state.sectionIdx + 1) % getSections().length;
                speak(SECTION_AUDIO_KEYS[currentSection()]);
            } else if (state.layer === "element") {
                if (currentSection() === "MENU") {
                    state.elementIdx = (state.elementIdx + 1) % getMenuOptions().length;
                    announceMenuOption(state.elementIdx);
                } else {
                    const count = getPanelElements().length;
                    let steps = 0;
                    do {
                        state.elementIdx = (state.elementIdx + 1) % count;
                        steps++;
                    } while (isElementSkippable(currentElement()) && steps < count);
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
            if (state.layer === "sub" && state.subMode === "karty") {
                kartyToggleSide();
                return;
            }
            // Mimo Kariet nemá ArrowUp/ArrowDown vlastnú navigáciu - ArrowDown sa preto
            // využije na PRESKOČENIE práve hrajúcej nahrávky, bez toho, aby sa čokoľvek
            // pohlo v navigácii (na rozdiel od ArrowLeft/ArrowRight, ktoré prehrávanie
            // prerušia LEN ako vedľajší účinok pohybu kurzora). Užitočné napr. počas
            // dlhšieho automatického čítania novej správy v SPRÁVACH - hráč nahrávku
            // jednoducho preskočí (posunie sa na ďalšiu vo fronte, ak nejaká čaká),
            // bez toho, aby musel niekam navigovať.
            if (e.key === "ArrowDown") {
                stopCurrentPlayback();
                playQueueNext();
            }
            return;
        }
    }

    // Zapnutie/vypnutie audio UI módu klávesou "V"
    window.addEventListener("keydown", function (e) {
        if (e.key === "v" || e.key === "V") {
            // Textové pole je práve focusnuté (napr. hráč PRÁVE PÍŠE meno hrdinu, ktoré
            // celkom bežne obsahuje písmeno "v" - "Viktor", "Slavomír"...) - tento listener
            // je úplne SAMOSTATNÝ od handleAudioUIKeydown vyššie (ktorý "v"/"V" už správne
            // ignoruje, viď komentár tam), takže bez tejto rovnakej podmienky by KAŽDÉ "v"
            // napísané do mena audio UI uprostred písania VYPLO (alebo znova zapLO), čo
            // pôsobilo presne ako "input vypína audio mód" - v skutočnosti nešlo o vypnutie
            // kvôli otvoreniu inputu samotného, ale o KAŽDÉ ďalšie písmeno "v" v texte mena.
            if (isTypingTarget()) return;
            audioUIActive = !audioUIActive;
            if (audioUIActive) {
                state.layer = "section";
                state.sectionIdx = 0;
                lastOverlay = null;
                generalPromptWasAnnounced = false;
                lastBuilderModalMsg = null;
                lastKnownActionPhase = (typeof is_action_phase !== "undefined") ? is_action_phase : false;
                lastKnownCardsActive = cardsAreActive();
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