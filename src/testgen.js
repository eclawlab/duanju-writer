// Test-run harness: fast, no-upload prose comparisons that isolate ONE variable
// at a time by holding the outline/plan fixed across configs and samples.
//
// Configs (selectable via --configs):
//   A  baseline    — older model + light prompt   (claude-opus-4-7, richContext:false)
//   B  model probe — newer model + light prompt   (claude-opus-4-8, richContext:false)
//   C  prompt probe— older model + rich  prompt   (claude-opus-4-7, richContext:true)
// Isolations: A vs B = MODEL (prompt fixed); A vs C = PROMPT (model fixed).
//
// --max-episodes N writes the first N episodes per run (so the semantic-retrieval
// block, inert in episode 1, actually fires from episode 2+). --samples K repeats
// each config K times to beat run-to-run noise. Each run gets its OWN ephemeral
// (in-memory, never saved) vector store so retrieval can't leak across runs.
// Nothing is uploaded; only a temp dir is touched for --story bible extraction.

import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDrama } from './drama-writer.js';
import { createClaudeCliAdapter } from './llm.js';
import { createStore } from './vectorstore.js';
import { loadConfig } from './config.js';
import { countWords } from './enrichment.js';
import { extractStoryArtifacts, synthMaterialsFromBible } from './worker.js';

const DEFAULT_MATERIALS = {
  topics: [{ title: '重生归来的逆袭', premise: '主角在事业与婚姻同时崩塌的午夜重生回到三年前，誓要拿回被夺走的一切并揪出背叛者。' }],
  plotHooks: [{ hook: '重生当晚，主角收到一条本应在三年后才出现的短信。' }],
  characterArchetypes: [{ archetype: '隐忍蛰伏的重生者' }, { archetype: '笑里藏刀的旧日盟友' }, { archetype: '半信半疑的现任对手' }],
  trendingTropes: ['重生', '打脸逆袭', '都市豪门'],
};

const CONFIGS = {
  A: { label: 'baseline',    rich: false, which: 'old' },
  B: { label: 'model probe', rich: false, which: 'new' },
  C: { label: 'prompt probe', rich: true, which: 'old' },
};

// A clip fell back to buildFallbackClip when its content carries these sentinels.
const FALLBACK_MARKERS = ['场景 · 时间 · 氛围', '镜头特写关键道具'];
const isFallback = (text = '') => FALLBACK_MARKERS.some(m => text.includes(m));

function makeLlmFn(model, claudePath, timeout) {
  const adapter = createClaudeCliAdapter({ claudePath, timeout, model });
  return (prompt /* , role */) => adapter.call(prompt);
}

// One-line health summary per episode: clip count, words, and any degraded clips.
function episodeSummary(story) {
  return (story?.episodes || []).map(ep => {
    const scenes = ep.scenes || [];
    const words = scenes.reduce((s, sc) => s + countWords(sc.content || ''), 0);
    const fb = scenes.filter(sc => isFallback(sc.content || '')).length;
    return `  ep${ep.episodeIndex}: ${scenes.length} clips · ${words}字${fb ? ` · ⚠ ${fb} fallback` : ''}`;
  }).join('\n');
}

function printEpisode(heading, story, epIdx) {
  const bar = '═'.repeat(72);
  console.log(`\n${bar}\n${heading}\n${bar}`);
  const ep = story?.episodes?.[epIdx];
  if (!ep) { console.log('(no episode at that index)'); return; }
  console.log(`第 ${ep.episodeIndex} 集 · ${ep.title || ''}`);
  (ep.scenes || []).forEach((s, i) => {
    const text = (s.content || '').trim();
    const flag = isFallback(text) ? '  ⚠FALLBACK' : '';
    console.log(`\n── 片段 ${i + 1}${flag} ──\n${text || '(空)'}`);
  });
}

async function materialsFromStory(storyPath, log) {
  const storyText = readFileSync(storyPath, 'utf8');
  const jobDir = mkdtempSync(join(tmpdir(), 'duanju-testgen-'));
  log(`Extracting story bible from ${storyPath} (temp ${jobDir})...`);
  const { bible, chapters } = await extractStoryArtifacts({ jobDir, storyText, log });
  log(`Bible: ${bible.characters?.length || 0} characters, ${chapters.chapters?.length || 0} chapters`);
  return { materials: synthMaterialsFromBible(bible), bible, chapters: chapters.chapters };
}

