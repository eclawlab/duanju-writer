<div align="center">

# Duanju Writer (短剧编剧机)

### 短剧自动剧本生成器

**调研 · 编排 · 写作 · 发布**

一个 AI 驱动的自动化守护进程，专门为竖屏短视频短剧（10-15 秒/片段、4-10 片段/集、10-40 集/部）批量生成完整剧本，并自动发布至 Duanju 平台。

[![Node.js](https://img.shields.io/badge/Node.js-≥20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [生成流程](#生成流程)
- [快速开始](#快速开始)
- [命令行参考](#命令行参考)
- [短剧套路库](#短剧套路库)
- [多模型供应商](#多模型供应商)
- [配置说明](#配置说明)
- [项目结构](#项目结构)

---

## 项目简介

**Duanju Writer** 是为 [Duanju](https://usaduanju.com) 短视频短剧平台打造的全自动剧本生成系统。每部剧由 10-40 集组成，每集包含 4-10 个 10-15 秒的竖屏片段（clip）；每个 clip 输出结构化剧本：场景（setting）、视觉动作（action）、对白（dialogue）、片尾钩点（hook）。

从趋势调研、雪花架构、大纲规划、片段编排到自动上线，整套流程无需人工干预。每次生成会输出三个不同结局变体（爽爆 / 苦尽甘来 / 反转），可用于 A/B 测试。

---

## 核心特性

### 📺 竖屏短剧专属
所有剧本严格遵守短剧节奏：第一集前 30 秒必须爆点；每 3-5 个 clip 至少一次反转；中段密集打脸升级；结局必爽。每个 clip 都带强制片尾钩点。

### 🔥 30 个爆款套路
覆盖六大题材类目（都市 / 复仇 / 甜宠 / 古装 / 家庭 / 玄幻），各 5 个套路（战神归来、重生复仇、闪婚总裁、冷宫复宠、错抱真千金、洪荒重生 等）。每个套路文件定义骨架（Outline）+ 片段钩点节奏（Clip）。

### 🎬 多结局变体生成
每部剧从中间某集分叉，生成三个结局走向：
- **爽爆**：身份全揭、反派跪地、主角拿走所有筹码。
- **苦尽甘来**：主角受尽磨难后获得真情，但有小遗憾。
- **反转**：终局前抛出关键反转，重新定义此前所有事件。

三个变体共享 `variationGroupId`，方便平台做 A/B 测试。

### 🌍 中文化趋势调研
从抖音、红果、ReelShort、微博热搜、快手、起点中文网、晋江文学城等中文平台采集当下热门题材与情绪钩点，确保选题与市场同步。

### 📝 结构化片段输出
每个 clip 输出严格 JSON：
```json
{
  "clipIndex": 0,
  "setting": "豪门别墅 · 夜 · 暴雨",
  "action": "陆衡推开大门，浑身湿透站在前妻苏晚面前。",
  "dialogue": "[narrator]\n五年了。\n[character:陆衡]\n我回来了。",
  "hook": "苏晚的手机响起，来电显示：林董事长。",
  "durationSec": 12,
  "isConclusion": false,
  "conclusion": null
}
```

中文字符硬约束：`setting≤20`、`action≤80`、`dialogue≤60`、`hook≤30`。下游 TTS 系统可直接消费此 JSON。

### 🧠 雪花法故事架构
四步骤结构化规划（核心种子 → 人物动力 → 世界观构建 → 情节架构），按短剧三幕式比例（25% / 50% / 25%）分配节奏权重。

### 👤 参考人物 / 参考事件注入
支持把预定义的人物档案或事件描述注入到雪花、大纲、规划、片段四个阶段，确保 LLM 不会任意改名或淡化关键事件。

### 📚 整本小说改编
提供一本完整小说作为参考（`--story path.txt`），系统先按章节切分并通过 LLM 抽取出 story bible（人物 / 事件 / 钩点 / 主题 / 世界观 / 原结局），然后将其注入到雪花、大纲、规划、片段四个阶段。`--fidelity tight|medium|loose` 控制改编紧密度：tight 完全按原作章节顺序、loose 仅取灵感、medium 在保留主线的同时压缩节奏（默认）。bible.json 与 chapters.json 持久化在 `~/.duanju-writer/jobs/<id>/story/`，断点续传时直接复用。

### ✏️ 修改与改进模式
对**已发布在 usaduanju.com 的剧**做小幅打磨：`duanju-writer modify <storyId> --feedback "..."` 会从平台下载该剧，按用户反馈做最小化、精准的修改（保留剧集结构、人物、`[narrator]/[character:名]` 格式，未涉及处逐字保留）。修改分两遍进行——先改元信息（标题/梗概/题材/标签/人物），再**逐集**单独改写，确保反馈贯穿全剧每一集而不是只改开头几集（剧集数量固定，反馈不能增删整集）——再作为**一部全新独立的剧**重新上传（不带 variationGroupId，平台视为新作品）。原文 / 反馈 / 修改后版本 / 结果持久化在 `~/.duanju-writer/modifications/<storyId>-<时间戳>/`。`--feedback-file path` 从文件读取反馈，`--title "..."` 覆盖标题，`--dry-run` 只下载+修改不上传（离线校验/安全预览）。

不知道 storyId？每次 `run` 上传后会把平台 storyId 记录在 `~/.duanju-writer/jobs/<id>/upload.v*.json`。运行 **`duanju-writer stories`** 即可列出本机发布过的全部剧（storyId + 标题 + 结局变体），`duanju-writer stories 关键词` 按标题/ID 过滤。

### 🔌 多模型供应商
可插拔的 LLM 后端：默认 Claude CLI，亦支持任何 OpenAI 兼容 API。可为 8 个任务角色（research / outline / plan / clip / compress / repair / consistency / enrichment）分别配置不同模型。

### 🔄 断点续传 + 上传幂等
每个流水线阶段产物（materials / snowflake / outline / plan / drama / variants）持久化在 `~/.duanju-writer/jobs/<id>/`。任务中断自动从断点恢复，已上线的剧不会重复发布。Artifact 带 `schemaVersion` 标记防止旧数据混入。

---

## 生成流程

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  趋势调研  │──→│  素材收集  │──→│  雪花架构  │──→│  大纲生成  │──→│  片段规划  │──→│  片段编写  │──→│  自动发布  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
                                                                                  │
                                                                                  ↓
                                                                       ┌──────────────────────┐
                                                                       │  分叉三结局变体（爽爆 │
                                                                       │  / 苦尽甘来 / 反转） │
                                                                       └──────────────────────┘
```

| 阶段 | 说明 |
|------|------|
| **趋势调研** | 从抖音、红果、ReelShort 等 5 个搜索 + 起点、晋江等 5 个网站抓取（5 分钟缓存）|
| **素材收集** | AI 分析趋势数据，输出 `topics` / `plotHooks` / `characterArchetypes` / `trendingTropes` |
| **雪花架构** | 4 步结构化规划：核心种子 → 人物 → 世界 → 情节，遵循短剧三幕式比例 |
| **大纲生成** | 输出 10-40 集结构：每集 4-10 个 `clipPlan` 项；最末集 `isEnding: true` + `ending` ∈ {爽爆/苦尽甘来/反转} |
| **片段规划** | 为每个 clip 调度事件、揭示、状态变化、节奏（slow/medium/fast）|
| **片段编写** | 调用 `prompts/clips.md` 逐 clip 生成结构化剧本，注入套路 `## Clip` 指南 |
| **变体分叉** | 在中段某集（约 70%）分叉，生成三个结局走向，共享 `variationGroupId` |
| **自动发布** | POST 到 `${autostoryUrl}/api/ai/stories`，body 带 `format: "duanju"` 鉴别符 |

---

## 快速开始

### 前置条件
- Node.js ≥ 20
- 已部署 Duanju 平台（API URL 默认为 `https://usaduanju.com`）
- Claude CLI 已认证（或自行配置任意 OpenAI 兼容供应商）

### 安装

```bash
git clone <repo>
cd duanju
npm install
```

### 初始化

```bash
node bin/duanju-writer.js setup
```

交互式向导会询问 Duanju API URL，自动获取 API key，并写入 `~/.duanju-writer/config.json`。

### 单次运行（前台）

```bash
node bin/duanju-writer.js run
```

支持以下旗标：

| 旗标 | 说明 |
|------|------|
| `--genre <都市\|复仇\|甜宠\|古装\|家庭\|玄幻>` | 锁定题材类目 |
| `--style <套路名>` | 锁定具体套路（如 `战神归来`、`闪婚总裁`） |
| `--episodes <10..40>` | 自定义集数（默认 20） |
| `--clips-per-episode <4..10>` | 每集片段数（默认 6） |
| `--reference-character <path.md>` | 注入预定义人物档案 |
| `--reference-event <path.md>` | 注入预定义事件描述 |
| `--story <path.{txt,md}>` | 注入参考小说（≤1MB），抽取 story bible 注入下游阶段 |
| `--fidelity <tight\|medium\|loose>` | 配合 `--story`：改编紧密度（默认 medium）|
| `--author-style <key>` | 叠加指定中文作家文风（仅影响文笔，与 `--style`/`--story` 正交可叠加）；`duanju-writer author-styles` 查看 15 位作家 |
| `--no-publish` | 只生成不上传 |

### 守护进程模式

```bash
node bin/duanju-writer.js start          # 后台调度器 + worker
node bin/duanju-writer.js scheduler      # 单独跑调度器
node bin/duanju-writer.js worker         # 单独跑 worker
node bin/duanju-writer.js jobs           # 查看任务队列状态
```

---

## 命令行参考

```
duanju-writer setup          交互式初始化（API URL + 自动获取 key）
duanju-writer run [flags]    单次生成 + 上传
duanju-writer modify <id>    下载已发布剧 → 按反馈修改 → 作为新剧上传
duanju-writer stories [q]    列出本机已发布的剧及其 storyId（可选关键词过滤）
duanju-writer start          启动调度器 + worker 守护进程
duanju-writer scheduler      单独运行调度器
duanju-writer worker         单独运行 worker
duanju-writer jobs           查看任务队列
duanju-writer styles         列出全部 30 个套路
duanju-writer author-styles  列出 15 位作家文风
duanju-writer config         查看 / 修改配置
duanju-writer provider       管理 LLM 供应商
duanju-writer role           为不同任务角色分配模型
duanju-writer knowledge      管理知识库（导入 / 列表 / 清空）
```

注：`--lang en` 已不再支持（本工具为短剧定制，仅生成中文剧本）。

---

## 短剧套路库

`styles/` 目录下按题材分 6 类目，每类 5 个套路：

| 类目 | 套路 |
|------|------|
| **复仇** | 战神归来、重生复仇、隐藏身份、假死归来、灭门复仇 |
| **都市** | 豪门弃女、替嫁夫人、都市赘婿、撕渣男、失忆夫君 |
| **甜宠** | 闪婚总裁、契约甜妻、萌宝助攻、校园暗恋、霸总追妻 |
| **古装** | 冷宫复宠、替嫁王妃、江湖侠女、错嫁皇族、重生宫斗 |
| **家庭** | 错抱真千金、婆媳大战、偏心父母、重组家庭、私生子 |
| **玄幻** | 洪荒重生、修仙逆袭、万界穿梭、召唤神兽、系统流 |

每个套路 `.md` 文件结构：

```markdown
---
name: 战神归来
category: 复仇
---

## Outline
- 主角是隐世战神/兵王，五年前被陷害逐出豪门
- 五年后强势归来，前妻 / 仇家不识其真实身份
- ...

## Clip
- 镜头特写关键道具：龙鳞戒指、退役军牌
- 路人甲掏出手机查身份 → 屏幕特写 → 表情骤变
- ...
```

`Outline` 段注入大纲生成阶段，`Clip` 段注入片段编写阶段。新增套路只需在对应类目下放新 `.md` 即可，无需改代码。

---

## 多模型供应商

默认使用 Claude CLI（`claude` 命令）。配置其他 OpenAI 兼容 API：

```bash
duanju-writer provider add deepseek --base-url https://api.deepseek.com --model deepseek-chat
duanju-writer role assign clip deepseek    # 让片段写作走 deepseek
```

可为 8 个角色独立配置：`research`、`outline`、`plan`、`clip`、`compress`、`repair`、`consistency`、`enrichment`。

---

## 配置说明

配置文件：`~/.duanju-writer/config.json`

```json
{
  "autostoryUrl": "https://usaduanju.com",
  "aiApiKey": "...",
  "lang": "cn",
  "genre": "",
  "episodesPerDrama": 20,
  "clipsPerEpisode": 6,
  "targetCharsPerClip": 50,
  "publish": true,
  "heartbeatInterval": 60000,
  "uploadTimeout": 60000,
  "roles": {
    "research": "claude",
    "outline": "claude",
    "plan": "claude",
    "clip": "claude",
    "compress": "claude",
    "repair": "claude",
    "consistency": "claude",
    "enrichment": "claude"
  }
}
```

---

## 项目结构

```
duanju/
├── bin/
│   └── duanju-writer.js     # CLI 入口
├── src/
│   ├── collector.js         # 趋势调研 + 素材收集
│   ├── snowflake.js         # 雪花法 4 步规划
│   ├── drama-writer.js      # 大纲 / 片段 / 尾段生成
│   ├── planner.js           # 片段级状态规划
│   ├── compressor.js        # 历史片段压缩
│   ├── consistency.js       # 钩点密度 / 重复检查
│   ├── enrichment.js        # 字数检查（中文）
│   ├── uploader.js          # POST 到 /api/ai/stories
│   ├── downloader.js        # GET /api/ai/stories/<id> + 归一化
│   ├── modifier.js          # 下载 → 反馈修改 → 作为新剧上传
│   ├── published.js         # 扫描本机已发布剧（stories 命令）
│   ├── worker.js            # 流水线编排 + 断点续传
│   ├── styles.js            # 套路 .md 文件解析
│   ├── llm.js               # 多供应商抽象层
│   └── ...
├── prompts/
│   ├── research.md          # 趋势调研提示词
│   ├── snowflake.md         # 雪花法提示词
│   ├── outline.md           # 大纲生成提示词
│   ├── plan.md              # 片段规划提示词
│   ├── clips.md             # 片段编写提示词
│   ├── tail-outline.md      # 多结局尾段生成
│   ├── modify-meta.md       # 反馈修改：元信息一遍
│   └── modify-episode.md    # 反馈修改：逐集一遍
├── styles/                  # 30 个 短剧 套路
│   ├── 复仇/  都市/  甜宠/
│   └── 古装/  家庭/  玄幻/
└── tests/                   # 508 个单元测试
```

---

## 许可证

MIT
