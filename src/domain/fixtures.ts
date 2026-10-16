import { DEMO_UNIT } from "./money.ts";
import type { DemoState, Moment, Panel } from "./types.ts";

const startedAt = Date.UTC(2026, 8, 29, 18);
const frames: Record<string, number> = {
  seed: 0,
  signal: 1,
  sea: 2,
  stars: 3,
  harbor: 4,
  reply: 5,
};
const panel = (art: string, caption: string): Panel => ({
  imageUrl: `/art/midnight-story.webp#frame=${frames[art]}`,
  caption,
});

function moment(
  id: string,
  parentId: string | null,
  authorId: string,
  title: string,
  panels: [Panel, Panel],
  fee: number,
  order: number,
): Moment {
  return {
    id,
    projectId: "midnight-signal",
    parentId,
    version: 1,
    authorId,
    title,
    panels,
    storyContext: panels.map((entry) => entry.caption).join(" "),
    reuseFee: fee,
    beneficiaryId: authorId,
    termsVersion: "open-finished-work-v1",
    publishedAt: startedAt + order * 60_000,
    source: "fixture",
  };
}

/** New independent, JSON-serializable state on every invocation. */
export function createDemoState(): DemoState {
  const moments: Moment[] = [
    moment(
      "seed",
      null,
      "sam",
      "The midnight signal",
      [
        panel(
          "seed",
          "At midnight, the lighthouse blinked for the first time in years.",
        ),
        panel(
          "signal",
          "Mira found a note beneath the lamp: someone out there was waiting.",
        ),
      ],
      DEMO_UNIT,
      0,
    ),
    moment(
      "signal",
      "seed",
      "priya",
      "A light answers",
      [
        panel(
          "signal",
          "Mira turned the lamp toward the sea. Three short flashes. One long.",
        ),
        panel("sea", "Beneath the black water, a small blue light answered."),
      ],
      DEMO_UNIT,
      1,
    ),
    moment(
      "sea",
      "signal",
      "jules",
      "Under the glass sea",
      [
        panel(
          "sea",
          "The tide pulled back, revealing a staircase made of glass.",
        ),
        panel("harbor", "At its foot stood a harbor no map had ever named."),
      ],
      DEMO_UNIT,
      2,
    ),
    moment(
      "stars",
      "signal",
      "sam",
      "The sky remembers",
      [
        panel(
          "stars",
          "Mira raised the lamp. The stars rearranged into familiar handwriting.",
        ),
        panel(
          "reply",
          "It was a letter from the keeper who had disappeared last winter.",
        ),
      ],
      DEMO_UNIT,
      3,
    ),
    moment(
      "harbor",
      "seed",
      "priya",
      "Follow the paper boats",
      [
        panel(
          "harbor",
          "Instead of lighting the lamp, Mira folded the note into a paper boat.",
        ),
        panel("sea", "A hundred tiny boats rose from the harbor to follow it."),
      ],
      DEMO_UNIT,
      4,
    ),
    moment(
      "reply",
      "sea",
      "jules",
      "An answer comes home",
      [
        panel(
          "reply",
          "In the hidden harbor, Mira met a child carrying the missing keeper's lantern.",
        ),
        panel(
          "seed",
          "Together they climbed toward the lighthouse, bringing the morning with them.",
        ),
      ],
      DEMO_UNIT,
      5,
    ),
  ];

  moments.push({
    ...moment(
      "paper-seed",
      null,
      "jules",
      "A moon made of paper",
      [
        panel(
          "stars",
          "Jules found a paper moon caught in the branches above the street.",
        ),
        panel(
          "harbor",
          "Every window below it showed a different possible tomorrow.",
        ),
      ],
      DEMO_UNIT,
      0,
    ),
    projectId: "paper-moon",
  });
  moments.push(
    {
      ...moment(
        "tidepool-seed",
        null,
        "sam",
        "Our secret lighthouse",
        [
          panel(
            "seed",
            "Three friends met by the lighthouse with one unfinished story.",
          ),
          panel(
            "signal",
            "They agreed that every ending would leave room for another beginning.",
          ),
        ],
        0,
        0,
      ),
      projectId: "tidepool",
      termsVersion: "friend-finished-work-v1",
    },
    {
      ...moment(
        "tidepool-lantern",
        "tidepool-seed",
        "priya",
        "Pass the lantern",
        [
          panel(
            "harbor",
            "Priya passed Sam a lantern filled with all the colors they had forgotten.",
          ),
          panel(
            "stars",
            "By its light, the path divided. The friends would meet again at sunrise.",
          ),
        ],
        0,
        1,
      ),
      projectId: "tidepool",
      termsVersion: "friend-finished-work-v1",
    },
  );

  return {
    version: 1,
    users: [
      { id: "sam", name: "Sam", initials: "S", color: "#e5ac66" },
      { id: "priya", name: "Priya", initials: "P", color: "#bfaae8" },
      { id: "jules", name: "Jules", initials: "J", color: "#79c5b9" },
    ],
    projects: [
      {
        id: "midnight-signal",
        title: "The midnight signal",
        description:
          "A lighthouse. A missing keeper. A story we make together.",
        visibility: "open",
        groupId: null,
        creatorId: "sam",
        seedId: "seed",
        termsVersion: "open-finished-work-v1",
        coverUrl: "/art/midnight-story.webp#frame=0",
      },
      {
        id: "paper-moon",
        title: "Paper moon",
        description: "Another world, your own credits.",
        visibility: "open",
        groupId: null,
        creatorId: "jules",
        seedId: "paper-seed",
        termsVersion: "open-finished-work-v1",
        coverUrl: "/art/midnight-story.webp#frame=3",
      },
      {
        id: "tidepool",
        title: "After hours",
        description: "An invite-only story for the Tidepool friends.",
        visibility: "private",
        groupId: "tidepool-friends",
        creatorId: "sam",
        seedId: "tidepool-seed",
        termsVersion: "friend-finished-work-v1",
        coverUrl: "/art/midnight-story.webp#frame=4",
      },
    ],
    groups: [
      {
        id: "tidepool-friends",
        name: "Tidepool friends",
        adminId: "sam",
        termsVersion: "friend-finished-work-v1",
        cartridgeCapacity: 20 * DEMO_UNIT,
      },
    ],
    memberships: [
      {
        groupId: "tidepool-friends",
        userId: "sam",
        role: "admin",
        status: "active",
        acceptedTermsVersion: "friend-finished-work-v1",
        canSpend: true,
        spendingLimit: 10 * DEMO_UNIT,
        spent: 0,
      },
      {
        groupId: "tidepool-friends",
        userId: "priya",
        role: "contributor",
        status: "active",
        acceptedTermsVersion: "friend-finished-work-v1",
        canSpend: true,
        spendingLimit: 2 * DEMO_UNIT,
        spent: 0,
      },
      {
        groupId: "tidepool-friends",
        userId: "jules",
        role: "contributor",
        status: "invited",
        acceptedTermsVersion: null,
        canSpend: true,
        spendingLimit: 2 * DEMO_UNIT,
        spent: 0,
      },
    ],
    moments,
    accounts: [
      {
        id: "personal-sam",
        kind: "personal",
        ownerId: "sam",
        groupId: null,
        available: 12_500_000,
        reserved: 0,
        spent: 0,
        deposited: 12_500_000,
        withdrawn: 0,
      },
      {
        id: "personal-priya",
        kind: "personal",
        ownerId: "priya",
        groupId: null,
        available: 8 * DEMO_UNIT,
        reserved: 0,
        spent: 0,
        deposited: 8 * DEMO_UNIT,
        withdrawn: 0,
      },
      {
        id: "personal-jules",
        kind: "personal",
        ownerId: "jules",
        groupId: null,
        available: 5 * DEMO_UNIT,
        reserved: 0,
        spent: 0,
        deposited: 5 * DEMO_UNIT,
        withdrawn: 0,
      },
      {
        id: "pool-tidepool",
        kind: "group",
        ownerId: null,
        groupId: "tidepool-friends",
        available: 12 * DEMO_UNIT,
        reserved: 0,
        spent: 8 * DEMO_UNIT,
        deposited: 20 * DEMO_UNIT,
        withdrawn: 0,
      },
    ],
    operations: [],
    ledger: [
      {
        id: "opening-pool",
        kind: "opening",
        accountId: "pool-tidepool",
        userId: "sam",
        amount: 8 * DEMO_UNIT,
        description:
          "Illustrative past group generation; no real provider expense.",
      },
    ],
    claims: { sam: 0, priya: 0, jules: 0 },
    generationSpent: 8 * DEMO_UNIT,
  };
}