export async function runTestGen(opts = {}) {
  const config = loadConfig();
  const claudePath = config.providers?.claude?.claudePath || 'claude';
  const timeout = config.providers?.claude?.timeout || 1500000;

  const modelByWhich = { old: opts.modelBefore || 'claude-opus-4-7', new: opts.modelAfter || 'claude-opus-4-8' };
  const lang = opts.lang || 'cn';
  const genre = opts.genre || '';
  const style = opts.style || '重生复仇';
  const mode = opts.mode || 'default';
  const fidelity = opts.fidelity || 'medium';
  const authorStyle = opts.authorStyle || '';
  const episodesPerDrama = opts.episodes || 4;
  const clipsPerEpisode = opts.clipsPerEpisode || 4;
  const maxEpisodes = opts.maxEpisodes || 1;
  const samples = opts.samples || 1;
  const selected = (opts.configs && opts.configs.length ? opts.configs : ['A', 'B', 'C']).filter(id => CONFIGS[id]);

  const log = (m) => console.log(`  ${m}`);

  let materials = opts.materials || DEFAULT_MATERIALS;
  let bible = null, chapters = null;
  if (opts.storyPath) {
    const fromStory = await materialsFromStory(opts.storyPath, log);
    materials = fromStory.materials; bible = fromStory.bible; chapters = fromStory.chapters;
  }

  console.log('Test run — no upload. Configs:');
  for (const id of selected) {
    const c = CONFIGS[id];
    console.log(`  ${id} ${c.label}: ${c.rich ? 'rich' : 'light'} prompt + ${modelByWhich[c.which]}`);
  }
  console.log(`  trope=${style} mode=${mode} authorStyle=${authorStyle || '(none)'} ` +
    `story=${opts.storyPath || '(default premise)'} maxEpisodes=${maxEpisodes} samples=${samples}`);

  const shared = { lang, genre, style, mode, fidelity, authorStyle, episodesPerDrama, clipsPerEpisode, bible, chapters, maxEpisodes };

  // The first generation builds the shared snowflake/outline/plan (captured via
  // callbacks); every later run reuses them verbatim so only model + prompt vary.
  let saved = null;
  const runs = []; // { id, sample, story }

  for (const id of selected) {
    const cfg = CONFIGS[id];
    const model = modelByWhich[cfg.which];
    for (let s = 1; s <= samples; s++) {
      const tag = `${id}${samples > 1 ? `#${s}` : ''} (${cfg.label} · ${cfg.rich ? 'rich' : 'light'} · ${model})`;
      console.log(`\n>>> ${tag}${saved ? '' : '  [also building shared outline/plan]'}...`);
      // Fresh ephemeral store per run so the rich config retrieves only from its
      // OWN earlier episodes, and the light config's indexing can't leak across runs.
      const vsDir = mkdtempSync(join(tmpdir(), 'duanju-vs-'));
      const vectorStore = createStore(join(vsDir, 'vs.json'));
      vectorStore.load();
      const capture = saved ? saved : {
        onSnowflake: (x) => { saved = { ...(saved || {}), savedSnowflake: x }; },
        onOutline: (x) => { saved = { ...(saved || {}), savedOutline: x }; },
        onPlan: (x) => { saved = { ...(saved || {}), savedPlan: x }; },
      };
      const story = await generateDrama(materials, {
        ...shared, ...(saved || {}), richContext: cfg.rich, vectorStore,
        llmFn: makeLlmFn(model, claudePath, timeout),
        ...(saved ? {} : capture),
        log,
      });
      runs.push({ id, sample: s, tag, story });
    }
  }

  // Print the LAST generated episode of each run (where retrieval is live), plus
  // a per-episode health summary for the whole run.
  const lastIdx = maxEpisodes - 1;
  for (const r of runs) {
    printEpisode(`${r.tag}  — episode ${r.story.episodes?.[lastIdx]?.episodeIndex ?? '?'}`, r.story, lastIdx);
    console.log(`\n[run health]\n${episodeSummary(r.story)}`);
  }

  console.log('\n────────────────────────────────────────────────────────────────────────');
  console.log('ISOLATION — MODEL  (prompt fixed = light):  A vs B');
  console.log('ISOLATION — PROMPT (model fixed = old):     A vs C');
  console.log(`Shared outline/plan across all runs. Printed episode = last of ${maxEpisodes}` +
    (maxEpisodes > 1 ? ' (semantic-retrieval block active from ep.2+).' : ' (retrieval inert at ep.1).'));
  console.log('────────────────────────────────────────────────────────────────────────');

  return { runs, outline: saved?.savedOutline };
}
