import {
  canAccessProject,
  DEMO_UNIT,
  validateDemoState,
} from "../domain/index.ts";
import type { DemoState, Moment, Project } from "../domain/index.ts";
import { isApprovedArtUrl } from "../lib/art.ts";

/** Local fixture state. These checks model access; they are not server authentication. */
export interface Guild {
  id: string;
  name: string;
  tagline: string;
  description: string;
  emblem: string;
  color: string;
  coverUrl: string;
  invitation: string;
  /** Internal associations. Public callers must use getPublicGuildProfile/listPublicProjects. */
  projectIds: string[];
}

export interface GuildMembership {
  guildId: string;
  userId: string;
  role: "steward" | "member";
  joinedAt: number;
}

export interface GuildJoinRequest {
  id: string;
  guildId: string;
  userId: string;
  message: string;
  status: "pending" | "approved";
  requestedAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
}

export interface SocialSpace {
  id: string;
  name: string;
  description: string;
  kind: "guild" | "group";
  guildId: string | null;
  groupId: string | null;
}

export interface IdeaContext {
  projectId: string;
  momentId: string;
}

export interface IdeaReply {
  id: string;
  authorId: string;
  body: string;
  createdAt: number;
}

export interface SavedIdea {
  id: string;
  spaceId: string;
  authorId: string;
  title: string;
  body: string;
  imageUrl?: string;
  context?: IdeaContext;
  replies: IdeaReply[];
  pinned: boolean;
  createdAt: number;
}

export interface BoardActivity {
  id: string;
  spaceId: string;
  actorId: string;
  ideaId: string;
  kind: "idea-added" | "reply-added" | "idea-pinned" | "idea-unpinned";
  replyId?: string;
  createdAt: number;
}

export interface SocialState {
  version: 1;
  guilds: Guild[];
  memberships: GuildMembership[];
  joinRequests: GuildJoinRequest[];
  spaces: SocialSpace[];
  ideas: SavedIdea[];
  activity: BoardActivity[];
}

const startedAt = Date.UTC(2026, 9, 1, 10);
const storyArt = (frame: number) => `/art/midnight-story.webp#frame=${frame}`;
const worldArt = (frame: number) => `/art/social-worlds.webp#scene=${frame}`;
const peopleArt = (frame: number) => `/art/social-people.webp#frame=${frame}`;

