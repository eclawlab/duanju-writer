import { callLLM } from './llm.js';

/**
 * Find all root-to-ending paths through the episode tree.
 * Returns array of paths, where each path is an array of episodeIndex values.
 */
export function findAllPaths(outline) {
  const epMap = {};
  for (const ep of outline.episodes) {
    epMap[ep.episodeIndex] = ep;
  }

  const paths = [];

  function walk(epIndex, currentPath, visited) {
    if (visited.has(epIndex)) return; // cycle guard
    const ep = epMap[epIndex];
    if (!ep) return;

    const path = [...currentPath, epIndex];
    visited.add(epIndex);

    if (ep.isEnding) {
      paths.push(path);
    } else if (ep.episodeChoices && ep.episodeChoices.length > 0) {
      for (const choice of ep.episodeChoices) {
        walk(choice.nextEpisodeIndex, path, new Set(visited));
      }
    }
  }

  walk(0, [], new Set());
  return paths;
}

/**
 * Build a description of a path for the LLM.
 */
function describePath(outline, path) {
  const epMap = {};
  for (const ep of outline.episodes) {
    epMap[ep.episodeIndex] = ep;
  }

  const parts = [];
  for (let i = 0; i < path.length; i++) {
    const ep = epMap[path[i]];
    if (!ep) continue;

    let desc = `[${ep.episodeIndex}] "${ep.title}"`;
    if (ep.isEnding) {
      desc += ` (${ep.ending} ending)`;
    }

    // Show which choice was taken to get to next episode
    if (i < path.length - 1 && ep.episodeChoices) {
      const nextIdx = path[i + 1];
      const choice = ep.episodeChoices.find(c => c.nextEpisodeIndex === nextIdx);
      if (choice) {
        desc += ` → chose: "${choice.text}"`;
      }
    }

    // Summarize scenes
    if (ep.scenePlan?.length) {
      const sceneSummaries = ep.scenePlan.map(s => s.summary).join('; ');
      desc += `\n   Scenes: ${sceneSummaries}`;
    }

    parts.push(desc);
  }

  return parts.join('\n');
}

/**
 * Use LLM to pick the best 3 paths for the most engaging story variations.
 * Returns array of 3 path arrays (each is an array of episodeIndex values).
 */
export async function pickBestPaths(outline, lang = 'en') {
  const allPaths = findAllPaths(outline);

  // If 3 or fewer paths, just return them all
  if (allPaths.length <= 3) {
    return allPaths;
  }

  const pathDescriptions = allPaths.map((path, i) =>
    `Path ${i + 1}:\n${describePath(outline, path)}`
  ).join('\n\n---\n\n');

  const prompt = lang === 'cn'
    ? [
        `你是一位故事策划专家。以下是一个分支故事"${outline.title}"的所有可能路径。`,
        '',
        `故事简介：${outline.synopsis}`,
        '',
        '## 所有路径',
        '',
        pathDescriptions,
        '',
        '## 任务',
        '',
        '从以上路径中选出最好的3条，使这3个故事变体组合在一起最具吸引力。选择标准：',
        '- 3条路径应尽可能不同，覆盖不同的故事体验',
        '- 优先选择情节最跌宕起伏、最有戏剧冲突的路径',
        '- 确保至少包含1个好结局和1个坏结局',
        '- 每条路径本身都应该是一个完整且引人入胜的故事',
        '',
        '仅返回JSON：{"paths": [1, 5, 3]}（数字为路径编号，1-based）',
      ].join('\n')
    : [
        `You are a story planning expert. Below are all possible paths through the branching story "${outline.title}".`,
        '',
        `Synopsis: ${outline.synopsis}`,
        '',
        '## All Paths',
        '',
        pathDescriptions,
        '',
        '## Task',
        '',
        'Pick the best 3 paths that together make the most compelling set of story variations. Selection criteria:',
        '- The 3 paths should be as different as possible, covering diverse story experiences',
        '- Prefer paths with the most dramatic twists and conflicts',
        '- Ensure at least 1 good ending and 1 bad ending are included',
        '- Each path should work as a complete, engaging standalone story',
        '',
        'Return ONLY JSON: {"paths": [1, 5, 3]} (numbers are 1-based path indices)',
      ].join('\n');

  const raw = await callLLM(prompt, 'outline');
  let result;
  try {
    const cleaned = raw.trim().replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
    result = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON
    const match = raw.match(/\{[^}]+\}/);
    if (match) {
      result = JSON.parse(match[0]);
    } else {
      // Fallback: pick first 3
      return allPaths.slice(0, 3);
    }
  }

  if (!result.paths || !Array.isArray(result.paths)) {
    return allPaths.slice(0, 3);
  }

  const picked = result.paths
    .map(i => allPaths[i - 1]) // 1-based to 0-based
    .filter(Boolean);

  // Ensure we have at least 1, at most 3
  if (picked.length === 0) return allPaths.slice(0, 3);
  return picked.slice(0, 3);
}

/**
 * Linearize a branching outline along a specific path.
 * Returns a new outline with only the episodes on the path,
 * re-indexed sequentially (0, 1, 2, ...) and with episodeChoices removed.
 */
export function linearizeOutline(outline, path) {
  const epMap = {};
  for (const ep of outline.episodes) {
    epMap[ep.episodeIndex] = ep;
  }

  const linearEpisodes = path.map((epIndex, newIndex) => {
    const ep = epMap[epIndex];
    if (!ep) throw new Error(`Episode ${epIndex} not found in outline`);

    const linearEp = {
      ...ep,
      episodeIndex: newIndex,
      episodeChoices: [], // no branching in linear story
    };

    // Remove choices from scene plans too
    linearEp.scenePlan = (ep.scenePlan || []).map(s => ({
      ...s,
      hasChoices: false,
    }));

    return linearEp;
  });

  return {
    ...outline,
    episodes: linearEpisodes,
  };
}
