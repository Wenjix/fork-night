/**
 * "Kimi K3 is the Night Watch's brain": the sponsor article at /kimi, as data, in English and Simplified
 * Chinese. Every number and quote comes from a live testnet run on October 13, 2026, copied verbatim.
 * Shared facts (numbers, links, Kimi's own words) live outside the per-locale copy so both readers see the
 * same evidence; tests/app/kimi-article.test.ts pins the numbers and checks both locales match.
 */

export type Locale = "en" | "zh";
export const LOCALES: readonly Locale[] = ["en", "zh"];
/** The BCP 47 tag each locale's text carries. */
export const LOCALE_TAG: Record<Locale, string> = { en: "en", zh: "zh-Hans" };
/** Where the reader's choice is remembered (localStorage, best effort). */
export const LANG_STORAGE_KEY = "fork-night-kimi-lang";
/** The polite live region that announces a language switch. */
export const LANG_STATUS_ID = "km-lang-status";

/**
 * The walkthrough video, the article's highlight. Leave it null until the video exists; the page then
 * shows an empty 16:9 frame that says where it goes.
 * - A file under public/ (it must also be added to config/submission-files.json to reach the hosted site):
 *   { kind: "file", src: "/kimi/walkthrough.mp4", poster: "/kimi/walkthrough.webp" }
 * - A YouTube video, embedded with YouTube's privacy-enhanced player: { kind: "youtube", id: "<video id>", href: "https://youtu.be/<video id>" }
 * - Any other hosted video (Loom, X): { kind: "link", href: "https://…", label: "Watch the walkthrough" }
 */
export type KimiVideo =
  | { kind: "file"; src: string; poster?: string }
  | { kind: "youtube"; id: string; href: string }
  | { kind: "link"; href: string; label: string }
  | null;

/** Wenjie's walkthrough of the Night Watch with Kimi K3. */
export const KIMI_VIDEO: KimiVideo = { kind: "youtube", id: "EH01ky2c0XM", href: "https://youtu.be/EH01ky2c0XM" };
/** YouTube's privacy-enhanced player: the embed's host, and the only origin the toggle's pause command goes to. */
export const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";

/** Facts both locales share. Seconds and dollars are strings so they render exactly as measured. */
export const KIMI_FACTS = {
  model: {
    name: "Kimi K3",
    maker: "Moonshot AI",
    via: "TokenRouter",
    id: "moonshotai/kimi-k3",
    endpoint: "https://api.tokenrouter.com/v1/chat/completions",
  },
  jobs: {
    desk: { seconds: "3.9", usd: "0.0039", approximate: false },
    night: { seconds: "15.7", usd: "0.0117", approximate: false },
    wren: { seconds: "3.8", usd: "0.0041", approximate: true },
  },
  /** 1-based: the take Kimi suggested showing first. */
  pick: 1,
} as const;

export const KIMI_DESK_BASELINE_SECONDS = "22.1";

export type JobKey = keyof typeof KIMI_FACTS.jobs;
export const JOB_KEYS: readonly JobKey[] = ["desk", "night", "wren"];

/** Which of the seven steps in "One night with Kimi K3" are Kimi's. */
export const FLOW_KIMI: readonly boolean[] = [true, false, true, false, true, false, false];

export const KIMI_HREFS = {
  home: "/",
  rooms: "/pilot",
  agents: "/agents",
  nightWatch: "/night-watch",
  kimi: "/kimi",
  repo: "https://github.com/Wenjix/fork-night",
} as const;

/** The closing links, in order; their words live in each locale's `close.links`. */
export const CLOSE_HREFS: readonly string[] = [KIMI_HREFS.nightWatch, KIMI_HREFS.agents, KIMI_HREFS.repo];

export const KIMI_CODE_PATHS: readonly string[] = [
  "src/night-watch/brain.ts",
  "src/night-watch/copilot.ts",
  "src/night-watch/generate.ts",
  "agents/wren/wren.mjs",
];

/** The request every Kimi K3 call makes, trimmed to the parts that matter. */
export const KIMI_REQUEST = `POST ${KIMI_FACTS.model.endpoint}
{
  "model": "${KIMI_FACTS.model.id}",
  "reasoning": { "effort": "low" },
  "response_format": {
    "type": "json_schema",
    "json_schema": { "strict": true, "schema": { … } }
  }
}`;