/** Extends the original rehearsal without replacing operations, money or existing stories. */
export function extendSocialDemo(demo: DemoState): DemoState {
  validateDemoState(demo);
  const additions = [
    {
      id: "moon-bus",
      title: "The moon missed the bus",
      creatorId: "priya",
      artwork: worldArt(0),
      description:
        "One very late moon. A bus full of strangers. Where do we take it?",
      captions: [
        "The last bus stopped for a passenger shaped exactly like the moon.",
        "It had forgotten the way back to the sky.",
      ],
    },
    {
      id: "paper-forest",
      title: "Paper forest",
      creatorId: "sam",
      artwork: worldArt(5),
      description: "Every folded creature remembers the person who made it.",
      captions: [
        "Sam unfolded a paper bird and found a map drawn inside its wing.",
        "The map led to a forest that rustled like a thousand unwritten letters.",
      ],
    },
    {
      id: "cloud-garden",
      title: "The cloud garden",
      creatorId: "jules",
      artwork: peopleArt(5),
      description: "Help grow a tiny world above the rooftops.",
      captions: [
        "Jules planted a cloud in a cracked blue flowerpot.",
        "By morning, rain was falling upward from every window on the street.",
      ],
    },
    {
      id: "midnight-bakery",
      title: "The midnight bakery",
      creatorId: "priya",
      artwork: worldArt(3),
      description:
        "A bakery that opens tomorrow, yesterday, and just after midnight.",
      captions: [
        "At midnight, the bakery's old oven rang like a clock.",
        "Inside was a loaf still warm from tomorrow morning.",
      ],
    },
  ];
  const missing = additions.filter(
    (item) => !demo.projects.some((project) => project.id === item.id),
  );
  const needsWorkshop = !demo.projects.some(
    (project) => project.id === "lantern-workshop",
  );
  if (!missing.length && !needsWorkshop) return demo;
  const next = structuredClone(demo);
  for (const item of missing) {
    const seedId = `${item.id}-seed`;
    next.projects.push({
      id: item.id,
      title: item.title,
      description: item.description,
      visibility: "open",
      groupId: null,
      creatorId: item.creatorId,
      seedId,
      termsVersion: "open-finished-work-v1",
      coverUrl: item.artwork,
    });
    next.moments.push({
      id: seedId,
      projectId: item.id,
      parentId: null,
      version: 1,
      authorId: item.creatorId,
      title: item.title,
      panels: [
        { imageUrl: item.artwork, caption: item.captions[0] },
        { imageUrl: item.artwork, caption: item.captions[1] },
      ],
      storyContext: item.captions.join(" "),
      reuseFee: 30_000,
      beneficiaryId: item.creatorId,
      termsVersion: "open-finished-work-v1",
      publishedAt: startedAt,
      source: "fixture",
    });
  }
  if (needsWorkshop) {
    const groupId = "lantern-workshop-members";
    const termsVersion = "guild-workshop-finished-v1";
    if (!next.groups.some((group) => group.id === groupId)) {
      next.groups.push({
        id: groupId,
        name: "Lantern workshop",
        adminId: "sam",
        termsVersion,
        cartridgeCapacity: 20 * DEMO_UNIT,
      });
      next.memberships.push(
        {
          groupId,
          userId: "sam",
          role: "admin",
          status: "active",
          acceptedTermsVersion: termsVersion,
          canSpend: true,
          spendingLimit: 10 * DEMO_UNIT,
          spent: 0,
        },
        {
          groupId,
          userId: "priya",
          role: "contributor",
          status: "active",
          acceptedTermsVersion: termsVersion,
          canSpend: false,
          spendingLimit: 0,
          spent: 0,
        },
      );
      next.accounts.push({
        id: "pool-lantern-workshop",
        kind: "group",
        ownerId: null,
        groupId,
        available: 12 * DEMO_UNIT,
        reserved: 0,
        spent: 0,
        deposited: 12 * DEMO_UNIT,
        withdrawn: 0,
      });
    }
    next.projects.push({
      id: "lantern-workshop",
      title: "Lantern workshop",
      description: "A small shared workshop for our unfinished experiments.",
      visibility: "private",
      groupId,
      creatorId: "sam",
      seedId: "lantern-workshop-seed",
      termsVersion,
      coverUrl: peopleArt(3),
    });
    const seed: Moment = {
      id: "lantern-workshop-seed",
      projectId: "lantern-workshop",
      parentId: null,
      version: 1,
      authorId: "sam",
      title: "A story inside a matchbox",
      panels: [
        {
          imageUrl: peopleArt(3),
          caption:
            "In the guild workshop, Sam opened a matchbox full of tiny lanterns.",
        },
        {
          imageUrl: peopleArt(3),
          caption:
            "Each light was an unfinished story, waiting for someone to carry it home.",
        },
      ],
      storyContext:
        "The workshop friends find a collection of unfinished stories inside a matchbox.",
      reuseFee: 0,
      beneficiaryId: "sam",
      termsVersion,
      publishedAt: startedAt,
      source: "fixture",
    };
    next.moments.push(seed);
  }
  validateDemoState(next);
  return next;
}

