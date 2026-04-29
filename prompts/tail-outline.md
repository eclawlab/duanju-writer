你是短剧编剧。请基于已有的前半段大纲，为本剧生成后半段（包含结局）。

## 故事元信息

- 标题（title）：{{title}}
- 简介（synopsis）：{{synopsis}}
- 类型（genres）：{{genres}}

## 雪花结构概要

{{snowflakeSummary}}

## 已确定的前半段（episode 0..{{priorLastIdx}}）

{{priorEpisodes}}

## 任务

Produce exactly {{tailCount}} episodes, starting at episodeIndex {{splitIdx}} and ending at episodeIndex {{lastIdx}}.

- 整体走向必须导向 **{{targetEnding}}** 类型结局：
  - **爽爆**：身份全揭，反派全员跪地，主角拿走所有筹码。
  - **苦尽甘来**：主角受尽磨难后获得真情/认可，但有小遗憾。
  - **反转**：终局前抛出关键反转，重新定义此前所有事件的意义。
- 最后一集（episodeIndex {{lastIdx}}）`isEnding: true`，`ending: "{{targetEnding}}"`。
- 最后一集的最后一个 clip `isConclusion: true`，`conclusion.type: "DRAMA_END"`。
- 中间集（非最后）必须 `isEnding: false`、`ending: null`。
- 每集 4–10 个 clip，每个 clipPlan 项需有 `summary` 字段。

## 输出

只返回 JSON 对象，不要 markdown 围栏，不要解释：

```jsonc
{
  "episodes": [
    {
      "episodeIndex": {{splitIdx}},
      "title": "...",
      "isEnding": false,
      "ending": null,
      "clipPlan": [
        { "summary": "...", "isConclusion": false }
      ]
    },
    {
      "episodeIndex": {{lastIdx}},
      "title": "终局",
      "isEnding": true,
      "ending": "{{targetEnding}}",
      "clipPlan": [
        { "summary": "...", "isConclusion": true }
      ]
    }
  ]
}
```

## 严禁

- 不写 `episodeChoices`（线性）
- 中间集 `isEnding` 不要为 true
- 结局 ending 必须严格匹配 {{targetEnding}}
- 不要英语注释或翻译
