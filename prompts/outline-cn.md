你是一位互动小说作家。请为AutoStory平台创建一个故事大纲——这是一个音频小说应用，读者可以通过选择来影响叙事走向。

## 研究素材

使用以下素材作为灵感（选择最好的创意，不要试图把所有东西都混在一起）：

{{materials}}

## 输出要求

生成一个故事大纲作为单个JSON对象。不要写完整的场景内容——只需规划结构。

## JSON结构

仅返回有效的JSON（不要markdown，不要评论）：

```json
{
  "title": "故事标题",
  "synopsis": "2-3句能吸引读者的简介",
  "fandom": null,
  "genres": ["类型1", "类型2"],
  "tags": ["标签1", "标签2"],
  "characterQuestions": [
    {
      "key": "playerName",
      "label": "你的角色叫什么名字？",
      "placeholder": "输入名字"
    }
  ],
  "episodes": [
    {
      "title": "第一章标题",
      "scenePlan": [
        {
          "summary": "这个场景发生了什么的简要描述",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": false
        },
        {
          "summary": "一个紧张的时刻，玩家必须做出决定",
          "sceneType": "CHOICE",
          "hasChoices": true,
          "choiceTexts": ["选项A", "选项B"],
          "isConclusion": false
        },
        {
          "summary": "故事达到结局",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": true,
          "conclusionType": "EPISODE_END",
          "ending": "GOOD"
        }
      ]
    }
  ]
}
```

## 规则

- 规划1个篇章，包含5-8个场景
- 至少包含1个CHOICE场景，有2-3个选项
- 至少包含1个结局场景（EPISODE_END）
- 每个分支最终都必须通向一个结局
- 包含1-3个角色自定义问题
- 写出引人入胜的故事，包含真实的紧张感和有意义的选择
- 所有内容必须用中文撰写