export type QuoteSet = {
  copilot: { forkPoint: string; read: string; suggestions: { brief: string; why: string }[] };
  night: { brief: string; read: string; takes: { caption: string; check: string }[]; morningNote: string };
  wren: { idea: string; title: string; captions: string[] };
};

/** Kimi K3's live outputs, verbatim. They are evidence, so both locales show them in English. */
export const KIMI_QUOTES: QuoteSet = {
  copilot: {
    forkPoint: "Mira decides to join the Dokkaebi and together they jump into the boat",
    read: "Mira and the Dokkaebi are aboard the glowing boat heading into the magical realm — the story needs what they first encounter there.",
    suggestions: [
      {
        brief: "The paper boat glides down toward a floating library built into a giant seashell, and a kind octopus librarian waves them in with one of its many arms.",
        why: "Introduces the octopus librarian friend, giving the new realm a welcoming face.",
      },
      {
        brief: "The boat sails low over a still, starry sea where dozens of tiny glowing treasures float like lanterns; Mira leans over the side in wonder while the Dokkaebi steers.",
        why: "A quiet wonder-beat that deepens the realm's magic before anyone new arrives.",
      },
      {
        brief: "A second midnight signal blinks from a small distant island, and the boat banks gently toward it as the Dokkaebi grins and points the way.",
        why: "Answers the lore's invitation motif and sets up a clear new destination.",
      },
    ],
  },
  night: {
    brief: "Mira and the Dokkaebi find a second lighthouse that answers the first.",
    read: "The story has just taken flight, so the next beat should give the journey a destination: a second light that answers, staged as wonder and welcome rather than peril.",
    takes: [
      {
        caption: "From the flying paper boat, Mira and the Dokkaebi spot a second lighthouse blinking back across the still sea.",
        check: "Matches the brief exactly: the answering light spotted at distance, Mira recognizable, calm and wordless.",
      },
      {
        caption: "The paper boat glides low toward the second lighthouse, whose beam sweeps down to greet them like a long golden arm.",
        check: "Lovely welcoming beam, but it stages the arrival the brief saves for later.",
      },
      {
        caption: "At the second lighthouse door, a young keeper in a red scarf holds up a lantern, waiting just as the first note promised.",
        check: "New keeper is a charming fork, but the 'first note' reference adds lore not yet established in any published scene.",
      },
    ],
    morningNote: "Quiet night. All three paths stayed gentle and wordless. I'd show the maker candidate 1 first: the second lighthouse answering from across the still sea, exactly the beat the brief asked for. 2 and 3 travel further ahead — warm arrivals to keep in the drawer for next time.",
  },
  wren: {
    idea: "I want one of the cove lights to rise and gently guide her back toward the lighthouse, hinting it has a task for her there.",
    title: "A light to guide her home",
    captions: [
      "From the shimmering swirl, one small light rose, hovering like a tiny lantern.",
      "It drifted toward the lighthouse path, and she followed, scarf catching the glow.",
    ],
  },
};

