import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePromptPath, loadPromptTemplate } from '../src/prompts.js';
import {
  normalizeEnding,
  localizeEnding,
  ENDING_EN_ALIASES,
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

describe('lang-aware prompt template loading', () => {
  test('cn resolves to base templates, en resolves to prompts/en/', () => {
    assert.ok(!resolvePromptPath('outline.md', 'cn').includes('/en/'));
    assert.ok(resolvePromptPath('outline.md', 'en').includes('/en/'));
  });

  test('unknown localized template falls back to the base file', () => {
    const p = resolvePromptPath('story-bible.md', 'en');
    assert.ok(!p.includes('/en/'), 'should fall back to base story-bible.md');
  });

  test('every en template exists and keeps its placeholders', () => {
    const required = {
      'outline.md': ['{{materials}}'],
      'tail-outline.md': ['{{title}}', '{{synopsis}}', '{{priorEpisodes}}', '{{targetEnding}}', '{{splitIdx}}', '{{lastIdx}}', '{{tailCount}}', '{{snowflakeSummary}}', '{{priorLastIdx}}', '{{genres}}'],
      'clips.md': ['{{title}}', '{{synopsis}}', '{{characters}}', '{{episodeTitle}}', '{{episodeIndex}}', '{{clipIndex}}', '{{totalClips}}', '{{clipSummary}}', '{{isConclusion}}', '{{priorClipDigest}}', '{{retrievedScenes}}', '{{stateContext}}', '{{tropeSection}}', '{{referenceCharacter}}', '{{referenceEvent}}'],
      'plan.md': ['{{outline}}'],
      'research.md': ['{{history}}', '{{webResearch}}'],
      'snowflake.md': ['{{materials}}', '{{partNumber}}', '{{partTitle}}', '{{partInstructions}}'],
    };
    for (const [name, placeholders] of Object.entries(required)) {
      const tpl = loadPromptTemplate(name, 'en');
      for (const ph of placeholders) {
        assert.ok(tpl.includes(ph), `${name} (en) missing placeholder ${ph}`);
      }
    }
  });
});

describe('English prompt builders', () => {
  const materials = { topics: [{ title: 't', premise: 'p' }] };

  test('buildOutlinePrompt(en) uses the English template and English ending enum', () => {
    const prompt = buildOutlinePrompt(materials, 'en');
    assert.match(prompt, /ENGLISH-language short drama/);
    assert.match(prompt, /"triumph"/);
    assert.ok(!prompt.includes('你是短剧编剧'));
  });

  test('buildOutlinePrompt(cn) still uses the Chinese template', () => {
    const prompt = buildOutlinePrompt(materials, 'cn');
    assert.match(prompt, /你是短剧编剧/);
  });

  test('buildClipPrompt(en) uses the English template with (none) placeholders', () => {
    const prompt = buildClipPrompt({ outline: { title: 'T' }, episode: {}, lang: 'en' });
    assert.match(prompt, /vertical-video drama clip in ENGLISH/);
    assert.match(prompt, /\(none\)/);
    assert.ok(!prompt.includes('（无）'));
  });

  test('buildClipPrompt(en) author voice section is in English', () => {
    const prompt = buildClipPrompt({ outline: {}, episode: {}, lang: 'en', authorVoice: 'Write tersely.' });
    assert.match(prompt, /## Author Voice/);
    assert.match(prompt, /Write tersely\./);
    assert.ok(!prompt.includes('文风'));
  });

  test('buildPlanPrompt / buildResearchPrompt / buildSnowflakePrompt pick en templates', () => {
    assert.match(buildPlanPrompt({ episodes: [] }, 'en'), /short-drama narrative planner/);
    assert.match(buildResearchPrompt([], 'data', 'en'), /short-drama materials researcher/);
    assert.match(buildSnowflakePrompt(materials, 0, [], 'en'), /Snowflake Method to plan this ENGLISH-language/);
  });
});

describe('ending normalization', () => {
  test('English aliases normalize to canonical CN tokens', () => {
    assert.equal(normalizeEnding('triumph'), '爽爆');
    assert.equal(normalizeEnding('Bittersweet'), '苦尽甘来');
    assert.equal(normalizeEnding(' TWIST '), '反转');
  });

  test('canonical tokens and unknown values pass through', () => {
    assert.equal(normalizeEnding('爽爆'), '爽爆');
    assert.equal(normalizeEnding('nonsense'), 'nonsense');
    assert.equal(normalizeEnding(null), null);
  });

  test('every alias maps onto a valid canonical ending', () => {
    for (const cn of Object.values(ENDING_EN_ALIASES)) {
      assert.ok(VALID_ENDINGS.includes(cn));
    }
  });

  test('localizeEnding renders CN tokens as English for lang=en only', () => {
    assert.equal(localizeEnding('爽爆', 'en'), 'triumph');
    assert.equal(localizeEnding('爽爆', 'cn'), '爽爆');
  });

  test('parseClip accepts an English conclusion ending', async () => {
    const raw = JSON.stringify({
      clipIndex: 0,
      setting: 'Office at night',
      action: 'Lucas slams the contract on the desk.',
      dialogue: '[narrator]\nIt was over.',
      hook: '',
      durationSec: 12,
      isConclusion: true,
      conclusion: { title: 'Finale', overview: 'He wins.', type: 'DRAMA_END', ending: 'triumph' },
    });
    const clip = await parseClip(raw);
    assert.equal(clip.conclusion.ending, 'GOOD');
  });

  test('parseOutline accepts an English final-episode ending', async () => {
    const mkEp = (i, last) => ({
      episodeIndex: i,
      title: `Episode ${i + 1}`,
      isEnding: last,
      ending: last ? 'twist' : null,
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

describe('English retry/fallback clips', () => {
  test('retry prompt localizes the ending token and limits for en', () => {
    const p = buildRetryClipPrompt({ isConclusion: true, ending: '爽爆', lang: 'en' });
    assert.match(p, /"ending": "triumph"/);
    assert.match(p, /Write everything in English/);
  });

  test('retry prompt stays CN-flavored for cn', () => {
    const p = buildRetryClipPrompt({ isConclusion: true, ending: '爽爆', lang: 'cn' });
    assert.match(p, /"ending": "爽爆"/);
    assert.match(p, /CN-char limits/);
  });

  test('fallback clip is English for lang=en and round-trips parseClip', async () => {
    const clip = buildFallbackClip({ clipIndex: 2, summary: 'Lucas exposes the villain in public', lang: 'en' });
    assert.equal(clip.setting, 'Scene · Time · Mood');
    assert.match(clip.action, /Lucas exposes the villain/);
    assert.equal(clip.hook, 'Close-up on a key prop');
    await assert.doesNotReject(() => parseClip(JSON.stringify({ ...clip, conclusion: null })));
  });

  test('English conclusion fallback uses English title/overview', () => {
    const clip = buildFallbackClip({ clipIndex: 0, isConclusion: true, ending: 'nonsense', lang: 'en' });
    assert.equal(clip.conclusion.title, 'Finale');
    assert.equal(clip.conclusion.ending, 'GOOD');
  });

  test('English selftell fallback prepends "I" not 我', () => {
    const outline = { characters: [{ name: 'Lucas', role: 'protagonist' }] };
    const clip = buildFallbackClip({ clipIndex: 0, summary: 'Lucas walks away', mode: 'selftell', lang: 'en', outline });
    assert.match(clip.action, /^I/);
    assert.ok(!clip.action.includes('我'));
  });

  test('CN fallback behavior is unchanged', () => {
    const clip = buildFallbackClip({ clipIndex: 0, summary: '陆衡揭露反派', lang: 'cn' });
    assert.equal(clip.setting, '场景 · 时间 · 氛围');
    assert.equal(clip.hook, '镜头特写关键道具');
  });
});

describe('variant labels', () => {
  test('en variants localize labels but keep canonical ending tokens and keys', () => {
    const cn = variantsForLang('cn');
    const en = variantsForLang('en');
    assert.deepEqual(cn.map(v => v.key), en.map(v => v.key));
    assert.deepEqual(cn.map(v => v.ending), en.map(v => v.ending));
    assert.deepEqual(en.map(v => v.label), ['Triumphant Ending', 'Bittersweet Ending', 'Twist Ending']);
    assert.equal(cn[0].label, '爽爆结局');
  });
});
