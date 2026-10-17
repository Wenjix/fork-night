import type { ReactNode } from "react";
import type { BrandId } from "@/lib/brands";
import { BrandBadge } from "../brand-badge";

/** Published path of the recorded walkthrough, relative to public/. */
export const DEMO_VIDEO = "hunyuan/fork-night-hunyuan-demo.mp4";

/** Wenjie's walkthrough on YouTube (Oct 13, 2026); when set, it plays in place of the local file. */
export const DEMO_YOUTUBE: { id: string; href: string } | null = { id: "mvQY0h9BfZo", href: "https://youtu.be/mvQY0h9BfZo" };

export type Lang = "en" | "zh";
export const LANGS: readonly { id: Lang; label: string; htmlLang: string }[] = [
  { id: "en", label: "English", htmlLang: "en" },
  { id: "zh", label: "中文", htmlLang: "zh-CN" },
];

/** The language a ?lang= value asks for; anything other than "zh" reads in English. */
export const langFrom = (value: string | string[] | undefined): Lang =>
  (Array.isArray(value) ? value[0] : value) === "zh" ? "zh" : "en";

/** The tools a use of Hunyuan names in its text, drawn as badges beside it. `label` is the name as the text spells it. */
type Tool = { brand: BrandId; label?: string };

type Copy = {
  languageLabel: string;
  skip: string;
  tryRoom: string;
  /** The names of the tool and its provider are badges; the words around them stay text. */
  byline: ReactNode;
  title: readonly string[];
  pageTitle: string;
  lede: string;
  videoLabel: string;
  videoSoon: string;
  videoCaption: string;
  whyTitle: string;
  why: string;
  whereTitle: string;
  uses: { title: string; text: ReactNode; tools: Tool[] }[];
  watchClip: string;
  scenes: string[];
  original: string;
  restyled: string;
  compareLabel: (scene: string) => string;
  compareValue: (percent: number) => string;
  flowTitle: string;
  step: (n: number) => string;
  flow: { title: string; text: string }[];
  valueTitle: string;
  stats: { label: string; value: string; text: string }[];
  ctaTitle: string;
  cta: ReactNode;
  ctaButton: string;
  notesTitle: string;
  notes: string[];
};