/** Simplified Chinese renderings; each English original is available in a disclosure below its translation. */
export const KIMI_QUOTES_ZH: QuoteSet = {
  copilot: {
    forkPoint: "Mira 决定加入 Dokkaebi，两人一起跳上小船",
    read: "Mira 和 Dokkaebi 已经登上发光的小船，驶向魔法世界——故事需要的是他们在那里遇见的第一样东西。",
    suggestions: [
      {
        brief: "纸船缓缓降向一座建在巨大贝壳里的漂浮图书馆，一位和善的章鱼图书管理员挥动一条触手，招呼他们进来。",
        why: "引出章鱼图书管理员这位朋友，让新世界有一张欢迎的面孔。",
      },
      {
        brief: "小船低低掠过平静的星海，几十个发着微光的小宝物像灯笼一样漂浮着；Mira 惊奇地探出船舷，Dokkaebi 在一旁掌舵。",
        why: "一个安静的惊奇时刻，在新角色登场之前加深这个世界的魔力。",
      },
      {
        brief: "远处的小岛上亮起第二道午夜信号，小船轻轻转向那里，Dokkaebi 咧嘴一笑，为大家指路。",
        why: "呼应背景故事里“邀请”的母题，并给出一个清晰的新目的地。",
      },
    ],
  },
  night: {
    brief: "Mira 和 Dokkaebi 找到了第二座灯塔，它回应着第一座。",
    read: "故事刚刚起飞，下一拍应该给旅程一个目的地：第二束回应的光，用惊奇与欢迎而不是危险来呈现。",
    takes: [
      {
        caption: "从飞行的纸船上，Mira 和 Dokkaebi 望见第二座灯塔在平静海面的那一头闪光回应。",
        check: "完全符合提要：远远望见回应的光，Mira 清晰可辨，画面宁静、没有文字。",
      },
      {
        caption: "纸船低低滑向第二座灯塔，它的光束扫下来迎接他们，像一条长长的金色手臂。",
        check: "欢迎的光束很美，但它提前演出了提要留到后面的“抵达”。",
      },
      {
        caption: "在第二座灯塔门口，一位戴红围巾的年轻守塔人举着灯笼，正如第一张字条所承诺的那样在等候。",
        check: "新守塔人是个迷人的分支，但“第一张字条”的说法引入了尚未在任何已发布场景中出现的设定。",
      },
    ],
    morningNote: "安静的一夜。三条路线都保持温和、没有文字。我会先给创作者看方案 1：第二座灯塔在平静的海面那头回应，正是提要想要的那一拍。方案 2 和 3 走得更远——是温暖的抵达场景，可以收起来留到下次。",
  },
  wren: {
    idea: "我想让海湾里的一盏光升起来，轻轻引她回到灯塔，暗示那里有一项任务在等她。",
    title: "引她回家的光",
    captions: [
      "从闪烁的漩涡里，一点小小的光升了起来，像一盏小灯笼悬在半空。",
      "它朝灯塔的小路飘去，她跟了上去，围巾映着微光。",
    ],
  },
};

type JobCopy = { name: string; when: string; waiting: string; does: string; per: string; detail: string };

/** Everything a reader sees, per locale. `{date}` is replaced with that locale's `date`. */
export type ArticleCopy = {
  date: string;
  skip: string;
  nav: { label: string; rooms: string; agents: string; nightWatch: string; kimi: string };
  toggle: { label: string; announce: string };
  hero: { eyebrow: string; title: string; dek: string; byline: string; readTime: string; videoLabel: string; videoPlaceholder: string };
  reading: {
    jumpLabel: string;
    jumps: { target: "jobs" | "wrote" | "why"; label: string }[];
    timingDetails: string;
    copilotDetails: string;
    nightDetails: string;
    wrenDetails: string;
    technicalDetails: string;
    safetyDetails: string;
    pricingDetails: string;
    defaultEffort: string;
    lowEffort: string;
    verdicts: string[];
    safeguards: string[];
  };
  jobs: { heading: string; intro: string; waitingLabel: string; secondsUnit: string; desk: JobCopy; night: JobCopy; wren: JobCopy };
  flow: { heading: string; intro: string; kimiTag: string; steps: { title: string; actor: string }[] };
  wrote: {
    heading: string;
    intro: string;
    live: string;
    translationLabel: string;
    /** Labels Kimi's English original when a translation reads first (the Chinese article). */
    originalLabel: string;
    copilot: { title: string; forkPointLabel: string; readLabel: string; whyLabel: string; callout: string };
    night: { title: string; briefLabel: string; readLabel: string; takeLabel: string; checkLabel: string; pickBadge: string; noteLabel: string; note: string };
    wren: { title: string; ideaLabel: string; titleLabel: string; captionsLabel: string; note: string };
  };
  why: {
    heading: string;
    intro: string;
    metrics: { value: string; label: string; sub: string }[];
    reasons: { title: string; body: string }[];
    requestHeading: string;
    requestNote: string;
  };
  safe: { heading: string; items: string[] };
  honest: { heading: string; items: string[] };
  close: { heading: string; links: { label: string; note: string }[]; codeHeading: string; codeRoles: string[] };
};