export function createSocialState(): SocialState {
  const ideas: SavedIdea[] = [
    {
      id: "tidepool-tomorrow",
      spaceId: "tidepool-board",
      authorId: "priya",
      title: "What if the lantern remembers tomorrow?",
      body: "A little light that knows our next adventure before we do. Maybe it flickers whenever we change the ending.",
      context: { projectId: "tidepool", momentId: "tidepool-lantern" },
      replies: [
        {
          id: "tidepool-reply-sam",
          authorId: "sam",
          body: "Yes! Let's leave one impossible clue in the first panel.",
          createdAt: startedAt + 120_000,
        },
      ],
      pinned: true,
      createdAt: startedAt,
    },
    {
      id: "tidepool-sketch",
      spaceId: "tidepool-board",
      authorId: "sam",
      title: "A pocket-sized adventure",
      body: "Leaving this little sketch for our next visit. A cat carrying a pocket watch: what could it be late for?",
      imageUrl: peopleArt(4),
      replies: [],
      pinned: false,
      createdAt: startedAt + 240_000,
    },
    {
      id: "tidepool-clouds",
      spaceId: "tidepool-board",
      authorId: "priya",
      title: "A garden that grows clouds",
      body: "An idea for another evening: everyone plants a different kind of weather.",
      imageUrl: peopleArt(5),
      replies: [],
      pinned: false,
      createdAt: startedAt + 360_000,
    },
    {
      id: "lantern-matchbox",
      spaceId: "paper-lantern-hall",
      authorId: "sam",
      title: "Could our next story fit inside a matchbox?",
      body: "Tiny worlds, big feelings. Leave a character or a setting here and we can build it together.",
      replies: [],
      pinned: true,
      createdAt: startedAt + 60_000,
    },
    {
      id: "market-sound",
      spaceId: "night-market-hall",
      authorId: "jules",
      title: "The sound of a moon landing",
      body: "Not the famous one. A very small moon landing on a very ordinary rooftop.",
      context: { projectId: "paper-moon", momentId: "paper-seed" },
      replies: [],
      pinned: false,
      createdAt: startedAt + 180_000,
    },
  ];
  return {
    version: 1,
    guilds: [
      {
        id: "paper-lantern",
        name: "Paper Lantern",
        tagline: "Strange stories. Generous collaborators.",
        description:
          "An open door for illustrators, storytellers and anyone with a wonderfully odd idea. We make little worlds together, one contribution at a time.",
        emblem: "lantern",
        color: "#eab15e",
        coverUrl: storyArt(0),
        invitation: "Bring a half-finished idea. We'll find a place for it.",
        projectIds: [
          "midnight-signal",
          "moon-bus",
          "paper-forest",
          "lantern-workshop",
        ],
      },
      {
        id: "night-market",
        name: "Night Market",
        tagline: "Made after dark. Shared with everyone.",
        description:
          "A gathering of visual storytellers, sound collectors and playful experimenters. Stop by to make something unexpected.",
        emblem: "moon",
        color: "#ad9bdc",
        coverUrl: storyArt(3),
        invitation: "There's always room for one more idea at the table.",
        projectIds: ["paper-moon", "cloud-garden", "midnight-bakery"],
      },
    ],
    memberships: [
      {
        guildId: "paper-lantern",
        userId: "sam",
        role: "steward",
        joinedAt: startedAt,
      },
      {
        guildId: "paper-lantern",
        userId: "priya",
        role: "member",
        joinedAt: startedAt,
      },
      {
        guildId: "night-market",
        userId: "jules",
        role: "steward",
        joinedAt: startedAt,
      },
      {
        guildId: "night-market",
        userId: "priya",
        role: "member",
        joinedAt: startedAt,
      },
    ],
    joinRequests: [],
    spaces: [
      {
        id: "paper-lantern-hall",
        name: "Paper Lantern",
        description: "Ideas left by the guild, ready whenever you return.",
        kind: "guild",
        guildId: "paper-lantern",
        groupId: null,
      },
      {
        id: "night-market-hall",
        name: "Night Market",
        description: "Little sparks from our after-dark experiments.",
        kind: "guild",
        guildId: "night-market",
        groupId: null,
      },
      {
        id: "tidepool-board",
        name: "Tidepool friends",
        description:
          "Our little corner for unfinished thoughts and happy accidents.",
        kind: "group",
        guildId: null,
        groupId: "tidepool-friends",
      },
    ],
    ideas,
    activity: [
      ...ideas.map((idea): BoardActivity => ({
        id: `activity-${idea.id}`,
        spaceId: idea.spaceId,
        actorId: idea.authorId,
        ideaId: idea.id,
        kind: "idea-added",
        createdAt: idea.createdAt,
      })),
      {
        id: "activity-tidepool-reply",
        spaceId: "tidepool-board",
        actorId: "sam",
        ideaId: "tidepool-tomorrow",
        replyId: "tidepool-reply-sam",
        kind: "reply-added",
        createdAt: startedAt + 120_000,
      },
    ],
  };
}

function assertUser(demo: DemoState, userId: string): void {
  if (!demo.users.some((user) => user.id === userId))
    throw new Error("Unknown demo participant.");
}

export function isGuildMember(
  social: SocialState,
  userId: string,
  guildId: string,
): boolean {
  return social.memberships.some(
    (member) => member.userId === userId && member.guildId === guildId,
  );
}

