import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptGroupTerms,
  assertLedgerConservation,
  canAccessProject,
  createDemoState,
  deliverFork,
  getFundingAccount,
  getQuote,
  publishFork,
  removeMember,
  reserveFork,
  validateDemoState,
} from "../../src/domain/index.ts";
import {
  addIdea,
  approveGuildJoin,
  canAccessBoard,
  createSocialState,
  extendSocialDemo,
  getPublicGuildProfile,
  isGuildMember,
  listBoardActivity,
  listGuildProjects,
  listIdeas,
  listPublicProjects,
  replyToIdea,
  requestGuildJoin,
  toggleIdeaPin,
  validateSocialState,
} from "../../src/social/model.ts";
import type { SocialState } from "../../src/social/model.ts";

const now = Date.UTC(2026, 9, 2, 10);
const fixture = () => ({
  demo: extendSocialDemo(createDemoState()),
  social: createSocialState(),
});

test("adding social rooms preserves a held fork and all existing balances, then resumes publication", () => {
  const initial = createDemoState();
  const quote = getQuote(initial, {
    userId: "priya",
    projectId: "midnight-signal",
    parentId: "signal",
    prompt: "Follow a curious paper bird.",
    now,
  });
  const held = reserveFork(initial, quote, { now });
  const before = JSON.stringify(held);
  const extended = extendSocialDemo(held);
  assert.equal(
    JSON.stringify(held),
    before,
    "Extension never mutates an old snapshot.",
  );
  assert.deepEqual(extended.projects.slice(0, 3), held.projects);
  assert.deepEqual(extended.accounts.slice(0, 4), held.accounts);
  assert.deepEqual(extended.operations, held.operations);
  assert.deepEqual(extended.ledger, held.ledger);
  assert.strictEqual(
    extendSocialDemo(extended),
    extended,
    "Repeated restore must not reload a pool.",
  );
  assert.equal(
    extended.projects.filter((project) => project.visibility === "open").length,
    6,
  );
  const finished = publishFork(
    deliverFork(extended, `op-${quote.id}`),
    `op-${quote.id}`,
    "For the paper bird.",
    { now: now + 1 },
  );
  assertLedgerConservation(finished);
  assert.doesNotThrow(() =>
    validateDemoState(JSON.parse(JSON.stringify(finished))),
  );
  assert.doesNotThrow(() => validateSocialState(createSocialState(), finished));
});

test("public discovery and public guild profiles disclose no restricted project IDs or titles", () => {
  const { demo, social } = fixture();
  const hidden = demo.projects.filter(
    (project) => project.visibility === "private",
  );
  const publicProjects = listPublicProjects(social, demo);
  const publicProfile = getPublicGuildProfile(social, demo, "paper-lantern");
  assert.equal(publicProjects.length, 6);
  assert.equal(publicProfile.projectIds.length, 3);
  const visibleJSON = JSON.stringify([publicProjects, publicProfile]);
  for (const project of hidden) {
    assert.ok(!visibleJSON.includes(project.id));
    assert.ok(!visibleJSON.includes(project.title));
  }
  assert.equal(listPublicProjects(social, demo, "night-market").length, 3);
  assert.throws(() => listPublicProjects(social, demo, "missing-guild"));
  assert.throws(
    () => listGuildProjects(social, demo, "jules", "paper-lantern"),
    /Join/,
  );
  assert.ok(
    listGuildProjects(social, demo, "priya", "paper-lantern").some(
      (project) => project.id === "lantern-workshop",
    ),
  );
});

test("guild approval opens social participation but grants neither private project access nor spending", () => {
  const { demo, social } = fixture();
  const initialDomainJSON = JSON.stringify(demo);
  const initialSocialJSON = JSON.stringify(social);
  const requested = requestGuildJoin(social, demo, {
    userId: "jules",
    guildId: "paper-lantern",
    message: "I collect tiny stories.",
    now,
  });
  const requestId = requested.joinRequests[0].id;
  assert.equal(JSON.stringify(social), initialSocialJSON);
  assert.strictEqual(
    requestGuildJoin(requested, demo, {
      userId: "jules",
      guildId: "paper-lantern",
      now,
    }),
    requested,
  );
  assert.equal(
    canAccessBoard(requested, demo, "jules", "paper-lantern-hall"),
    false,
  );
  assert.throws(
    () =>
      approveGuildJoin(requested, demo, { actorId: "jules", requestId, now }),
    /steward/,
  );
  assert.throws(
    () =>
      approveGuildJoin(requested, demo, { actorId: "priya", requestId, now }),
    /steward/,
  );
  const approved = approveGuildJoin(requested, demo, {
    actorId: "sam",
    requestId,
    now: now + 1,
  });
  assert.equal(isGuildMember(approved, "jules", "paper-lantern"), true);
  assert.equal(
    canAccessBoard(approved, demo, "jules", "paper-lantern-hall"),
    true,
  );
  assert.equal(canAccessProject(demo, "jules", "lantern-workshop"), false);
  assert.equal(
    canAccessBoard(approved, demo, "jules", "tidepool-board"),
    false,
  );
  assert.ok(
    listGuildProjects(approved, demo, "jules", "paper-lantern").every(
      (project) => project.visibility === "open",
    ),
  );
  assert.equal(
    getFundingAccount(demo, "jules", "moon-bus").id,
    "personal-jules",
  );
  assert.equal(JSON.stringify(demo), initialDomainJSON);
  assert.doesNotThrow(() =>
    validateSocialState(JSON.parse(JSON.stringify(approved)), demo),
  );
  assert.strictEqual(
    approveGuildJoin(approved, demo, {
      actorId: "sam",
      requestId,
      now: now + 2,
    }),
    approved,
  );

  const viewerQuote = getQuote(demo, {
    userId: "priya",
    projectId: "lantern-workshop",
    parentId: "lantern-workshop-seed",
    prompt: "Let one of the stories escape.",
    now,
  });
  assert.throws(
    () => reserveFork(demo, viewerQuote, { now }),
    /spending permission/,
  );
});

