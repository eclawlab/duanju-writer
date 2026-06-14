import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePromptPath, loadPromptTemplate } from '../src/prompts.js';
import {
  normalizeEnding,
  localizeEnding,
  ENDING_PH_ALIASES,
  VALID_ENDINGS,
  buildOutlinePrompt,
  buildClipPrompt,
  buildRetryClipPrompt,
  buildFallbackClip,
  parseClip,
  parseOutline,
} from '../src/drama-writer.js';
import { buildPlanPrompt } from '../src/planner.js';
import { buildResearchPrompt } from '../src/collector.js';
import { buildSnowflakePrompt } from '../src/snowflake.js';
import { variantsForLang } from '../src/worker.js';

describe('lang-aware prompt template loading (ph)', () => {
  test('ph resolves to prompts/ph/', () => {
    assert.ok(resolvePromptPath('outline.md', 'ph').includes('/ph/'));
  });

  test('unknown localized template falls back to the base file', () => {
    const p = resolvePromptPath('story-bible.md', 'ph');
    assert.ok(!p.includes('/ph/'), 'should fall back to base story-bible.md');
  });

  test('every ph template exists and keeps its placeholders', () => {
    const required = {
      'outline.md': ['{{materials}}'],
      'tail-outline.md': ['{{title}}', '{{synopsis}}', '{{priorEpisodes}}', '{{targetEnding}}', '{{splitIdx}}', '{{lastIdx}}', '{{tailCount}}', '{{snowflakeSummary}}', '{{priorLastIdx}}', '{{genres}}'],
      'clips.md': ['{{title}}', '{{synopsis}}', '{{characters}}', '{{episodeTitle}}', '{{episodeIndex}}', '{{clipIndex}}', '{{totalClips}}', '{{clipSummary}}', '{{isConclusion}}', '{{priorClipDigest}}', '{{retrievedScenes}}', '{{stateContext}}', '{{tropeSection}}', '{{referenceCharacter}}', '{{referenceEvent}}'],
      'plan.md': ['{{outline}}'],
      'research.md': ['{{history}}', '{{webResearch}}'],
      'snowflake.md': ['{{materials}}', '{{partNumber}}', '{{partTitle}}', '{{partInstructions}}'],
    };
    for (const [name, placeholders] of Object.entries(required)) {
      const tpl = loadPromptTemplate(name, 'ph');
      for (const ph of placeholders) {
        assert.ok(tpl.includes(ph), `${name} (ph) missing placeholder ${ph}`);
      }
    }
  });
});

describe('Filipino prompt builders', () => {
  const materials = { topics: [{ title: 't', premise: 'p' }] };

  test('buildOutlinePrompt(ph) uses the Filipino template and Filipino ending enum', () => {
    const prompt = buildOutlinePrompt(materials, 'ph');
    assert.match(prompt, /FILIPINO-language/);
    assert.match(prompt, /"tagumpay"/);
    assert.ok(!prompt.includes('你是短剧编剧'));
  });

  test('buildClipPrompt(ph) uses the Filipino template with (wala) placeholders', () => {
    const prompt = buildClipPrompt({ outline: { title: 'T' }, episode: {}, lang: 'ph' });
    assert.match(prompt, /drama clip in FILIPINO/);
    assert.match(prompt, /\(wala\)/);
    assert.ok(!prompt.includes('（无）'));
  });

  test('buildClipPrompt(ph) author voice section is in Filipino', () => {
    const prompt = buildClipPrompt({ outline: {}, episode: {}, lang: 'ph', authorVoice: 'Sumulat nang maikli.' });
    assert.match(prompt, /Tinig ng May-akda/);
    assert.match(prompt, /Sumulat nang maikli\./);
    assert.ok(!prompt.includes('## Author Voice\n'));
  });

  test('buildPlanPrompt / buildResearchPrompt / buildSnowflakePrompt pick ph templates', () => {
    assert.match(buildPlanPrompt({ episodes: [] }, 'ph'), /Filipino \(Tagalog\)/);
    assert.match(buildResearchPrompt([], 'data', 'ph'), /FILIPINO-language/);
    assert.match(buildSnowflakePrompt(materials, 0, [], 'ph'), /FILIPINO-language/);
  });
});

