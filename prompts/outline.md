你是短剧编剧。基于以下素材，生成一份完整的中文短剧（竖屏 10–15 秒短视频系列）的线性大纲。

## 素材

请从中挑选一个最有爆款潜质的设定（不要把所有素材塞进一个故事）：

{{materials}}

## 核心要求

短剧观众用碎片时间观看，每集 ~1 分钟（4–10 个 10–15 秒片段构成）。整部剧 10–40 集，结尾必须爽。

- 第一集前 30 秒必须有爆点（身份反转 / 关键冲突 / 强情绪）。
- 每集至少 1–2 次反转或打脸。
- 角色关系在第一集就要立起来——主角是谁、对立面是谁、初始冲突是什么。
- 3–7 个语音可分辨的角色名。
- 全剧结尾在最后一集，`isEnding: true`，`ending` 取 {爽爆 / 苦尽甘来 / 反转} 之一。
- 没有分支、没有读者选择。

## 输出结构

只返回一个 JSON 对象，不要 markdown 围栏，不要解释。schema:

```jsonc
{
  "title": "战神归来",
  "synopsis": "两句话钩子（卖点+冲突）",
  "trope": "战神归来",
  "genre": "都市",
  "tags": ["复仇", "打脸"],
  "lang": "cn",
  "characters": [
    { "name": "陆衡", "role": "protagonist", "description": "..." },
    { "name": "苏晚", "role": "ex-wife", "description": "..." },
    { "name": "林董", "role": "antagonist", "description": "..." }
  ],
  "episodes": [
    {
      "episodeIndex": 0,
      "title": "第1集 归来",
      "isEnding": false,
      "ending": null,
      "clipPlan": [
        { "summary": "陆衡狼狈现身，岳父羞辱", "clipType": "NARRATIVE", "isConclusion": false }
      ]
    },
    {
      "episodeIndex": 19,
      "title": "第20集 终局",
      "isEnding": true,
      "ending": "爽爆",
      "clipPlan": [
        { "summary": "陆衡身份揭露，反派全员跪地", "clipType": "NARRATIVE", "isConclusion": true }
      ]
    }
  ]
}
```

## 严禁

- 不写 `episodeChoices`（线性短剧无分支）
- 不写非空的 `characterQuestions`（短剧没有玩家选项）
- 角色名不要同音
- 不要把所有素材塞进一个故事——挑最爆的一个设定深耕
