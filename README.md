# Story Writer

Autonomous story generation daemon for the [AutoStory](https://autostory-web.fly.dev) platform. Researches trending fiction, generates interactive audio novel stories with branching choices, and publishes them automatically.

Powered by [Claude Code](https://claude.ai/claude-code) as the AI backbone.

## How It Works

```
Web Research  -->  Material Collection  -->  Style Selection  -->  Outline  -->  Scenes  -->  Upload
```

1. **Research** - Scrapes trending fiction from Wattpad, Reddit, Qidian, JJWXC, and more
2. **Collect** - Claude analyzes trends and generates story materials (topics, characters, plot hooks)
3. **Style** - Auto-selects the best writing style for the story, or uses your choice
4. **Outline** - Generates a structured story outline with episodes and scene plans
5. **Write** - Writes each scene with narrator blocks, character dialogue, and player choices
6. **Upload** - Publishes the finished story to the AutoStory platform

## Quick Start

### Prerequisites

- Node.js >= 20
- [Claude Code CLI](https://claude.ai/claude-code) installed and authenticated

### Install

```bash
git clone https://github.com/eclawlab/story_writer.git
cd story_writer
npm install
npm link    # installs `story_writer` globally
```

### Setup

Connect to your AutoStory instance:

```bash
story_writer setup
# or with a URL:
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
# Start both scheduler + worker (generates stories on a timer)
story_writer start

# Or run them separately
story_writer scheduler
story_writer worker
```

## Writing Styles

54 author styles across 10 categories. When no style is specified, the system automatically picks the best fit for each story.

<details>
<summary><strong>Chinese Literary</strong> (9 styles)</summary>

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

</details>

<details>
<summary><strong>Chinese Sci-Fi</strong> (1 style)</summary>

| Key | Author |
|-----|--------|
| `liucixin` | Liu Cixin (刘慈欣) |

</details>

<details>
<summary><strong>Chinese Web Novel</strong> (5 styles)</summary>

| Key | Author |
|-----|--------|
| `ergen` | Er Gen (耳根) |
| `tangjiasanshao` | Tang Jia San Shao (唐家三少) |
| `maoni` | Mao Ni (猫腻) |
| `tiancantudou` | Tian Can Tu Dou (天蚕土豆) |
| `priest` | Priest (priest) |

</details>

<details>
<summary><strong>English Literary</strong> (11 styles)</summary>

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

</details>

<details>
<summary><strong>English Fantasy</strong> (7 styles)</summary>

| Key | Author |
|-----|--------|
| `tolkien` | J.R.R. Tolkien |
| `grrmartin` | George R.R. Martin |
| `leguin` | Ursula K. Le Guin |
| `gaiman` | Neil Gaiman |
| `sanderson` | Brandon Sanderson |
| `rothfuss` | Patrick Rothfuss |
| `pratchett` | Terry Pratchett |

</details>

<details>
<summary><strong>English Sci-Fi</strong> (6 styles)</summary>

| Key | Author |
|-----|--------|
| `asimov` | Isaac Asimov |
| `pkdick` | Philip K. Dick |
| `butler` | Octavia Butler |
| `gibson` | William Gibson |
| `clarke` | Arthur C. Clarke |
| `atwood` | Margaret Atwood |

</details>

<details>
<summary><strong>English Thriller</strong> (7 styles)</summary>

| Key | Author |
|-----|--------|
| `king` | Stephen King |
| `christie` | Agatha Christie |
| `chandler` | Raymond Chandler |
| `flynn` | Gillian Flynn |
| `poe` | Edgar Allan Poe |
| `lovecraft` | H.P. Lovecraft |
| `daphnedumurier` | Daphne du Maurier |

</details>

<details>
<summary><strong>English Romance</strong> (4 styles)</summary>

| Key | Author |
|-----|--------|
| `sparks` | Nicholas Sparks |
| `gabaldon` | Diana Gabaldon |
| `rowell` | Rainbow Rowell |
| `bronte` | Emily Bronte |

</details>

<details>
<summary><strong>English Web Novel</strong> (4 styles)</summary>

| Key | Author |
|-----|--------|
| `wildbow` | Wildbow (J.C. McCrae) |
| `pirateaba` | pirateaba |
| `erraticerrata` | ErraticErrata |
| `shirtaloon` | Shirtaloon (Travis Deverell) |

</details>

### Adding Custom Styles

Drop a `.md` file in `styles/<category>/`:

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

No code changes needed. The style is available immediately.

## CLI Reference

```
story_writer setup [url]                    # Configure API connection
story_writer start                          # Run scheduler + worker daemon
story_writer run [count] [options]          # Generate stories immediately
story_writer jobs                           # List all jobs and their status
story_writer styles                         # List available writing styles
story_writer config                         # Show current configuration
story_writer config set <key> <value>       # Update a config value
```

### Run Options

| Flag | Description | Example |
|------|-------------|---------|
| `--lang` | Language (`en` or `cn`) | `--lang cn` |
| `--style` | Writing style key | `--style hemingway` |
| (number) | How many stories | `3` |

### Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `autostoryUrl` | `https://autostory-web.fly.dev` | AutoStory API endpoint |
| `aiApiKey` | (empty) | API key for AutoStory |
| `claudePath` | `claude` | Path to Claude CLI binary |
| `lang` | `en` | Default language |
| `style` | `default` | Default writing style (or `default` for auto-pick) |
| `heartbeatInterval` | `1800000` | Scheduler interval in ms (30 min) |
| `maxRetries` | `3` | Max retries per failed job |
| `maxConcurrentJobs` | `1` | Max parallel jobs |
| `publishOnUpload` | `true` | Auto-publish uploaded stories |

Config is stored at `~/.story_writer/config.json`.

## Project Structure

```
story_writer/
  bin/story_writer.js     # CLI entry point
  src/
    claude.js             # Claude CLI wrapper
    collector.js          # Web research + material generation
    config.js             # Config loading/saving
    constants.js          # Shared constants
    history.js            # Story history tracking
    queue.js              # Job queue management
    scheduler.js          # Timed job creation
    setup.js              # Interactive setup wizard
    styles.js             # Style loader (reads .md files)
    uploader.js           # AutoStory API upload
    webfetch.js           # HTML page fetcher + parser
    websearch.js          # DuckDuckGo search scraper
    worker.js             # Job processor pipeline
    writer.js             # Outline + scene generation
  prompts/                # Prompt templates (en + cn)
  styles/                 # Writing style definitions (.md)
  tests/                  # 121 unit tests
```

## Testing

```bash
npm test
```

## License

MIT