const en: ArticleCopy = {
  date: "October 13, 2026",
  skip: "Skip to the article",
  nav: { label: "Fork Night", rooms: "Rooms", agents: "Agents", nightWatch: "Night Watch", kimi: "Kimi K3" },
  toggle: { label: "Language", announce: "Showing the article in English." },
  hero: {
    eyebrow: "Build notes · Kimi K3 via TokenRouter",
    title: "Kimi K3 is the Night Watch’s brain",
    dek: "A creative co-pilot at your desk. A planner while you sleep. Here’s how Kimi turns a story brief into a plan you can build on.",
    byline: "Fork Night · {date}",
    readTime: "3-minute read",
    videoLabel: "Watch the walkthrough",
    videoPlaceholder: "The walkthrough video goes here",
  },
  reading: {
    jumpLabel: "In this article",
    jumps: [{ target: "jobs", label: "The three jobs" }, { target: "wrote", label: "Live examples" }, { target: "why", label: "The numbers" }],
    timingDetails: "Timing notes from the live runs",
    copilotDetails: "Story context & the other suggestions",
    nightDetails: "Read the self-checks & morning note",
    wrenDetails: "Read Wren’s starting idea",
    technicalDetails: "Run details & request format",
    safetyDetails: "How the safeguards work",
    pricingDetails: "Model & pricing notes",
    defaultEffort: "Default effort",
    lowEffort: "Low effort",
    verdicts: ["Matches the brief", "Arrives too early", "Adds unestablished lore"],
    safeguards: ["You choose what gets published.", "Spending stays within your policy.", "Failed plans fall back safely."],
  },
  jobs: {
    heading: "Three jobs, one model",
    intro: "Kimi K3 (by Moonshot AI) via TokenRouter does all of the Night Watch’s thinking, and Wren’s planning too.",
    waitingLabel: "Who’s waiting",
    secondsUnit: "s",
    desk: {
      name: "Desk co-pilot",
      when: "While you’re at your desk",
      waiting: "You, at the desk",
      does: "Three ideas grounded in your story. Pick one, edit it, and make it yours.",
      per: "per answer",
      detail: "At default effort the same request took 22.1 s and $0.0225.",
    },
    night: {
      name: "Overnight brain",
      when: "While you’re away",
      waiting: "No one: you’re asleep",
      does: "Plans three takes, checks them against your world, and leaves a morning note.",
      per: "per night",
      detail: "Of that: planning 9.4 s, self-check 3.7 s.",
    },
    wren: {
      name: "Wren’s planner",
      when: "The room’s AI agent",
      waiting: "The room",
      does: "Turns Wren’s idea into a title, two captions, and an image prompt.",
      per: "per plan",
      detail: "1,054 input and 241 output tokens, 24 of them reasoning. At default effort it took 9.1 s.",
    },
  },
  flow: {
    heading: "One night with Kimi K3",
    intro: "Kimi proposes and checks. You set the limits and choose what to publish.",
    kimiTag: "Kimi K3",
    steps: [
      { title: "Choose a brief", actor: "You + Kimi K3" },
      { title: "Set a spending cap", actor: "You + Privy" },
      { title: "Plan three takes", actor: "Kimi K3" },
      { title: "Check for safety", actor: "Safety check" },
      { title: "Check the plan", actor: "Kimi K3" },
      { title: "Draw the scenes", actor: "Image model" },
      { title: "Pick what to publish", actor: "You" },
    ],
  },
  wrote: {
    heading: "What Kimi actually wrote",
    intro: "A few highlights from the live runs. Open any example for the full context.",
    live: "From a live testnet run, {date}",
    translationLabel: "Translation",
    originalLabel: "Original",
    copilot: {
      title: "Desk co-pilot",
      forkPointLabel: "Fork point",
      readLabel: "What the story needs",
      whyLabel: "Why",
      callout: "The maker never mentioned the octopus librarian. Kimi found it in the world’s lore.",
    },
    night: {
      title: "What your Night Watch thought",
      briefLabel: "Your brief",
      readLabel: "Read the room (first sentence)",
      takeLabel: "Take",
      checkLabel: "Self-check",
      pickBadge: "Kimi’s first pick",
      noteLabel: "Morning note",
      note: "No images were drawn in this run: it shows the thinking alone.",
    },
    wren: {
      title: "Wren · the room’s AI agent",
      ideaLabel: "Idea note",
      titleLabel: "Title",
      captionsLabel: "Captions",
      note: "A dry run: Wren planned its turn and posted nothing.",
    },
  },
  why: {
    heading: "Why Kimi K3",
    intro: "Measured on {date}. Single runs, not a benchmark.",
    metrics: [
      { value: "22.1 s → 3.9 s", label: "Desk answer at low reasoning effort", sub: "Wren’s plan: 9.1 s → 3.8 s" },
      { value: "15.7 s", label: "A whole night’s thinking", sub: "Plan, safety check and self-check" },
      { value: "About a cent", label: "Per night of planning and checking", sub: "$0.0117 on the live run" },
      { value: "12 of 12", label: "Calls returned valid JSON in the shape we asked for", sub: "The 10 strict-schema calls all fit" },
    ],
    reasons: [
      {
        title: "It reads the world",
        body: "It pulled the octopus librarian from the lore, kept Mira’s yellow scarf and blue coat, and its self-check notes were specific: “stages the arrival the brief saves for later”.",
      },
      {
        title: "Reliable structured output",
        body: "All 12 Kimi K3 calls in our live runs came back as valid JSON in the shape we asked for, on the first try: 3 probes, 3 overnight plans, 2 plan checks, 2 desk co-pilot answers and 2 Wren plans.",
      },
      {
        title: "One model for every job",
        body: "Fast enough at low effort to plan, check its own plan and answer at the desk, so one model does all three jobs (it checked a plan in 3.7 s).",
      },
    ],
    requestHeading: "Every call looks like this",
    requestNote: "Low reasoning effort and a strict JSON schema, through TokenRouter’s OpenAI-compatible API.",
  },
  safe: {
    heading: "Built to fail safe",
    items: [
      "Story text written by other people reaches Kimi as quoted data, never as instructions.",
      "Every text Kimi writes passes a moderation check before anyone sees it or it reaches the image model. A flagged take uses the plain prompt, and a flagged check note is held back.",
      "Any failure (timeout, malformed answer, missing key) falls back to the plain prompts. The brain never blocks a night.",
      "Kimi never publishes and never spends. The maker chooses what to publish in the morning, and spending is limited separately by the maker’s Privy policy.",
      "The brain’s operator-paid inference counts against the operator’s inference allowance. The desk co-pilot is limited to 12 answers per maker per hour.",
    ],
  },
  honest: {
    heading: "Honest notes",
    items: [
      "Testnet only. All inference is operator-paid inference.",
      "Kimi K3 plans and checks text. Images come from a separate image model.",
      "The timings and costs above are single live runs on {date}, and they vary from run to run.",
      "Costs are measured token usage at TokenRouter’s pay-as-you-go list price for Kimi K3 on {date}: $1.80 per million input tokens, $9.00 per million output tokens and $0.18 per million cached input tokens, 40% off the $3.00 / $15.00 list.",
      "The Night Watch runner and its page run on the operator’s machine. The hosted site explains the flow but doesn’t run it.",
    ],
  },
  close: {
    heading: "See it for yourself",
    links: [
      { label: "See the Night Watch", note: "Runs on the operator’s machine; the hosted page explains it." },
      { label: "Meet Wren", note: "The room’s AI agent, now planning with Kimi K3." },
      { label: "Read the code", note: "The public repository." },
    ],
    codeHeading: "Where Kimi lives in the code",
    codeRoles: [
      "planner, self-check and desk co-pilot prompts",
      "the desk co-pilot route’s logic",
      "where the overnight runner asks the brain",
      "Wren’s planner",
    ],
  },
};

