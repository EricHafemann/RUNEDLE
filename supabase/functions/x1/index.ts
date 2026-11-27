// Runedle · X1 ao vivo — função do servidor (Supabase Edge Function)
// Guarda o campeão secreto, confere cada palpite e decide o vencedor.
// O navegador nunca recebe a resposta antes de acertar.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CHAMPIONS, QUOTES } from './data.ts';

type Champ = (typeof CHAMPIONS)[string];

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
class Fail extends Error { constructor(msg: string, public status = 400) { super(msg); } }

const MODES = ['classic', 'quote', 'ability', 'emoji', 'splash'];
const DD = 'https://ddragon.leagueoflegends.com';
const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';
const COLS = ['gender', 'positions', 'species', 'resource', 'range', 'regions', 'year'] as const;

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const cleanName = (s: unknown) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Invocador';

/* ---------- comparação do Classic (mesma regra do jogo) ---------- */
function list(a: string[], b: string[]) {
  if (a.length === b.length && a.every((x) => b.includes(x))) return 'correct';
  return a.some((x) => b.includes(x)) ? 'partial' : 'wrong';
}
function compare(g: Champ, t: Champ) {
  return {
    gender: g.gender === t.gender ? 'correct' : 'wrong',
    positions: list(g.positions, t.positions),
    species: list(g.species, t.species),
    resource: g.resource === t.resource ? 'correct' : 'wrong',
    range: list(g.range, t.range),
    regions: list(g.regions, t.regions),
    year: g.year === t.year ? 'correct' : 'wrong',
    arrow: g.year === t.year ? null : g.year < t.year ? 'up' : 'down',
  };
}

/* ---------- imagens como data URL (o nome do arquivo entregaria a resposta) ---------- */
async function dataUrl(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`imagem ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${res.headers.get('content-type') ?? 'image/png'};base64,${btoa(bin)}`;
}

async function makeClue(mode: string, id: string) {
  const c = CHAMPIONS[id];
  if (mode === 'quote') return { quote: pick(QUOTES[id]) };
  if (mode === 'emoji') return { emojis: c.emojis };
  if (mode === 'ability') {
    const key = pick(['Q', 'W', 'E', 'R']);
    try {
      const info = await (await fetch(`${CD}/v1/champions/${c.key}.json`)).json();
      const sp = info.spells.find((s: { spellKey: string }) => s.spellKey.toUpperCase() === key);
      return { img: await dataUrl(`${CD}/${sp.abilityIconPath.replace('/lol-game-data/assets/', '').toLowerCase()}`), key };
    } catch {
      const v = (await (await fetch(`${DD}/api/versions.json`)).json())[0];
      const d = (await (await fetch(`${DD}/cdn/${v}/data/pt_BR/champion/${id}.json`)).json()).data[id];
      return { img: await dataUrl(`${DD}/cdn/${v}/img/spell/${d.spells['QWER'.indexOf(key)].image.full}`), key };
    }
  }
  if (mode === 'splash') {
    return { img: await dataUrl(`${DD}/cdn/img/champion/splash/${id}_0.jpg`), ox: 25 + Math.random() * 50, oy: 20 + Math.random() * 45 };
  }
  return {};
}

/* ---------- acesso à sala ---------- */
async function getRoom(code: string) {
  const { data } = await db.from('x1_rooms').select('*').eq('code', code).maybeSingle();
  if (!data) throw new Fail('Sala não encontrada.', 404);
  return data;
}
async function auth(code: string, token: string) {
  const { data: players } = await db.from('x1_players').select('id').eq('room_code', code);
  const ids = (players ?? []).map((p) => p.id);
  if (!ids.length) throw new Fail('Sala vazia.', 404);
  const { data } = await db.from('x1_tokens').select('player_id').in('player_id', ids).eq('token', String(token)).maybeSingle();
  if (!data) throw new Fail('Você não está nesta sala.', 403);
  return data.player_id as string;
}
async function addPlayer(code: string, name: string) {
  const { data: p, error } = await db.from('x1_players').insert({ room_code: code, name: cleanName(name) }).select('id').single();
  if (error) throw error;
  const token = crypto.randomUUID();
  await db.from('x1_tokens').insert({ player_id: p.id, token });
  return { playerId: p.id, token };
}

