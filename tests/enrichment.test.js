import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('enrichment', () => {
  test('countWords counts words excluding tags', async () => {
    const { countWords } = await import('../src/enrichment.js');
    const result = countWords('[narrator]\nHello world foo bar');
    assert.equal(result, 4);
  });

  test('countWords handles character tags', async () => {
    const { countWords } = await import('../src/enrichment.js');
    const result = countWords('[character:Alice|voice:alloy]\nShe spoke. He listened.');
    assert.equal(result, 4);
  });

  test('countWords returns 0 for empty/tags-only', async () => {
    const { countWords } = await import('../src/enrichment.js');
    const result = countWords('[narrator]\n[player]');
    assert.equal(result, 0);
  });

  test('needsEnrichment returns true when below 80% target', async () => {
    const { needsEnrichment } = await import('../src/enrichment.js');
    // 10 words content, target 200 → 10 < 160 → true
    const content = 'one two three four five six seven eight nine ten';
    assert.equal(needsEnrichment(content, 200), true);
  });

  test('needsEnrichment returns false when above 80% target', async () => {
    const { needsEnrichment } = await import('../src/enrichment.js');
    // 180 words content, target 200 → 180 >= 160 → false
    const content = Array(180).fill('word').join(' ');
    assert.equal(needsEnrichment(content, 200), false);
  });

  test('needsEnrichment returns false when target is 0', async () => {
    const { needsEnrichment } = await import('../src/enrichment.js');
    const content = 'only a few words here';
    assert.equal(needsEnrichment(content, 0), false);
  });

  test('buildEnrichmentPrompt includes content and target', async () => {
    const { buildEnrichmentPrompt } = await import('../src/enrichment.js');
    const content = 'Alice stepped into the forest.';
    const prompt = buildEnrichmentPrompt(content, 300, 'en');
    assert.ok(prompt.includes(content), 'prompt should include the content');
    assert.ok(prompt.includes('300'), 'prompt should include the target word count');
  });

  test('buildEnrichmentPrompt uses Chinese for cn lang', async () => {
    const { buildEnrichmentPrompt } = await import('../src/enrichment.js');
    const content = '爱丽丝走进了森林。';
    const prompt = buildEnrichmentPrompt(content, 300, 'cn');
    assert.ok(prompt.includes('你正在扩写'), 'prompt should use Chinese opening');
    assert.ok(prompt.includes(content), 'prompt should include the content');
  });

  describe('countChars', () => {
    test('counts only CN characters, ignoring punctuation and ASCII', async () => {
      const { countChars } = await import('../src/enrichment.js');
      assert.equal(countChars('你好，world！这是测试。'), 6);  // 你好这是测试
    });

    test('returns 0 for empty string', async () => {
      const { countChars } = await import('../src/enrichment.js');
      assert.equal(countChars(''), 0);
    });

    test('handles mixed CN/EN/punctuation', async () => {
      const { countChars } = await import('../src/enrichment.js');
      assert.equal(countChars('陆衡推开大门'), 6);
    });

    test('strips scene tags before counting', async () => {
      const { countChars } = await import('../src/enrichment.js');
      assert.equal(countChars('[narrator]\n陆衡归来。'), 4);  // 陆衡归来
    });
  });
});

// Gate behavior: enrichment is opt-in via targetCharsPerClip (0 = disabled).
test('needsEnrichment is disabled when targetWords is 0/falsy', () => {
  assert.equal(needsEnrichment('短', 0), false);
  assert.equal(needsEnrichment('短', undefined), false);
});

test('needsEnrichment triggers only when content is below 80% of target', () => {
  assert.equal(needsEnrichment('一二三四五', 100), true);       // 5 < 80 → expand
  assert.equal(needsEnrichment('字'.repeat(90), 100), false);   // 90 ≥ 80 → leave
});
