<div align="center">

# Story Writer

### Autonomous Interactive Fiction Generator

**Research. Plan. Write. Publish.**

An AI-powered daemon that researches trending fiction, crafts branching interactive stories in 54 literary styles, and publishes them to the [AutoStory](https://autostory-web.fly.dev) platform — fully autonomously.

一个 AI 驱动的自动化守护进程，自动调研热门小说趋势、以 54 种文学风格撰写分支互动故事，并自动发布至 [AutoStory](https://autostory-web.fly.dev) 平台。

[![Node.js](https://img.shields.io/badge/Node.js-≥20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-121_passing-brightgreen)](tests/)

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
- [写作风格库](#写作风格库-1)
- [多模型供应商系统](#多模型供应商系统-1)
- [知识库系统](#知识库系统-1)
- [叙事智能引擎](#叙事智能引擎-1)
- [配置说明](#配置说明-1)
- [项目结构](#项目结构-1)
- [自定义扩展](#自定义扩展-1)

---

## 项目简介

**Story Writer** 是为 AutoStory 互动有声小说平台打造的全自动故事生成系统。读者在故事中做出选择，影响叙事走向 —— 而 Story Writer 负责生成这些充满分支与可能性的故事。

从网络调研、素材收集、大纲规划、场景写作到最终发布，整个流程无需人工干预，完全自动化运行。

---

## 核心特性

### 🔬 智能调研
自动抓取 Wattpad、Reddit、起点中文网、晋江文学城、Royal Road 等平台的热门小说趋势，确保生成的故事紧跟潮流。

### 🎭 54 种文学风格
涵盖 10 个类别的作家风格 —— 从莫言的魔幻现实主义到托尔金的史诗奇幻，从刘慈欣的硬科幻到金庸的武侠世界。支持自动风格匹配或手动指定。

### 🌐 中英双语
原生支持中文和英文内容生成，包含独立的提示词模板和调研源。

### 🧠 叙事智能引擎
- **故事状态追踪**：实时跟踪角色位置、物品归属、已揭示的秘密、情感变化
- **一致性检查**：防止重复句式开头、过度使用相同短语、主题冷却机制
- **场景压缩**：将已写场景压缩为叙事摘要，注入后续场景的上下文
- **场景丰富化**：根据目标字数自动扩展场景，增添感官细节和氛围描写
- **雪花写作法**：四步骤故事规划（核心种子→角色动态→世界构建→情节架构）

### 🔌 多模型供应商
可插拔的 LLM 供应商架构。默认使用 Claude CLI，同时支持任何 OpenAI 兼容 API（如 Deepseek、Mistral 等）。可为不同任务角色分配不同模型。

### 📚 知识库
内置 TF-IDF 向量检索引擎，支持导入世界观设定、参考资料等文档，在场景写作时自动注入相关上下文。

### ⚡ 零外部依赖
仅依赖 `chalk` 一个 npm 包。无需数据库，纯文件系统存储，开箱即用。

---

## 生成流程

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  网络调研  │──→│  素材收集  │──→│  大纲生成  │──→│  状态规划  │──→│  场景写作  │──→│  自动发布  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

| 步骤 | 说明 |
|------|------|
| **网络调研** | 抓取多个平台的热门小说趋势，缓存 30 分钟 |
| **素材收集** | AI 分析趋势数据，生成故事主题、角色原型、情节钩子 |
| **大纲生成** | 创建结构化大纲：标题、简介、类型、标签、5-8 个场景 |
| **状态规划** | 初始化故事状态，规划角色、物品、地点、每场景事件序列 |
| **场景写作** | 逐场景写作，含叙述、对话、玩家选择，支持场景类型特化 |
| **自动发布** | 将完成的故事上传至 AutoStory API 并自动发布 |

---

## 快速开始 {#快速开始-1}

### 前置要求

- Node.js 20 或更高版本
- [Claude Code CLI](https://claude.ai/claude-code) 已安装并认证

### 安装

```bash
git clone https://github.com/eclawlab/story_writer.git
cd story_writer
npm install
npm link    # 全局安装 story_writer 命令
```

### 初始配置

```bash
# 连接至 AutoStory 实例（交互式配置）
story_writer setup https://your-autostory-server.com
```

### 生成故事

```bash
# 生成一个故事（自动选择风格）
story_writer run

# 用莫言风格生成 3 个中文故事
story_writer run 3 --style moyan --lang cn

# 用托尔金风格生成
story_writer run --style tolkien
```

### 守护进程模式

```bash
# 启动调度器 + 工作器（定时自动生成）
story_writer start

# 或分别启动
story_writer scheduler    # 定时创建任务
story_writer worker       # 处理待执行任务
```

---

## 命令行参考 {#命令行参考-1}

### 核心命令

| 命令 | 说明 |
|------|------|
| `story_writer setup [url]` | 配置 API 连接 |
| `story_writer run [count] [options]` | 立即生成故事 |
| `story_writer start` | 启动调度器 + 工作器守护进程 |
| `story_writer scheduler` | 仅启动调度器 |
| `story_writer worker` | 仅启动工作器 |
| `story_writer jobs` | 查看所有任务及状态 |
| `story_writer styles` | 列出可用写作风格 |
| `story_writer config` | 显示当前配置 |
| `story_writer config set <key> <value>` | 更新配置项 |

### 生成选项

| 参数 | 说明 | 示例 |
|------|------|------|
| `--lang` | 语言（`en` 或 `cn`） | `--lang cn` |
| `--style` | 写作风格 | `--style hemingway` |
| (数字) | 生成数量 | `3` |

### 供应商管理

```bash
story_writer provider add <name> --type openai --base-url <url> --model <model> --api-key <key>
story_writer provider list
story_writer provider test <name>
story_writer provider remove <name>
```

### 角色分配

```bash
story_writer role set scene deepseek    # 将场景写作分配给 Deepseek
story_writer role list                  # 查看角色分配
```

### 知识库管理

```bash
story_writer knowledge import ./worldbuilding.txt            # 导入文档
story_writer knowledge import ./docs/ --job <jobId>          # 导入至特定任务
story_writer knowledge info                                  # 查看知识库信息
story_writer knowledge clear                                 # 清空知识库
```

---

## 写作风格库 {#写作风格库-1}

54 种预置作家风格，涵盖 10 个类别：

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

### 添加自定义风格

在 `styles/<category>/` 目录下创建 `.md` 文件即可，无需修改代码：

```markdown
---
name: 作者名
category: 类别名
---

## Outline
大纲生成指导...

## Scene
场景写作指导...
```

---

## 多模型供应商系统 {#多模型供应商系统-1}

可插拔架构，支持为不同创作环节指定不同 AI 模型：

```
┌─────────────┐
│   角色分配    │
├─────────────┤
│ research → claude    │  调研：Claude
│ outline  → claude    │  大纲：Claude
│ scene    → deepseek  │  场景：Deepseek
│ compress → claude    │  压缩：Claude
└─────────────┘
```

**支持的供应商类型：**
- `claude-cli` — 通过 Claude CLI 调用（默认）
- `openai` — 任何 OpenAI 兼容 API（Deepseek、Mistral、本地模型等）

---

## 知识库系统 {#知识库系统-1}

内置的 TF-IDF 向量检索引擎，可导入参考资料并在写作时自动注入相关上下文：

- 自动文档分块
- 停用词过滤
- 余弦相似度检索
- 支持全局知识库和任务级知识库

---

## 叙事智能引擎 {#叙事智能引擎-1}

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
- **角色**：位置、状态、已知信息、情绪
- **物品**：位置、持有者、状态
- **地点**：已探索/未探索、状态描述
- **揭示**：已知秘密、可见性范围、揭示场景

### 雪花写作法

四步骤结构化故事规划：
1. **核心种子** — 一句话故事本质
2. **角色动态** — 3-6 个角色的动机、弧线、秘密
3. **世界构建** — 物理、社会、象征三个维度
4. **情节架构** — 三幕式结构

---

## 配置说明 {#配置说明-1}

配置文件路径：`~/.story_writer/config.json`

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
story_writer/
├── bin/
│   └── story_writer.js          # CLI 入口和命令路由
├── src/
│   ├── llm.js                   # 多供应商 LLM 抽象层
│   ├── collector.js             # 网络调研 + 素材生成
│   ├── writer.js                # 大纲 + 场景生成编排器
│   ├── planner.js               # 故事状态初始化
│   ├── story-state.js           # 故事世界状态追踪
│   ├── compressor.js            # 场景压缩（叙事上下文）
│   ├── consistency.js           # 重复检测 + 主题冷却
│   ├── enrichment.js            # 场景字数丰富化
│   ├── scene-types.js           # 场景类型规则引擎
│   ├── snowflake.js             # 雪花写作法
│   ├── vectorstore.js           # TF-IDF 向量检索引擎
│   ├── knowledge.js             # 知识库文档分块
│   ├── styles.js                # 风格加载器
│   ├── config.js                # 配置管理
│   ├── queue.js                 # 任务队列
│   ├── scheduler.js             # 定时调度器
│   ├── worker.js                # 任务处理管线
│   ├── uploader.js              # API 上传
│   ├── websearch.js             # DuckDuckGo 搜索
│   ├── webfetch.js              # HTML 抓取解析
│   ├── history.js               # 生成历史
│   ├── setup.js                 # 交互式配置向导
│   └── constants.js             # 常量定义
├── prompts/                     # 提示词模板（中英双语）
├── styles/                      # 54 种写作风格定义
├── tests/                       # 121 个单元测试
└── docs/                        # 开发文档
```

---

## 自定义扩展 {#自定义扩展-1}

### 添加新的 LLM 供应商

```bash
story_writer provider add <name> --type openai --base-url <url> --model <model> --api-key <key>
story_writer role set <role> <provider>
```

### 添加写作风格

在 `styles/<category>/` 下添加 `.md` 文件，自动生效。

### 修改提示词

编辑 `prompts/` 目录下的模板文件，支持 `{{materials}}`、`{{outline}}`、`{{webResearch}}` 等变量注入。

---

## 测试

```bash
npm test    # 运行 121 个单元测试
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

### 🔬 Intelligent Research
Automatically scrapes trending fiction from Wattpad, Reddit, Qidian, JJWXC, Royal Road, and more — ensuring stories stay fresh and relevant.

### 🎭 54 Author Styles
Spanning 10 categories — from Mo Yan's magical realism to Tolkien's epic fantasy, Liu Cixin's hard sci-fi to Jin Yong's wuxia. Auto-selects the best style or lets you choose.

### 🌐 Bilingual (English & Chinese)
First-class support for both languages with dedicated prompt templates and research sources.

### 🧠 Narrative Intelligence
- **Story State Tracking** — Characters, items, locations, revelations, and emotional arcs
- **Consistency Checking** — Prevents repetitive openers, overused phrases, and motif fatigue
- **Scene Compression** — Summarizes prior scenes for narrative context injection
- **Scene Enrichment** — Expands scenes to hit word-count targets with sensory detail
- **Snowflake Method** — 4-step structured story planning

### 🔌 Multi-Provider LLMs
Pluggable provider architecture. Ships with Claude CLI support; add any OpenAI-compatible API (Deepseek, Mistral, local models). Assign different models to different creative roles.

### 📚 Knowledge Base
Built-in TF-IDF vector store. Import worldbuilding docs, reference materials, or plot outlines — relevant context is automatically injected during scene writing.

### ⚡ Minimal Dependencies
One npm dependency (`chalk`). No database. Pure file-system storage. Runs anywhere Node.js does.

---

## How It Works

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ Research  │──→│ Collect  │──→│ Outline  │──→│  Plan    │──→│  Write   │──→│ Upload   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

| Step | What Happens |
|------|-------------|
| **Research** | Scrapes trending fiction from multiple platforms; caches results for 30 minutes |
| **Collect** | AI analyzes trends and generates story topics, character archetypes, and plot hooks |
| **Outline** | Creates a structured outline with title, synopsis, genres, tags, and 5–8 scenes |
| **Plan** | Initializes story state; plans characters, items, locations, and per-scene event sequences |
| **Write** | Writes each scene iteratively with narration, dialogue, and player choices; applies scene-type specialization, consistency checks, and enrichment |
| **Upload** | Posts the finished story to the AutoStory API and auto-publishes |

---

## Quick Start

### Prerequisites

- Node.js >= 20
- [Claude Code CLI](https://claude.ai/claude-code) installed and authenticated

### Install

```bash
git clone https://github.com/eclawlab/story_writer.git
cd story_writer
npm install
npm link    # makes 'story_writer' available globally
```

### Setup

```bash
# Connect to your AutoStory instance (interactive)
story_writer setup https://your-autostory-server.com
```

### Generate a Story

```bash
# Generate one story (auto-picks style)
story_writer run

# Generate 3 stories in Mo Yan's style, in Chinese
story_writer run 3 --style moyan --lang cn

# Generate in Tolkien's style
story_writer run --style tolkien
```

### Run as Daemon

```bash
# Start scheduler + worker (generates stories on a timer)
story_writer start

# Or run them separately
story_writer scheduler    # creates jobs on a heartbeat
story_writer worker       # processes pending jobs
```

---

## CLI Reference

### Core Commands

| Command | Description |
|---------|-------------|
| `story_writer setup [url]` | Configure API connection |
| `story_writer run [count] [options]` | Generate stories immediately |
| `story_writer start` | Run scheduler + worker daemon |
| `story_writer scheduler` | Run scheduler only |
| `story_writer worker` | Run worker only |
| `story_writer jobs` | List all jobs and their status |
| `story_writer styles` | List available writing styles |
| `story_writer config` | Show current configuration |
| `story_writer config set <key> <value>` | Update a config value |

### Run Options

| Flag | Description | Example |
|------|-------------|---------|
| `--lang` | Language (`en` or `cn`) | `--lang cn` |
| `--style` | Writing style key | `--style hemingway` |
| (number) | How many stories to generate | `3` |

### Provider Management

```bash
story_writer provider add <name> --type openai --base-url <url> --model <model> --api-key <key>
story_writer provider list
story_writer provider test <name>
story_writer provider remove <name>
```

### Role Assignment

```bash
story_writer role set scene deepseek    # Use Deepseek for scene writing
story_writer role list                  # Show role assignments
```

### Knowledge Base

```bash
story_writer knowledge import ./worldbuilding.txt            # Import a document
story_writer knowledge import ./docs/ --job <jobId>          # Import to a specific job
story_writer knowledge info                                  # Show knowledge base info
story_writer knowledge clear                                 # Clear knowledge base
```

---

## Writing Styles

54 pre-configured author styles across 10 categories. When style is set to `default`, the system auto-selects the best fit for each story.

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
├──────────┬──────────────────────────┤
│ research │ claude                   │
│ outline  │ claude                   │
│ scene    │ deepseek                 │
│ compress │ claude                   │
│ style    │ claude                   │
│ repair   │ claude                   │
└──────────┴──────────────────────────┘
```

**Supported provider types:**
- `claude-cli` — Calls the Claude CLI binary via stdin/stdout (default)
- `openai` — Any OpenAI-compatible API (Deepseek, Mistral, local models, etc.)

**Available roles:** `research`, `outline`, `plan`, `scene`, `compress`, `consistency`, `style`, `repair`

---

## Knowledge Base

Import reference documents into a built-in TF-IDF vector store. Relevant chunks are automatically retrieved and injected into scene-writing prompts.

**Capabilities:**
- Automatic document chunking
- Stopword filtering and tokenization
- Cosine similarity search
- Per-job and global knowledge bases

```bash
# Import worldbuilding docs
story_writer knowledge import ./worldbuilding.txt

# Import a full directory
story_writer knowledge import ./reference-docs/

# Target a specific job
story_writer knowledge import ./plot-details.md --job <jobId>
```

---

## Narrative Intelligence

### Scene Type Specialization

Each scene is assigned a type that shapes how it's written:

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
- **Characters** — position, status, knowledge, emotional state
- **Items** — location, holder, status
- **Locations** — exploration state, descriptions
- **Revelations** — secrets revealed, visibility scope, scene of origin
- **Relationships, plot arcs, foreshadowing**

### Consistency Engine

Prevents mechanical, repetitive writing:
- Flags repetitive sentence openers (3+ occurrences)
- Detects overused phrases (3–5 word sequences appearing 3+ times)
- Enforces motif cooldowns (no reuse within 3 scenes)

### Snowflake Method

Structured 4-step story planning:
1. **Core Seed** — The one-sentence essence of the story
2. **Character Dynamics** — 3–6 characters with motivations, arcs, and secrets
3. **World Building** — Physical, social, and symbolic dimensions
4. **Plot Architecture** — Three-act structure with turning points

---

## Configuration

Stored at `~/.story_writer/config.json`.

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
| `providers` | `{...}` | LLM provider configurations |
| `roles` | `{...}` | Role-to-provider mappings |

---

## Project Structure

```
story_writer/
├── bin/
│   └── story_writer.js          # CLI entry point and command router
├── src/
│   ├── llm.js                   # Multi-provider LLM abstraction
│   ├── collector.js             # Web research + material generation
│   ├── writer.js                # Outline + scene generation orchestrator
│   ├── planner.js               # Story state initialization from outline
│   ├── story-state.js           # World state tracker (characters, items, locations)
│   ├── compressor.js            # Scene compression for narrative context
│   ├── consistency.js           # Repetition detection + motif tracking
│   ├── enrichment.js            # Scene word-count enrichment
│   ├── scene-types.js           # Scene type rules engine
│   ├── snowflake.js             # Snowflake method story planning
│   ├── vectorstore.js           # In-memory TF-IDF vector store
│   ├── knowledge.js             # Knowledge base document chunking
│   ├── styles.js                # Writing style loader (.md files)
│   ├── config.js                # Config loading/saving with provider system
│   ├── queue.js                 # Job queue management
│   ├── scheduler.js             # Timed job creation daemon
│   ├── worker.js                # Job processor pipeline with retry logic
│   ├── uploader.js              # AutoStory API upload
│   ├── websearch.js             # DuckDuckGo search scraper
│   ├── webfetch.js              # HTML page fetcher + parser
│   ├── history.js               # Generation history tracking
│   ├── setup.js                 # Interactive setup wizard
│   └── constants.js             # Shared constants and paths
├── prompts/                     # Prompt templates (English + Chinese)
├── styles/                      # 54 writing style definitions (.md)
├── tests/                       # 121 unit tests
└── docs/                        # Development specs
```

---

## Extending

### Add a New LLM Provider

```bash
story_writer provider add mymodel --type openai --base-url https://api.example.com/v1 --model model-name --api-key sk-...
story_writer role set scene mymodel
```

### Add a Writing Style

Drop a `.md` file in `styles/<category>/` with `name`, `category` frontmatter and `## Outline` / `## Scene` sections. Available immediately.

### Modify Prompts

Edit templates in `prompts/`. Supported variables: `{{materials}}`, `{{outline}}`, `{{webResearch}}`, `{{history}}`, and more.

---

## Testing

```bash
npm test    # Runs 121 unit tests via Node.js native test runner
```

---

## License

MIT

---

<div align="center">

Powered by [Claude Code](https://claude.ai/claude-code)

</div>
