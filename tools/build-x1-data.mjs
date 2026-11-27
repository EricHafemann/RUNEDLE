// Gera supabase/functions/x1/data.ts a partir de js/data.js (rode após mudar campeões ou falas):
//   node tools/build-x1-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/data.js', import.meta.url), 'utf8') + ';this.R=CHAMPION_ROWS;this.Q=QUOTES;this.K=CHAMPION_KEYS;', ctx);

const G = { M: 'Masculino', F: 'Feminino', O: 'Outro' };
const P = { T: 'Top', J: 'Jungle', M: 'Mid', A: 'ADC', S: 'Support' };
const RG = { C: 'Corpo a corpo', D: 'À distância' };
const seg = new Intl.Segmenter('pt', { granularity: 'grapheme' });

const champs = {};
for (const [id, name, g, pos, sp, res, rng, reg, year, emo] of ctx.R) {
  champs[id] = {
    name, key: ctx.K[id], gender: G[g], positions: [...pos].map((x) => P[x]), species: sp.split('|'),
    resource: res, range: [...rng].map((x) => RG[x]), regions: reg.split('|'), year,
    emojis: Array.from(seg.segment(emo), (x) => x.segment).filter((x) => x.trim()),
  };
}
const out = `// Gerado por tools/build-x1-data.mjs a partir de js/data.js. Não edite à mão.
export const CHAMPIONS: Record<string, { name: string; key: number; gender: string; positions: string[]; species: string[]; resource: string; range: string[]; regions: string[]; year: number; emojis: string[] }> = ${JSON.stringify(champs)};
export const QUOTES: Record<string, string[]> = ${JSON.stringify(ctx.Q)};
`;
writeFileSync(new URL('../supabase/functions/x1/data.ts', import.meta.url), out);
console.log(`data.ts gerado com ${Object.keys(champs).length} campeões.`);

// Versão em um arquivo só, para colar no editor de funções do painel do Supabase
const handler = readFileSync(new URL('../supabase/functions/x1/index.ts', import.meta.url), 'utf8');
const bundle = handler
  .replace("import { CHAMPIONS, QUOTES } from './data.ts';", out.replace(/^\/\/.*\n/, '').trim())
  .replace('// Runedle · X1 ao vivo — função do servidor', '// Runedle · X1 ao vivo — função do servidor (ARQUIVO ÚNICO, gerado por tools/build-x1-data.mjs)');
writeFileSync(new URL('../supabase/x1-arquivo-unico.ts', import.meta.url), bundle);
console.log('supabase/x1-arquivo-unico.ts gerado.');