describe('ending normalization (ph)', () => {
  test('Filipino aliases normalize to canonical CN tokens', () => {
    assert.equal(normalizeEnding('tagumpay'), '爽爆');
    assert.equal(normalizeEnding('Mapait-Matamis'), '苦尽甘来');
    assert.equal(normalizeEnding(' PAGBALIGTAD '), '反转');
  });

  test('every ph alias maps onto a valid canonical ending', () => {
    for (const cn of Object.values(ENDING_PH_ALIASES)) {
      assert.ok(VALID_ENDINGS.includes(cn));
    }
  });

  test('localizeEnding renders CN tokens as Filipino for lang=ph', () => {
    assert.equal(localizeEnding('爽爆', 'ph'), 'tagumpay');
    assert.equal(localizeEnding('苦尽甘来', 'ph'), 'mapait-matamis');
    assert.equal(localizeEnding('爽爆', 'cn'), '爽爆');
    assert.equal(localizeEnding('爽爆', 'en'), 'triumph');
  });

  test('parseClip accepts a Filipino conclusion ending', async () => {
    const raw = JSON.stringify({
      clipIndex: 0,
      setting: 'Opisina sa gabi',
      action: 'Ibinagsak ni Lucas ang kontrata sa mesa.',
      dialogue: '[narrator]\nTapos na ang lahat.',
      hook: '',
      durationSec: 12,
      isConclusion: true,
      conclusion: { title: 'Wakas', overview: 'Nanalo siya.', type: 'DRAMA_END', ending: 'tagumpay' },
    });
    const clip = await parseClip(raw);
    assert.equal(clip.conclusion.ending, 'GOOD');
  });

  test('parseOutline accepts a Filipino final-episode ending', async () => {
    const mkEp = (i, last) => ({
      episodeIndex: i,
      title: `Episode ${i + 1}`,
      isEnding: last,
      ending: last ? 'pagbaligtad' : null,
      clipPlan: Array.from({ length: 4 }, (_, j) => ({ summary: `beat ${j}`, isConclusion: last && j === 3 })),
    });
    const raw = JSON.stringify({
      title: 'T', synopsis: 'S',
      characters: [
        { name: 'A', role: 'protagonist' },
        { name: 'B', role: 'rival' },
        { name: 'C', role: 'ally' },
      ],
      episodes: [mkEp(0, false), mkEp(1, true)],
    });
    const outline = await parseOutline(raw);
    assert.equal(outline.episodes[1].ending, '反转');
  });
});

describe('Filipino retry/fallback clips', () => {
  test('retry prompt localizes the ending token and limits for ph', () => {
    const p = buildRetryClipPrompt({ isConclusion: true, ending: '爽爆', lang: 'ph' });
    assert.match(p, /"ending": "tagumpay"/);
    assert.match(p, /Write everything in Filipino/);
  });

  test('fallback clip is Filipino for lang=ph and round-trips parseClip', async () => {
    const clip = buildFallbackClip({ clipIndex: 2, summary: 'Inilantad ni Lucas ang kontrabida', lang: 'ph' });
    assert.equal(clip.setting, 'Eksena · Oras · Damdamin');
    assert.match(clip.action, /Inilantad ni Lucas/);
    assert.equal(clip.hook, 'Close-up sa mahalagang bagay');
    await assert.doesNotReject(() => parseClip(JSON.stringify({ ...clip, conclusion: null })));
  });

  test('Filipino conclusion fallback uses Filipino title/overview', () => {
    const clip = buildFallbackClip({ clipIndex: 0, isConclusion: true, ending: 'nonsense', lang: 'ph' });
    assert.equal(clip.conclusion.title, 'Wakas');
    assert.equal(clip.conclusion.ending, 'GOOD');
  });

  test('Filipino selftell fallback prepends "Ako" not 我', () => {
    const outline = { characters: [{ name: 'Lucas', role: 'protagonist' }] };
    const clip = buildFallbackClip({ clipIndex: 0, summary: 'Lucas walks away', mode: 'selftell', lang: 'ph', outline });
    assert.match(clip.action, /^Ako/);
    assert.ok(!clip.action.includes('我'));
  });
});

describe('variant labels (ph)', () => {
  test('ph variants localize labels but keep canonical ending tokens and keys', () => {
    const cn = variantsForLang('cn');
    const ph = variantsForLang('ph');
    assert.deepEqual(cn.map(v => v.key), ph.map(v => v.key));
    assert.deepEqual(cn.map(v => v.ending), ph.map(v => v.ending));
    assert.deepEqual(ph.map(v => v.label), ['Matagumpay na Wakas', 'Mapait-matamis na Wakas', 'Wakas na Pabaligtad']);
  });
});
