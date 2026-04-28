const SCENE_RULES = {
  NARRATIVE: {
    en: [
      '- Balance exposition with action — show, don\'t tell',
      '- Use environmental details to set mood and atmosphere',
      '- Vary sentence length: short for tension, long for reflection',
      '- Ground abstract emotions in physical sensations',
    ],
    cn: [
      '- 叙述与动作平衡——展示而非讲述',
      '- 用环境细节营造氛围',
      '- 变化句子长度：短句制造紧张，长句用于沉思',
      '- 用身体感受表达抽象情感',
    ],
  },
  CHOICE: {
    en: [
      '- Build tension leading to the choice point — make both options feel consequential',
      '- Each choice should reflect a different value or priority, not just a different action',
      '- Use dialogue or internal monologue to highlight the stakes of each option',
      '- The moment before the choice should feel like a held breath',
    ],
    cn: [
      '- 在选择点前制造紧张感——让每个选项都有重大后果',
      '- 每个选择应体现不同的价值观或优先级，而非仅仅是不同的行动',
      '- 用对话或内心独白突出每个选项的利害关系',
      '- 选择前的瞬间应像屏息以待',
    ],
  },
  DIALOGUE: {
    en: [
      '- Every line of dialogue should serve character or plot — cut small talk',
      '- Use subtext: what characters mean vs. what they say should differ',
      '- Vary speech patterns per character: vocabulary, rhythm, verbal tics',
      '- Balance dialogue with action beats — characters move, gesture, react physically',
      '- Power dynamics should be visible through who speaks, who listens, who interrupts',
    ],
    cn: [
      '- 每句对话都应服务于角色或情节——删去闲聊',
      '- 运用潜台词：角色的真实意图与台词应有差异',
      '- 为每个角色设计不同的语言风格：词汇、节奏、口头禅',
      '- 对话与动作描写交替——角色要有肢体动作和反应',
      '- 通过谁说话、谁倾听、谁打断来展示权力关系',
    ],
  },
  ACTION: {
    en: [
      '- Use short, punchy sentences for fast-paced sequences',
      '- Engage all senses: not just sight, but sound, smell, pain, adrenaline',
      '- Characters should interact with their environment during action — use terrain',
      '- Consequences matter: injuries slow people down, exhaustion accumulates',
      '- Rhythm control: quick bursts of action, then a beat of stillness for impact',
    ],
    cn: [
      '- 快节奏场景用短促有力的句子',
      '- 调动所有感官：不仅是视觉，还有声音、气味、疼痛、肾上腺素',
      '- 动作中角色应与环境互动——利用地形',
      '- 后果很重要：伤势会拖慢速度，疲劳会累积',
      '- 节奏控制：快速动作爆发后，留一拍静止以增强冲击力',
    ],
  },
  PSYCHOLOGICAL: {
    en: [
      '- Externalize internal states through physical symptoms: dry mouth, racing heart, cold sweat',
      '- Use metaphorical imagery that mirrors the character\'s mental state',
      '- Show cognitive dissonance: the gap between what characters believe and what they do',
      '- Memory and flashback should intrude naturally, triggered by sensory details',
      '- Silence and pauses carry as much weight as words',
    ],
    cn: [
      '- 通过身体反应外化内心状态：口干、心跳加速、冷汗',
      '- 使用映射角色心理状态的比喻意象',
      '- 展示认知失调：角色信念与行为之间的落差',
      '- 记忆和闪回应由感官细节自然触发',
      '- 沉默和停顿与话语同样有分量',
    ],
  },
  ENVIRONMENTAL: {
    en: [
      '- The setting is a character — give it mood, personality, and agency',
      '- Use unusual sensory combinations: the sound of fog, the weight of silence',
      '- Describe space through movement: how characters navigate it reveals its nature',
      '- Weather and light as emotional mirrors — but avoid clichés',
      '- Architecture and landscape should reflect the civilization or culture that built them',
    ],
    cn: [
      '- 将场景当作角色——赋予它情绪、个性和能动性',
      '- 使用独特的感官组合：雾的声音、寂静的重量',
      '- 通过角色的移动来描述空间：他们如何穿行揭示空间的本质',
      '- 天气和光线作为情感镜像——但避免陈词滥调',
      '- 建筑和景观应反映建造它们的文明或文化',
    ],
  },
};

export function getSceneTypeRules(sceneType, lang = 'en') {
  const rules = SCENE_RULES[sceneType];
  if (!rules) return '';
  const langRules = rules[lang] || rules['en'];
  return langRules.join('\n');
}

export function listSceneTypes() {
  return Object.keys(SCENE_RULES);
}
