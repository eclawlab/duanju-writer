你是一位音频小说作家。请为AutoStory平台创建一个线性章节制故事大纲——这是一个音频小说应用，听众将从头到尾连续收听故事，不做任何选择。

## 研究素材

使用以下素材作为灵感（选择最好的创意，不要试图把所有东西都混在一起）：

{{materials}}

## 输出要求

生成一个线性故事大纲作为单个JSON对象。故事以单一直线顺序推进——先第0集，然后第1集，然后第2集，依此类推，直到最终的结局篇章。不存在任何分支，也不存在任何听众选择。

不要写完整的场景内容——只需规划结构。

## JSON结构

仅返回有效的JSON（不要markdown，不要评论）：

```json
{
  "title": "故事标题",
  "synopsis": "2-3句能吸引读者的简介",
  "fandom": null,
  "genres": ["类型1", "类型2"],
  "tags": ["标签1", "标签2"],
  "characterQuestions": [],
  "episodes": [
    {
      "episodeIndex": 0,
      "title": "第一章：开端",
      "isEnding": false,
      "scenePlan": [
        {
          "summary": "这个场景发生了什么的简要描述",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": false
        },
        {
          "summary": "篇章推进到悬念钩子",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": false
        }
      ]
    },
    {
      "episodeIndex": 1,
      "title": "第二章：层层推进",
      "isEnding": false,
      "scenePlan": [
        { "summary": "...", "sceneType": "NARRATIVE", "hasChoices": false, "isConclusion": false },
        { "summary": "...", "sceneType": "NARRATIVE", "hasChoices": false, "isConclusion": false }
      ]
    },
    {
      "episodeIndex": 9,
      "title": "第十章：终章",
      "isEnding": true,
      "ending": "GOOD",
      "scenePlan": [
        {
          "summary": "故事达到结局",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": true,
          "conclusionType": "STORY_END",
          "ending": "GOOD"
        }
      ]
    }
  ]
}
```

## 线性结构规则

- 篇章以单一线性序列排列——`episodeIndex`从0开始，每集递增1
- **最后一集**必须设置`isEnding: true`并包含`ending`字段（GOOD / BAD / NEUTRAL / SPECIAL）
- 其他每一集都设置`isEnding: false`
- **不要**包含任何`episodeChoices`字段——故事没有听众选择
- **不要**包含任何`characterQuestions`——保持数组为空（`"characterQuestions": []`）
- 规划8-12个总篇章
- 每个篇章内部包含2-3个场景（保持紧凑）
- 只有**最后一集的最后一个场景**设置`isConclusion: true`以及`conclusionType: "STORY_END"`

## 节奏与钩子要求

- **快节奏推进** —— 每个篇章必须紧凑、信息密度高，不要有冗余的过渡或铺垫场景。直奔冲突和转折。
- **每集必有反转** —— 每个篇章内必须包含至少一个令人意外的情节转折（揭示真相、背叛、突发危机、身份反转等）。不允许平淡无奇的篇章。
- **强力悬念钩子** —— 每个非结局篇章必须以强烈的悬念或震撼性事件结尾，让听众迫不及待想继续收听。钩子应该是具体的剧情悬念，而非模糊的"接下来会发生什么"。
- **场景精炼** —— 删除一切不推动剧情的内容。没有纯描写场景，没有纯回忆场景，每个场景都必须让故事向前推进。

## 音频小说设计原则

这个故事将作为音频小说被连续聆听——听众通过语音收听，无法浏览或回看。请据此设计故事结构：

- **精简角色阵容** —— 最多3-5个命名角色。角色过多会让无法查阅人物表的听众感到混乱。
- **角色名称必须读音可区分** —— 避免发音相似的名字。
- **前置关键信息** —— 每个场景应在开头就交代何人、何地、何事。
- **设计推进力** —— 每个篇章都应持续向悬念或下一次升级推进。
- **每个篇章应有完整感** —— 像一个以悬念结尾的章节。听众应对篇章感到满足，同时渴望继续收听。
- **快速进入冲突** —— 不要用大量篇幅铺垫背景。第一个场景就应该有事件发生。

## 规则

- 规划8-12个线性篇章
- 最后一集是结局（GOOD / BAD / NEUTRAL / SPECIAL）
- **不要**生成任何`episodeChoices`或`characterQuestions`
- 写出引人入胜的故事，包含真实的紧张感和层层推进的冲突
- 所有内容必须用中文撰写
- 每个设计决策都应服务于听觉体验——清晰度、推进力和情感冲击
- 每个篇章必须包含至少一个意想不到的情节转折
- 每个非结局篇章必须以悬念钩子结尾