/** Contains no restricted project titles, IDs, counts, notes or balances. */
export function getPublicGuildProfile(
  social: SocialState,
  demo: DemoState,
  guildId: string,
): Guild {
  const guild = social.guilds.find((item) => item.id === guildId);
  if (!guild) throw new Error("Guild not found.");
  return {
    ...guild,
    projectIds: listPublicProjects(social, demo, guildId).map(
      (project) => project.id,
    ),
  };
}

export function listPublicProjects(
  social: SocialState,
  demo: DemoState,
  guildId?: string,
): Project[] {
  const guild = guildId
    ? social.guilds.find((item) => item.id === guildId)
    : undefined;
  if (guildId && !guild) throw new Error("Guild not found.");
  return demo.projects.filter(
    (project) =>
      project.visibility === "open" &&
      (!guild || guild.projectIds.includes(project.id)),
  );
}

export function listGuildProjects(
  social: SocialState,
  demo: DemoState,
  userId: string,
  guildId: string,
): Project[] {
  assertUser(demo, userId);
  if (!isGuildMember(social, userId, guildId))
    throw new Error("Join this guild before entering its member hall.");
  const guild = social.guilds.find((item) => item.id === guildId);
  if (!guild) throw new Error("Guild not found.");
  return demo.projects.filter(
    (project) =>
      guild.projectIds.includes(project.id) &&
      canAccessProject(demo, userId, project.id),
  );
}

export function requestGuildJoin(
  social: SocialState,
  demo: DemoState,
  input: { userId: string; guildId: string; message?: string; now?: number },
): SocialState {
  assertUser(demo, input.userId);
  if (!social.guilds.some((guild) => guild.id === input.guildId))
    throw new Error("Guild not found.");
  if (
    isGuildMember(social, input.userId, input.guildId) ||
    social.joinRequests.some(
      (request) =>
        request.userId === input.userId &&
        request.guildId === input.guildId &&
        request.status === "pending",
    )
  )
    return social;
  const message = (
    input.message ?? "I'd love to make something with you."
  ).trim();
  if (!message || message.length > 500)
    throw new Error("Use 1–500 characters for your introduction.");
  const now = checkedTime(input.now);
  const next = structuredClone(social);
  next.joinRequests.push({
    id: uniqueId("join", now, next.joinRequests),
    guildId: input.guildId,
    userId: input.userId,
    message,
    status: "pending",
    requestedAt: now,
  });
  return next;
}

/** Social approval deliberately does not change domain membership, terms or pool authority. */
export function approveGuildJoin(
  social: SocialState,
  demo: DemoState,
  input: { actorId: string; requestId: string; now?: number },
): SocialState {
  assertUser(demo, input.actorId);
  const request = social.joinRequests.find(
    (item) => item.id === input.requestId,
  );
  if (
    !request ||
    !social.memberships.some(
      (member) =>
        member.guildId === request.guildId &&
        member.userId === input.actorId &&
        member.role === "steward",
    )
  )
    throw new Error("Only this guild's steward can approve a request.");
  if (request.status === "approved") return social;
  const now = checkedTime(input.now);
  if (now < request.requestedAt)
    throw new Error("Approval cannot precede the request.");
  const next = structuredClone(social);
  Object.assign(
    next.joinRequests.find((item) => item.id === input.requestId)!,
    { status: "approved", reviewedAt: now, reviewedBy: input.actorId },
  );
  if (!isGuildMember(next, request.userId, request.guildId))
    next.memberships.push({
      guildId: request.guildId,
      userId: request.userId,
      role: "member",
      joinedAt: now,
    });
  return next;
}

export function canAccessBoard(
  social: SocialState,
  demo: DemoState,
  userId: string,
  spaceId: string,
): boolean {
  if (!demo.users.some((user) => user.id === userId)) return false;
  const space = social.spaces.find((item) => item.id === spaceId);
  if (!space) return false;
  if (space.kind === "guild")
    return Boolean(
      space.guildId && isGuildMember(social, userId, space.guildId),
    );
  const group = demo.groups.find((item) => item.id === space.groupId);
  return Boolean(
    group &&
    demo.memberships.some(
      (member) =>
        member.groupId === group.id &&
        member.userId === userId &&
        member.status === "active" &&
        member.acceptedTermsVersion === group.termsVersion,
    ),
  );
}

