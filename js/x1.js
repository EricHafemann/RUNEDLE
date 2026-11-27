/* Runedle · X1 ao vivo
 * Salas para dois jogadores com o mesmo campeão, progresso do adversário em tempo real
 * e palpites conferidos no servidor (Supabase Edge Function "x1"). */
(() => {
  'use strict';
  const R = window.RUNEDLE;
  if (!R) return;
  const { esc, plural, read, write, champIcon, spinner, ICON, BY_ID, CHAMPIONS, COLUMNS, MODES, MODE_BY_ID, normalize } = R;

  const cfg = window.RUNEDLE_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseKey);
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';

  let sb = null;
  let libState = 'idle'; // idle | loading | ready | error
  let sess = read('x1:session', null); // { code, playerId, token, channelKey }
  if (sess && !sess.channelKey) sess = null; // sessão de versão antiga
  let room = null;
  let players = [];
  let clue = null; // { round, mode, clue }
  let mine = read('x1:guesses', null); // { code, round, list: [{ id, correct, cells }] }
  let answer = null;
  let error = '';
  let busy = false;
  let channel = null;
  let ticker = null;
  let lastKey = '';
  let poll = null;

  const meName = () => read('x1:name', '');
  const shareLink = (code) => `${location.origin}${location.pathname}#x1-${code}`;

  /* ---------- infraestrutura ---------- */
  function loadLib() {
    if (libState !== 'idle') return;
    libState = 'loading';
    const tag = document.createElement('script');
    tag.src = SUPABASE_JS;
    tag.onload = () => {
      try {
        sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
        libState = 'ready';
        if (sess) connect();
      } catch { libState = 'error'; }
      R.rerender();
    };
    tag.onerror = () => { libState = 'error'; R.rerender(); };
    document.head.appendChild(tag);
  }

  async function call(action, body = {}) {
    const { data, error: err } = await sb.functions.invoke('x1', { body: { action, ...body } });
    if (err) {
      let msg = 'Não foi possível falar com o servidor do X1.';
      try { const j = await err.context.json(); if (j && j.error) msg = j.error; } catch { /* mantém a mensagem padrão */ }
      throw new Error(msg);
    }
    return data;
  }

  async function act(fn) {
    if (busy) return;
    busy = true; error = ''; R.rerender();
    try { await fn(); } catch (e) { error = e.message || String(e); }
    busy = false; R.rerender();
  }

  function saveSession(s) { sess = s; write('x1:session', s); }
  function clearSession() {
    sess = null; room = null; players = []; clue = null; mine = null; answer = null;
    write('x1:session', null); write('x1:guesses', null);
    if (channel) { sb.removeChannel(channel); channel = null; }
    clearInterval(poll);
  }

  /* Tempo real: a função do servidor avisa num canal com nome secreto, conhecido só por quem está na sala.
   * O navegador não lê nenhuma tabela: o estado vem sempre da função, que confere a senha do jogador. */
  function connect() {
    if (!sb || !sess) return;
    if (channel) sb.removeChannel(channel);
    channel = sb.channel(`x1-${sess.code}-${sess.channelKey}`)
      .on('broadcast', { event: 'sync' }, refresh)
      .subscribe();
    clearInterval(poll);
    poll = setInterval(refresh, 15000); // reserva, caso algum aviso se perca
    refresh();
  }

  let refreshing = false;
  async function refresh() {
    if (!sb || !sess || refreshing) return;
    refreshing = true;
    const code = sess.code;
    try {
      let st;
      try {
        st = await call('state', { code, token: sess.token });
      } catch (e) {
        if (/não encontrada|não está nesta sala|vazia/i.test(e.message)) {
          clearSession();
          error = 'A sala foi encerrada.';
          R.rerender();
        }
        return;
      }
      if (!sess || sess.code !== code) return;
      const r = st.room;
      const roundChanged = !room || room.round !== r.round;
      room = r; players = st.players || [];
      if (roundChanged) answer = null;
      if (room.status !== 'lobby' && (!clue || clue.round !== room.round)) {
        try { clue = await call('clue', { code, token: sess.token }); } catch (e) { error = e.message; }
      }
      if (!mine || mine.code !== code || mine.round !== room.round) { mine = { code, round: room.round, list: [] }; write('x1:guesses', mine); }
      if (room.status === 'finished' && !answer) {
        try { answer = (await call('reveal', { code, token: sess.token })).answer; } catch { /* tenta de novo no próximo aviso */ }
        if (room.mode === 'emoji') { try { clue = await call('clue', { code, token: sess.token }); } catch { /* mantém a pista */ } }
      }
      if (room.status === 'finished' && room.winner_id === sess.playerId && lastKey !== `${code}:${room.round}:won`) {
        lastKey = `${code}:${room.round}:won`;
        R.confetti();
      }
      tick();
      R.rerender();
    } finally {
      refreshing = false;
    }
  }

  /* contagem regressiva antes da rodada */
  function tick() {
    clearInterval(ticker);
    if (room && room.status === 'playing' && room.starts_at && Date.parse(room.starts_at) > Date.now()) {
      ticker = setInterval(() => {
        if (Date.parse(room.starts_at) <= Date.now()) clearInterval(ticker);
        if (R.route.name === 'x1') R.rerender();
      }, 250);
    }
  }

  /* ---------- telas ---------- */
  const me = () => players.find((p) => p.id === (sess && sess.playerId));
  const opp = () => players.find((p) => p.id !== (sess && sess.playerId));

  function lobbyHTML(joinCode) {
    const modeOpts = MODES.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
    return `
      <div class="kicker"><b>X1 AO VIVO</b><span class="pill">2 jogadores · mesmo campeão</span></div>
      <section class="frame clue">
        <h1 class="title">Desafie um amigo</h1>
        <p class="muted" style="margin:0">Os dois recebem o mesmo campeão ao mesmo tempo. Quem acertar primeiro vence. Os palpites são conferidos no servidor.</p>
      </section>
      <div class="x1-grid">
        <form class="frame x1-card" id="x1-create">
          <h2 class="title" style="font-size:18px">Criar sala</h2>
          <label for="x1-name-a">SEU NOME</label>
          <input id="x1-name-a" name="name" maxlength="16" required value="${esc(meName())}" autocomplete="nickname">
          <label for="x1-mode">MODO</label>
          <select id="x1-mode" name="mode">${modeOpts}</select>
          <button class="btn btn-hex" type="submit" ${busy ? 'disabled' : ''}>CRIAR SALA</button>
        </form>
        <form class="frame x1-card" id="x1-join">
          <h2 class="title" style="font-size:18px">Entrar com código</h2>
          <label for="x1-name-b">SEU NOME</label>
          <input id="x1-name-b" name="name" maxlength="16" required value="${esc(meName())}" autocomplete="nickname">
          <label for="x1-code">CÓDIGO DA SALA</label>
          <input id="x1-code" name="code" class="code-input" maxlength="4" required value="${esc(joinCode || '')}" autocomplete="off" placeholder="KX7Q">
          <button class="btn btn-gold" type="submit" ${busy ? 'disabled' : ''}>ENTRAR</button>
        </form>
      </div>`;
  }

  function playersHTML() {
    const isClassic = room.mode === 'classic';
    return `<div class="players">${players.map((p) => {
      const mineP = p.id === sess.playerId;
      const host = p.id === room.host_id;
      const pct = room.status === 'lobby' ? 0 : p.finished ? 100 : isClassic ? Math.round((p.progress / 7) * 100) : Math.min(90, p.attempts * 12);
      const status = room.status === 'lobby' ? (host ? 'Anfitrião' : 'Pronto')
        : p.won ? `Acertou em ${plural(p.attempts, 'tentativa')}`
        : `${plural(p.attempts, 'tentativa')}${isClassic && p.attempts ? ` · ${p.progress}/7 verdes` : ''}`;
      return `<div class="player ${mineP ? 'me' : ''} ${p.finished ? 'done' : ''}">
        <div class="top"><b>${esc(p.name)}${mineP ? ' <small>(você)</small>' : ''}</b><small>${status}</small></div>
        <div class="meter"><i style="width:${pct}%"></i></div></div>`;
    }).join('')}${players.length < 2 ? '<div class="player"><div class="top"><b class="muted">Esperando adversário…</b></div><div class="meter"><i style="width:0"></i></div></div>' : ''}</div>`;
  }

  function clueHTML() {
    const c = (clue && clue.clue) || {};
    const n = (mine && mine.list.length) || 0;
    const done = room.status === 'finished' || (me() && me().finished);
    switch (room.mode) {
      case 'quote': return `<blockquote class="quote"><p>${esc(c.quote || '…')}</p></blockquote>`;
      case 'emoji': {
        // o servidor só manda os emojis já revelados
        const em = c.emojis || [];
        const total = Math.max(c.total || 5, em.length);
        return `<div class="emojis">${Array.from({ length: total }, (_, i) => `<span class="${i < em.length ? 'on pop' : ''}">${i < em.length ? esc(em[i]) : '?'}</span>`).join('')}</div>`;
      }
      case 'ability': return c.img ? `<div class="ability-frame"><img src="${c.img}" alt="Ícone da habilidade" style="${done ? '' : 'filter:grayscale(1)'}"></div>` : spinner('Carregando habilidade…');
      case 'splash': {
        if (!c.img) return spinner('Carregando splash art…');
        const zoom = done ? 1 : Math.max(1.4, 6 - n * 0.55);
        return `<div class="splash"><img class="loaded" src="${c.img}" alt="Trecho da splash art" style="transform:scale(${zoom});transform-origin:${c.ox}% ${c.oy}%;filter:${done ? 'none' : 'grayscale(1)'}"></div>`;
      }
      default: return `<div class="legend"><span><i class="bg-ok"></i>Correto</span><span><i class="bg-part"></i>Parcial</span><span><i class="bg-bad"></i>Incorreto</span><span>${ICON.up}mais recente</span><span>${ICON.down}mais antigo</span></div>`;
    }
  }

  function guessesHTML() {
    const list = (mine && mine.list) || [];
    if (!list.length) return '';
    if (room.mode === 'classic') {
      const head = `<div class="crow chead"><div>Campeão</div>${COLUMNS.map(([, l]) => `<div>${l}</div>`).join('')}</div>`;
      const rows = list.map((g, i) => {
        const c = BY_ID[g.id];
        const fresh = i === 0 && g.fresh;
        const cells = COLUMNS.map(([k], ci) => {
          const m = g.cells ? g.cells[k] : 'wrong';
          const text = Array.isArray(c[k]) ? c[k].join(', ') : String(c[k]);
          const arrow = k === 'year' && g.cells && g.cells.arrow ? `<span class="arrow">${g.cells.arrow === 'up' ? ICON.up : ICON.down}</span>` : '';
          return `<div class="cell ${m} ${fresh ? 'flip' : ''}" style="${fresh ? `animation-delay:${0.15 + ci * 0.2}s` : ''}">${arrow}<span>${esc(text)}</span></div>`;
        }).join('');
        return `<div class="crow"><div class="cell champ ${fresh ? 'pop' : ''}">${champIcon(g.id, 80)}<span class="name">${esc(c.name)}</span></div>${cells}</div>`;
      }).join('');
      return `<div class="table-wrap"><div class="ctable">${head}${rows}</div></div>`;
    }
    return `<ul class="guess-list">${list.map((g, i) => `<li class="${g.correct ? 'right' : 'wrong'} ${i === 0 && g.fresh ? 'flip' : ''}">${champIcon(g.id, 40)}<b>${esc(BY_ID[g.id].name)}</b><small>#${list.length - i}</small></li>`).join('')}</ul>`;
  }

  function roomHTML() {
    const host = room.host_id === sess.playerId;
    const modeName = (MODE_BY_ID[room.mode] || MODES[0]).name;
    const top = `
      <section class="frame top-panel">
        <div class="top-row">
          <div><small class="muted">SALA · ${esc(modeName)}</small><div class="room-code">${esc(room.code)}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" type="button" data-x1="copy">${ICON.share.replace('<svg', '<svg width="18" height="18"')} Copiar convite</button>
            <button class="btn-link" type="button" data-x1="leave">Sair</button>
          </div>
        </div>
        ${host && room.status !== 'playing' ? `<div class="chips">${MODES.map((m) => `<button class="chip ${m.id === room.mode ? 'on' : ''}" type="button" data-x1-mode="${m.id}">${ICON[m.id]}<span class="lbl">${m.name}</span></button>`).join('')}</div>` : ''}
        <p class="toast" id="x1-toast"></p>
      </section>`;

    let center = '';
    if (room.status === 'lobby') {
      center = `<section class="frame notice">${players.length < 2
        ? `Mande o código <b>${esc(room.code)}</b> ou o convite para o seu amigo. A sala abre sozinha quando ele entrar.`
        : host ? `<button class="btn btn-hex" type="button" data-x1="start" ${busy ? 'disabled' : ''}>COMEÇAR RODADA</button>` : 'Tudo pronto. Esperando o anfitrião começar…'}</section>`;
    } else {
      const left = room.starts_at ? Date.parse(room.starts_at) - Date.now() : 0;
      if (room.status === 'playing' && left > 0) {
        center = `<section class="frame clue"><p class="muted" style="margin:0">A rodada começa em</p><div class="big-count" data-count>${Math.ceil(left / 1000)}</div></section>`;
      } else {
        const meP = me();
        const finished = room.status === 'finished';
        center = `
          <section class="frame clue">
            <h1 class="title">${esc(MODE_BY_ID[room.mode].heading)}</h1>
            ${clueHTML()}
            <p class="attempts">Tentativas: <b>${(mine && mine.list.length) || 0}</b></p>
          </section>
          ${!finished && meP && !meP.finished ? `
            <div class="search" id="x1-search">
              <form autocomplete="off">
                <input type="text" id="x1-input" placeholder="Digite o nome de um campeão…" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="x1-sug" aria-label="Nome do campeão">
                <button type="submit" class="btn btn-gold" aria-label="Enviar tentativa">${ICON.send}</button>
              </form>
              <ul class="suggestions" id="x1-sug" role="listbox" hidden></ul>
            </div>` : ''}
          ${finished ? resultHTML() : ''}`;
      }
    }
    return `<div class="kicker"><b>X1 AO VIVO</b></div>${top}${playersHTML()}${center}${room.status !== 'lobby' ? guessesHTML() : ''}`;
  }

  function resultHTML() {
    const winner = players.find((p) => p.id === room.winner_id);
    const iWon = room.winner_id === sess.playerId;
    const host = room.host_id === sess.playerId;
    const a = answer && BY_ID[answer];
    return `
      <section class="frame result ${iWon ? 'won' : 'lost'}">
        <h2>${iWon ? 'Vitória!' : winner ? `${esc(winner.name)} venceu` : 'Fim da rodada'}</h2>
        ${a ? `<div class="who">${champIcon(answer, 72)}<div><span class="muted">O campeão era</span><strong>${esc(a.name)}</strong></div></div>` : ''}
        <div class="actions">
          ${host ? `<button class="btn btn-hex" type="button" data-x1="start" ${busy ? 'disabled' : ''}>REVANCHE</button>` : '<span class="muted">Esperando o anfitrião pedir revanche…</span>'}
        </div>
      </section>`;
  }

  function html(route) {
    if (!configured) {
      return `<div class="kicker"><b>X1 AO VIVO</b></div>
        <section class="frame notice">O X1 ainda não foi configurado neste site. Ele precisa de um projeto no Supabase configurado.</section>`;
    }
    if (libState === 'error') return '<section class="frame notice">Não foi possível carregar o X1. Verifique sua conexão. Na versão do jogo dentro do Claude o X1 não funciona, abra pelo site.</section>';
    loadLib();
    if (libState !== 'ready') return spinner('Conectando ao X1…');
    const err = error ? `<section class="frame notice" style="border-color:#a5292c">${esc(error)}</section>` : '';
    if (route.room && sess && sess.code !== route.room) {
      return `${err}<section class="frame notice">Você já está na sala <b>${esc(sess.code)}</b>. Saia dela para entrar na <b>${esc(route.room)}</b>.
        <div style="margin-top:12px;display:flex;gap:10px;justify-content:center"><a class="btn" href="#x1">Voltar à minha sala</a><button class="btn btn-gold" type="button" data-x1="leave">Sair e entrar</button></div></section>`;
    }
    if (!sess) return err + lobbyHTML(route.room);
    if (!room) return err + spinner('Entrando na sala…');
    return err + roomHTML();
  }

  /* ---------- interação ---------- */
  function bind(route) {
    const app = document.getElementById('app');
    const create = app.querySelector('#x1-create');
    if (create) create.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(create);
      write('x1:name', String(f.get('name') || '').trim());
      act(async () => {
        const r = await call('create', { name: f.get('name'), mode: f.get('mode') });
        saveSession({ code: r.code, playerId: r.playerId, token: r.token, channelKey: r.channelKey });
        connect();
        if (location.hash !== '#x1') location.hash = 'x1';
      });
    });
    const join = app.querySelector('#x1-join');
    if (join) join.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(join);
      write('x1:name', String(f.get('name') || '').trim());
      act(async () => {
        const r = await call('join', { name: f.get('name'), code: String(f.get('code') || '').toUpperCase() });
        saveSession({ code: r.code, playerId: r.playerId, token: r.token, channelKey: r.channelKey });
        connect();
        if (location.hash !== '#x1') location.hash = 'x1';
      });
    });

    app.querySelectorAll('[data-x1]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.x1;
      if (a === 'start') act(() => call('start', { code: sess.code, token: sess.token }));
      if (a === 'leave') {
        const target = route.room && sess && sess.code !== route.room ? route.room : null;
        act(async () => {
          try { await call('leave', { code: sess.code, token: sess.token }); } catch { /* sala já não existe */ }
          clearSession();
          location.hash = target ? `x1-${target}` : 'x1';
        });
      }
      if (a === 'copy') {
        const text = `Bora um X1 no Runedle? Sala ${sess.code}: ${shareLink(sess.code)}`;
        const toast = document.getElementById('x1-toast');
        navigator.clipboard.writeText(text)
          .then(() => { if (toast) toast.textContent = 'Convite copiado!'; })
          .catch(() => { if (toast) toast.textContent = text; });
      }
    }));
    app.querySelectorAll('[data-x1-mode]').forEach((b) => b.addEventListener('click', () => {
      act(() => call('mode', { code: sess.code, token: sess.token, mode: b.dataset.x1Mode }));
    }));

    bindSearch();
  }

  function bindSearch() {
    const input = document.getElementById('x1-input');
    if (!input) return;
    const list = document.getElementById('x1-sug');
    let items = [];
    let active = 0;
    const compute = () => {
      const q = normalize(input.value);
      if (!q) return [];
      const used = new Set(((mine && mine.list) || []).map((g) => g.id));
      const pool = CHAMPIONS.filter((c) => !used.has(c.id));
      const starts = pool.filter((c) => normalize(c.name).startsWith(q));
      return starts.concat(pool.filter((c) => !starts.includes(c) && normalize(c.name).includes(q))).slice(0, 8);
    };
    const draw = () => {
      list.hidden = !input.value.trim();
      input.setAttribute('aria-expanded', String(!list.hidden && items.length > 0));
      list.innerHTML = items.length
        ? items.map((c, i) => `<li role="option" data-id="${c.id}" aria-selected="${i === active}" class="${i === active ? 'active' : ''}">${champIcon(c.id, 36)}<span>${esc(c.name)}</span></li>`).join('')
        : '<li class="empty">Nenhum campeão encontrado (ou você já tentou).</li>';
    };
    const submit = (id) => {
      const pick = id || (items[active] && items[active].id);
      if (!pick || busy) return;
      act(async () => {
        const r = await call('guess', { code: sess.code, token: sess.token, championId: pick });
        mine.list.forEach((g) => { g.fresh = false; });
        mine.list.unshift({ id: pick, correct: r.correct, cells: r.cells, fresh: true });
        write('x1:guesses', mine);
        if (r.clue && clue) clue = { ...clue, clue: r.clue };
        if (r.correct) answer = pick;
      });
    };
    input.addEventListener('input', () => { items = compute(); active = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
      else if (e.key === 'Escape') list.hidden = true;
    });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
    input.form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-id]');
      if (li) { e.preventDefault(); submit(li.dataset.id); }
    });
    if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
  }

  /* ---------- coluna social ---------- */
  function socialHTML() {
    if (!configured) return '<span class="muted" style="font-size:12px">Disponível quando o X1 for configurado.</span>';
    if (!sess) return '<a href="#x1" class="btn btn-hex" style="width:100%">CRIAR OU ENTRAR</a>';
    const status = !room ? 'conectando…' : room.status === 'lobby' ? `${players.length}/2 na sala` : room.status === 'playing' ? 'rodada em andamento' : 'rodada encerrada';
    return `<a href="#x1" class="mini-row">${ICON.share}<span>Sala ${esc(sess.code)}</span><small class="st-play">${status}</small></a>
      ${players.map((p) => `<span class="mini-row" style="padding-left:26px"><span>${esc(p.name)}</span><small>${p.attempts} tent.</small></span>`).join('')}`;
  }

  R.registerView('x1', {
    html, bind, socialHTML,
    inRoom: () => !!(sess && room && room.status === 'playing'),
  });

  // reconecta a uma sala em andamento ao abrir o site
  if (configured && sess) loadLib();
})();