// Button names stay in English in both languages, because that is what the room shows.
export const COPY: Record<Lang, Copy> = {
  en: {
    languageLabel: "Language",
    skip: "Skip to the article",
    tryRoom: "Try the room",
    byline: <>A sponsor spotlight on <BrandBadge brand="hunyuan" label="Tencent Hunyuan" />, <span className="hy-nowrap">used through <BrandBadge brand="gmi" /></span></>,
    title: ["One story, many branches.", "Hunyuan keeps them one film."],
    pageTitle: "How Hunyuan keeps a forked story one film · Fork Night",
    lede: "Fork Night lets people make a story together by forking it. In our Blade Runner room, Hunyuan image models give every branch scenes that belong to the same world, and let a maker redraw a whole branch in a new style without losing who is in it.",
    videoLabel: "Fork Night walkthrough: restyling a branch and turning scenes into film with Hunyuan",
    videoSoon: "Walkthrough video coming soon",
    videoCaption: "The walkthrough: restyle a branch, compare, apply, then turn four scenes into film.",
    whyTitle: "Why a forked story needs consistent images",
    why: "Every fork is a new direction written by a different person. If each branch draws its characters differently, the story falls apart. Fork Night needs images that remember who Mara and Vale are, whichever branch you are on.",
    whereTitle: "Three places Hunyuan shows up",
    uses: [
      { title: "Four scenes, one cast", text: <>Hunyuan Image 3.5 drew four scenes with the same two people: the memory shop, the capsule, the greenhouse and the seedling. On the story map they are the <strong>Scene 1–4</strong> fork.</>, tools: [{ brand: "hunyuan", label: "Hunyuan Image 3.5" }] },
      { title: "Scenes become a film", text: <>Those four Hunyuan images were the references for a 12-second Wan 3.0 motion clip, also through GMI Cloud. Select Scene 4 and choose <strong>Turn these 4 scenes into a video</strong>.</>, tools: [{ brand: "wan", label: "Wan 3.0" }, { brand: "gmi" }] },
      { title: "Restyle a whole branch", text: <>Hy-Image 3.5 preview redrew the three scenes of the archive fork in anime, with each original image as its reference. Same people, same rooms, same framing. Captions and credits stay as they were. Drag the slider to compare.</>, tools: [{ brand: "hunyuan", label: "Hy-Image 3.5 preview" }] },
    ],
    watchClip: "Watch the clip in the room",
    scenes: ["A memory for sale", "Erase the owner, not the memory", "No one owns this morning"],
    original: "Original",
    restyled: "Hunyuan restyle",
    compareLabel: scene => `Compare the original and the Hunyuan restyle of “${scene}”`,
    compareValue: percent => `${100 - percent}% of the Hunyuan restyle shown`,
    flowTitle: "The flow in the video",
    step: n => `Step ${n}`,
    flow: [
      { title: "Pick a branch", text: "Open the Blade Runner room and select a moment on any fork of the story map." },
      { title: "Restyle the path", text: "Choose a style. Hunyuan redraws each scene on that path, using the original as its reference." },
      { title: "Compare, then apply", text: "Check every scene before and after. Apply it and the whole branch changes on the map." },
      { title: "Turn scenes into film", text: "On the Scene 1–4 fork, Scene 4 opens a 12-second film made from those four Hunyuan images." },
    ],
    valueTitle: "What Hunyuan brought",
    stats: [
      { label: "Per 1024px image", value: "$0.024", text: "Cheap enough to redraw a branch, not just one picture." },
      { label: "Per restyled scene", value: "21–29 s", text: "Measured on our three anime restyles, one request each." },
      { label: "Reference images", value: "Up to 5", text: "The original scene guides the new one, so identity carries over." },
      { label: "Story changes", value: "0", text: "A restyle changes how a branch looks, never what its makers wrote." },
    ],
    ctaTitle: "See it in the room",
    cta: <>Open the Blade Runner room, select <strong>No one owns this morning</strong>, and choose <strong>Restyle this path</strong>.</>,
    ctaButton: "Open the Blade Runner room",
    notesTitle: "Notes",
    notes: [
      "The film and the restyle are prepared examples. The room replays saved results and makes no provider request.",
      "Hunyuan made the four film scenes (October 7, 2026) and the three anime restyles (October 13, 2026). The room’s original six scenes were made with a different image model.",
      "GMI’s dedicated Hunyuan image-to-image endpoint returned a provider activation error on October 13, so the restyle used Hy-Image 3.5 preview with the original images as references. Five generations, including two redraws, cost about $0.12.",
      "Blade Runner: A Memory of Rain is an unofficial fan story with original characters.",
    ],
  },
  zh: {
    languageLabel: "语言",
    skip: "跳到正文",
    tryRoom: "体验房间",
    byline: <>赞助商专题：通过 <BrandBadge brand="gmi" /> 使用<BrandBadge brand="hunyuan" label="腾讯混元" /></>,
    title: ["一个故事，无数分支。", "混元让它们始终是同一部电影。"],
    pageTitle: "混元如何让分叉的故事始终是同一部电影 · Fork Night",
    lede: "在 Fork Night，大家通过“分叉”一起创作故事。在我们的《银翼杀手》房间里，混元图像模型让每条分支的画面都属于同一个世界，也让创作者能用新的风格重绘整条分支，而画面中的人物依旧是原来的人物。",
    videoLabel: "Fork Night 演示：用混元重绘一条分支，并把场景变成影片",
    videoSoon: "演示视频即将上线",
    videoCaption: "演示流程：重绘一条分支、对比、应用，再把四个场景变成影片。",
    whyTitle: "为什么分叉的故事需要一致的画面",
    why: "每个分叉都是另一位创作者写下的新方向。如果每条分支把角色画得不一样，故事就散了。无论你在哪条分支上，Fork Night 都需要能“记住” Mara 和 Vale 的画面。",
    whereTitle: "混元出现的三个地方",
    uses: [
      { title: "四个场景，同一组角色", text: <>混元图像 3.5 画出了同样两个人的四个场景：记忆商店、记忆胶囊、温室和幼苗。在故事地图上，它们就是 <strong lang="en">Scene 1–4</strong> 分支。</>, tools: [{ brand: "hunyuan", label: "混元图像 3.5" }] },
      { title: "场景变成影片", text: <>这四张混元图像作为参考，同样通过 GMI Cloud 生成了一段 12 秒的 Wan 3.0 动态影片。选中 Scene 4，点击 <strong lang="en">Turn these 4 scenes into a video</strong> 即可观看。</>, tools: [{ brand: "wan", label: "Wan 3.0" }, { brand: "gmi" }] },
      { title: "重绘整条分支", text: <>Hy-Image 3.5 preview 以每张原图为参考，把档案馆分支的三个场景重绘成动漫风格。人物、场景和构图都不变，文字说明和署名也保持原样。拖动滑块即可对比。</>, tools: [{ brand: "hunyuan", label: "Hy-Image 3.5 preview" }] },
    ],
    watchClip: "在房间里观看影片",
    scenes: ["出售的记忆", "抹去主人，而非记忆", "这个早晨不属于任何人"],
    original: "原图",
    restyled: "混元重绘",
    compareLabel: scene => `对比“${scene}”的原图与混元重绘`,
    compareValue: percent => `显示 ${100 - percent}% 的混元重绘`,
    flowTitle: "视频中的流程",
    step: n => `第 ${n} 步`,
    flow: [
      { title: "选择一条分支", text: "打开《银翼杀手》房间，在故事地图的任一分支上选中一个片段。" },
      { title: "重绘这条路径", text: "选择一种风格。混元以原图为参考，重绘这条路径上的每个场景。" },
      { title: "对比，然后应用", text: "逐一对比每个场景的前后效果。应用后，整条分支会在地图上同步更新。" },
      { title: "把场景变成影片", text: "在 Scene 1–4 分支上，Scene 4 会打开一段由这四张混元图像生成的 12 秒影片。" },
    ],
    valueTitle: "混元带来的价值",
    stats: [
      { label: "每张 1024px 图像", value: "$0.024", text: "成本低到可以重绘整条分支，而不只是一张图。" },
      { label: "每个重绘场景", value: "21–29 秒", text: "三次动漫重绘的实测时间，每次一个请求。" },
      { label: "参考图像", value: "最多 5 张", text: "原场景引导新画面，人物身份得以延续。" },
      { label: "故事改动", value: "0", text: "重绘只改变分支的样子，从不改动创作者写下的内容。" },
    ],
    ctaTitle: "在房间里亲自体验",
    cta: <>打开《银翼杀手》房间，选中 <strong lang="en">No one owns this morning</strong>，然后点击 <strong lang="en">Restyle this path</strong>。</>,
    ctaButton: "打开《银翼杀手》房间",
    notesTitle: "说明",
    notes: [
      "影片和重绘都是预先准备的示例。房间只回放已保存的结果，不会向模型服务商发送请求。",
      "混元制作了四个影片场景（2026 年 10 月 7 日）和三张动漫重绘（2026 年 10 月 13 日）。房间最初的六个场景由另一款图像模型制作。",
      "10 月 13 日，GMI 上专用的混元图生图接口返回了服务未开通的错误，因此重绘改用 Hy-Image 3.5 preview，并以原图作为参考图像。共生成五次（含两次重画），花费约 0.12 美元。",
      "《银翼杀手：雨的记忆》是一部非官方同人故事，角色均为原创。",
    ],
  },
};
