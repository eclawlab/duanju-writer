<div align="center">

# Duanju Writer

### Autonomous Interactive Fiction Generator

**Research. Plan. Write. Publish.**

An AI-powered daemon that researches trending fiction from 30 novel platforms worldwide, crafts branching interactive audio novels in 54 literary styles, and publishes them to the [AutoStory](https://autostory-web.fly.dev) platform — fully autonomously.

一个 AI 驱动的自动化守护进程，从全球 30 个小说平台自动调研热门趋势、以 54 种文学风格撰写分支互动有声小说，并自动发布至 [AutoStory](https://autostory-web.fly.dev) 平台。

[![Node.js](https://img.shields.io/badge/Node.js-≥20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-231_passing-brightgreen)](tests/)

</div>

---

<details>
<summary><strong>📖 中文版 (Chinese Version)</strong></summary>

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [生成流程](#生成流程)
- [快速开始](#快速开始-1)
- [命令行参考](#命令行参考-1)
- [全球小说调研网络](#全球小说调研网络-1)
- [写作风格库](#写作风格库-1)
- [多模型供应商系统](#多模型供应商系统-1)
- [知识库系统](#知识库系统-1)
- [叙事智能引擎](#叙事智能引擎-1)
- [配置说明](#配置说明-1)
- [项目结构](#项目结构-1)
- [自定义扩展](#自定义扩展-1)

---

## 项目简介

**Duanju Writer** 是为 AutoStory 互动有声小说平台打造的全自动故事生成系统。听众通过语音收听故事并做出选择，影响叙事走向 —— 而 Duanju Writer 负责生成这些专为听觉体验优化的分支互动有声小说。

从网络调研、素材收集、大纲规划、场景写作到最终发布，整个流程无需人工干预，完全自动化运行。

---

## 核心特性

### 🌍 全球 30 站小说调研
从 8 个国家/地区、6 种语言的 30 个顶级小说平台采集灵感。每次生成随机选取 5 个搜索查询和 5 个网站直接抓取，确保多样性。

### 🎭 54 种文学风格
涵盖 9 个类别的作家风格 —— 从莫言的魔幻现实主义到托尔金的史诗奇幻，从刘慈欣的硬科幻到金庸的武侠世界。支持自动风格匹配或手动指定。

### 🎧 音频小说优化
所有内容专为语音合成（TTS）朗读体验优化。大纲阶段即融入音频设计原则（精简角色、读音可区分的名字、前置关键信息），场景写作遵循严格的听觉体验指南——明确说话者身份、控制节奏韵律、避免视觉化写法、为每个角色设计独特语音风格。

### 🌐 中英双语
原生支持中文和英文内容生成，包含独立的提示词模板和调研源。中文模式优先采集中日韩平台内容。

### 🧠 叙事智能引擎
- **故事状态追踪**：实时跟踪角色位置、物品归属、情感变化、关系网络、伏笔线索
- **一致性检查**：防止重复句式开头、过度使用相同短语、主题冷却机制（支持中文标点分句）
- **场景压缩**：将已写场景压缩为叙事摘要，维护全局故事概要，注入后续场景上下文
- **场景丰富化**：根据目标字数自动扩展场景，增添感官细节和氛围描写（中文按字计数）
- **雪花写作法**：四步骤故事规划（核心种子 → 角色动态 → 世界构建 → 情节架构）
- **情节弧线**：跟踪未解决的情节线索、伏笔种植/强化/解决
- **角色弧线**：五阶段角色发展模型（初始 → 触发 → 矛盾 → 转变 → 最终）

### 🔌 多模型供应商
可插拔的 LLM 供应商架构。默认使用 Claude CLI，同时支持任何 OpenAI 兼容 API（如 Deepseek、Mistral 等）。可为 8 个不同任务角色分配不同模型。

### 📚 知识库
内置 TF-IDF 向量检索引擎（支持中日韩文本双字符分词），支持导入世界观设定、参考资料等文档，在场景写作时自动注入相关上下文。

### ⚡ 零外部依赖
仅依赖 `chalk` 一个 npm 包。无需数据库，纯文件系统存储，开箱即用。

### 🔄 断点续传
每个流程步骤（素材收集、故事生成、上传）的产物均持久化保存。任务中断后自动从断点恢复，避免重复工作和重复上传。

---

## 生成流程

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  网络调研  │──→│  素材收集  │──→│  雪花架构  │──→│  大纲生成  │──→│  状态规划  │──→│  场景写作  │──→│  自动发布  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

| 步骤 | 说明 |
|------|------|
| **网络调研** | 从 30 个平台随机选取 5 个进行搜索 + 5 个直接抓取，缓存 5 分钟 |
| **素材收集** | AI 分析趋势数据，生成故事主题、角色原型、情节钩子 |
| **雪花架构** | 四步结构化规划：核心种子 → 角色设计 → 世界构建 → 情节架构 |
| **大纲生成** | 创建结构化大纲：标题、简介、类型、标签、分集场景计划；融入音频小说设计原则 |
| **状态规划** | 初始化角色/物品/地点状态，规划每场景事件、揭示、伏笔 |
| **场景写作** | 逐场景写作，含叙述、对话、玩家选择；遵循音频小说写作指南，自动一致性检查和丰富化 |
| **自动发布** | 将完成的故事上传至 AutoStory API 并自动发布 |

---

## 快速开始 {#快速开始-1}

### 前置要求

- Node.js 20 或更高版本
- [Claude Code CLI](https://claude.ai/claude-code) 已安装并认证

### 安装

```bash
git clone https://github.com/eclawlab/duanju-writer.git
cd duanju-writer
npm install
npm link    # 全局安装 duanju-writer 命令
```

### 初始配置

```bash
# 连接至 AutoStory 实例（交互式配置）
duanju-writer setup https://your-autostory-server.com
```

### 生成故事

```bash
# 生成一个故事（自动选择风格）
duanju-writer run

# 用莫言风格生成 3 个中文故事
duanju-writer run 3 --style moyan --lang cn

# 用托尔金风格生成
duanju-writer run --style tolkien
```

### 守护进程模式

```bash
# 启动调度器 + 工作器（定时自动生成）
duanju-writer start

# 或分别启动
duanju-writer scheduler    # 定时创建任务
duanju-writer worker       # 处理待执行任务
```

---

## 命令行参考 {#命令行参考-1}

### 核心命令

| 命令 | 说明 |
|------|------|
| `duanju-writer setup [url]` | 配置 API 连接 |
| `duanju-writer run [count] [options]` | 立即生成故事 |
| `duanju-writer start` | 启动调度器 + 工作器守护进程 |
| `duanju-writer scheduler` | 仅启动调度器 |
| `duanju-writer worker` | 仅启动工作器 |
| `duanju-writer jobs` | 查看所有任务及状态 |
| `duanju-writer styles` | 列出可用写作风格 |
| `duanju-writer config` | 显示当前配置 |
| `duanju-writer config set <key> <value>` | 更新配置项 |

### 生成选项

| 参数 | 说明 | 示例 |
|------|------|------|
| `--lang` | 语言（`en` 或 `cn`） | `--lang cn` |
| `--style` | 写作风格 | `--style hemingway` |
| (数字) | 生成数量 | `3` |

### 供应商管理

```bash
duanju-writer provider add <name> --type openai --base-url <url> --model <model> --api-key <key>
duanju-writer provider list
duanju-writer provider test <name>
duanju-writer provider remove <name>
```

### 角色分配

```bash
duanju-writer role set scene deepseek    # 将场景写作分配给 Deepseek
duanju-writer role list                  # 查看角色分配
```

### 知识库管理

```bash
duanju-writer knowledge import ./worldbuilding.txt            # 导入文档
duanju-writer knowledge import ./docs/ --job <jobId>          # 导入至特定任务
duanju-writer knowledge info                                  # 查看知识库信息
duanju-writer knowledge clear                                 # 清空知识库
```

---

## 全球小说调研网络 {#全球小说调研网络-1}

从 30 个全球顶级小说平台采集创意灵感。每次运行随机选取 5 个搜索查询 + 5 个网站直接抓取，中文模式优先中日韩平台。

| 地区 | 平台 |
|------|------|
| 🌐 英语/全球 | Wattpad, Reddit WritingPrompts, Tapas, Goodreads, Quotev, Dreame, NovelToon, Novel Updates |
| 🇨🇳 中国 | 起点中文网, 晋江文学城, 纵横中文网, 书旗小说, 飞卢小说 |
| 🇯🇵 日本 | 小説家になろう (Syosetu), カクヨム (Kakuyomu), アルファポリス (Alphapolis), Pixiv 小说 |
| 🇰🇷 韩国 | 카카오페이지 (KakaoPage), 노벨피아 (Novelpia), 조아라 (Joara), 리디북스 (Ridibooks) |
| 🇻🇳 越南 | TruyenFull |
| 🇮🇳 印度 | Pratilipi（12 种印度语言） |
| 🌐 最佳尝试 | Royal Road, AO3, Webnovel, Scribblehub |

---

## 写作风格库 {#写作风格库-1}

54 种预置作家风格，涵盖 9 个类别：

| 类别 | 数量 | 代表作家 |
|------|------|----------|
| 华语文学 | 9 | 莫言、鲁迅、金庸、余华、张爱玲、老舍、沈从文、王小波、三毛 |
| 华语科幻 | 1 | 刘慈欣 |
| 华语网文 | 5 | 耳根、唐家三少、猫腻、天蚕土豆、Priest |
| 英语文学 | 11 | 海明威、菲茨杰拉德、伍尔夫、马尔克斯、村上春树、狄更斯、奥斯汀、卡夫卡 |
| 英语奇幻 | 7 | 托尔金、乔治·R·R·马丁、勒古恩、盖曼、桑德森 |
| 英语科幻 | 6 | 阿西莫夫、菲利普·K·迪克、巴特勒、吉布森、克拉克、阿特伍德 |
| 英语悬疑 | 7 | 斯蒂芬·金、阿加莎·克里斯蒂、钱德勒、吉莉安·弗琳、爱伦·坡、洛夫克拉夫特 |
| 英语言情 | 4 | 尼古拉斯·斯帕克斯、戴安娜·盖伯顿、彩虹·罗威尔、艾米莉·勃朗特 |
| 英语网文 | 4 | Wildbow、pirateaba、ErraticErrata、Shirtaloon |

---

## 叙事智能引擎 {#叙事智能引擎-1}

### 音频小说设计

故事从大纲阶段即为听觉体验而设计。大纲层面确保精简角色阵容（3-5人）、读音可区分的名字、前置关键信息和推进力驱动的节奏。场景层面的写作指南涵盖：

- **听者清晰度** — 对话前明确说话者、频繁使用角色名、首次出场附带标志性描述
- **节奏韵律** — 刻意变化句长、段落间隔创造呼吸停顿、每段2-4句
- **避免视觉化写法** — 禁用"如上所示"、禁用同音名、禁用复杂嵌套长句、禁用括号补充
- **声音氛围** — 环境音效描写、自然口语化对话、每个角色独特的语言风格
- **TTS声音分配** — 每个角色分配特定的TTS声音（alloy, echo, fable, onyx, nova, shimmer）

### 场景类型特化

| 类型 | 说明 |
|------|------|
| `NARRATIVE` | 叙事推进型，侧重环境描写和动作 |
| `CHOICE` | 选择决策型，构建紧张感并提供分支 |
| `DIALOGUE` | 角色对话型，展现人物关系和性格 |
| `ACTION` | 动作场面型，快节奏的战斗或追逐 |
| `PSYCHOLOGICAL` | 心理描写型，深入角色内心世界 |
| `ENVIRONMENTAL` | 环境叙事型，以场景本身作为叙事角色 |

### 故事状态追踪

实时维护完整的故事世界状态：
- **角色**：位置、状态（存活/死亡）、已知信息、情绪、角色弧线（五阶段）
- **物品**：位置、持有者、状态
- **地点**：状态（正常/被毁）
- **揭示**：可见性范围（公开/隐藏/延迟/永不明示）、揭示时机
- **关系网络**：角色间的同盟/对手/恋人/导师/背叛关系
- **情节弧线**：开放/升级/解决状态追踪
- **伏笔**：种植、强化、解决三阶段管理
- **矛盾检测**：死亡角色持有物品、存活角色在已毁地点等

### 雪花写作法

四步骤结构化故事规划：
1. **核心种子** — 一句话故事本质
2. **角色动态** — 3-6 个角色的三层动机（表面/深层/灵魂）、弧线、秘密
3. **世界构建** — 物理（地理、规则、漏洞）、社会（权力、禁忌）、象征三个维度
4. **情节架构** — 三幕式结构（触发/对抗/解决）

---

## 配置说明 {#配置说明-1}

配置文件路径：`~/.duanju-writer/config.json`

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `autostoryUrl` | `https://autostory-web.fly.dev` | AutoStory API 地址 |
| `aiApiKey` | (空) | AutoStory API 密钥 |
| `claudePath` | `claude` | Claude CLI 路径 |
| `lang` | `en` | 默认语言（`en` / `cn`） |
| `style` | `default` | 默认风格（`default` 为自动选择） |
| `heartbeatInterval` | `1800000` | 调度间隔（毫秒，默认 30 分钟） |
| `maxRetries` | `3` | 任务失败最大重试次数 |
| `maxConcurrentJobs` | `1` | 最大并行任务数 |
| `publishOnUpload` | `true` | 上传后自动发布 |
| `targetWordsPerScene` | `0` | 目标字数/场景（0 = 不限） |

---

## 项目结构 {#项目结构-1}

```
duanju-writer/
├── bin/
│   └── duanju-writer.js          # CLI 入口和命令路由
├── src/                         # 24 个源文件
│   ├── llm.js                   # 多供应商 LLM 抽象层
│   ├── collector.js             # 全球 30 站网络调研 + 素材生成
│   ├── writer.js                # 大纲 + 场景生成编排器
│   ├── planner.js               # 故事状态初始化 + 场景规划
│   ├── story-state.js           # 故事世界状态追踪（角色/物品/地点/关系/伏笔）
│   ├── compressor.js            # 场景压缩 + 全局叙事摘要
│   ├── consistency.js           # 重复检测 + 主题冷却（中英文）
│   ├── enrichment.js            # 场景字数丰富化（中文按字计数）
│   ├── scene-types.js           # 6 种场景类型规则引擎
│   ├── snowflake.js             # 雪花写作法（四步骤）
│   ├── vectorstore.js           # TF-IDF 向量检索（中日韩双字符分词）
│   ├── knowledge.js             # 知识库文档分块 + 时间过滤检索
│   ├── styles.js                # 54 种风格加载器
│   ├── config.js                # 配置管理（含供应商/角色系统）
│   ├── queue.js                 # 任务队列（创建/更新/查询）
│   ├── scheduler.js             # 定时调度器
│   ├── worker.js                # 任务处理管线（断点续传 + 重试）
│   ├── uploader.js              # AutoStory API 上传
│   ├── websearch.js             # DuckDuckGo HTML 搜索
│   ├── webfetch.js              # HTML 抓取 + 内容提取
│   ├── history.js               # 生成历史（最近 50 条）
│   ├── setup.js                 # 交互式配置向导
│   └── constants.js             # 常量定义
├── prompts/                     # 10 个提示词模板（中英双语）
├── styles/                      # 54 种写作风格定义（9 个类别）
└── tests/                       # 231 个单元测试
```

---

## 自定义扩展 {#自定义扩展-1}

### 添加新的 LLM 供应商

```bash
duanju-writer provider add <name> --type openai --base-url <url> --model <model> --api-key <key>
duanju-writer role set <role> <provider>
```

### 添加写作风格

在 `styles/<category>/` 下添加 `.md` 文件，自动生效。

### 修改提示词

编辑 `prompts/` 目录下的模板文件，支持 `{{materials}}`、`{{outline}}`、`{{webResearch}}` 等变量注入。

---

## 测试

```bash
npm test    # 运行 231 个单元测试
```

---

## 许可证

MIT

</details>

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Global Novel Research Network](#global-novel-research-network)
- [Writing Styles](#writing-styles)
- [Multi-Provider LLM System](#multi-provider-llm-system)
- [Knowledge Base](#knowledge-base)
- [Narrative Intelligence](#narrative-intelligence)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Extending](#extending)
- [Testing](#testing)

---

## Features

### 🌍 30-Site Global Novel Research
Draws inspiration from 30 top fiction platforms across 8 countries and 6 languages. Each generation randomly samples 5 search queries and 5 sites to scrape, ensuring diversity across runs.

### 🎭 54 Author Styles
Spanning 9 categories — from Mo Yan's magical realism to Tolkien's epic fantasy, Liu Cixin's hard sci-fi to Jin Yong's wuxia. Auto-selects the best style for each story or lets you choose.

### 🎧 Audio Novel Optimized
Every story is crafted for the listening experience. Outline prompts enforce audio-first design principles (focused cast of 3-5 characters, phonetically distinct names, front-loaded context). Scene prompts follow strict audio novel writing guidelines — speaker identification before dialogue, rhythm and pacing for TTS, distinct speech patterns per character, and avoidance of audio-hostile patterns (visual references, complex nested sentences, ambiguous pronouns).

### 🌐 Bilingual (English & Chinese)
First-class support for both languages with dedicated prompt templates and research sources. Chinese mode prioritizes CN/JP/KR platforms.

### 🧠 Narrative Intelligence
- **Story State Tracking** — Characters, items, locations, revelations, relationships, plot arcs, foreshadowing
- **Consistency Checking** — Detects repetitive openers, overused phrases, and motif fatigue (supports both English and Chinese punctuation)
- **Scene Compression** — Summarizes prior scenes and maintains a rolling global narrative summary
- **Scene Enrichment** — Expands scenes to word-count targets with sensory detail (CJK characters counted individually)
- **Snowflake Method** — 4-step structured story planning (seed, characters, world, plot)
- **Plot Arcs** — Tracks open/escalating/resolved story threads
- **Character Arcs** — 5-stage development model (initial, trigger, dissonance, transformation, final)
- **Contradiction Detection** — Dead character holding items, alive character at destroyed location, etc.

### 🔌 Multi-Provider LLMs
Pluggable provider architecture. Ships with Claude CLI; add any OpenAI-compatible API (Deepseek, Mistral, local models). Assign different models to 8 creative roles.

### 📚 Knowledge Base
Built-in TF-IDF vector store with CJK bigram tokenization. Import worldbuilding docs — relevant context is automatically injected during scene writing with temporal filtering.

### ⚡ Minimal Dependencies
One npm dependency (`chalk`). No database. Pure file-system storage. Runs anywhere Node.js does.

### 🔄 Resumable Pipeline
Every pipeline step (collect, write, upload) persists its artifacts. Interrupted jobs resume from the last checkpoint — no duplicate work or duplicate uploads.

---

## How It Works

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ Research  │──→│ Collect  │──→│Snowflake │──→│ Outline  │──→│  Plan    │──→│  Write   │──→│ Upload   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

| Step | What Happens |
|------|-------------|
| **Research** | Randomly samples 5 search queries + 5 fetch URLs from 30 global platforms; caches for 5 minutes |
| **Collect** | AI analyzes trends and generates story topics, character archetypes, and plot hooks |
| **Snowflake** | 4-step story architecture: core seed, character dynamics, world building, plot structure |
| **Outline** | Creates a structured outline with title, synopsis, genres, tags, episodes, and scene plans; applies audio novel design principles |
| **Plan** | Initializes story state; plans characters, items, locations, revelations, events per scene |
| **Write** | Writes each scene iteratively with audio novel guidelines and full narrative intelligence (state tracking, knowledge retrieval, consistency checks, enrichment, compression) |
| **Upload** | Posts the finished story to the AutoStory API and auto-publishes |

Each step's output is saved to disk. If the process crashes, the next run resumes from the last completed step.

---

## Quick Start

### Prerequisites

- Node.js >= 20
- [Claude Code CLI](https://claude.ai/claude-code) installed and authenticated

### Install

```bash
git clone https://github.com/eclawlab/duanju-writer.git
cd duanju-writer
npm install
npm link    # makes 'duanju-writer' available globally
```

### Setup

```bash
# Connect to your AutoStory instance (interactive)
duanju-writer setup https://your-autostory-server.com
```

### Generate a Story

```bash
# Generate one story (auto-picks style)
duanju-writer run

# Generate 3 stories in Mo Yan's style, in Chinese
duanju-writer run 3 --style moyan --lang cn

# Generate in Tolkien's style
duanju-writer run --style tolkien
```

### Run as Daemon

```bash
# Start scheduler + worker (generates stories on a timer)
duanju-writer start

# Or run them separately
duanju-writer scheduler    # creates jobs on a heartbeat
duanju-writer worker       # processes pending jobs
```

---

## CLI Reference

### Core Commands

| Command | Description |
|---------|-------------|
| `duanju-writer setup [url]` | Configure API connection |
| `duanju-writer run [count] [options]` | Generate stories immediately |
| `duanju-writer start` | Run scheduler + worker daemon |
| `duanju-writer scheduler` | Run scheduler only |
| `duanju-writer worker` | Run worker only |
| `duanju-writer jobs` | List all jobs and their status |
| `duanju-writer styles` | List available writing styles |
| `duanju-writer config` | Show current configuration |
| `duanju-writer config set <key> <value>` | Update a config value |

### Run Options

| Flag | Description | Example |
|------|-------------|---------|
| `--lang` | Language (`en` or `cn`) | `--lang cn` |
| `--style` | Writing style key | `--style hemingway` |
| (number) | How many stories to generate | `3` |

### Provider Management

```bash
duanju-writer provider add <name> --type openai --base-url <url> --model <model> --api-key <key>
duanju-writer provider list
duanju-writer provider test <name>
duanju-writer provider remove <name>
```

### Role Assignment

```bash
duanju-writer role set scene deepseek    # Use Deepseek for scene writing
duanju-writer role list                  # Show role assignments
```

### Knowledge Base

```bash
duanju-writer knowledge import ./worldbuilding.txt            # Import a document
duanju-writer knowledge import ./docs/ --job <jobId>          # Import to a specific job
duanju-writer knowledge info                                  # Show knowledge base info
duanju-writer knowledge clear                                 # Clear knowledge base
```

---

## Global Novel Research Network

Draws inspiration from 30 top novel platforms worldwide. Each run randomly samples 5 search queries and 5 fetch URLs, with language-aware selection:

- **EN mode**: 2 global + 1 Chinese + 1 Japanese/Korean + 1 other
- **CN mode**: 2 Chinese + 1 Japanese + 1 Korean + 1 global

| Region | Platforms |
|--------|-----------|
| 🌐 English / Global | Wattpad, Reddit WritingPrompts, Tapas, Goodreads, Quotev, Dreame, NovelToon, Novel Updates |
| 🇨🇳 China | Qidian (起点中文网), JJWXC (晋江文学城), Zongheng (纵横中文网), Shuqi (书旗小说), Faloo (飞卢小说) |
| 🇯🇵 Japan | Syosetu (小説家になろう), Kakuyomu (カクヨム), Alphapolis (アルファポリス), Pixiv Novels |
| 🇰🇷 Korea | KakaoPage (카카오페이지), Novelpia (노벨피아), Joara (조아라), Ridibooks (리디북스) |
| 🇻🇳 Vietnam | TruyenFull |
| 🇮🇳 India | Pratilipi (12 Indian languages) |
| 🌐 Best-effort | Royal Road, Archive of Our Own (AO3), Webnovel, Scribblehub |

All fetches use `Promise.allSettled` — failed sites are gracefully skipped without blocking the pipeline.

---

## Writing Styles

54 pre-configured author styles across 9 categories. When style is set to `default`, the system auto-selects the best fit for each story.

| Category | Count | Notable Authors |
|----------|-------|----------------|
| Chinese Literary | 9 | Mo Yan, Lu Xun, Jin Yong, Yu Hua, Zhang Ailing, Lao She, Shen Congwen, Wang Xiaobo, San Mao |
| Chinese Sci-Fi | 1 | Liu Cixin |
| Chinese Web Novel | 5 | Er Gen, Tang Jia San Shao, Mao Ni, Tian Can Tu Dou, Priest |
| English Literary | 11 | Hemingway, Fitzgerald, Woolf, Marquez, Murakami, Morrison, Dickens, Austen, Kafka, Orwell, McCarthy |
| English Fantasy | 7 | Tolkien, George R.R. Martin, Le Guin, Gaiman, Sanderson, Rothfuss, Pratchett |
| English Sci-Fi | 6 | Asimov, Philip K. Dick, Butler, Gibson, Clarke, Atwood |
| English Thriller | 7 | King, Christie, Chandler, Flynn, Poe, Lovecraft, du Maurier |
| English Romance | 4 | Sparks, Gabaldon, Rowell, Bronte |
| English Web Novel | 4 | Wildbow, pirateaba, ErraticErrata, Shirtaloon |

<details>
<summary><strong>Full Style Reference</strong></summary>

#### Chinese Literary
| Key | Author |
|-----|--------|
| `moyan` | Mo Yan (莫言) |
| `luxun` | Lu Xun (鲁迅) |
| `jinyong` | Jin Yong (金庸) |
| `sanmao` | San Mao (三毛) |
| `yuhua` | Yu Hua (余华) |
| `zhangailing` | Zhang Ailing (张爱玲) |
| `laoshe` | Lao She (老舍) |
| `shencongwen` | Shen Congwen (沈从文) |
| `wangxiaobo` | Wang Xiaobo (王小波) |

#### Chinese Sci-Fi
| Key | Author |
|-----|--------|
| `liucixin` | Liu Cixin (刘慈欣) |

#### Chinese Web Novel
| Key | Author |
|-----|--------|
| `ergen` | Er Gen (耳根) |
| `tangjiasanshao` | Tang Jia San Shao (唐家三少) |
| `maoni` | Mao Ni (猫腻) |
| `tiancantudou` | Tian Can Tu Dou (天蚕土豆) |
| `priest` | Priest |

#### English Literary
| Key | Author |
|-----|--------|
| `hemingway` | Ernest Hemingway |
| `fitzgerald` | F. Scott Fitzgerald |
| `woolf` | Virginia Woolf |
| `marquez` | Gabriel Garcia Marquez |
| `murakami` | Haruki Murakami |
| `morrison` | Toni Morrison |
| `dickens` | Charles Dickens |
| `austen` | Jane Austen |
| `kafka` | Franz Kafka |
| `orwell` | George Orwell |
| `cormacmccarthy` | Cormac McCarthy |

#### English Fantasy
| Key | Author |
|-----|--------|
| `tolkien` | J.R.R. Tolkien |
| `grrmartin` | George R.R. Martin |
| `leguin` | Ursula K. Le Guin |
| `gaiman` | Neil Gaiman |
| `sanderson` | Brandon Sanderson |
| `rothfuss` | Patrick Rothfuss |
| `pratchett` | Terry Pratchett |

#### English Sci-Fi
| Key | Author |
|-----|--------|
| `asimov` | Isaac Asimov |
| `pkdick` | Philip K. Dick |
| `butler` | Octavia Butler |
| `gibson` | William Gibson |
| `clarke` | Arthur C. Clarke |
| `atwood` | Margaret Atwood |

#### English Thriller
| Key | Author |
|-----|--------|
| `king` | Stephen King |
| `christie` | Agatha Christie |
| `chandler` | Raymond Chandler |
| `flynn` | Gillian Flynn |
| `poe` | Edgar Allan Poe |
| `lovecraft` | H.P. Lovecraft |
| `daphnedumurier` | Daphne du Maurier |

#### English Romance
| Key | Author |
|-----|--------|
| `sparks` | Nicholas Sparks |
| `gabaldon` | Diana Gabaldon |
| `rowell` | Rainbow Rowell |
| `bronte` | Emily Bronte |

#### English Web Novel
| Key | Author |
|-----|--------|
| `wildbow` | Wildbow (J.C. McCrae) |
| `pirateaba` | pirateaba |
| `erraticerrata` | ErraticErrata |
| `shirtaloon` | Shirtaloon (Travis Deverell) |

</details>

### Adding Custom Styles

Drop a `.md` file in `styles/<category>/` — no code changes needed:

```markdown
---
name: Your Author Name
category: your-category
---

## Outline
Instructions for how the AI should plan the story structure...

## Scene
Instructions for how the AI should write individual scenes...
```

---

## Multi-Provider LLM System

A pluggable architecture that lets you assign different AI models to different creative roles:

```
┌─────────────────────────────────────┐
│          Role Assignments           │
├─────────────┬───────────────────────┤
│ research    │ claude                │
│ outline     │ claude                │
│ plan        │ claude                │
│ scene       │ deepseek              │
│ compress    │ claude                │
│ consistency │ claude                │
│ style       │ claude                │
│ repair      │ claude                │
└─────────────┴───────────────────────┘
```

**Supported provider types:**
- `claude-cli` — Calls the Claude CLI binary via stdin/stdout (default)
- `openai` — Any OpenAI-compatible API (Deepseek, Mistral, local models, etc.)

**Available roles:** `research`, `outline`, `plan`, `scene`, `compress`, `consistency`, `style`, `repair`

Each provider is cached after first use. Provider instances are automatically created from configuration.

---

## Knowledge Base

Import reference documents into a built-in TF-IDF vector store. Relevant chunks are automatically retrieved and injected into scene-writing prompts.

**Capabilities:**
- Automatic document chunking (paragraph and sentence boundaries)
- CJK bigram tokenization alongside Latin word splitting
- Stopword filtering
- Cosine similarity search
- Temporal filtering (excludes scenes within 3 of the current scene)
- Per-job and global knowledge bases
- Persistent storage (JSON files)

```bash
# Import worldbuilding docs
duanju-writer knowledge import ./worldbuilding.txt

# Import a full directory (.txt and .md files)
duanju-writer knowledge import ./reference-docs/

# Target a specific job
duanju-writer knowledge import ./plot-details.md --job <jobId>
```

---

## Narrative Intelligence

### Audio Novel Design

Stories are designed from the ground up for the listening experience. At the outline level, audio design principles ensure focused casts (3-5 characters), phonetically distinct names, front-loaded context, and momentum-driven pacing. At the scene level, comprehensive writing guidelines cover:

- **Clarity** — Speaker identification before dialogue, frequent use of character names, memorable descriptors on first appearance
- **Rhythm** — Varied sentence length, natural breathing pauses via paragraph breaks, 2-4 sentence blocks
- **Audio-hostile avoidance** — No visual references ("see above"), no similar-sounding names, no complex nested sentences, no parenthetical asides
- **Sound design** — Ambient sound descriptions, natural-sounding dialogue, distinct speech patterns per character
- **TTS voice assignment** — Each character is assigned a specific TTS voice (alloy, echo, fable, onyx, nova, shimmer)

### Scene Type Specialization

Each scene is assigned a type that shapes how it's written, with dedicated rules for both English and Chinese:

| Type | Purpose |
|------|---------|
| `NARRATIVE` | Exposition with action and environmental detail |
| `CHOICE` | Builds tension and presents branching decisions |
| `DIALOGUE` | Character interaction revealing personality and relationships |
| `ACTION` | Fast-paced sequences — combat, chases, escapes |
| `PSYCHOLOGICAL` | Internal states, moral dilemmas, emotional conflict |
| `ENVIRONMENTAL` | Setting as character — atmosphere drives the narrative |

### Story State Tracker

Maintains a live world model throughout generation:

- **Characters** — Position, status (alive/dead), knowledge, emotional state, 5-stage arc
- **Items** — Location, holder, status (active/destroyed/used)
- **Locations** — Status (normal/destroyed)
- **Revelations** — Visibility scope (public/hidden/delayed/never_explicit), reveal timing
- **Relationships** — Ally, rival, lover, mentor, betrayer, neutral
- **Plot Arcs** — Open/escalating/resolved story threads with scene tracking
- **Foreshadowing** — Plant, reinforce (with scene list), resolve lifecycle
- **Validation** — Detects contradictions (dead character holding items, alive character at destroyed location, active item at destroyed location)

### Consistency Engine

Prevents mechanical, repetitive writing:
- Flags repetitive sentence openers (3+ occurrences)
- Detects overused phrases (3-5 word sequences appearing 3+ times)
- Enforces motif cooldowns (no reuse within 3 scenes; tracker auto-prunes)
- Full support for Chinese punctuation (`。！？`) for sentence splitting
- Automatic LLM-powered rewriting when issues are detected

### Scene Enrichment

When `targetWordsPerScene` is set in config:
- Counts words using CJK-aware logic (each Chinese/Japanese/Korean character = 1 word)
- Scenes below 80% of target are automatically expanded via LLM
- Preserves all scene tags, plot events, and character actions

### Scene Compression

Maintains narrative continuity across scenes:
- Each scene is compressed into a structured summary (character actions, plot progress, emotional arc, state changes)
- A rolling global narrative summary (max 2000 chars) is maintained and injected into every scene prompt
- Prior scene context is formatted and included in the "Story So Far" section

### Snowflake Method

Structured 4-step story planning that enriches the outline:
1. **Core Seed** — The one-sentence essence of the story
2. **Character Dynamics** — 3-6 characters with triple-layer motivations (surface/deep/soul), 5-stage arcs, and secrets
3. **World Building** — Physical (geography, rules, loopholes), social (power structures, taboos), symbolic (visual motifs, climate-mood mapping)
4. **Plot Architecture** — Three-act structure: trigger (catalyst, reaction, stakes), confrontation (escalation, false victory, darkest moment), resolution (cost, twist, epilogue)

---

## Configuration

Stored at `~/.duanju-writer/config.json`.

| Key | Default | Description |
|-----|---------|-------------|
| `autostoryUrl` | `https://autostory-web.fly.dev` | AutoStory API endpoint |
| `aiApiKey` | (empty) | API key for AutoStory |
| `claudePath` | `claude` | Path to Claude CLI binary |
| `lang` | `en` | Default language (`en` or `cn`) |
| `style` | `default` | Default writing style (`default` = auto-pick) |
| `heartbeatInterval` | `1800000` | Scheduler interval in ms (default: 30 min) |
| `maxRetries` | `3` | Max retries per failed job |
| `maxConcurrentJobs` | `1` | Max parallel jobs |
| `publishOnUpload` | `true` | Auto-publish after upload |
| `targetWordsPerScene` | `0` | Target words per scene (0 = disabled) |
| `providers` | `{claude: {type: 'claude-cli'}}` | LLM provider configurations |
| `roles` | `{research: 'claude', ...}` | Role-to-provider mappings |

---

## Project Structure

```
duanju-writer/
├── bin/
│   └── duanju-writer.js          # CLI entry point and command router
├── src/                         # 24 source files
│   ├── llm.js                   # Multi-provider LLM abstraction (OpenAI + Claude CLI)
│   ├── collector.js             # 30-site global web research + material generation
│   ├── writer.js                # Outline + scene generation orchestrator
│   ├── planner.js               # Story state initialization + scene planning
│   ├── story-state.js           # World state tracker (characters/items/locations/arcs/foreshadowing)
│   ├── compressor.js            # Scene compression + global narrative summary
│   ├── consistency.js           # Repetition detection + motif cooldown (EN + CJK)
│   ├── enrichment.js            # Scene word-count enrichment (CJK-aware counting)
│   ├── scene-types.js           # 6 scene type rules engine (EN + CN)
│   ├── snowflake.js             # Snowflake method (4-step story architecture)
│   ├── vectorstore.js           # TF-IDF vector store (CJK bigram tokenization)
│   ├── knowledge.js             # Knowledge base document chunking + temporal retrieval
│   ├── styles.js                # 54 writing style loader
│   ├── config.js                # Config management with provider/role system
│   ├── queue.js                 # Job queue (create/update/query/busy detection)
│   ├── scheduler.js             # Timed job creation daemon
│   ├── worker.js                # Job processor pipeline (resume + retry)
│   ├── uploader.js              # AutoStory API upload
│   ├── websearch.js             # DuckDuckGo HTML search scraper
│   ├── webfetch.js              # HTML page fetcher + content extractor
│   ├── history.js               # Generation history (last 50 entries)
│   ├── setup.js                 # Interactive setup wizard
│   └── constants.js             # Shared constants and paths
├── prompts/                     # 10 prompt templates (English + Chinese)
├── styles/                      # 54 writing style definitions (9 categories)
└── tests/                       # 231 unit tests
```

---

## Extending

### Add a New LLM Provider

```bash
duanju-writer provider add mymodel --type openai --base-url https://api.example.com/v1 --model model-name --api-key sk-...
duanju-writer role set scene mymodel
```

### Add a Writing Style

Drop a `.md` file in `styles/<category>/` with `name`, `category` frontmatter and `## Outline` / `## Scene` sections. Available immediately — no code changes or restarts needed.

### Modify Prompts

Edit templates in `prompts/`. Available templates:
- `research.md` / `research-cn.md` — Research material collection
- `outline.md` / `outline-cn.md` — Story outline generation
- `plan.md` / `plan-cn.md` — Scene planning
- `scenes.md` / `scenes-cn.md` — Scene writing
- `snowflake.md` / `snowflake-cn.md` — Snowflake method architecture

Supported variables: `{{materials}}`, `{{outline}}`, `{{webResearch}}`, `{{history}}`, `{{sceneIndex}}`, `{{totalScenes}}`, `{{sceneSummary}}`, `{{sceneType}}`, and more.

---

## Testing

```bash
npm test    # Runs 231 unit tests via Node.js native test runner
```

---

## License

MIT

---

<div align="center">

Powered by [Claude Code](https://claude.ai/claude-code)

</div>
