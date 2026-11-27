/* Runedle — jogo diário de adivinhação de campeões (HTML + CSS + JavaScript puro).
 * Depende de js/data.js (CHAMPION_ROWS, QUOTES, CHAMPION_TITLES) e js/icons.js. */
(() => {
  'use strict';

  /* =========================================================
   * Utilidades
   * ======================================================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const fmtDate = (key) => key.split('-').reverse().join('/');

  /* =========================================================
   * Campeões
   * ======================================================= */
  const GENDER = { M: 'Masculino', F: 'Feminino', O: 'Outro' };
  const POS = { T: 'Top', J: 'Jungle', M: 'Mid', A: 'ADC', S: 'Support' };
  const RANGE = { C: 'Corpo a corpo', D: 'À distância' };

  function splitEmojis(s) {
    if (window.Intl && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(s), (x) => x.segment).filter((x) => x.trim());
    }
    return Array.from(s);
  }

  const CHAMPIONS = CHAMPION_ROWS.map(([id, name, g, pos, sp, res, rng, reg, year, emo]) => ({
    id, name, year,
    gender: GENDER[g],
    positions: pos.split('').map((p) => POS[p]),
    species: sp.split('|'),
    resource: res,
    range: rng.split('').map((r) => RANGE[r]),
    regions: reg.split('|'),
    emojis: splitEmojis(emo),
  })).sort((a, b) => a.id.localeCompare(b.id));

  const BY_ID = Object.fromEntries(CHAMPIONS.map((c) => [c.id, c]));

  /* =========================================================
   * Desafio diário
   * O dia do jogo vira às 21h de Brasília (00:00 UTC). A chave do dia é a data UTC.
   * ======================================================= */
  const DAY = 86400000;
  const EPOCH = Date.UTC(2024, 0, 1);
  const CAL_START = '2026-01-01'; // primeiro dia disponível no calendário
  const RESET_LABEL = 'Reinicia às 21h (horário de Brasília)';

  const dateKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
  const dayNumber = (key) => Math.floor((Date.parse(key + 'T00:00:00Z') - EPOCH) / DAY) + 1;
  const msUntilReset = (now = Date.now()) => Math.floor(now / DAY) * DAY + DAY - now;
  const prevKey = (key) => dateKey(Date.parse(key + 'T12:00:00Z') - DAY);
  const isValidKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(Date.parse(k + 'T00:00:00Z')) && dateKey(Date.parse(k + 'T12:00:00Z')) === k;

  /* hash determinístico (cyrb53): mesmo resultado em qualquer navegador */
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  /* gerador pseudoaleatório com semente (mulberry32) */
  function rng(seed) {
    let a = hash(seed) >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* escolhe o campeão do dia; evita repetir o de ontem no mesmo modo */
  function pickDaily(pool, mode, key) {
    const idx = (k) => hash(`runedle:${mode}:${k}`) % pool.length;
    let i = idx(key);
    if (pool.length > 1 && i === idx(prevKey(key))) i = (i + 1) % pool.length;
    return pool[i];
  }

  function formatCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  }

  /* =========================================================
   * LocalStorage
   * ======================================================= */
  const PREFIX = 'runedle:v1:';
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* sem armazenamento: o jogo continua */ }
  }

  /* partida de um modo em um dia (versões antigas guardavam só a do dia em game:<modo>) */
  function loadGame(mode, key) {
    const g = read(`game:${mode}:${key}`, null);
    if (g) return g;
    const legacy = read(`game:${mode}`, null);
    return legacy && legacy.dateKey === key ? legacy : { dateKey: key, guesses: [], status: 'playing' };
  }
  const saveGame = (mode, g) => write(`game:${mode}:${g.dateKey}`, g);

  function loadStats(mode) {
    const s = read(`stats:${mode}`, { played: 0, wins: 0, currentStreak: 0, maxStreak: 0, distribution: {} });
    const today = dateKey();
    if (s.currentStreak > 0 && s.lastWonKey !== today && s.lastWonKey !== prevKey(today)) s.currentStreak = 0;
    return s;
  }

  const distKey = (n) => (n >= 10 ? '10+' : String(n));

  function addHistory(entry) {
    const history = read('history', []);
    history.unshift(entry);
    write('history', history.slice(0, 300));
  }

  /* resultado do desafio do dia: conta para estatísticas e sequência */
  function recordResult(mode, key, championId, won, attempts) {
    const s = loadStats(mode);
    if (s.lastPlayedKey === key) return; // uma partida por modo por dia
    s.played++;
    s.lastPlayedKey = key;
    if (won) {
      s.wins++;
      s.currentStreak = s.lastWonKey === prevKey(key) ? s.currentStreak + 1 : 1;
      s.maxStreak = Math.max(s.maxStreak, s.currentStreak);
      s.lastWonKey = key;
      const d = distKey(attempts);
      s.distribution[d] = (s.distribution[d] || 0) + 1;
      const days = read('days', []);
      if (!days.includes(key)) { days.push(key); write('days', days.slice(-800)); }
    } else {
      s.currentStreak = 0;
    }
    write(`stats:${mode}`, s);
    addHistory({ dateKey: key, mode, championId, attempts, won });
  }

  /* Sequência diária: dias seguidos em que você venceu pelo menos um desafio no próprio dia.
   * Vale até o fim de hoje se você ganhou ontem e ainda não jogou hoje. */
  function dailyStreak() {
    const days = new Set(read('days', []));
    const today = dateKey();
    let k = days.has(today) ? today : prevKey(today);
    let current = 0;
    while (days.has(k)) { current++; k = prevKey(k); }
    const sorted = [...days].sort();
    let best = 0, run = 0, last = null;
    for (const d of sorted) { run = last && prevKey(d) === last ? run + 1 : 1; best = Math.max(best, run); last = d; }
    const week = [];
    for (let i = 6, d = today; i >= 0; i--) { week.unshift({ key: d, won: days.has(d) }); d = prevKey(d); }
    return { current, best, wonToday: days.has(today), week };
  }

  /* modo infinito: estatísticas próprias */
  const loadInf = () => read('inf:stats', { streak: 0, best: 0, played: 0, wins: 0 });

  /* =========================================================
   * Imagens
   * Ícones, habilidades e splash padrão ficam no projeto (funcionam offline).
   * As skins vêm do Data Dragon da Riot quando há internet; sem acesso, usa a splash padrão.
   * ======================================================= */
  const iconUrl = (id) => (typeof CHAMPION_ICONS !== 'undefined' && CHAMPION_ICONS[id]) || `img/champion/${id}.jpg`;
  const localSplash = (id) => `splash/${id}.jpg`;
  const titleOf = (id) => (typeof CHAMPION_TITLES !== 'undefined' && CHAMPION_TITLES[id]) || '';
  const DD = 'https://ddragon.leagueoflegends.com';

  /* habilidades: cada spells/<id>.js chama RUNEDLE_SPELLS({...}) */
  const SPELLS = {};
  window.RUNEDLE_SPELLS = (data) => { SPELLS[data.id] = { status: 'ready', data }; render(); };

  function getSpells(id) {
    if (SPELLS[id]) return SPELLS[id];
    SPELLS[id] = { status: 'loading' };
    const tag = document.createElement('script');
    tag.src = `spells/${id}.js`;
    tag.onerror = () => { SPELLS[id] = { status: 'error' }; tag.remove(); render(); };
    document.body.appendChild(tag);
    return SPELLS[id];
  }

  /* ícones atuais das habilidades (arquivos do cliente, via CommunityDragon). status: loading | online | offline */
  const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';
  const CD_ICONS = {};

  function getCDIcons(id) {
    if (CD_ICONS[id]) return CD_ICONS[id];
    const key = typeof CHAMPION_KEYS !== 'undefined' && CHAMPION_KEYS[id];
    if (!key) return (CD_ICONS[id] = { status: 'offline' });
    CD_ICONS[id] = { status: 'loading' };
    fetchJSON(`${CD}/v1/champions/${key}.json`)
      .then((json) => {
        const icons = {};
        for (const sp of json.spells || []) {
          const k = String(sp.spellKey || '').toUpperCase();
          if (sp.abilityIconPath && 'QWER'.includes(k) && k) icons[k] = `${CD}/${sp.abilityIconPath.replace('/lol-game-data/assets/', '').toLowerCase()}`;
        }
        CD_ICONS[id] = Object.keys(icons).length === 4 ? { status: 'online', icons } : { status: 'offline' };
      })
      .catch(() => { CD_ICONS[id] = { status: 'offline' }; })
      .finally(() => render());
    return CD_ICONS[id];
  }

  /* skins (Data Dragon). status: loading | online | offline */
  const SKINS = {};
  let ddVersion = null;

  async function fetchJSON(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(String(res.status));
      return await res.json();
    } finally { clearTimeout(t); }
  }

  function getSkins(id) {
    if (SKINS[id]) return SKINS[id];
    SKINS[id] = { status: 'loading', skins: [{ num: 0, name: 'default' }] };
    (async () => {
      try {
        if (!ddVersion) ddVersion = (await fetchJSON(`${DD}/api/versions.json`))[0];
        const json = await fetchJSON(`${DD}/cdn/${ddVersion}/data/pt_BR/champion/${id}.json`);
        const skins = json.data[id].skins.map((s) => ({ num: s.num, name: s.name }));
        SKINS[id] = { status: 'online', skins };
      } catch {
        SKINS[id] = { status: 'offline', skins: [{ num: 0, name: 'default' }] };
      }
      render();
    })();
    return SKINS[id];
  }

  function splashInfo(id, seedKey) {
    const st = getSkins(id);
    const skin = st.skins[Math.floor(rng(`splash-skin:${seedKey}`)() * st.skins.length)];
    const src = st.status === 'online' ? `${DD}/cdn/img/champion/splash/${id}_${skin.num}.jpg` : localSplash(id);
    return { st, skin, src };
  }

  const skinLabel = (name) => (name === 'default' ? 'Skin padrão' : name);

  function champIcon(id, size, extra = '') {
    const name = BY_ID[id] ? BY_ID[id].name : id;
    return `<img class="champ-icon ${extra}" src="${esc(iconUrl(id))}" alt="${esc(name)}" width="${size}" height="${size}" style="width:${size}px;height:${size}px" loading="lazy" data-fallback="${esc(name.slice(0, 2))}">`;
  }

  /* ícone quebrado vira um quadrado com as iniciais */
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.fallback && !img.dataset.failed) {
      img.dataset.failed = '1';
      const span = document.createElement('span');
      span.className = img.className + ' champ-fallback';
      span.style.cssText = img.style.cssText;
      span.textContent = img.dataset.fallback;
      img.replaceWith(span);
    }
  }, true);

  /* =========================================================
   * Ícones SVG
   * ======================================================= */
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    stats: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
    home: svg('<path d="M3 11 12 4l9 7M5 10v10h14V10"/>'),
    share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    fire: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c1 3.5-1.5 5-1.5 8 0 1.4 1 2.5 2.3 2.5 1.5 0 2.4-1.2 2.2-3 2.4 1.7 4 4.3 4 7.1C19 20.3 15.9 23 12 23s-7-2.7-7-6.4C5 11.2 10.4 8.6 12 2Z"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0ac8b9" d="M12 2 15 9l7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>',
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
    up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    left: svg('<path d="M15 6l-6 6 6 6"/>'),
    right: svg('<path d="M9 6l6 6-6 6"/>'),
    skip: svg('<path d="M5 5l9 7-9 7zM18 5v14"/>'),
    calendar: svg('<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    infinite: svg('<path d="M7.5 8.5C5.6 8.5 4 10.1 4 12s1.6 3.5 3.5 3.5C10.5 15.5 13.5 8.5 16.5 8.5 18.4 8.5 20 10.1 20 12s-1.6 3.5-3.5 3.5C13.5 15.5 10.5 8.5 7.5 8.5Z"/>'),
    dice: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01"/>'),
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    classic: svg('<path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M12 22V12M21 7l-9 5-9-5"/>'),
    quote: svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M9 9h.01M12 9h.01M15 9h.01"/>'),
    ability: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    emoji: svg('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'),
    splash: svg('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>'),
  };

  const spinner = (label = 'Carregando…') => `<div class="loading" role="status"><div class="spinner"></div>${label ? `<span>${esc(label)}</span>` : ''}</div>`;
  const errorBox = (msg, retryId) => `<div class="frame error-box"><p>${esc(msg)}</p>${
    retryId ? `<button class="btn" data-action="retry-spells" data-id="${esc(retryId)}">Tentar de novo</button>` : ''}</div>`;

  /* =========================================================
   * Comparação do modo Classic
   * ======================================================= */
  const COLUMNS = [
    ['gender', 'Gênero'], ['positions', 'Posição'], ['species', 'Espécie'], ['resource', 'Recurso'],
    ['range', 'Alcance'], ['regions', 'Região'], ['year', 'Lançamento'],
  ];
  const MATCH_EMOJI = { correct: '🟩', partial: '🟨', wrong: '🟥' };

  function compareLists(a, b) {
    if (a.length === b.length && a.every((x) => b.includes(x))) return 'correct';
    return a.some((x) => b.includes(x)) ? 'partial' : 'wrong';
  }

  function compare(guess, target) {
    const list = (k) => ({ match: compareLists(guess[k], target[k]), text: guess[k].join(', ') });
    return {
      gender: { match: guess.gender === target.gender ? 'correct' : 'wrong', text: guess.gender },
      positions: list('positions'),
      species: list('species'),
      resource: { match: guess.resource === target.resource ? 'correct' : 'wrong', text: guess.resource },
      range: list('range'),
      regions: list('regions'),
      year: {
        match: guess.year === target.year ? 'correct' : 'wrong',
        text: String(guess.year),
        arrow: guess.year === target.year ? null : guess.year < target.year ? 'up' : 'down',
      },
    };
  }

  /* =========================================================
   * Modos de jogo
   * Cada modo usa g.dateKey como semente: no diário é a data; no infinito, um id aleatório.
   * ======================================================= */
  const QUOTE_POOL = CHAMPIONS.filter((c) => QUOTES[c.id] && QUOTES[c.id].length);
  const KEYS = ['Q', 'W', 'E', 'R'];
  const prefs = {
    gray: read('pref:ability-gray', false),
    rotate: read('pref:ability-rotate', false),
    splashGray: read('pref:splash-gray', true),
  };
  const loadedImgs = new Set();

  const MODES = [
    {
      id: 'classic', name: 'Classic', desc: 'Pistas a cada tentativa', pool: CHAMPIONS,
      heading: 'Adivinhe o campeão',
      clue: () => `
        <p style="margin:0;color:var(--gold-200)">Digite qualquer campeão. As cores mostram o quanto cada característica se aproxima do campeão secreto.</p>
        <div class="legend">
          <span><i class="bg-ok"></i>Correto</span><span><i class="bg-part"></i>Parcial</span><span><i class="bg-bad"></i>Incorreto</span>
          <span>${ICON.up}mais recente</span><span>${ICON.down}mais antigo</span>
        </div>`,
      hints: (t) => [
        { label: 'Título', at: 5, html: `<p style="margin:0;text-transform:capitalize">“${esc(titleOf(t.id))}”</p>` },
        { label: 'Emojis', at: 9, html: `<p style="margin:0;font-size:30px;letter-spacing:.15em">${esc(t.emojis.slice(0, 3).join(' '))}</p>` },
      ],
      guesses: (g, t) => classicTable(g, t),
      shareGrid: (g, t) => g.guesses.slice(0, 8).map((id) => {
        const r = compare(BY_ID[id], t);
        return COLUMNS.map(([k]) => MATCH_EMOJI[r[k].match]).join('');
      }).join('\n') + (g.guesses.length > 8 ? `\n+${g.guesses.length - 8} tentativas` : ''),
    },
    {
      id: 'quote', name: 'Quote', desc: 'Adivinhe pela fala', pool: QUOTE_POOL,
      heading: 'Qual campeão diz',
      clue: (g, t) => {
        const lines = QUOTES[t.id];
        const line = lines[Math.floor(rng(`quote-line:${g.dateKey}`)() * lines.length)];
        return `<blockquote class="quote"><p>${esc(line)}</p></blockquote>`;
      },
      hints: (t) => [
        { label: 'Região', at: 4, html: `<p style="margin:0">${esc(t.regions.join(' · '))}</p>` },
        { label: 'Posição', at: 7, html: `<p style="margin:0">${esc(t.positions.join(' · '))}</p>` },
      ],
    },
    {
      id: 'ability', name: 'Ability', desc: 'Adivinhe pela habilidade', pool: CHAMPIONS,
      heading: 'De qual campeão é esta habilidade?',
      clue: (g, t) => {
        const d = getSpells(t.id);
        const cd = getCDIcons(t.id);
        if (d.status === 'loading' || cd.status === 'loading') return spinner('Carregando habilidade…');
        if (d.status === 'error') return errorBox('Não foi possível carregar a habilidade.', t.id);
        const { keyIdx, rotation } = abilitySeed(g.dateKey);
        const spell = d.data.spells[keyIdx];
        const done = g.status !== 'playing';
        // a tecla só aparece depois do bônus (ou se a pessoa desistiu, quando não há bônus)
        const bonusPending = g.status === 'won' && !(g.bonus && g.bonus.answered);
        const style = done ? '' : `transform:${prefs.rotate ? `rotate(${rotation}deg)` : 'none'};filter:${prefs.gray ? 'grayscale(1)' : 'none'}`;
        let footer;
        if (!done) {
          footer = `<div class="toggles">
              <label><input type="checkbox" data-pref="gray" ${prefs.gray ? 'checked' : ''}>Preto e branco</label>
              <label><input type="checkbox" data-pref="rotate" ${prefs.rotate ? 'checked' : ''}>Girar ícone</label>
            </div>`;
        } else if (bonusPending) {
          footer = '<p class="muted" style="margin:12px 0 0">Responda o bônus abaixo para ver qual é a habilidade.</p>';
        } else {
          footer = `<p style="margin:12px 0 0"><b class="title" style="font-size:18px;margin-right:8px">${KEYS[keyIdx]}</b>${esc(spell.name)}</p>`;
        }
        const src = cd.status === 'online' ? cd.icons[KEYS[keyIdx]] : spell.img;
        return `<div class="ability-frame"><img src="${esc(src)}" alt="Ícone da habilidade" style="${style}" data-ability data-champ="${esc(t.id)}"></div>${footer}`;
      },
      hints: (t) => [{ label: 'Posição', at: 5, html: `<p style="margin:0">${esc(t.positions.join(' · '))}</p>` }],
      bonus: (g, t) => {
        const d = SPELLS[t.id];
        if (g.status !== 'won' || !d || d.status !== 'ready') return '';
        const { keyIdx } = abilitySeed(g.dateKey);
        const answered = g.bonus && g.bonus.answered;
        const btns = KEYS.map((k, i) => {
          const cls = !answered ? '' : i === keyIdx ? 'right' : g.bonus.choice === k ? 'wrong' : 'dim';
          return `<button class="btn ${cls}" ${answered ? 'disabled' : ''} data-action="bonus" data-choice="${k}" data-correct="${i === keyIdx}">${k}</button>`;
        }).join('');
        return `<div class="bonus"><p>Bônus: qual é a tecla desta habilidade?</p><div class="opts">${btns}</div>${
          answered ? `<p style="margin:8px 0 0">${g.bonus.correct ? 'Acertou o bônus!' : `Era ${KEYS[keyIdx]}.`}</p>` : ''}</div>`;
      },
    },
    {
      id: 'emoji', name: 'Emoji', desc: 'Adivinhe pelos emojis', pool: CHAMPIONS,
      heading: 'Qual campeão estes emojis representam?',
      clue: (g, t) => {
        const shown = g.status !== 'playing' ? t.emojis.length : Math.min(t.emojis.length, g.guesses.length + 1);
        const boxes = t.emojis.map((e, i) => `<span class="${i < shown ? 'on pop' : ''}">${i < shown ? esc(e) : '?'}</span>`).join('');
        return `<div class="emojis">${boxes}</div>${
          g.status === 'playing' && shown < t.emojis.length ? '<p class="muted small" style="margin:12px 0 0">Cada erro revela mais um emoji.</p>' : ''}`;
      },
      hints: (t) => [{ label: 'Região', at: 6, html: `<p style="margin:0">${esc(t.regions.join(' · '))}</p>` }],
    },
    {
      id: 'splash', name: 'Splash', desc: 'Adivinhe pela splash art', pool: CHAMPIONS,
      heading: 'De qual campeão é esta splash art?',
      clue: (g, t) => {
        const { st, skin, src } = splashInfo(t.id, g.dateKey);
        if (st.status === 'loading') return spinner('Carregando splash art…');
        const r = rng(`splash:${g.dateKey}`);
        const ox = 25 + r() * 50;
        const oy = 20 + r() * 45;
        const done = g.status !== 'playing';
        const zoom = done ? 1 : Math.max(1.4, 6 - g.guesses.length * 0.55);
        const gray = !done && prefs.splashGray;
        const loaded = loadedImgs.has(src);
        const bonusPending = g.status === 'won' && skinBonusAvailable(st) && !(g.bonus && g.bonus.answered);
        let footer;
        if (!done) {
          footer = `<div class="toggles">
              <label><input type="checkbox" data-pref="splashGray" ${prefs.splashGray ? 'checked' : ''}>Preto e branco</label>
            </div>
            <p class="muted small" style="margin:4px 0 0">Cada erro afasta o zoom e revela mais da imagem.</p>`;
        } else if (bonusPending) {
          footer = '<p class="muted" style="margin:12px 0 0">Responda o bônus abaixo para ver o nome da skin.</p>';
        } else {
          footer = `<p style="margin:12px 0 0">Skin: <b>${esc(skinLabel(skin.name))}</b></p>`;
        }
        return `
          <div class="splash">
            ${loaded ? '' : '<div class="spinner"></div>'}
            <img src="${esc(src)}" alt="Trecho da splash art" draggable="false" class="${loaded ? 'loaded' : ''}" data-splash data-champ="${esc(t.id)}"
              style="transform:scale(${zoom});transform-origin:${ox}% ${oy}%;filter:${gray ? 'grayscale(1)' : 'none'}">
          </div>${footer}`;
      },
      hints: (t) => [{ label: 'Região', at: 5, html: `<p style="margin:0">${esc(t.regions.join(' · '))}</p>` }],
      bonus: (g, t) => {
        const st = SKINS[t.id];
        if (g.status !== 'won' || !skinBonusAvailable(st)) return '';
        const { skin } = splashInfo(t.id, g.dateKey);
        const rr = rng(`splash-opt:${g.dateKey}`);
        const others = st.skins.filter((s) => s.num !== skin.num).sort(() => rr() - 0.5).slice(0, 3);
        const options = [...others, skin].sort(() => rr() - 0.5);
        const answered = g.bonus && g.bonus.answered;
        const btns = options.map((o) => {
          const cls = !answered ? '' : o.num === skin.num ? 'right' : g.bonus.choice === String(o.num) ? 'wrong' : 'dim';
          return `<button class="btn ${cls}" style="font-size:12px" ${answered ? 'disabled' : ''} data-action="bonus" data-choice="${o.num}" data-correct="${o.num === skin.num}">${esc(skinLabel(o.name))}</button>`;
        }).join('');
        return `<div class="bonus"><p>Bônus: qual é a skin?</p><div class="opts">${btns}</div></div>`;
      },
    },
  ];
  const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));

  const skinBonusAvailable = (st) => !!st && st.status === 'online' && st.skins.length >= 2;

  function abilitySeed(key) {
    const r = rng(`ability:${key}`);
    return { keyIdx: Math.floor(r() * 4), rotation: [0, 90, 180, 270][Math.floor(r() * 4)] };
  }

  function classicTable(g, t) {
    if (!g.guesses.length) return '';
    const head = `<div class="crow chead"><div>Campeão</div>${COLUMNS.map(([, l]) => `<div>${l}</div>`).join('')}</div>`;
    const rows = g.guesses.map((id, i) => ({ id, i })).reverse().map(({ id, i }) => {
      const c = BY_ID[id];
      const res = compare(c, t);
      const fresh = i === view.animateIdx;
      const cells = COLUMNS.map(([k], ci) => {
        const r = res[k];
        const arrow = r.arrow ? `<span class="arrow">${r.arrow === 'up' ? ICON.up : ICON.down}</span>` : '';
        return `<div class="cell ${r.match} ${fresh ? 'flip' : ''}" style="${fresh ? `animation-delay:${0.15 + ci * 0.22}s` : ''}">${arrow}<span>${esc(r.text)}</span></div>`;
      }).join('');
      return `<div class="crow"><div class="cell champ ${fresh ? 'pop' : ''}" title="${esc(c.name)}">${champIcon(id, 84)}<span class="name">${esc(c.name)}</span></div>${cells}</div>`;
    }).join('');
    return `<p class="swipe-hint">Deslize a tabela para o lado →</p><div class="table-wrap"><div class="ctable">${head}${rows}</div></div>`;
  }

  function simpleGuessList(g, t) {
    if (!g.guesses.length) return '';
    return `<ul class="guess-list">${g.guesses.map((id, i) => ({ id, i })).reverse().map(({ id, i }) => `
      <li class="${id === t.id ? 'right' : 'wrong'} ${i === view.animateIdx ? 'flip' : ''}">
        ${champIcon(id, 44)}<b>${esc(BY_ID[id].name)}</b><small>#${i + 1}</small>
      </li>`).join('')}</ul>`;
  }

  /* =========================================================
   * Sessões: diário, dia do calendário e infinito
   * Todas expõem a mesma interface para a tela de jogo.
   * ======================================================= */
  function dailySession(mode, key) {
    const m = MODE_BY_ID[mode];
    return {
      kind: key === currentKey ? 'daily' : 'archive',
      mode: m,
      key,
      target: pickDaily(m.pool, mode, key),
      game: () => loadGame(mode, key),
      save: (g) => saveGame(mode, g),
      finish(g, won) {
        if (this.kind === 'daily') {
          recordResult(mode, key, this.target.id, won, g.guesses.length);
        } else {
          g.late = true; // jogado depois do dia: não conta para estatísticas nem sequência
          addHistory({ dateKey: key, mode, championId: this.target.id, attempts: g.guesses.length, won, late: true });
        }
      },
    };
  }

  const INF_MODES = ['classic', 'quote', 'ability', 'emoji', 'splash'];

  function newInfiniteRound(prevTargetId) {
    const choice = read('inf:mode', 'random');
    const mode = choice === 'random' ? INF_MODES[Math.floor(Math.random() * INF_MODES.length)] : choice;
    const pool = MODE_BY_ID[mode].pool.filter((c) => c.id !== prevTargetId);
    const target = pool[Math.floor(Math.random() * pool.length)];
    const round = { mode, targetId: target.id, dateKey: `inf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, guesses: [], status: 'playing' };
    write('inf:round', round);
    return round;
  }

  function infiniteSession() {
    let round = read('inf:round', null);
    if (!round || !MODE_BY_ID[round.mode] || !BY_ID[round.targetId]) round = newInfiniteRound();
    return {
      kind: 'infinite',
      mode: MODE_BY_ID[round.mode],
      key: round.dateKey,
      target: BY_ID[round.targetId],
      game: () => read('inf:round', round),
      save: (g) => write('inf:round', g),
      finish(g, won) {
        const s = loadInf();
        s.played++;
        if (won) { s.wins++; s.streak++; s.best = Math.max(s.best, s.streak); } else { s.streak = 0; }
        write('inf:stats', s);
      },
    };
  }

  /* =========================================================
   * Rotas
   * #classic … #splash → desafio de hoje · #infinito · #calendario · #dia-AAAA-MM-DD-modo
   * ======================================================= */
  let currentKey = dateKey();
  let route = parseRoute();
  let view = { openHint: null, animateIdx: -1 };
  let calMonth = currentKey.slice(0, 7);

  function parseRoute() {
    const h = location.hash.replace('#', '');
    if (MODE_BY_ID[h]) return { name: 'mode', mode: h, key: currentKey };
    if (h === 'infinito') return { name: 'infinite' };
    if (h === 'x1' || /^x1-[A-Za-z0-9]{4,6}$/.test(h)) return { name: 'x1', room: h.length > 2 ? h.slice(3).toUpperCase() : null };
    if (h === 'calendario') return { name: 'calendar' };
    const m = /^dia-(\d{4}-\d{2}-\d{2})-(\w+)$/.exec(h);
    if (m && isValidKey(m[1]) && MODE_BY_ID[m[2]] && m[1] >= CAL_START && m[1] <= currentKey) return { name: 'mode', mode: m[2], key: m[1] };
    return { name: 'mode', mode: 'classic', key: currentKey }; // entrada: direto no Classic
  }

  const dayHash = (key, mode) => (key === currentKey ? `#${mode}` : `#dia-${key}-${mode}`);

  function currentSession() {
    if (route.name === 'infinite') return infiniteSession();
    if (route.name === 'mode') return dailySession(route.mode, route.key);
    return null;
  }

  /* =========================================================
   * Renderização
   * ======================================================= */
  const app = $('#app');
  const views = {}; // telas extras registradas por outros scripts (ex.: X1)

  function render() {
    renderShell();
    let html;
    if (route.name === 'calendar') html = calendarHTML();
    else if (route.name === 'x1') html = views.x1 ? views.x1.html(route) : '<div class="frame notice">Carregando o X1…</div>';
    else html = sessionHTML(currentSession());
    app.innerHTML = html;
    app.classList.toggle('enter', !!view.enter);
    view.enter = false;
    if (route.name === 'calendar') bindCalendar();
    else if (route.name === 'x1') { if (views.x1) views.x1.bind(route); }
    else bindSession(currentSession());
    view.animateIdx = -1; // só a tentativa recém-feita anima
  }

  /* fundo do palco: arte desfocada que nunca é a resposta de nenhum modo do dia */
  function stageBackground() {
    const banned = new Set(MODES.map((m) => pickDaily(m.pool, m.id, currentKey).id));
    let key = currentKey;
    if (route.name === 'infinite') { const r = read('inf:round', null); if (r) { banned.add(r.targetId); key = r.dateKey; } }
    if (route.name === 'mode' && route.key !== currentKey) { MODES.forEach((m) => banned.add(pickDaily(m.pool, m.id, route.key).id)); key = route.key; }
    const pool = CHAMPIONS.filter((c) => !banned.has(c.id));
    return pool[hash(`bg:${key}`) % pool.length].id;
  }

  function renderShell() {
    const st = dailyStreak();
    const wins = MODES.reduce((n, m) => n + loadStats(m.id).wins, 0) + loadInf().wins;
    const dailyActive = route.name === 'mode' || route.name === 'calendar';

    // abas do topo
    const tabs = [
      ['#classic', 'DIÁRIO', dailyActive],
      ['#infinito', 'INFINITO', route.name === 'infinite'],
      ['#x1', 'X1', route.name === 'x1'],
    ];
    const live = views.x1 && views.x1.inRoom && views.x1.inRoom();
    $('#top-tabs').innerHTML = tabs.map(([href, label, on]) =>
      `<a href="${href}" class="top-tab ${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''}>${label}${label === 'X1' && live ? '<i class="live"></i>' : ''}</a>`).join('');

    // carteira
    $('#wallet').innerHTML = `
      <div title="Sequência diária">${ICON.fire.replace('<svg', '<svg style="color:#ffb347"')}<span>${st.current}</span><small>${st.current === 1 ? 'dia seguido' : 'dias seguidos'}</small></div>
      <div title="Vitórias somando todos os modos">${ICON.star}<span>${wins}</span><small>vitórias</small></div>`;

    // banner e modos do dia
    const done = MODES.filter((m) => loadGame(m.id, currentKey).status !== 'playing').length;
    $('#side-banner').innerHTML = `<img src="${esc(localSplash(stageBackground()))}" alt=""><div><small>${done}/5 CONCLUÍDOS</small><b>DESAFIO #${dayNumber(currentKey)}</b></div>`;
    const activeMode = route.name === 'mode' && route.key === currentKey ? route.mode : null;
    $('#side-modes').innerHTML = MODES.map((m) => {
      const g = loadGame(m.id, currentKey);
      const [cls, txt] = g.status === 'won' ? ['st-won', 'Concluído']
        : g.status === 'lost' ? ['st-lost', 'Derrota']
        : g.guesses.length ? ['st-play', `Jogando · ${plural(g.guesses.length, 'tentativa')}`] : ['st-new', 'Novo'];
      const on = m.id === activeMode;
      return `<a href="#${m.id}" class="side-mode ${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''}>
        <span class="thumb">${ICON[m.id]}</span>
        <span class="txt"><b>${m.name.toUpperCase()}</b><small class="${cls}">${txt}</small></span></a>`;
    }).join('');

    // no celular, a faixa de modos rola até o modo aberto
    const activeEl = $('#side-modes .side-mode.on');
    if (activeEl && matchMedia('(max-width: 860px)').matches) {
      const strip = $('#side-modes');
      strip.scrollLeft = activeEl.offsetLeft - (strip.clientWidth - activeEl.clientWidth) / 2;
    }

    // fundo do palco (troca suave)
    const bg = $('#stage-bg-img');
    const src = localSplash(stageBackground());
    if (bg.getAttribute('src') !== src) {
      bg.classList.remove('on');
      bg.onload = () => bg.classList.add('on');
      bg.setAttribute('src', src);
      if (bg.complete && bg.naturalWidth) bg.classList.add('on');
    }

    renderSocial(st, wins);
  }

  /* coluna da direita: perfil, sequência, progresso do dia e X1 */
  function renderSocial(st, wins) {
    const open = read('pref:groups', { streak: true, today: true, x1: true });
    const names = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const week = st.week.map((d) => {
      const wd = names[new Date(d.key + 'T12:00:00Z').getUTCDay()];
      return `<span class="day ${d.won ? 'won' : ''} ${d.key === currentKey ? 'now' : ''}"><i>${d.won ? ICON.fire : ''}</i><small>${wd}</small></span>`;
    }).join('');
    const today = MODES.map((m) => {
      const g = loadGame(m.id, currentKey);
      const [cls, txt] = g.status === 'won' ? ['st-won', plural(g.guesses.length, 'tentativa')] : g.status === 'lost' ? ['st-lost', 'desistiu'] : ['st-new', g.guesses.length ? 'em andamento' : 'novo'];
      return `<a href="#${m.id}" class="mini-row">${ICON[m.id]}<span>${m.name}</span><small class="${cls}">${txt}</small></a>`;
    }).join('');
    const x1Body = views.x1 && views.x1.socialHTML ? views.x1.socialHTML() : '<a href="#x1" class="btn btn-hex" style="width:100%">CRIAR OU ENTRAR</a>';
    const group = (id, label, body) => `
      <div>
        <button class="group-btn" type="button" data-group="${id}" aria-expanded="${!!open[id]}"><span class="arrow">▸</span>${label}</button>
        ${open[id] ? `<div class="group-body">${body}</div>` : ''}
      </div>`;
    const avatarId = MODES.map((m) => pickDaily(m.pool, m.id, prevKey(currentKey)).id)[0];
    $('#social').innerHTML = `
      <div class="profile">
        <span class="avatar">${champIcon(avatarId, 48)}<span class="lvl">${wins}</span></span>
        <span class="who"><b>Invocador</b><small>● Jogando Runedle</small></span>
      </div>
      <div class="social-head"><span>SOCIAL</span></div>
      <div class="social-groups">
        ${group('streak', `SEQUÊNCIA (${st.current})`, `
          <div class="streak-big"><span class="flame ${st.current ? 'on' : ''}">${ICON.fire}</span><div><b>${st.current}</b><small>${st.current === 1 ? 'dia seguido' : 'dias seguidos'} · recorde ${st.best}</small></div></div>
          <div class="week">${week}</div>
          <small class="muted" style="font-size:12px">${st.wonToday ? 'Desafio de hoje concluído. Volte às 21h!' : 'Vença um desafio hoje para manter a sequência.'}</small>`)}
        ${group('today', `DESAFIO DE HOJE (${MODES.filter((m) => loadGame(m.id, currentKey).status === 'won').length}/5)`, today)}
        ${group('x1', 'X1 AO VIVO', x1Body)}
      </div>
      <div class="social-foot"><span>Novo desafio em</span><b data-countdown style="margin-left:auto;font-variant-numeric:tabular-nums;color:var(--gold-100)">${formatCountdown(msUntilReset())}</b></div>`;
    $('#social').querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => {
      const cur = read('pref:groups', { streak: true, today: true, x1: true });
      cur[b.dataset.group] = !cur[b.dataset.group];
      write('pref:groups', cur);
      renderSocial(dailyStreak(), wins);
    }));
  }

  /* barra acima da pista: dia do calendário ou painel do modo infinito */
  function sessionTopHTML(s) {
    if (s.kind === 'archive') {
      const chips = MODES.map((m) => {
        const st = loadGame(m.id, s.key).status;
        return `<a href="${dayHash(s.key, m.id)}" class="chip ${m.id === s.mode.id ? 'on' : ''}" title="${m.name}">${ICON[m.id]}<span class="lbl">${m.name}</span>${
          st !== 'playing' ? `<span class="dot ${st}"></span>` : ''}</a>`;
      }).join('');
      return `
        <section class="frame top-panel">
          <div class="top-row">
            <a href="#calendario" class="btn-link">${ICON.left} Calendário</a>
            <b>Desafio de ${fmtDate(s.key)} <span class="muted">· #${dayNumber(s.key)}</span></b>
          </div>
          <div class="chips">${chips}</div>
          <p class="muted small" style="margin:0">Jogando depois do dia: não conta para a sequência nem para as estatísticas.</p>
        </section>`;
    }
    if (s.kind === 'infinite') {
      const inf = loadInf();
      const choice = read('inf:mode', 'random');
      const opts = [['random', 'Aleatório', ICON.dice], ...MODES.map((m) => [m.id, m.name, ICON[m.id]])];
      const chips = opts.map(([id, name, ic]) => `<button class="chip ${choice === id ? 'on' : ''}" data-action="inf-mode" data-mode="${id}" title="${name}">${ic}<span class="lbl">${name}</span></button>`).join('');
      return `
        <section class="frame top-panel">
          <div class="top-row">
            <b class="title" style="font-size:18px">${ICON.infinite.replace('<svg', '<svg width="22" height="22" style="vertical-align:-5px;margin-right:6px"')}Modo infinito</b>
            <span class="inf-stats"><span class="streak-num">${ICON.fire}${inf.streak}</span><small>seguidas</small><span class="sep"></span><small>Recorde</small><b>${inf.best}</b></span>
          </div>
          <div class="chips">${chips}</div>
          <p class="muted small" style="margin:0">Rodada atual: <b style="color:var(--gold-100)">${s.mode.name}</b>. A escolha vale a partir da próxima rodada.</p>
        </section>`;
    }
    return '';
  }

  function hintsHTML(s, g) {
    const hints = s.mode.hints ? s.mode.hints(s.target) : [];
    if (!hints.length || g.status !== 'playing') return '';
    const n = g.guesses.length;
    const btns = hints.map((h, i) => {
      const left = h.at - n;
      const unlocked = left <= 0;
      const open = view.openHint === i;
      return `<button class="hint-btn ${unlocked ? 'unlocked' : ''} ${open ? 'open' : ''}" ${unlocked ? `data-action="hint" data-i="${i}"` : 'disabled'}>
        <b>${h.label}</b>
        <small>${unlocked ? (open ? 'ocultar' : 'ver dica') : `em ${plural(left, 'tentativa')}`}</small>
        ${unlocked ? '' : `<span class="bar"><i style="width:${Math.min(100, (n / h.at) * 100)}%"></i></span>`}
      </button>`;
    }).join('');
    const body = view.openHint !== null && hints[view.openHint] && hints[view.openHint].at <= n
      ? `<div class="frame hint-body">${hints[view.openHint].html}</div>` : '';
    return `<div class="hints">${btns}</div>${body}`;
  }

  function resultHTML(s, g) {
    const won = g.status === 'won';
    const t = s.target;
    const title = titleOf(t.id);
    let actions, extra = '';
    if (s.kind === 'infinite') {
      const inf = loadInf();
      extra = `<p class="streak-line">${ICON.fire}${won ? `Sequência no infinito: <b>${inf.streak}</b>` : 'Sequência zerada'}<span class="muted" style="margin-left:6px">· recorde ${inf.best}</span></p>`;
      actions = `<button class="btn btn-gold" data-action="next-round" id="next-round">Próxima rodada →</button>`;
    } else {
      const idx = MODES.indexOf(s.mode);
      const next = MODES[(idx + 1) % MODES.length];
      if (s.kind === 'daily' && won) extra = `<p class="streak-line">${ICON.fire}Sequência diária: <b>${plural(dailyStreak().current, 'dia')}</b></p>`;
      actions = `<button class="btn" data-action="share">${ICON.share.replace('<svg', '<svg width="20" height="20"')} Compartilhar</button>
        <a class="btn btn-gold" href="${dayHash(s.key, next.id)}">Próximo: ${next.name} →</a>`;
    }
    const footer = s.kind === 'daily'
      ? `<div class="countdown"><div class="label">Próximo campeão em</div><div class="time" data-countdown>${formatCountdown(msUntilReset())}</div></div>`
      : s.kind === 'archive' ? '<a href="#calendario" class="btn-link">Voltar ao calendário</a>' : '';
    const giveUpText = s.kind === 'infinite' ? `Você pulou após ${plural(g.guesses.length, 'tentativa')}.` : `Você desistiu após ${plural(g.guesses.length, 'tentativa')}.`;
    return `
      <section class="frame result ${won ? 'won' : 'lost'}" aria-live="polite">
        <h2>${won ? 'Vitória!' : s.kind === 'infinite' ? 'Rodada pulada' : 'Derrota'}</h2>
        <div class="who">
          ${champIcon(t.id, 80)}
          <div><span class="muted">${won ? 'Você adivinhou' : 'O campeão era'}</span><strong>${esc(t.name)}</strong>${title ? `<em>${esc(title)}</em>` : ''}</div>
        </div>
        <p style="margin:0;color:var(--gold-200)">${won ? `Tentativas: ${g.guesses.length}` : giveUpText}</p>
        ${extra}
        ${s.mode.bonus ? s.mode.bonus(g, t) : ''}
        <div class="divider"></div>
        <div class="actions">${actions}</div>
        <p class="toast" id="toast"></p>
        ${footer}
      </section>`;
  }

  function sessionHTML(s) {
    const g = s.game();
    const playing = g.status === 'playing';
    const heading = s.kind === 'daily' && s.mode.id === 'classic' ? 'Adivinhe o campeão de hoje' : s.mode.heading;
    const giveUpLabel = s.kind === 'infinite' ? `${ICON.skip} Pular (zera a sequência)` : `${ICON.flag} Desistir`;
    const kicker = s.kind === 'infinite' ? '' : `
      <div class="kicker"><b>MODO ${s.mode.name.toUpperCase()}${s.kind === 'archive' ? ` · ${fmtDate(s.key)}` : ` · DESAFIO #${dayNumber(s.key)}`}</b>
        ${s.kind === 'daily' ? `<span class="pill">${ICON.clock}<span data-countdown>${formatCountdown(msUntilReset())}</span></span>` : ''}</div>`;
    return `
      ${sessionTopHTML(s)}
      ${kicker}
      <section class="frame clue">
        <h1 class="title">${heading}</h1>
        ${s.mode.clue(g, s.target)}
        <p class="attempts">Tentativas: <b>${g.guesses.length}</b></p>
      </section>
      ${hintsHTML(s, g)}
      ${playing ? `
        <div class="search" id="search">
          <form autocomplete="off">
            <input type="text" id="guess-input" placeholder="Digite o nome de um campeão…" spellcheck="false"
              role="combobox" aria-expanded="false" aria-controls="suggestions" aria-autocomplete="list">
            <button type="submit" class="btn btn-gold" aria-label="Enviar tentativa">${ICON.send}</button>
          </form>
          <ul class="frame suggestions" id="suggestions" role="listbox" hidden></ul>
        </div>
        ${g.guesses.length || s.kind === 'infinite' ? `<div class="giveup"><button class="btn-link" data-action="giveup">${giveUpLabel}</button></div>` : ''}
      ` : resultHTML(s, g)}
      ${s.mode.guesses ? s.mode.guesses(g, s.target) : simpleGuessList(g, s.target)}`;
  }

  /* ---------- calendário ---------- */
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function dayStatus(key) {
    let onTime = 0, late = 0, lost = 0;
    for (const m of MODES) {
      const g = loadGame(m.id, key);
      if (g.status === 'won') g.late ? late++ : onTime++;
      else if (g.status === 'lost') lost++;
    }
    return { onTime, late, lost };
  }

  function calendarHTML() {
    const [y, mo] = calMonth.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const lead = first.getUTCDay();
    const minMonth = CAL_START.slice(0, 7);
    const maxMonth = currentKey.slice(0, 7);
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="cal-cell empty"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${calMonth}-${String(d).padStart(2, '0')}`;
      const available = key >= CAL_START && key <= currentKey;
      if (!available) { cells += `<span class="cal-cell off"><b>${d}</b></span>`; continue; }
      const st = dayStatus(key);
      const dots = [...Array(st.onTime).fill('won'), ...Array(st.late).fill('late'), ...Array(st.lost).fill('lost')];
      while (dots.length < 5) dots.push('');
      const complete = st.onTime + st.late === 5;
      cells += `<a href="${dayHash(key, 'classic')}" class="cal-cell ${key === currentKey ? 'today' : ''} ${complete ? 'complete' : ''}" aria-label="Desafio de ${fmtDate(key)}">
        <b>${d}</b><span class="dots">${dots.map((c) => `<i class="${c}"></i>`).join('')}</span></a>`;
    }
    return `
      <section class="frame calendar">
        <div class="cal-head">
          <button class="icon-btn" data-action="cal-prev" aria-label="Mês anterior" ${calMonth <= minMonth ? 'disabled' : ''}>${ICON.left}</button>
          <h1 class="title">${MONTHS[mo - 1][0].toUpperCase() + MONTHS[mo - 1].slice(1)} de ${y}</h1>
          <button class="icon-btn" data-action="cal-next" aria-label="Próximo mês" ${calMonth >= maxMonth ? 'disabled' : ''}>${ICON.right}</button>
        </div>
        <div class="cal-grid">
          ${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((w) => `<span class="cal-wd">${w}</span>`).join('')}
          ${cells}
        </div>
        <div class="cal-legend">
          <span><i class="won"></i>Vencido no dia</span><span><i class="late"></i>Vencido depois</span><span><i class="lost"></i>Desistiu</span>
        </div>
        <p class="muted small" style="margin:0">Desafios de dias passados podem ser jogados quando quiser, mas não contam para a sequência diária nem para as estatísticas.</p>
      </section>`;
  }

  function bindCalendar() {
    app.querySelectorAll('[data-action^="cal-"]').forEach((b) => b.addEventListener('click', () => {
      const [y, m] = calMonth.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + (b.dataset.action === 'cal-next' ? 1 : -1), 1));
      calMonth = d.toISOString().slice(0, 7);
      render();
    }));
  }

  /* =========================================================
   * Interação na tela de jogo
   * ======================================================= */
  function bindSession(s) {
    app.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', () => {
        const a = el.dataset.action;
        const g = s.game();
        if (a === 'hint') {
          const i = Number(el.dataset.i);
          view.openHint = view.openHint === i ? null : i;
          render();
        } else if (a === 'giveup') {
          confirmGiveUp(s);
        } else if (a === 'share') {
          share(s, g);
        } else if (a === 'bonus') {
          if (g.bonus && g.bonus.answered) return;
          g.bonus = { answered: true, correct: el.dataset.correct === 'true', choice: el.dataset.choice };
          s.save(g);
          render();
        } else if (a === 'retry-spells') {
          delete SPELLS[el.dataset.id];
          render();
        } else if (a === 'next-round') {
          newInfiniteRound(s.target.id);
          view = { openHint: null, animateIdx: -1 };
          render();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (a === 'inf-mode') {
          write('inf:mode', el.dataset.mode);
          // sem tentativas ainda: já troca a rodada atual
          if (g.status === 'playing' && !g.guesses.length) newInfiniteRound(s.target.id);
          view = { openHint: null, animateIdx: -1 };
          render();
        }
      });
    });

    app.querySelectorAll('[data-pref]').forEach((el) => {
      el.addEventListener('change', () => {
        const name = el.dataset.pref;
        prefs[name] = el.checked;
        write(name === 'splashGray' ? 'pref:splash-gray' : `pref:ability-${name}`, el.checked);
        render();
      });
    });

    const abil = app.querySelector('[data-ability]');
    if (abil) abil.addEventListener('error', () => {
      const id = abil.dataset.champ;
      if (CD_ICONS[id] && CD_ICONS[id].status === 'online') { CD_ICONS[id] = { status: 'offline' }; render(); }
    });

    const splash = app.querySelector('[data-splash]');
    if (splash) {
      const done = () => {
        loadedImgs.add(splash.getAttribute('src'));
        splash.classList.add('loaded');
        const sp = splash.parentElement && splash.parentElement.querySelector('.spinner');
        if (sp) sp.remove();
      };
      if (splash.complete && splash.naturalWidth) done();
      splash.addEventListener('load', done);
      splash.addEventListener('error', () => {
        const id = splash.dataset.champ;
        if (SKINS[id] && SKINS[id].status === 'online') {
          // skin da Riot não carregou: volta para a splash padrão guardada no projeto
          SKINS[id] = { status: 'offline', skins: [{ num: 0, name: 'default' }] };
          render();
        } else if (splash.parentElement) {
          splash.parentElement.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px">${errorBox('A imagem não carregou.')}</div>`;
        }
      });
    }

    bindSearch(s);
  }

  function bindSearch(s) {
    const input = $('#guess-input');
    if (!input) return;
    const list = $('#suggestions');
    const form = input.form;
    let items = [];
    let active = 0;

    const compute = () => {
      const q = normalize(input.value);
      if (!q) return [];
      const used = s.game().guesses;
      const pool = CHAMPIONS.filter((c) => !used.includes(c.id));
      const starts = pool.filter((c) => normalize(c.name).startsWith(q));
      const contains = pool.filter((c) => !starts.includes(c) && normalize(c.name).includes(q));
      return starts.concat(contains).slice(0, 8);
    };

    const draw = () => {
      if (!input.value.trim()) { list.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
      list.hidden = false;
      input.setAttribute('aria-expanded', String(items.length > 0));
      if (!items.length) {
        list.innerHTML = '<li class="empty">Nenhum campeão encontrado (ou você já tentou).</li>';
        return;
      }
      list.innerHTML = items.map((c, i) => `
        <li role="option" id="sug-${c.id}" data-id="${c.id}" aria-selected="${i === active}" class="${i === active ? 'active' : ''}">
          ${champIcon(c.id, 36)}<span>${esc(c.name)}</span>
        </li>`).join('');
      input.setAttribute('aria-activedescendant', items[active] ? `sug-${items[active].id}` : '');
    };

    const submit = (id) => {
      const pick = id || (items[active] && items[active].id) || (items[0] && items[0].id);
      if (!pick) {
        const box = $('#search');
        box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        return;
      }
      makeGuess(s, pick);
    };

    input.addEventListener('input', () => { items = compute(); active = 0; draw(); });
    input.addEventListener('focus', () => { items = compute(); draw(); });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
      else if (e.key === 'Escape') { list.hidden = true; }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-id]');
      if (li) { e.preventDefault(); submit(li.dataset.id); }
    });
    list.addEventListener('mousemove', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const i = items.findIndex((c) => c.id === li.dataset.id);
      if (i !== active) { active = i; draw(); }
    });

    if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
  }

  function makeGuess(s, id) {
    const g = s.game();
    if (g.status !== 'playing' || g.guesses.includes(id)) return;
    g.guesses.push(id);
    view.animateIdx = g.guesses.length - 1;
    if (id === s.target.id) {
      g.status = 'won';
      s.finish(g, true);
      confetti();
    }
    s.save(g);
    render();
    const input = $('#guess-input');
    if (input) input.focus({ preventScroll: true });
    if (g.status === 'won') {
      const res = app.querySelector('.result');
      if (res) res.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const next = $('#next-round');
      if (next) next.focus({ preventScroll: true });
    }
  }

  function confirmGiveUp(s) {
    const infinite = s.kind === 'infinite';
    const body = infinite
      ? '<p style="color:var(--gold-200)">O campeão será revelado e sua sequência no modo infinito volta a zero.</p>'
      : s.kind === 'archive'
        ? '<p style="color:var(--gold-200)">O campeão será revelado. Como é um desafio de outro dia, isso não afeta suas estatísticas.</p>'
        : '<p style="color:var(--gold-200)">O campeão será revelado e a partida conta como derrota. Sua sequência de vitórias neste modo volta a zero.</p>';
    openModal(infinite ? 'Pular esta rodada?' : 'Desistir do desafio?', `${body}
      <div class="modal-actions">
        <button class="btn" data-close>Continuar tentando</button>
        <button class="btn btn-gold" id="confirm-giveup">${infinite ? 'Pular' : 'Desistir'}</button>
      </div>`, (root) => {
      $('#confirm-giveup', root).addEventListener('click', () => {
        const g = s.game();
        if (g.status === 'playing') {
          g.status = 'lost';
          s.finish(g, false);
          s.save(g);
        }
        closeModal();
        render();
      });
    });
  }

  async function share(s, g) {
    const grid = s.mode.shareGrid ? s.mode.shareGrid(g, s.target) : g.guesses.map((id) => (id === s.target.id ? '🟩' : '🟥')).join('');
    const text = `Runedle #${dayNumber(s.key)} · ${s.mode.name}${s.kind === 'archive' ? ` (${fmtDate(s.key)})` : ''}\n${
      g.status === 'won' ? `Acertei em ${plural(g.guesses.length, 'tentativa')}` : 'Não consegui'}\n${grid}${
      g.bonus && g.bonus.answered ? `\nBônus: ${g.bonus.correct ? '✅' : '❌'}` : ''}`;
    const toast = $('#toast');
    let msg = 'Não foi possível copiar.';
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try { await navigator.share({ text }); if (toast) toast.textContent = 'Compartilhado!'; return; } catch { /* cancelado: tenta copiar */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      msg = 'Resultado copiado!';
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { if (document.execCommand('copy')) msg = 'Resultado copiado!'; } catch { /* ignora */ }
      ta.remove();
    }
    if (toast) {
      toast.textContent = msg;
      setTimeout(() => { if (toast.isConnected) toast.textContent = ''; }, 2500);
    }
  }

  function confetti() {
    const colors = ['#c8aa6e', '#f0e6d2', '#0ac8b9', '#cdfafa', '#785a28'];
    const box = document.createElement('div');
    box.className = 'confetti';
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i');
      const size = 6 + Math.random() * 8;
      const round = Math.random() > 0.5;
      const color = colors[i % colors.length];
      p.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${round ? size : size * 0.4}px;background:${color};` +
        `border-radius:${round ? '50%' : '2px'};animation-delay:${Math.random() * 0.8}s;animation-duration:${2.2 + Math.random() * 2}s;box-shadow:0 0 8px ${color}`;
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 5000);
  }

  /* =========================================================
   * Modais
   * ======================================================= */
  const modalRoot = $('#modal-root');
  let lastFocus = null;

  function openModal(title, body, onMount) {
    lastFocus = document.activeElement;
    modalRoot.innerHTML = `
      <div class="overlay" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="frame modal">
          <div class="modal-head"><h2 class="title">${esc(title)}</h2><button class="icon-btn" data-close aria-label="Fechar">${ICON.close}</button></div>
          <div class="modal-body">${body}</div>
        </div>
      </div>`;
    const overlay = modalRoot.firstElementChild;
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) closeModal(); });
    document.body.style.overflow = 'hidden';
    if (onMount) onMount(overlay);
    const focusable = overlay.querySelector('[data-close]');
    if (focusable) focusable.focus();
  }

  function closeModal() {
    modalRoot.innerHTML = '';
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalRoot.firstElementChild) closeModal(); });

  function statsBody(tab) {
    const tabs = [...MODES.map((m) => [m.id, m.name]), ['infinite', 'Infinito']];
    const tabsHTML = `<div class="tabs" role="tablist">${tabs.map(([id, name]) => `<button role="tab" data-tab="${id}" aria-selected="${id === tab}" class="${id === tab ? 'on' : ''}">${name}</button>`).join('')}</div>`;
    const tile = ([l, v]) => `<div class="tile"><b>${v}</b><small>${l}</small></div>`;
    if (tab === 'infinite') {
      const s = loadInf();
      const rate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
      return `${tabsHTML}<div class="tiles">${[['Rodadas', s.played], ['Acertos', s.wins], ['Taxa de acerto', `${rate}%`], ['Sequência atual', s.streak], ['Maior sequência', s.best]].map(tile).join('')}</div>
        <p class="muted">A sequência do modo infinito só zera quando você pula uma rodada.</p>`;
    }
    const s = loadStats(tab);
    const rate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
    const buckets = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'];
    const max = Math.max(1, ...buckets.map((b) => s.distribution[b] || 0));
    const dist = s.wins === 0
      ? '<p class="muted">Vença uma partida neste modo para ver a distribuição.</p>'
      : `<div class="dist">${buckets.map((b) => {
          const n = s.distribution[b] || 0;
          return `<div class="dist-row"><span>${b}</span><div><i class="${n ? 'has' : ''}" style="width:${Math.max(8, (n / max) * 100)}%">${n}</i></div></div>`;
        }).join('')}</div>`;
    return `${tabsHTML}
      <div class="tiles">${[['Partidas', s.played], ['Vitórias', s.wins], ['Taxa de vitória', `${rate}%`], ['Sequência atual', s.currentStreak], ['Maior sequência', s.maxStreak]].map(tile).join('')}</div>
      <h3 class="title" style="font-size:14px;margin-bottom:8px">Distribuição de tentativas</h3>
      ${dist}`;
  }

  function openStats(tab) {
    openModal('Estatísticas', statsBody(tab), function mount(root) {
      root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
        root.querySelector('.modal-body').innerHTML = statsBody(b.dataset.tab);
        mount(root);
      }));
    });
  }

  function openHistory() {
    const h = read('history', []);
    const body = !h.length
      ? '<p class="muted">Nenhuma partida terminada ainda.</p>'
      : `<ul class="history">${h.map((e) => `
          <li>
            ${champIcon(e.championId, 40, e.won ? '' : 'gray')}
            <div class="info"><b>${esc(BY_ID[e.championId] ? BY_ID[e.championId].name : e.championId)}</b>
              <small>${esc(MODE_BY_ID[e.mode] ? MODE_BY_ID[e.mode].name : e.mode)} · ${esc(fmtDate(e.dateKey))}${e.late ? ' · jogado depois' : ''}</small></div>
            <span class="res" style="color:${e.won ? '#86efac' : '#fca5a5'}">${e.won ? `${e.attempts} tent.` : 'Derrota'}</span>
          </li>`).join('')}</ul>`;
    openModal('Histórico de partidas', body);
  }

  function openHelp() {
    openModal('Como jogar', `
      <p>Todo dia há um campeão secreto em cada um dos cinco modos. Ele é o mesmo para todos os jogadores e muda às 21h (horário de Brasília).</p>
      <p><b style="color:var(--gold-200)">Classic:</b> cada tentativa compara gênero, posição, espécie, recurso, alcance, região e ano de lançamento.</p>
      <ul>
        <li><span class="sq bg-ok"></span>Verde: característica idêntica.</li>
        <li><span class="sq bg-part"></span>Amarelo: em parte (ex.: uma das posições em comum).</li>
        <li><span class="sq bg-bad"></span>Vermelho: nada em comum.</li>
        <li>A seta no ano indica se o campeão secreto é mais recente (↑) ou mais antigo (↓).</li>
      </ul>
      <p><b style="color:var(--gold-200)">Quote, Ability, Emoji e Splash:</b> descubra o campeão por uma fala, um ícone de habilidade, emojis ou um trecho da splash art (que começa em preto e branco). A cada erro a pista fica mais fácil.</p>
      <p><b style="color:var(--gold-200)">Sequência diária:</b> cada dia em que você vence pelo menos um desafio do dia soma 1. Se passar um dia sem vencer, ela volta a zero.</p>
      <p><b style="color:var(--gold-200)">Modo infinito:</b> rodadas aleatórias sem limite, com sequência própria. Pular uma rodada zera essa sequência.</p>
      <p><b style="color:var(--gold-200)">Calendário:</b> jogue o desafio de qualquer dia passado. Esses jogos não contam para a sequência diária nem para as estatísticas.</p>
      <p class="small" style="color:var(--gold-400)">Seu progresso fica salvo neste navegador.</p>`);
  }

  /* =========================================================
   * Inicialização
   * ======================================================= */
  $('#btn-stats').innerHTML = ICON.stats;
  $('#btn-history').innerHTML = ICON.history;
  $('#btn-cal').innerHTML = ICON.calendar;
  $('#btn-history').addEventListener('click', openHistory);
  $('#btn-stats').addEventListener('click', () => {
    const s = route.name === 'mode' || route.name === 'infinite' ? currentSession() : null;
    openStats(s ? (s.kind === 'infinite' ? 'infinite' : s.mode.id) : 'classic');
  });
  $('#btn-help').addEventListener('click', openHelp);

  window.addEventListener('hashchange', () => {
    route = parseRoute();
    view = { openHint: null, animateIdx: -1, enter: true };
    if (route.name === 'mode' && route.key !== currentKey && location.hash === `#dia-${currentKey}-${route.mode}`) location.hash = route.mode;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* relógio: atualiza a contagem e vira o dia às 21h */
  setInterval(() => {
    const txt = formatCountdown(msUntilReset());
    document.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = txt; });
    const k = dateKey();
    if (k !== currentKey) {
      currentKey = k;
      route = parseRoute();
      view = { openHint: null, animateIdx: -1, enter: true };
      render();
    }
  }, 1000);

  /* API usada pelo X1 (js/x1.js) */
  window.RUNEDLE = {
    CHAMPIONS, BY_ID, MODES, MODE_BY_ID, QUOTES, KEYS, ICON, COLUMNS,
    esc, plural, read, write, champIcon, spinner, confetti, openModal, closeModal, normalize,
    registerView(name, v) { views[name] = v; if (route.name === name) render(); else renderShell(); },
    rerender: () => render(),
    get route() { return route; },
  };

  $('#patch').textContent = typeof ASSET_PATCH !== 'undefined' ? ASSET_PATCH : '';
  view.enter = true;
  render();
})();