/* ---------- ações ---------- */
const ACTIONS: Record<string, (b: Record<string, string>) => Promise<unknown>> = {
  async create(b) {
    const mode = MODES.includes(b.mode) ? b.mode : 'classic';
    await db.rpc('x1_cleanup');
    const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 6; i++) {
      const code = Array.from({ length: 4 }, () => pick([...ABC])).join('');
      const { error } = await db.from('x1_rooms').insert({ code, mode });
      if (error) continue; // código repetido: tenta outro
      const me = await addPlayer(code, b.name);
      await db.from('x1_rooms').update({ host_id: me.playerId }).eq('code', code);
      return { code, ...me };
    }
    throw new Fail('Não foi possível criar a sala. Tente de novo.', 500);
  },

  async join(b) {
    const code = String(b.code ?? '').toUpperCase();
    const room = await getRoom(code);
    if (room.status === 'playing') throw new Fail('A partida já começou.');
    const { count } = await db.from('x1_players').select('id', { count: 'exact', head: true }).eq('room_code', code);
    if ((count ?? 0) >= 2) throw new Fail('A sala já está cheia.');
    return { code, ...(await addPlayer(code, b.name)) };
  },

  async mode(b) {
    const room = await getRoom(b.code);
    const me = await auth(b.code, b.token);
    if (room.host_id !== me) throw new Fail('Só quem criou a sala escolhe o modo.', 403);
    if (room.status === 'playing') throw new Fail('Espere a rodada terminar.');
    if (!MODES.includes(b.mode)) throw new Fail('Modo inválido.');
    await db.from('x1_rooms').update({ mode: b.mode, updated_at: new Date().toISOString() }).eq('code', b.code);
    return { ok: true };
  },

  async start(b) {
    const room = await getRoom(b.code);
    const me = await auth(b.code, b.token);
    if (room.host_id !== me) throw new Fail('Só quem criou a sala pode começar.', 403);
    if (room.status === 'playing') throw new Fail('A rodada já está em andamento.');
    const { count } = await db.from('x1_players').select('id', { count: 'exact', head: true }).eq('room_code', b.code);
    if ((count ?? 0) < 2) throw new Fail('Espere o adversário entrar.');
    const pool = Object.keys(CHAMPIONS).filter((id) => room.mode !== 'quote' || QUOTES[id]?.length);
    const target = pick(pool);
    const clue = await makeClue(room.mode, target);
    await db.from('x1_secrets').upsert({ room_code: b.code, target_id: target, clue });
    await db.from('x1_players').update({ attempts: 0, progress: 0, finished: false, won: false, finished_at: null }).eq('room_code', b.code);
    await db.from('x1_rooms').update({
      status: 'playing', round: room.round + 1, winner_id: null,
      starts_at: new Date(Date.now() + 4000).toISOString(), updated_at: new Date().toISOString(),
    }).eq('code', b.code);
    return { ok: true };
  },

  async clue(b) {
    const room = await getRoom(b.code);
    await auth(b.code, b.token);
    if (room.status === 'lobby') throw new Fail('A rodada ainda não começou.');
    const { data } = await db.from('x1_secrets').select('clue').eq('room_code', b.code).single();
    return { round: room.round, mode: room.mode, clue: data?.clue ?? {} };
  },

  async guess(b) {
    const room = await getRoom(b.code);
    const me = await auth(b.code, b.token);
    if (room.status !== 'playing') throw new Fail('Não há rodada em andamento.');
    if (room.starts_at && Date.now() < Date.parse(room.starts_at) - 500) throw new Fail('Espere a contagem.');
    const g = CHAMPIONS[b.championId];
    if (!g) throw new Fail('Campeão inválido.');
    const { data: player } = await db.from('x1_players').select('*').eq('id', me).single();
    if (player.finished) throw new Fail('Você já terminou esta rodada.');
    const { data: secret } = await db.from('x1_secrets').select('target_id').eq('room_code', b.code).single();
    const t = CHAMPIONS[secret.target_id];
    const correct = b.championId === secret.target_id;
    const cells = room.mode === 'classic' ? compare(g, t) : null;
    const progress = cells ? COLS.filter((k) => cells[k] === 'correct').length : player.progress;
    const now = new Date().toISOString();
    await db.from('x1_players').update({
      attempts: player.attempts + 1, progress, finished: correct, won: correct, finished_at: correct ? now : null,
    }).eq('id', me);
    if (correct) {
      // o primeiro a acertar vence (a condição evita empate por corrida)
      await db.from('x1_rooms').update({ winner_id: me, status: 'finished', updated_at: now }).eq('code', b.code).is('winner_id', null);
    }
    return { correct, cells, attempts: player.attempts + 1, answer: correct ? secret.target_id : null };
  },

  async reveal(b) {
    const room = await getRoom(b.code);
    await auth(b.code, b.token);
    if (room.status !== 'finished') throw new Fail('A rodada ainda não terminou.');
    const { data } = await db.from('x1_secrets').select('target_id').eq('room_code', b.code).single();
    return { answer: data?.target_id ?? null };
  },

  async leave(b) {
    const me = await auth(b.code, b.token);
    await db.from('x1_players').delete().eq('id', me);
    const { count } = await db.from('x1_players').select('id', { count: 'exact', head: true }).eq('room_code', b.code);
    if (!count) await db.from('x1_rooms').delete().eq('code', b.code);
    else await db.from('x1_rooms').update({ status: 'lobby', updated_at: new Date().toISOString() }).eq('code', b.code);
    return { ok: true };
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json();
    const fn = ACTIONS[String(body.action)];
    if (!fn) throw new Fail('Ação desconhecida.');
    return json(await fn(body));
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500;
    return json({ error: e instanceof Fail ? e.message : 'Erro no servidor do X1.' }, status);
  }
});