function boardFor(
  social: SocialState,
  demo: DemoState,
  userId: string,
  spaceId: string,
): SocialSpace {
  if (!canAccessBoard(social, demo, userId, spaceId))
    throw new Error("This ideas board is for its accepted members only.");
  return social.spaces.find((space) => space.id === spaceId)!;
}

export function listIdeas(
  social: SocialState,
  demo: DemoState,
  userId: string,
  spaceId: string,
): SavedIdea[] {
  boardFor(social, demo, userId, spaceId);
  return social.ideas
    .filter((idea) => idea.spaceId === spaceId)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.createdAt - a.createdAt ||
        a.id.localeCompare(b.id),
    );
}

export function listBoardActivity(
  social: SocialState,
  demo: DemoState,
  userId: string,
  spaceId: string,
): BoardActivity[] {
  boardFor(social, demo, userId, spaceId);
  return social.activity
    .filter((event) => event.spaceId === spaceId)
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

function validContext(
  demo: DemoState,
  space: SocialSpace,
  context: IdeaContext,
): boolean {
  const project = demo.projects.find((item) => item.id === context.projectId);
  const moment = demo.moments.find((item) => item.id === context.momentId);
  if (!project || !moment || moment.projectId !== project.id) return false;
  // A shared link must be safe for the whole board, including future guild members.
  return (
    project.visibility === "open" ||
    (space.kind === "group" &&
      space.groupId === project.groupId &&
      demo.groups.find((group) => group.id === space.groupId)?.termsVersion ===
        project.termsVersion)
  );
}

export function addIdea(
  social: SocialState,
  demo: DemoState,
  input: {
    userId: string;
    spaceId: string;
    title: string;
    body: string;
    imageUrl?: string;
    context?: IdeaContext;
    now?: number;
  },
): SocialState {
  const space = boardFor(social, demo, input.userId, input.spaceId);
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > 120)
    throw new Error("Give your idea a title of 1–120 characters.");
  if (body.length > 2_000 || (!body && !input.imageUrl))
    throw new Error(
      "Leave some words or an image, using at most 2,000 characters.",
    );
  if (input.imageUrl && !safeImage(input.imageUrl))
    throw new Error("Choose a local PNG, JPEG, WebP or GIF image under 1 MB.");
  if (
    input.context &&
    (!canAccessProject(demo, input.userId, input.context.projectId) ||
      !validContext(demo, space, input.context))
  )
    throw new Error(
      "Link a published moment that everyone on this board can access.",
    );
  if (
    social.ideas.filter((idea) => idea.spaceId === input.spaceId).length >= 500
  )
    throw new Error("This local ideas board has reached its 500-note limit.");
  const now = checkedTime(input.now);
  const next = structuredClone(social);
  const idea: SavedIdea = {
    id: uniqueId("idea", now, next.ideas),
    spaceId: input.spaceId,
    authorId: input.userId,
    title,
    body,
    replies: [],
    pinned: false,
    createdAt: now,
  };
  if (input.imageUrl) idea.imageUrl = input.imageUrl;
  if (input.context) idea.context = { ...input.context };
  next.ideas.push(idea);
  appendActivity(next, idea, input.userId, "idea-added", now);
  return next;
}

export function replyToIdea(
  social: SocialState,
  demo: DemoState,
  input: { userId: string; ideaId: string; body: string; now?: number },
): SocialState {
  const idea = accessibleIdea(social, demo, input.userId, input.ideaId);
  const body = input.body.trim();
  if (!body || body.length > 1_000)
    throw new Error("Use 1–1,000 characters for your reply.");
  if (idea.replies.length >= 100)
    throw new Error("This local note has reached its reply limit.");
  const now = checkedTime(input.now);
  if (now < idea.createdAt) throw new Error("A reply cannot precede its idea.");
  const next = structuredClone(social);
  const replyId = uniqueId(
    "reply",
    now,
    next.ideas.flatMap((item) => item.replies),
  );
  next.ideas
    .find((item) => item.id === input.ideaId)!
    .replies.push({
      id: replyId,
      authorId: input.userId,
      body,
      createdAt: now,
    });
  appendActivity(next, idea, input.userId, "reply-added", now, replyId);
  return next;
}