const zh: ArticleCopy = {
  date: "2026 年 10 月 13 日",
  skip: "跳到正文",
  nav: { label: "Fork Night", rooms: "故事房间", agents: "智能体", nightWatch: "Night Watch", kimi: "Kimi K3" },
  toggle: { label: "语言", announce: "已切换为中文。" },
  hero: {
    eyebrow: "开发笔记 · 经 TokenRouter 调用 Kimi K3",
    title: "Kimi K3 是 Night Watch（夜巡）的大脑",
    dek: "坐在书桌前，它陪你找灵感；入睡后，它继续规划。看看 Kimi 如何把一段故事提要，变成你能接着创作的方案。",
    byline: "Fork Night · {date}",
    readTime: "约 3 分钟读完",
    videoLabel: "观看演示视频",
    videoPlaceholder: "演示视频将放在这里",
  },
  reading: {
    jumpLabel: "本文导航",
    jumps: [{ target: "jobs", label: "三项工作" }, { target: "wrote", label: "实际输出" }, { target: "why", label: "实测数据" }],
    timingDetails: "查看实际运行的耗时记录",
    copilotDetails: "故事背景与其他建议",
    nightDetails: "查看自查意见与晨间留言",
    wrenDetails: "查看 Wren 最初的想法",
    technicalDetails: "运行详情与请求格式",
    safetyDetails: "安全措施如何运作",
    pricingDetails: "模型与计费说明",
    defaultEffort: "默认推理强度",
    lowEffort: "低推理强度",
    verdicts: ["符合提要", "抵达得太早", "引入了未确立的设定"],
    safeguards: ["发布什么，由你决定。", "花费受你的策略约束。", "规划失败，也有安全兜底。"],
  },
  jobs: {
    heading: "一个模型，三项工作",
    intro: "Night Watch 的全部思考都由 Kimi K3（Moonshot AI 出品，经 TokenRouter 调用）完成，Wren 的规划也是。",
    waitingLabel: "谁在等待",
    secondsUnit: "秒",
    desk: {
      name: "书桌副驾",
      when: "当你坐在书桌前",
      waiting: "你，就在书桌前",
      does: "结合你的故事，给出三个灵感。选一个，改一改，接着创作。",
      per: "每次回答",
      detail: "同样的请求在默认推理强度下用时 22.1 秒，花费 $0.0225。",
    },
    night: {
      name: "夜间大脑",
      when: "当你离开时",
      waiting: "没人在等：你已经睡了",
      does: "规划三个方案，对照世界设定自查，再留下一段晨间留言。",
      per: "每晚",
      detail: "其中：规划 9.4 秒，自查 3.7 秒。",
    },
    wren: {
      name: "Wren 的规划",
      when: "故事房间里的 AI 智能体",
      waiting: "整个故事房间",
      does: "把 Wren 的想法变成标题、两条图说和图像提示词。",
      per: "每次规划",
      detail: "输入 1,054 个 token，输出 241 个，其中 24 个用于推理。默认推理强度下用时 9.1 秒。",
    },
  },
  flow: {
    heading: "Kimi K3 的一个夜晚",
    intro: "Kimi 提建议、做自查。你设定额度，再决定发布什么。",
    kimiTag: "Kimi K3",
    steps: [
      { title: "选定故事提要", actor: "你 + Kimi K3" },
      { title: "设定花费上限", actor: "你 + Privy" },
      { title: "规划三个方案", actor: "Kimi K3" },
      { title: "内容安全审核", actor: "安全审核" },
      { title: "自查故事方案", actor: "Kimi K3" },
      { title: "绘制画面", actor: "图像模型" },
      { title: "决定发布什么", actor: "你" },
    ],
  },
  wrote: {
    heading: "Kimi 实际写了什么",
    intro: "精选几段实际输出。展开可看完整背景；每段译文下都保留了可展开的英文原文。",
    live: "来自 {date} 的一次测试网实际运行",
    translationLabel: "译文",
    originalLabel: "原文",
    copilot: {
      title: "书桌副驾",
      forkPointLabel: "续写起点",
      readLabel: "故事需要什么",
      whyLabel: "理由",
      callout: "创作者从没提过章鱼图书管理员。Kimi 自己从世界设定中找到了它。",
    },
    night: {
      title: "你的 Night Watch 想了些什么",
      briefLabel: "你的提要",
      readLabel: "读懂房间（第一句）",
      takeLabel: "方案",
      checkLabel: "自查",
      pickBadge: "Kimi 的首选",
      noteLabel: "晨间留言",
      note: "这次运行没有作画，只展示思考过程。",
    },
    wren: {
      title: "Wren · 故事房间里的 AI 智能体",
      ideaLabel: "想法",
      titleLabel: "标题",
      captionsLabel: "图说",
      note: "这是一次演练：Wren 规划了这一轮，但没有发布任何内容。",
    },
  },
  why: {
    heading: "为什么选 Kimi K3",
    intro: "测于 {date}。仅为单次运行记录，并非基准测试。",
    metrics: [
      { value: "22.1 秒 → 3.9 秒", label: "低推理强度下的书桌回答", sub: "Wren 的规划：9.1 秒 → 3.8 秒" },
      { value: "15.7 秒", label: "一整晚的思考", sub: "规划、安全审核和自查" },
      { value: "约一美分", label: "每晚的规划与自查", sub: "实际运行花费 $0.0117" },
      { value: "12 / 12", label: "调用都返回了符合要求格式的有效 JSON", sub: "10 次严格 schema 调用全部符合" },
    ],
    reasons: [
      {
        title: "它读得懂世界观",
        body: "它从背景故事里找到了章鱼图书管理员，保留了 Mira 的黄围巾和蓝外套，自查意见也很具体：“stages the arrival the brief saves for later”（提前演出了提要留到后面的“抵达”）。",
      },
      {
        title: "结构化输出很可靠",
        body: "我们实测中的 12 次 Kimi K3 调用，全部一次就返回了符合要求格式的有效 JSON：3 次探测、3 次夜间规划、2 次方案自查、2 次书桌回答和 2 次 Wren 规划。",
      },
      {
        title: "一个模型包揽全部",
        body: "在低推理强度下足够快，既能规划、自查方案，又能在书桌旁回答，所以一个模型就包揽了三项工作（自查一个方案用了 3.7 秒）。",
      },
    ],
    requestHeading: "每次调用都是这样",
    requestNote: "低推理强度，加上严格的 JSON schema，经 TokenRouter 的 OpenAI 兼容接口调用。",
  },
  safe: {
    heading: "安全兜底的设计",
    items: [
      "其他人写的故事文字，只会作为引用的资料交给 Kimi，绝不会被当作指令。",
      "Kimi 写下的每段文字，在给任何人看或交给图像模型之前，都要先通过内容审核。被标记的方案改用普通提示词，被标记的自查意见不予显示。",
      "任何失败（超时、回答格式不对、缺少密钥）都会退回普通提示词。大脑从不卡住一个夜晚。",
      "Kimi 从不发布，也从不花钱。清晨由创作者决定发布什么；花费另由创作者的 Privy 策略单独限制。",
      "大脑的推理费用计入运营方的推理额度。书桌副驾对每位创作者每小时最多回答 12 次。",
    ],
  },
  honest: {
    heading: "如实说明",
    items: [
      "仅限测试网。所有推理都是运营方承担的推理费用。",
      "Kimi K3 负责规划和自查文字，图像由另一个图像模型生成。",
      "以上用时和费用都来自 {date} 的单次实际运行，每次运行都会有所不同。",
      "费用按实际 token 用量，以 TokenRouter 在 {date} 给出的 Kimi K3 按量计费价格计算：每百万输入 token $1.80，每百万输出 token $9.00，每百万缓存输入 token $0.18，比 $3.00 / $15.00 的原价便宜 40%。",
      "Night Watch 的运行器和页面都在运营方自己的电脑上运行。线上网站只介绍流程，不实际运行。",
    ],
  },
  close: {
    heading: "亲自看看",
    links: [
      { label: "查看 Night Watch", note: "在运营方的电脑上运行；线上页面会说明流程。" },
      { label: "认识 Wren", note: "故事房间里的 AI 智能体，现在用 Kimi K3 规划。" },
      { label: "阅读代码", note: "公开的代码仓库。" },
    ],
    codeHeading: "Kimi 在代码中的位置",
    codeRoles: [
      "规划、自查与书桌副驾的提示词",
      "书桌副驾接口的逻辑",
      "夜间运行器调用大脑的地方",
      "Wren 的规划器",
    ],
  },
};

export const ARTICLE: Record<Locale, ArticleCopy> = { en, zh };

/** The tab title in each language. The English one is also the route's metadata title. */
export const PAGE_TITLE: Record<Locale, string> = { en: `${en.hero.title} · Fork Night`, zh: `${zh.hero.title} · Fork Night` };

/** Fills `{date}` with the locale's date. */
export const fill = (text: string, copy: ArticleCopy) => text.replaceAll("{date}", copy.date);