test("friend boards require accepted current terms; invitation, guild overlap and removal do not bypass them", () => {
  const { demo, social } = fixture();
  assert.equal(canAccessBoard(social, demo, "jules", "tidepool-board"), false);
  assert.throws(
    () => listIdeas(social, demo, "jules", "tidepool-board"),
    /accepted members/,
  );
  assert.throws(
    () => listBoardActivity(social, demo, "jules", "tidepool-board"),
    /accepted members/,
  );
  assert.throws(
    () =>
      addIdea(social, demo, {
        userId: "jules",
        spaceId: "tidepool-board",
        title: "Sneak in",
        body: "Without accepting.",
        now,
      }),
    /accepted members/,
  );
  assert.throws(
    () =>
      replyToIdea(social, demo, {
        userId: "jules",
        ideaId: "tidepool-tomorrow",
        body: "Hello",
        now,
      }),
    /accepted members/,
  );
  assert.throws(
    () =>
      toggleIdeaPin(social, demo, {
        userId: "jules",
        ideaId: "tidepool-tomorrow",
        now,
      }),
    /accepted members/,
  );
  const accepted = acceptGroupTerms(demo, {
    userId: "jules",
    groupId: "tidepool-friends",
  });
  assert.equal(
    canAccessBoard(social, accepted, "jules", "tidepool-board"),
    true,
  );
  assert.equal(
    canAccessBoard(social, accepted, "unknown-user", "tidepool-board"),
    false,
  );
  const removed = removeMember(accepted, {
    actorId: "sam",
    userId: "jules",
    groupId: "tidepool-friends",
  });
  assert.equal(
    canAccessBoard(social, removed, "jules", "tidepool-board"),
    false,
  );
});

test("saved ideas, images, replies and pins survive return visits with ordered shared activity", () => {
  const { demo, social } = fixture();
  const socialBefore = JSON.stringify(social);
  const domainBefore = JSON.stringify(demo);
  let saved = addIdea(social, demo, {
    userId: "priya",
    spaceId: "tidepool-board",
    title: "The clockwork cat",
    body: "A cat carries a watch, but it only ticks when someone tells a story.",
    imageUrl: "/art/midnight-story.webp#frame=3",
    context: { projectId: "tidepool", momentId: "tidepool-lantern" },
    now,
  });
  const added = saved.ideas.at(-1)!;
  saved = replyToIdea(saved, demo, {
    userId: "sam",
    ideaId: added.id,
    body: "I'll draw its pocket watch.",
    now: now + 1,
  });
  saved = toggleIdeaPin(saved, demo, {
    userId: "sam",
    ideaId: added.id,
    now: now + 2,
  });
  const returned: unknown = JSON.parse(JSON.stringify(saved));
  validateSocialState(returned, demo);
  const idea = listIdeas(returned, demo, "sam", "tidepool-board")[0];
  assert.equal(idea.id, added.id);
  assert.equal(idea.pinned, true);
  assert.equal(idea.replies[0].body, "I'll draw its pocket watch.");
  assert.equal(idea.context?.momentId, "tidepool-lantern");
  assert.deepEqual(
    listBoardActivity(returned, demo, "priya", "tidepool-board")
      .slice(0, 3)
      .map((event) => event.kind),
    ["idea-pinned", "reply-added", "idea-added"],
  );
  assert.equal(JSON.stringify(social), socialBefore);
  assert.equal(
    JSON.stringify(demo),
    domainBefore,
    "Posting a note never reserves money or creates a draft.",
  );
});