/** Any accepted board member can arrange the shared pinboard. */
export function toggleIdeaPin(
  social: SocialState,
  demo: DemoState,
  input: { userId: string; ideaId: string; now?: number },
): SocialState {
  const idea = accessibleIdea(social, demo, input.userId, input.ideaId);
  const now = checkedTime(input.now);
  if (now < idea.createdAt) throw new Error("A pin cannot precede its idea.");
  const next = structuredClone(social);
  next.ideas.find((item) => item.id === input.ideaId)!.pinned = !idea.pinned;
  appendActivity(
    next,
    idea,
    input.userId,
    idea.pinned ? "idea-unpinned" : "idea-pinned",
    now,
  );
  return next;
}

function accessibleIdea(
  social: SocialState,
  demo: DemoState,
  userId: string,
  ideaId: string,
): SavedIdea {
  const idea = social.ideas.find((item) => item.id === ideaId);
  if (!idea) throw new Error("Idea not available.");
  boardFor(social, demo, userId, idea.spaceId);
  return idea;
}

function appendActivity(
  social: SocialState,
  idea: SavedIdea,
  actorId: string,
  kind: BoardActivity["kind"],
  now: number,
  replyId?: string,
): void {
  social.activity.push({
    id: uniqueId("activity", now, social.activity),
    spaceId: idea.spaceId,
    actorId,
    ideaId: idea.id,
    kind,
    createdAt: now,
    ...(replyId ? { replyId } : {}),
  });
}

function checkedTime(value?: number): number {
  const time = value ?? Date.now();
  if (!Number.isSafeInteger(time) || time < 0 || time > 8_640_000_000_000_000)
    throw new Error("Invalid activity time.");
  return time;
}

function uniqueId(
  prefix: string,
  now: number,
  entries: { id: string }[],
): string {
  let sequence = entries.length;
  while (entries.some((entry) => entry.id === `${prefix}-${now}-${sequence}`))
    sequence += 1;
  return `${prefix}-${now}-${sequence}`;
}

function safeImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (isApprovedArtUrl(value) ||
      (value.length <= 1_400_000 &&
        /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(
          value,
        )))
  );
}

type RecordValue = Record<string, unknown>;
function ensure(condition: unknown, path: string): asserts condition {
  if (!condition)
    throw new Error(
      `Saved social data is invalid at ${path}. Reset the local demo to continue.`,
    );
}
function record(
  value: unknown,
  path: string,
  required: string[],
  optional: string[] = [],
): RecordValue {
  ensure(
    value !== null && typeof value === "object" && !Array.isArray(value),
    path,
  );
  const data = value as RecordValue;
  ensure(
    Object.getPrototypeOf(data) === Object.prototype ||
      Object.getPrototypeOf(data) === null,
    path,
  );
  ensure(
    required.every((key) => Object.hasOwn(data, key)) &&
      Object.keys(data).every(
        (key) => required.includes(key) || optional.includes(key),
      ),
    path,
  );
  return data;
}
function text(
  value: unknown,
  path: string,
  max = 2_000,
  min = 1,
): asserts value is string {
  ensure(
    typeof value === "string" &&
      value.length <= max &&
      value.trim().length >= min,
    path,
  );
}
function id(value: unknown, path: string): asserts value is string {
  text(value, path, 200);
  ensure(
    /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value) &&
      !["__proto__", "prototype", "constructor"].includes(value),
    path,
  );
}
function time(value: unknown, path: string): void {
  ensure(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 8_640_000_000_000_000,
    path,
  );
}
function array(value: unknown, path: string, max = 10_000): unknown[] {
  ensure(Array.isArray(value) && value.length <= max, path);
  // Iteration deliberately visits sparse slots so malformed snapshots cannot hide a record.
  return Array.from(value);
}
function unique(values: string[], path: string): void {
  ensure(new Set(values).size === values.length, path);
}

