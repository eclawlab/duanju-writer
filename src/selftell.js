// Selftell narration mode — shared directive used by every pipeline stage
// (snowflake, outline, plan, clip, tail-outline). Reframes the entire drama
// as the protagonist's first-person retelling, without changing the
// downstream clip schema (setting/action/dialogue/hook). Only the *voice*
// changes.

export function buildSelftellDirective(lang = 'cn', stage = 'general') {
  if (lang === 'cn') {
    const lines = [
      '',
      '## 自述模式（selftell）',
      '',
      '本剧采用**主角自述**视角：故事由主角本人以第一人称（"我"）亲口讲述。',
      '',
      '硬性约束：',
      '- 选定**唯一一位**主角作为叙述者，并贯穿全剧不变。在 characters 中标注该角色为视角主角（如有 `role` 字段，可写 "主角（自述）"）。',
      '- 一切**叙述性**文字（旁白、情绪、回忆、心声）必须使用第一人称："我"、"我的"、"咱们/我们"。',
      '- 在 clip 的 `action` 字段中，主角的动作以"我……"开头描述（例："我推开大门，浑身湿透"），其他人物用其姓名描述。',
      '- 在 clip 的 `dialogue` 字段中：',
      '  - `[narrator]` 段落必须是主角本人的内心独白或回顾性自述（仍是"我"），不是上帝视角旁白。',
      '  - 其他角色发声仍使用 `[character:姓名]` 标签，照常对话。',
      '  - 主角本人开口说话时，可使用 `[character:主角姓名]` 标签写出当时的台词；主角的回顾性"心声"则继续放在 `[narrator]` 中。',
      '- 在 `setting` / `hook` 字段中允许保持简洁的场景/悬念描写，但不得把主角写成"他/她"——只能用其姓名或"我"。',
      '- 严禁全知视角：禁止透露主角当时不知道的事；可在后续片段以"后来我才知道……"的回顾方式补充。',
      '- 字数硬约束（setting≤20、action≤80、dialogue≤60、hook≤30，中文字符）和钩点要求保持不变。',
    ];
    if (stage === 'outline' || stage === 'tail-outline') {
      lines.push(
        '- 在 outline 顶层 `synopsis` 中明确告诉读者这是主角"我"亲口讲述的故事；剧名与每集标题可保留第三方视角，但每集 `clipPlan[*].summary` 都应能转写为主角第一人称。',
      );
    }
    if (stage === 'plan') {
      lines.push(
        '- 在 `clips.events` 中以第一人称描述发生在主角身上的事件（"我得知……" / "我决定……"）；其他角色的动作描述其姓名即可。',
      );
    }
    if (stage === 'snowflake') {
      lines.push(
        '- 在 characters 数组中明确标出**唯一**一位"视角主角（自述者）"。其 motivation 与 arc 必须能够支撑全程第一人称叙事。',
      );
    }
    return lines.join('\n') + '\n';
  }
  const lines = [
    '',
    '## Selftell Narration Mode',
    '',
    'This drama is told in **first person by its main character**. The protagonist narrates their own story end-to-end.',
    '',
    'Hard constraints:',
    '- Choose **exactly one** protagonist as the narrator and keep them as the POV character throughout the entire drama.',
    '- All narration (inner voice, recollection, atmosphere, framing) uses first person: "I", "my", "we".',
    '- In each clip\'s `action` field, the protagonist\'s actions are described starting with "I…" (e.g. "I push the door open, soaked through"). Other characters are described by name.',
    '- In each clip\'s `dialogue` field:',
    '  - `[narrator]` blocks are the protagonist\'s own inner voice / recollection in first person — NOT an omniscient outside narrator.',
    '  - Other characters still speak under `[character:Name]` tags as usual.',
    '  - The protagonist may also speak under `[character:ProtagonistName]` when delivering an in-scene line; their inner voice stays in `[narrator]`.',
    '- In `setting` and `hook`, avoid third-person references to the protagonist ("he", "she") — use their name or "I".',
    '- No omniscient knowledge: do not reveal what the protagonist did not know at that moment; deferred reveals can come back later as "Later I learned…".',
    '- All CN-char limits (setting≤20, action≤80, dialogue≤60, hook≤30) and the hook requirement remain in force.',
  ];
  if (stage === 'outline' || stage === 'tail-outline') {
    lines.push(
      '- The top-level `synopsis` should make clear this is the protagonist telling their own story. Episode `clipPlan[*].summary` items should each be transposable to first person.',
    );
  }
  if (stage === 'plan') {
    lines.push(
      '- In `clips.events`, describe events that happen to or are perceived by the protagonist in first person ("I learn…", "I decide…"). Other characters can be referred to by name.',
    );
  }
  if (stage === 'snowflake') {
    lines.push(
      '- In the characters array, mark exactly one "POV protagonist (selftell narrator)". Their motivation and arc must support a full first-person retelling.',
    );
  }
  return lines.join('\n') + '\n';
}
