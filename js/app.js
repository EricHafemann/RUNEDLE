/* Runedle — jogo diário de adivinhação de campeões (HTML + CSS + JavaScript puro).
 * Depende de js/data.js (CHAMPION_ROWS e QUOTES). */
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
   * Desafio diário (horário de Brasília, UTC-3)
   * ======================================================= */
  const OFFSET_MS = -3 * 3600 * 1000;
  const DAY = 86400000;
  const EPOCH = Date.UTC(2024, 0, 1);

  const dateKey = (now = Date.now()) => new Date(now + OFFSET_MS).toISOString().slice(0, 10);
  const dayNumber = (key) => Math.floor((Date.parse(key + 'T00:00:00Z') - EPOCH) / DAY) + 1;
  const msUntilReset = (now = Date.now()) => {
    const local = now + OFFSET_MS;
    return Math.floor(local / DAY) * DAY + DAY - local;
  };
  const prevKey = (key) => dateKey(Date.parse(key + 'T12:00:00Z') - DAY);

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
   * LocalStorage (partidas, estatísticas, histórico)
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

  function loadGame(mode, key) {
    const g = read(`game:${mode}`, null);
    return g && g.dateKey === key ? g : { dateKey: key, guesses: [], status: 'playing' };
  }
  const saveGame = (mode, g) => write(`game:${mode}`, g);

  function loadStats(mode) {
    const s = read(`stats:${mode}`, { played: 0, wins: 0, currentStreak: 0, maxStreak: 0, distribution: {} });
    const today = dateKey();
    if (s.currentStreak > 0 && s.lastWonKey !== today && s.lastWonKey !== prevKey(today)) s.currentStreak = 0;
    return s;
  }

  const distKey = (n) => (n >= 10 ? '10+' : String(n));

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
    } else {
      s.currentStreak = 0;
    }
    write(`stats:${mode}`, s);
    if (won) {
      const days = read('days', []);
      if (!days.includes(key)) { days.push(key); write('days', days.slice(-800)); }
    }
    const history = read('history', []);
    history.unshift({ dateKey: key, mode, championId, attempts, won });
    write('history', history.slice(0, 200));
  }

  /* Sequência diária: dias seguidos em que você venceu pelo menos um desafio.
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

  /* =========================================================
   * Imagens dos campeões (arquivos locais, baixados do Data Dragon)
   * img/champion/<id>.jpg · splash/<id>.jpg · spells/<id>.js
   * ======================================================= */
  const iconUrl = (id) => (typeof CHAMPION_ICONS !== 'undefined' && CHAMPION_ICONS[id]) || `img/champion/${id}.jpg`;
  const splashUrl = (id) => `splash/${id}.jpg`;
  const titleOf = (id) => (typeof CHAMPION_TITLES !== 'undefined' && CHAMPION_TITLES[id]) || '';

  /* habilidades: cada spells/<id>.js chama RUNEDLE_SPELLS({...}); funciona até abrindo o arquivo direto */
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
    flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
    up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    classic: svg('<path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M12 22V12M21 7l-9 5-9-5"/>'),
    quote: svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M9 9h.01M12 9h.01M15 9h.01"/>'),
    ability: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    emoji: svg('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'),
    splash: svg('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>'),
  };

  const spinner = (label = 'Carregando…') => `<div class="loading" role="status"><div class="spinner"></div>${label ? `<span>${esc(label)}</span>` : ''}</div>`;
  const errorBox = (msg, retryId) => `<div class="frame error-box"><p>${esc(msg)}</p>${
    retryId ? `<button class="btn" data-action="retry-detail" data-id="${esc(retryId)}">Tentar de novo</button>` : ''}</div>`;

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
   * ======================================================= */
  const QUOTE_POOL = CHAMPIONS.filter((c) => QUOTES[c.id] && QUOTES[c.id].length);
  const KEYS = ['Q', 'W', 'E', 'R'];
  const prefs = { gray: read('pref:ability-gray', false), rotate: read('pref:ability-rotate', false) };
  const loadedImgs = new Set();

  const MODES = [
    {
      id: 'classic', name: 'Classic', desc: 'Pistas a cada tentativa',
      heading: 'Adivinhe o campeão de hoje',
      target: (k) => pickDaily(CHAMPIONS, 'classic', k),
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
      id: 'quote', name: 'Quote', desc: 'Adivinhe pela fala',
      heading: 'Qual campeão diz',
      target: (k) => pickDaily(QUOTE_POOL, 'quote', k),
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
      id: 'ability', name: 'Ability', desc: 'Adivinhe pela habilidade',
      heading: 'De qual campeão é esta habilidade?',
      target: (k) => pickDaily(CHAMPIONS, 'ability', k),
      clue: (g, t) => {
        const d = getSpells(t.id);
        if (d.status === 'loading') return spinner('Carregando habilidade…');
        if (d.status === 'error') return errorBox('Não foi possível carregar a habilidade.', t.id);
        const { keyIdx, rotation } = abilitySeed(g.dateKey);
        const spell = d.data.spells[keyIdx];
        const done = g.status !== 'playing';
        const style = done ? '' : `transform:${prefs.rotate ? `rotate(${rotation}deg)` : 'none'};filter:${prefs.gray ? 'grayscale(1)' : 'none'}`;
        return `
          <div class="ability-frame"><img src="${spell.img}" alt="Ícone da habilidade" style="${style}"></div>
          ${done
            ? `<p style="margin:12px 0 0"><b class="title" style="font-size:18px;margin-right:8px">${KEYS[keyIdx]}</b>${esc(spell.name)}</p>`
            : `<div class="toggles">
                <label><input type="checkbox" data-pref="gray" ${prefs.gray ? 'checked' : ''}>Preto e branco</label>
                <label><input type="checkbox" data-pref="rotate" ${prefs.rotate ? 'checked' : ''}>Girar ícone</label>
              </div>`}`;
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
      id: 'emoji', name: 'Emoji', desc: 'Adivinhe pelos emojis',
      heading: 'Qual campeão estes emojis representam?',
      target: (k) => pickDaily(CHAMPIONS, 'emoji', k),
      clue: (g, t) => {
        const shown = g.status !== 'playing' ? t.emojis.length : Math.min(t.emojis.length, g.guesses.length + 1);
        const boxes = t.emojis.map((e, i) => `<span class="${i < shown ? 'on pop' : ''}">${i < shown ? esc(e) : '?'}</span>`).join('');
        return `<div class="emojis">${boxes}</div>${
          g.status === 'playing' && shown < t.emojis.length ? '<p class="muted small" style="margin:12px 0 0">Cada erro revela mais um emoji.</p>' : ''}`;
      },
      hints: (t) => [{ label: 'Região', at: 6, html: `<p style="margin:0">${esc(t.regions.join(' · '))}</p>` }],
    },
    {
      id: 'splash', name: 'Splash', desc: 'Adivinhe pela splash art',
      heading: 'De qual campeão é esta splash art?',
      target: (k) => pickDaily(CHAMPIONS, 'splash', k),
      clue: (g, t) => {
        const r = rng(`splash:${g.dateKey}`);
        const ox = 25 + r() * 50;
        const oy = 20 + r() * 45;
        const done = g.status !== 'playing';
        const zoom = done ? 1 : Math.max(1.4, 6 - g.guesses.length * 0.55);
        const src = splashUrl(t.id);
        const loaded = loadedImgs.has(src);
        return `
          <div class="splash">
            ${loaded ? '' : '<div class="spinner"></div>'}
            <img src="${esc(src)}" alt="Trecho da splash art" draggable="false" class="${loaded ? 'loaded' : ''}" data-splash
              style="transform:scale(${zoom});transform-origin:${ox}% ${oy}%">
          </div>
          ${done ? '' : '<p class="muted small" style="margin:12px 0 0">Cada erro afasta o zoom e revela mais da imagem.</p>'}`;
      },
      hints: (t) => [{ label: 'Região', at: 5, html: `<p style="margin:0">${esc(t.regions.join(' · '))}</p>` }],
    },
  ];
  const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));

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
   * Estado da tela
   * ======================================================= */
  let currentKey = dateKey();
  let route = parseRoute();
  let view = { openHint: null, animateIdx: -1 };

  function parseRoute() {
    const h = location.hash.replace('#', '');
    return MODE_BY_ID[h] ? h : 'home';
  }

  /* =========================================================
   * Renderização
   * ======================================================= */
  const app = $('#app');

  function render() {
    renderHeader();
    app.innerHTML = route === 'home' ? homeHTML() : modeHTML(MODE_BY_ID[route]);
    if (route !== 'home') bindMode(MODE_BY_ID[route]);
    view.animateIdx = -1; // só a tentativa recém-feita anima
  }

  function renderHeader() {
    const st = dailyStreak();
    const badge = $('#streak-badge');
    badge.innerHTML = `${ICON.fire}<b>${st.current}</b>`;
    badge.className = `streak-badge ${st.current ? 'on' : ''} ${st.wonToday ? 'today' : ''}`;
    badge.title = `Sequência diária: ${plural(st.current, 'dia')}`;
    document.body.classList.toggle('in-mode', route !== 'home');
    $('#btn-home').hidden = route === 'home';
    const tabs = $('#mode-tabs');
    tabs.hidden = route === 'home';
    if (route === 'home') return;
    tabs.innerHTML = MODES.map((m) => {
      const st = loadGame(m.id, currentKey).status;
      return `<a href="#${m.id}" class="mode-tab ${route === m.id ? 'active' : ''}" ${route === m.id ? 'aria-current="page"' : ''} title="${m.name}">
        ${ICON[m.id]}<span class="lbl">${m.name}</span>${st !== 'playing' ? `<span class="dot ${st}"></span>` : ''}</a>`;
    }).join('');
  }

  function homeHTML() {
    const games = MODES.map((m) => ({ m, g: loadGame(m.id, currentKey), s: loadStats(m.id) }));
    const done = games.filter((x) => x.g.status !== 'playing').length;
    const cards = games.map(({ m, g, s }, i) => {
      const st = g.status === 'won' ? '<span class="won">Concluído</span>'
        : g.status === 'lost' ? '<span class="lost">Derrota</span>'
        : g.guesses.length ? plural(g.guesses.length, 'tentativa') : 'Novo';
      return `<a href="#${m.id}" class="frame mode-card" style="animation-delay:${i * 0.06}s">
        <span class="ico ${g.status === 'won' ? 'won' : ''}">${ICON[m.id]}</span>
        <span class="txt"><b>${m.name}</b><small>${m.desc}</small></span>
        <span class="st">${st}${s.currentStreak > 0 ? `<span class="streak">Sequência ${s.currentStreak}</span>` : ''}</span>
      </a>`;
    }).join('');
    return `
      <section class="hero" style="animation:rise .35s ease-out both">
        <p class="muted" style="margin:0">Desafio #${dayNumber(currentKey)}</p>
        <h1>Adivinhe o campeão</h1>
        <p>Cinco desafios novos todo dia, iguais para todos os jogadores.</p>
      </section>
      ${streakCard()}
      <div class="progress" aria-label="Progresso do dia">
        <div class="progress-bar"><span style="width:${(done / MODES.length) * 100}%"></span></div>
        <span>${done}/${MODES.length}</span>
      </div>
      <nav class="mode-list">${cards}</nav>
      <div class="countdown">
        <div class="label">Novos campeões em</div>
        <div class="time" data-countdown>${formatCountdown(msUntilReset())}</div>
        <div class="small" style="color:var(--gold-500)">Reinicia à meia-noite (horário de Brasília)</div>
      </div>`;
  }

  function streakCard() {
    const st = dailyStreak();
    const names = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const week = st.week.map((d) => {
      const wd = names[new Date(d.key + 'T12:00:00Z').getUTCDay()];
      return `<span class="day ${d.won ? 'won' : ''} ${d.key === currentKey ? 'now' : ''}"><i>${d.won ? ICON.fire : ''}</i><small>${wd}</small></span>`;
    }).join('');
    const msg = st.wonToday ? 'Desafio de hoje concluído. Volte amanhã!'
      : st.current ? 'Vença um desafio hoje para manter a sequência.'
      : 'Vença um desafio hoje para começar uma sequência.';
    return `
      <section class="frame streak-card">
        <div class="streak-main">
          <span class="flame ${st.current ? 'on' : ''}">${ICON.fire}</span>
          <div><b>${st.current}</b><span>${st.current === 1 ? 'dia seguido' : 'dias seguidos'}</span></div>
          <div class="best"><small>Recorde</small><b>${st.best}</b></div>
        </div>
        <div class="week">${week}</div>
        <p>${msg}</p>
      </section>`;
  }

  function hintsHTML(mode, g, t) {
    const hints = mode.hints ? mode.hints(t) : [];
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

  function resultHTML(mode, g, t) {
    const won = g.status === 'won';
    const idx = MODES.indexOf(mode);
    const next = MODES[(idx + 1) % MODES.length];
    const title = titleOf(t.id);
    return `
      <section class="frame result ${won ? 'won' : 'lost'}" aria-live="polite">
        <h2>${won ? 'Vitória!' : 'Derrota'}</h2>
        <div class="who">
          ${champIcon(t.id, 80)}
          <div><span class="muted">${won ? 'Você adivinhou' : 'O campeão era'}</span><strong>${esc(t.name)}</strong>${title ? `<em>${esc(title)}</em>` : ''}</div>
        </div>
        <p style="margin:0;color:var(--gold-200)">${won ? `Tentativas: ${g.guesses.length}` : `Você desistiu após ${plural(g.guesses.length, 'tentativa')}.`}</p>
        ${won ? `<p class="streak-line">${ICON.fire}Sequência diária: <b>${plural(dailyStreak().current, 'dia')}</b></p>` : ''}
        ${mode.bonus ? mode.bonus(g, t) : ''}
        <div class="divider"></div>
        <div class="actions">
          <button class="btn" data-action="share">${ICON.share.replace('<svg', '<svg width="20" height="20"')} Compartilhar</button>
          <a class="btn btn-gold" href="#${next.id}">Próximo: ${next.name} →</a>
        </div>
        <p class="toast" id="toast"></p>
        <div class="countdown"><div class="label">Próximo campeão em</div><div class="time" data-countdown>${formatCountdown(msUntilReset())}</div></div>
      </section>`;
  }

  function modeHTML(mode) {
    const t = mode.target(currentKey);
    const g = loadGame(mode.id, currentKey);
    const playing = g.status === 'playing';
    return `
      <section class="frame clue">
        <h1 class="title">${mode.heading}</h1>
        ${mode.clue(g, t)}
        <p class="attempts">Tentativas: <b>${g.guesses.length}</b></p>
      </section>
      ${hintsHTML(mode, g, t)}
      ${playing ? `
        <div class="search" id="search">
          <form autocomplete="off">
            <input type="text" id="guess-input" placeholder="Digite o nome de um campeão…" spellcheck="false"
              role="combobox" aria-expanded="false" aria-controls="suggestions" aria-autocomplete="list">
            <button type="submit" class="btn btn-gold" aria-label="Enviar tentativa">${ICON.send}</button>
          </form>
          <ul class="frame suggestions" id="suggestions" role="listbox" hidden></ul>
        </div>
        ${g.guesses.length ? `<div class="giveup"><button class="btn-link" data-action="giveup">${ICON.flag} Desistir</button></div>` : ''}
      ` : resultHTML(mode, g, t)}
      ${mode.guesses ? mode.guesses(g, t) : simpleGuessList(g, t)}`;
  }

  /* =========================================================
   * Interação dentro de um modo
   * ======================================================= */
  function bindMode(mode) {
    const t = mode.target(currentKey);

    app.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', () => {
        const a = el.dataset.action;
        const g = loadGame(mode.id, currentKey);
        if (a === 'hint') {
          const i = Number(el.dataset.i);
          view.openHint = view.openHint === i ? null : i;
          render();
        } else if (a === 'giveup') {
          confirmGiveUp(mode, t);
        } else if (a === 'share') {
          share(mode, g, t);
        } else if (a === 'bonus') {
          if (g.bonus && g.bonus.answered) return;
          g.bonus = { answered: true, correct: el.dataset.correct === 'true', choice: el.dataset.choice };
          saveGame(mode.id, g);
          render();
        } else if (a === 'retry-detail') {
          delete SPELLS[el.dataset.id];
          render();
        }
      });
    });

    app.querySelectorAll('[data-pref]').forEach((el) => {
      el.addEventListener('change', () => {
        prefs[el.dataset.pref] = el.checked;
        write(`pref:ability-${el.dataset.pref}`, el.checked);
        render();
      });
    });

    const splash = app.querySelector('[data-splash]');
    if (splash) {
      const done = () => {
        loadedImgs.add(splash.src);
        splash.classList.add('loaded');
        const sp = splash.parentElement.querySelector('.spinner');
        if (sp) sp.remove();
      };
      if (splash.complete && splash.naturalWidth) done();
      splash.addEventListener('load', done);
      splash.addEventListener('error', () => {
        splash.parentElement.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px">${errorBox('A imagem não carregou.')}</div>`;
      });
    }

    bindSearch(mode, t);
  }

  function bindSearch(mode, t) {
    const input = $('#guess-input');
    if (!input) return;
    const list = $('#suggestions');
    const form = input.form;
    let items = [];
    let active = 0;

    const compute = () => {
      const q = normalize(input.value);
      if (!q) return [];
      const used = loadGame(mode.id, currentKey).guesses;
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
      makeGuess(mode, t, pick);
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

  function makeGuess(mode, t, id) {
    const g = loadGame(mode.id, currentKey);
    if (g.status !== 'playing' || g.guesses.includes(id)) return;
    g.guesses.push(id);
    view.animateIdx = g.guesses.length - 1;
    if (id === t.id) {
      g.status = 'won';
      recordResult(mode.id, g.dateKey, t.id, true, g.guesses.length);
      confetti();
    }
    saveGame(mode.id, g);
    render();
    const input = $('#guess-input');
    if (input) input.focus({ preventScroll: true });
    if (g.status === 'won') {
      const res = app.querySelector('.result');
      if (res) res.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function confirmGiveUp(mode, t) {
    openModal('Desistir do desafio?', `
      <p style="color:var(--gold-200)">O campeão será revelado e a partida conta como derrota. Sua sequência de vitórias neste modo volta a zero.</p>
      <div class="modal-actions">
        <button class="btn" data-close>Continuar tentando</button>
        <button class="btn btn-gold" id="confirm-giveup">Desistir</button>
      </div>`, (root) => {
      $('#confirm-giveup', root).addEventListener('click', () => {
        const g = loadGame(mode.id, currentKey);
        if (g.status === 'playing') {
          g.status = 'lost';
          recordResult(mode.id, g.dateKey, t.id, false, g.guesses.length);
          saveGame(mode.id, g);
        }
        closeModal();
        render();
      });
    });
  }

  async function share(mode, g, t) {
    const grid = mode.shareGrid ? mode.shareGrid(g, t) : g.guesses.map((id) => (id === t.id ? '🟩' : '🟥')).join('');
    const text = `Runedle #${dayNumber(g.dateKey)} · ${mode.name}\n${
      g.status === 'won' ? `Acertei em ${plural(g.guesses.length, 'tentativa')}` : 'Não consegui hoje'}\n${grid}${
      g.bonus && g.bonus.answered ? `\nBônus: ${g.bonus.correct ? '✅' : '❌'}` : ''}`;
    const toast = $('#toast');
    let msg = 'Não foi possível copiar.';
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try { await navigator.share({ text }); msg = 'Compartilhado!'; toast.textContent = msg; return; } catch { /* cancelado: tenta copiar */ }
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

  function statsBody(modeId) {
    const s = loadStats(modeId);
    const rate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
    const buckets = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'];
    const max = Math.max(1, ...buckets.map((b) => s.distribution[b] || 0));
    const tiles = [['Partidas', s.played], ['Vitórias', s.wins], ['Taxa de vitória', `${rate}%`], ['Sequência atual', s.currentStreak], ['Maior sequência', s.maxStreak]]
      .map(([l, v]) => `<div class="tile"><b>${v}</b><small>${l}</small></div>`).join('');
    const dist = s.wins === 0
      ? '<p class="muted">Vença uma partida neste modo para ver a distribuição.</p>'
      : `<div class="dist">${buckets.map((b) => {
          const n = s.distribution[b] || 0;
          return `<div class="dist-row"><span>${b}</span><div><i class="${n ? 'has' : ''}" style="width:${Math.max(8, (n / max) * 100)}%">${n}</i></div></div>`;
        }).join('')}</div>`;
    return `
      <div class="tabs" role="tablist">${MODES.map((m) => `<button role="tab" data-tab="${m.id}" aria-selected="${m.id === modeId}" class="${m.id === modeId ? 'on' : ''}">${m.name}</button>`).join('')}</div>
      <div class="tiles">${tiles}</div>
      <h3 class="title" style="font-size:14px;margin-bottom:8px">Distribuição de tentativas</h3>
      ${dist}`;
  }

  function openStats(modeId) {
    openModal('Estatísticas', statsBody(modeId), function mount(root) {
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
              <small>${esc(MODE_BY_ID[e.mode] ? MODE_BY_ID[e.mode].name : e.mode)} · ${esc(e.dateKey.split('-').reverse().join('/'))}</small></div>
            <span class="res" style="color:${e.won ? '#86efac' : '#fca5a5'}">${e.won ? `${e.attempts} tent.` : 'Derrota'}</span>
          </li>`).join('')}</ul>`;
    openModal('Histórico de partidas', body);
  }

  function openHelp() {
    openModal('Como jogar', `
      <p>Todo dia há um campeão secreto em cada um dos cinco modos. Ele é o mesmo para todos os jogadores e muda à meia-noite (horário de Brasília).</p>
      <p><b style="color:var(--gold-200)">Classic:</b> cada tentativa compara gênero, posição, espécie, recurso, alcance, região e ano de lançamento.</p>
      <ul>
        <li><span class="sq bg-ok"></span>Verde: característica idêntica.</li>
        <li><span class="sq bg-part"></span>Amarelo: em parte (ex.: uma das posições em comum).</li>
        <li><span class="sq bg-bad"></span>Vermelho: nada em comum.</li>
        <li>A seta no ano indica se o campeão secreto é mais recente (↑) ou mais antigo (↓).</li>
      </ul>
      <p><b style="color:var(--gold-200)">Quote, Ability, Emoji e Splash:</b> descubra o campeão por uma fala, um ícone de habilidade, emojis ou um trecho da splash art. A cada erro a pista fica mais fácil.</p>
      <p><b style="color:var(--gold-200)">Sequência diária:</b> cada dia em que você vence pelo menos um desafio soma 1. Se passar um dia sem vencer, ela volta a zero.</p>
      <p>Tentativas são ilimitadas. Se travar, use “Desistir” para ver a resposta (conta como derrota).</p>
      <p class="small" style="color:var(--gold-400)">Suas estatísticas ficam salvas neste navegador.</p>`);
  }

  /* =========================================================
   * Inicialização
   * ======================================================= */
  $('#btn-home').innerHTML = ICON.home;
  $('#btn-history').innerHTML = ICON.history;
  $('#btn-stats').innerHTML = ICON.stats;
  $('#btn-help').innerHTML = ICON.help;
  $('#btn-history').addEventListener('click', openHistory);
  $('#btn-stats').addEventListener('click', () => openStats(route === 'home' ? 'classic' : route));
  $('#btn-help').addEventListener('click', openHelp);
  $('#streak-badge').addEventListener('click', () => { location.hash = ''; });

  window.addEventListener('hashchange', () => {
    route = parseRoute();
    view = { openHint: null, animateIdx: -1 };
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* relógio: atualiza a contagem e vira o dia à meia-noite */
  setInterval(() => {
    const txt = formatCountdown(msUntilReset());
    document.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = txt; });
    const k = dateKey();
    if (k !== currentKey) {
      currentKey = k;
      view = { openHint: null, animateIdx: -1 };
      render();
    }
  }, 1000);

  $('#patch').textContent = typeof ASSET_PATCH !== 'undefined' ? ASSET_PATCH : '';
  render();
})();