/** Rejects corrupt restore data without changing either saved state or financial state. */
export function validateSocialState(
  value: unknown,
  demo: DemoState,
): asserts value is SocialState {
  const root = record(value, "state", [
    "version",
    "guilds",
    "memberships",
    "joinRequests",
    "spaces",
    "ideas",
    "activity",
  ]);
  ensure(root.version === 1, "version");
  for (const raw of array(root.guilds, "guilds", 100)) {
    const item = record(raw, "guild", [
      "id",
      "name",
      "tagline",
      "description",
      "emblem",
      "color",
      "coverUrl",
      "invitation",
      "projectIds",
    ]);
    id(item.id, "guild.id");
    for (const key of [
      "name",
      "tagline",
      "description",
      "emblem",
      "invitation",
    ])
      text(item[key], `guild.${key}`);
    ensure(
      typeof item.color === "string" && /^#[0-9a-fA-F]{6}$/.test(item.color),
      "guild.color",
    );
    ensure(safeImage(item.coverUrl), "guild.coverUrl");
    for (const projectId of array(item.projectIds, "guild.projectIds"))
      id(projectId, "guild.projectId");
    unique(item.projectIds as string[], "guild.projectIds");
  }
  for (const raw of array(root.memberships, "memberships")) {
    const item = record(raw, "membership", [
      "guildId",
      "userId",
      "role",
      "joinedAt",
    ]);
    id(item.guildId, "membership.guildId");
    id(item.userId, "membership.userId");
    ensure(
      item.role === "steward" || item.role === "member",
      "membership.role",
    );
    time(item.joinedAt, "membership.joinedAt");
  }
  for (const raw of array(root.joinRequests, "joinRequests")) {
    const item = record(
      raw,
      "joinRequest",
      ["id", "guildId", "userId", "message", "status", "requestedAt"],
      ["reviewedAt", "reviewedBy"],
    );
    for (const key of ["id", "guildId", "userId"])
      id(item[key], `joinRequest.${key}`);
    text(item.message, "joinRequest.message", 500);
    time(item.requestedAt, "joinRequest.requestedAt");
    ensure(
      item.status === "pending" || item.status === "approved",
      "joinRequest.status",
    );
    if (item.status === "approved") {
      id(item.reviewedBy, "joinRequest.reviewedBy");
      time(item.reviewedAt, "joinRequest.reviewedAt");
      ensure(
        (item.reviewedAt as number) >= (item.requestedAt as number),
        "joinRequest.reviewedAt",
      );
    } else
      ensure(
        !Object.hasOwn(item, "reviewedBy") &&
          !Object.hasOwn(item, "reviewedAt"),
        "joinRequest.pending",
      );
  }
  for (const raw of array(root.spaces, "spaces", 100)) {
    const item = record(raw, "space", [
      "id",
      "name",
      "description",
      "kind",
      "guildId",
      "groupId",
    ]);
    id(item.id, "space.id");
    text(item.name, "space.name");
    text(item.description, "space.description");
    ensure(item.kind === "guild" || item.kind === "group", "space.kind");
    if (item.kind === "guild") {
      id(item.guildId, "space.guildId");
      ensure(item.groupId === null, "space.groupId");
    } else {
      id(item.groupId, "space.groupId");
      ensure(item.guildId === null, "space.guildId");
    }
  }
  for (const raw of array(root.ideas, "ideas")) {
    const item = record(
      raw,
      "idea",
      [
        "id",
        "spaceId",
        "authorId",
        "title",
        "body",
        "replies",
        "pinned",
        "createdAt",
      ],
      ["imageUrl", "context"],
    );
    for (const key of ["id", "spaceId", "authorId"])
      id(item[key], `idea.${key}`);
    text(item.title, "idea.title", 120);
    text(item.body, "idea.body", 2_000, 0);
    time(item.createdAt, "idea.createdAt");
    ensure(typeof item.pinned === "boolean", "idea.pinned");
    ensure(
      (item.body as string).trim().length > 0 ||
        Object.hasOwn(item, "imageUrl"),
      "idea.content",
    );
    if (Object.hasOwn(item, "imageUrl"))
      ensure(safeImage(item.imageUrl), "idea.imageUrl");
    if (Object.hasOwn(item, "context")) {
      const context = record(item.context, "idea.context", [
        "projectId",
        "momentId",
      ]);
      id(context.projectId, "context.projectId");
      id(context.momentId, "context.momentId");
    }
    for (const rawReply of array(item.replies, "idea.replies", 100)) {
      const reply = record(rawReply, "reply", [
        "id",
        "authorId",
        "body",
        "createdAt",
      ]);
      id(reply.id, "reply.id");
      id(reply.authorId, "reply.authorId");
      text(reply.body, "reply.body", 1_000);
      time(reply.createdAt, "reply.createdAt");
      ensure(
        (reply.createdAt as number) >= (item.createdAt as number),
        "reply.createdAt",
      );
    }
  }
  for (const raw of array(root.activity, "activity", 100_000)) {
    const item = record(
      raw,
      "activity",
      ["id", "spaceId", "actorId", "ideaId", "kind", "createdAt"],
      ["replyId"],
    );
    for (const key of ["id", "spaceId", "actorId", "ideaId"])
      id(item[key], `activity.${key}`);
    time(item.createdAt, "activity.createdAt");
    ensure(
      ["idea-added", "reply-added", "idea-pinned", "idea-unpinned"].includes(
        item.kind as string,
      ),
      "activity.kind",
    );
    if (item.kind === "reply-added") id(item.replyId, "activity.replyId");
    else ensure(!Object.hasOwn(item, "replyId"), "activity.replyId");
  }

  const state = value as SocialState;
  for (const key of [
    "guilds",
    "joinRequests",
    "spaces",
    "ideas",
    "activity",
  ] as const)
    unique(
      state[key].map((item) => item.id),
      key,
    );
  unique(
    state.memberships.map((item) => `${item.guildId}/${item.userId}`),
    "memberships",
  );
  unique(
    state.joinRequests.map((item) => `${item.guildId}/${item.userId}`),
    "joinRequests",
  );
  unique(
    state.ideas.flatMap((item) => item.replies.map((reply) => reply.id)),
    "replies",
  );
  const users = new Set(demo.users.map((user) => user.id));
  const guilds = new Set(state.guilds.map((guild) => guild.id));
  for (const guild of state.guilds) {
    ensure(
      guild.projectIds.every((projectId) =>
        demo.projects.some((project) => project.id === projectId),
      ),
      "guild.projects",
    );
    ensure(
      state.memberships.some(
        (member) => member.guildId === guild.id && member.role === "steward",
      ),
      "guild.steward",
    );
  }
  for (const member of state.memberships)
    ensure(
      users.has(member.userId) && guilds.has(member.guildId),
      "membership.references",
    );
  for (const request of state.joinRequests) {
    ensure(
      users.has(request.userId) && guilds.has(request.guildId),
      "joinRequest.references",
    );
    if (request.status === "approved")
      ensure(
        users.has(request.reviewedBy!) &&
          isGuildMember(state, request.userId, request.guildId) &&
          state.memberships.some(
            (member) =>
              member.guildId === request.guildId &&
              member.userId === request.reviewedBy &&
              member.role === "steward",
          ),
        "joinRequest.approval",
      );
    else
      ensure(
        !isGuildMember(state, request.userId, request.guildId),
        "joinRequest.pendingMembership",
      );
  }
  for (const space of state.spaces) {
    ensure(
      space.kind === "guild"
        ? guilds.has(space.guildId!)
        : demo.groups.some((group) => group.id === space.groupId),
      "space.references",
    );
    ensure(
      state.ideas.filter((idea) => idea.spaceId === space.id).length <= 500,
      "space.ideaLimit",
    );
  }
  for (const idea of state.ideas) {
    const space = state.spaces.find((item) => item.id === idea.spaceId);
    ensure(space && users.has(idea.authorId), "idea.references");
    if (idea.context)
      ensure(validContext(demo, space, idea.context), "idea.context");
    for (const reply of idea.replies)
      ensure(users.has(reply.authorId), "reply.authorId");
  }
  for (const event of state.activity) {
    const idea = state.ideas.find((item) => item.id === event.ideaId);
    ensure(
      idea &&
        event.spaceId === idea.spaceId &&
        users.has(event.actorId) &&
        event.createdAt >= idea.createdAt,
      "activity.references",
    );
    if (event.kind === "idea-added")
      ensure(
        event.actorId === idea.authorId && event.createdAt === idea.createdAt,
        "activity.ideaAuthor",
      );
    if (event.kind === "reply-added")
      ensure(
        idea.replies.some(
          (reply) =>
            reply.id === event.replyId &&
            reply.authorId === event.actorId &&
            reply.createdAt === event.createdAt,
        ),
        "activity.reply",
      );
  }
}