test("story links cannot disclose another private group's work or an unpublished draft", () => {
  const { demo, social } = fixture();
  const add = (
    spaceId: string,
    context: { projectId: string; momentId: string },
  ) =>
    addIdea(social, demo, {
      userId: "priya",
      spaceId,
      title: "An idea",
      body: "Building from this moment.",
      context,
      now,
    });
  // Priya can read both private projects, but the two board audiences differ.
  assert.ok(canAccessProject(demo, "priya", "lantern-workshop"));
  assert.throws(
    () =>
      add("tidepool-board", {
        projectId: "lantern-workshop",
        momentId: "lantern-workshop-seed",
      }),
    /everyone on this board/,
  );
  assert.throws(
    () =>
      add("paper-lantern-hall", {
        projectId: "tidepool",
        momentId: "tidepool-lantern",
      }),
    /everyone on this board/,
  );
  assert.throws(
    () =>
      add("paper-lantern-hall", {
        projectId: "lantern-workshop",
        momentId: "lantern-workshop-seed",
      }),
    /everyone on this board/,
  );
  assert.throws(
    () =>
      add("tidepool-board", {
        projectId: "midnight-signal",
        momentId: "tidepool-seed",
      }),
    /everyone on this board/,
  );
  assert.throws(
    () =>
      add("tidepool-board", {
        projectId: "tidepool",
        momentId: "private-draft-id",
      }),
    /everyone on this board/,
  );
  assert.doesNotThrow(() =>
    add("paper-lantern-hall", {
      projectId: "midnight-signal",
      momentId: "seed",
    }),
  );
  assert.doesNotThrow(() =>
    add("tidepool-board", {
      projectId: "tidepool",
      momentId: "tidepool-lantern",
    }),
  );
});

test("image notes allow bounded local images while refusing remote trackers, executable markup and oversized inputs", () => {
  const { demo, social } = fixture();
  const add = (imageUrl: string) =>
    addIdea(social, demo, {
      userId: "sam",
      spaceId: "tidepool-board",
      title: "Sketch",
      body: "",
      imageUrl,
      now,
    });
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";
  assert.doesNotThrow(() => validateSocialState(add(pixel), demo));
  for (const imageUrl of [
    "https://tracker.example/private-board.png",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    `data:image/png;base64,${"A".repeat(1_400_001)}`,
  ])
    assert.throws(() => add(imageUrl), /local/);
});

test("a removed contributor's past notes remain readable by current members without restoring their access", () => {
  const { demo, social } = fixture();
  const removed = removeMember(demo, {
    actorId: "sam",
    userId: "priya",
    groupId: "tidepool-friends",
  });
  const snapshot: unknown = JSON.parse(JSON.stringify(social));
  assert.doesNotThrow(() => validateSocialState(snapshot, removed));
  assert.ok(
    listIdeas(social, removed, "sam", "tidepool-board").some(
      (idea) => idea.authorId === "priya",
    ),
  );
  assert.throws(
    () => listIdeas(social, removed, "priya", "tidepool-board"),
    /accepted members/,
  );
});

test("restore rejects malformed records, duplicate identities, hidden links and inconsistent activity", () => {
  const { demo, social } = fixture();
  const mutations: ((state: SocialState) => void)[] = [
    (state) => {
      state.version = 2 as 1;
    },
    (state) => {
      state.ideas[0].title = 123 as unknown as string;
    },
    (state) => {
      delete state.ideas[0];
    },
    (state) => {
      state.ideas.push({ ...state.ideas[0] });
    },
    (state) => {
      state.guilds[0].projectIds.push("missing-project");
    },
    (state) => {
      state.memberships.push({ ...state.memberships[0] });
    },
    (state) => {
      state.spaces[0].guildId = "missing-guild";
    },
    (state) => {
      state.ideas[0].authorId = "missing-person";
    },
    (state) => {
      state.ideas[0].context = {
        projectId: "lantern-workshop",
        momentId: "lantern-workshop-seed",
      };
    },
    (state) => {
      state.ideas[0].imageUrl = "https://tracker.example/image.png";
    },
    (state) => {
      state.ideas[0].replies[0].createdAt = 0;
    },
    (state) => {
      state.ideas[0].createdAt = Number.NaN;
    },
    (state) => {
      state.activity[0].spaceId = "night-market-hall";
    },
    (state) => {
      state.activity[0].actorId = "jules";
    },
    (state) => {
      state.activity.at(-1)!.replyId = "missing-reply";
    },
    (state) => {
      (state.ideas[0] as unknown as Record<string, unknown>).draft =
        "should never be persisted here";
    },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(social);
    mutate(invalid);
    assert.throws(
      () => validateSocialState(invalid, demo),
      /Saved social data/,
    );
  }
  for (const invalid of [null, [], {}, { ...social, ideas: null }])
    assert.throws(() => validateSocialState(invalid, demo));
});
