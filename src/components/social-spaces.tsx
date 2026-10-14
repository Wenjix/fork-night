"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  Download,
  Feather,
  Globe2,
  ImagePlus,
  Lamp,
  LayoutGrid,
  List,
  LockKeyhole,
  MessageCircle,
  Moon,
  Pin,
  Plus,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import {
  acceptGroupTerms,
  canAccessProject,
  formatCredits,
  type DemoState,
  type Project,
} from "@/domain";
import {
  addIdea,
  approveGuildJoin,
  canAccessBoard,
  createSocialState,
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
  type Guild,
  type SavedIdea,
  type SocialState,
  type SocialSpace,
} from "@/social/model";
import {
  formatSocialRoute,
  type OpenProjectOptions,
  type SocialRoute,
  type WorkspaceDraft,
} from "@/social/navigation";
import { StoryArt } from "./story-art";
import { AppHeader } from "./app-header";
import { fandomStory, showcaseProjects, storyStyleLabel } from "@/lib/fandom-stories";
import { fandomImageInStyle, type ArtDirections } from "@/lib/fandom-art-direction";
import { FandomArtDirection } from "./fandom-art-direction";
import { RoomPeek } from "./room-peek";
import { PersonalDesk } from "./personal-desk";
import { GuildFundingHallEntry } from "./guild-funding";
import { ContextPlate, SectionPlate } from "./visual-plates";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { projectActivity } from "@/social/activity";
import {
  commitSocialChange,
  SOCIAL_STORAGE_KEY as SOCIAL_KEY,
} from "@/social/storage";
import "@/app/social.css";
import "@/app/desk.css";

export interface SocialSpacesProps {
  demo: DemoState;
  artDirections: ArtDirections;
  onArtDirectionChange: (projectId: string, styleId: "anime" | "film") => void;
  userId: string;
  loaded: boolean;
  route: SocialRoute;
  navigate: (route: SocialRoute) => void;
  onUserChange: (userId: string) => void;
  onOpenProject: (projectId: string, options?: OpenProjectOptions) => void;
  onUpdateDemo: (
    action: (current: DemoState) => DemoState,
    message?: string,
  ) => DemoState | null;
  drafts: WorkspaceDraft[];
  onDeskLeaveGuardChange: (guard: (() => boolean) | null) => void;
}
type ViewProps = SocialSpacesProps & {
  social: SocialState;
  mutate: (
    action: (current: SocialState) => SocialState,
    message: string,
  ) => boolean;
};
export function SocialSpaces(props: SocialSpacesProps) {
  const { demo, loaded, route, navigate, userId, onUserChange } = props;
  const [social, setSocial] = useState(createSocialState);
  const [restored, setRestored] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [help, setHelp] = useState(false);
  const original = useRef<string | null>(null);
  const heading = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!loaded || restored) return;
    try {
      const raw = localStorage.getItem(SOCIAL_KEY);
      original.current = raw;
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        validateSocialState(saved, demo);
        setSocial(saved);
      }
    } catch {
      setStorageError(
        "Your saved spaces could not be read. Download the original before resetting; it has not been overwritten.",
      );
    }
    setRestored(true);
  }, [demo, loaded, restored]);
  useEffect(() => {
    setActionError("");
    setNotice("");
    if (restored) heading.current?.focus({ preventScroll: true });
  }, [
    route.kind,
    "guildId" in route ? route.guildId : "",
    "boardId" in route ? route.boardId : "",
    userId,
    restored,
  ]);
  function mutate(
    action: (current: SocialState) => SocialState,
    message: string,
  ) {
    if (!restored || storageError) {
      setActionError("Resolve the save warning before changing these spaces.");
      return false;
    }
    try {
      const next = commitSocialChange(localStorage, social, demo, action);
      setSocial(next);
      setActionError("");
      setNotice(message);
      return true;
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "That change could not be saved. Please try again.",
      );
      return false;
    }
  }
  const view: ViewProps = { ...props, social, mutate };
  const paper = route.kind === "ideas" || route.kind === "desk";
  const user = demo.users.find((item) => item.id === userId)!;
  return (
    <div className={`social-app ${paper ? "social-paper" : "social-night"}`}>
      <a
        className="skip-link"
        href="#social-main"
        onClick={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
      >
        Skip to content
      </a>
      <AppHeader current={route.kind === "desk" ? "desk" : ["spaces", "hall", "ideas"].includes(route.kind) ? "spaces" : "lobby"} onLocalNavigate={navigate}>
        <label className="social-user">
          <Maker id={userId} name={user.name} />
          <span className="sr-only">Preview as collaborator</span>
          <select
            aria-label="Preview as collaborator"
            value={userId}
            onChange={(event) => onUserChange(event.target.value)}
          >
            {demo.users.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <ChevronDown size={15} />
        </label>
      </AppHeader>
      <div className="social-demo-strip" role="region" aria-label="Local preview information">
        <span>
          Local preview · fictional people and credits · saved in this browser
        </span>
        <button
          onClick={() => setHelp(!help)}
          aria-expanded={help}
          aria-label="About this preview"
        >
          <CircleHelp size={14} />
          <span>About this preview</span>
        </button>
      </div>
      {help && (
        <section className="social-help">
          <h2>A little world to try together.</h2>
          <p>
            Switch between Sam, Priya and Jules to rehearse joining a guild,
            leaving an idea and building on a story. This browser holds all the
            sample data; it is not a secure private space or a live multi-user
            service yet. Use fictional content.
          </p>
          <button
            className="social-link"
            onClick={() =>
              downloadSocial(JSON.stringify(social), "fork-night-spaces.json")
            }
          >
            <Download size={15} />
            Back up spaces and ideas
          </button>
        </section>
      )}
      {storageError && (
        <div className="social-save-warning" role="alert">
          <p>{storageError}</p>
          <button
            onClick={() =>
              downloadSocial(
                original.current ?? JSON.stringify(social),
                "fork-night-original-spaces.json",
              )
            }
          >
            Download original
          </button>
          <button
            onClick={() =>
              downloadSocial(
                JSON.stringify(social),
                "fork-night-current-spaces.json",
              )
            }
          >
            Download current ideas
          </button>
          <button
            onClick={() => {
              if (
                window.confirm(
                  "Reset only the social sample data? Your story drafts and balances will remain. Download your ideas first.",
                )
              ) {
                try {
                  localStorage.setItem(
                    SOCIAL_KEY,
                    JSON.stringify(createSocialState()),
                  );
                  setSocial(createSocialState());
                  setStorageError("");
                } catch {
                  setStorageError(
                    "Storage is still unavailable. Download your work and try in a browser with storage enabled.",
                  );
                }
              }
            }}
          >
            Reset social sample
          </button>
        </div>
      )}
      <main
        className="social-main"
        id="social-main"
        tabIndex={-1}
        ref={heading}
      >
        {actionError && (
          <div className="social-error" role="alert">
            {actionError}
            <button
              aria-label="Dismiss error"
              onClick={() => setActionError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {!restored ? (
          <div className="social-loading" role="status">
            <Lamp size={32} />
            <h1>Opening the doors…</h1>
            <p>Finding your stories and spaces.</p>
          </div>
        ) : (
          <>
            {route.kind === "lobby" && <Lobby {...view} />}
            {route.kind === "spaces" && <Spaces {...view} />}
            {route.kind === "guild" && (
              <GuildProfile {...view} guildId={route.guildId} />
            )}
            {route.kind === "hall" && (
              <GuildHall {...view} guildId={route.guildId} />
            )}
            {route.kind === "ideas" && (
              <IdeasBoard
                key={`${route.boardId}:${userId}`}
                {...view}
                boardId={route.boardId}
              />
            )}
            {route.kind === "desk" && <PersonalDesk key={userId} {...view} />}
          </>
        )}
      </main>
      <footer className="social-footer">
        <span>
          <Moon size={16} />
          Stories keep going between gatherings.
        </span>
        <span>Made by people. Built on each other.</span>
      </footer>
      {notice && (
        <div className="social-toast" role="status">
          <Check size={17} />
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function downloadSocial(text: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function RouteLink({
  route,
  navigate,
  children,
  className = "",
  current = false,
  onClick,
  ...anchorProps
}: {
  route: SocialRoute;
  navigate: ViewProps["navigate"];
  current?: boolean;
} & Omit<ComponentProps<"a">, "href" | "aria-current">) {
  return (
    <a
      {...anchorProps}
      className={className}
      href={formatSocialRoute(route)}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        navigate(route);
      }}
    >
      {children}
    </a>
  );
}
export function Scene({
  frame,
  sheet = "worlds",
  label,
  className = "",
}: {
  frame: number;
  sheet?: "worlds" | "people";
  label: string;
  className?: string;
}) {
  return (
    <span role="img" aria-label={label} className={`social-scene ${className}`}>
      <i
        className="social-scene-paint"
        aria-hidden="true"
        style={{
          backgroundImage: `url(/art/social-${sheet}.webp)`,
          backgroundPosition: `${(frame % 3) * 50}% ${Math.floor(frame / 3) * 100}%`,
        }}
      />
    </span>
  );
}
function Cover({
  project,
  className = "",
}: {
  project: Project;
  className?: string;
}) {
  return (
    <StoryArt
      src={project.coverUrl}
      description={`${project.title}, story illustration`}
      className={className}
    />
  );
}
function Maker({
  id,
  name,
  large = false,
}: {
  id: string;
  name: string;
  large?: boolean;
}) {
  const frame = id === "priya" ? 1 : id === "jules" ? 2 : 0;
  return (
    <Scene
      sheet="people"
      frame={frame}
      label={name}
      className={`social-avatar ${large ? "large" : ""}`}
    />
  );
}
function GuildMark({
  guild,
  large = false,
}: {
  guild: Guild;
  large?: boolean;
}) {
  return (
    <span
      className={`guild-mark ${large ? "large" : ""}`}
      style={{ "--guild-color": guild.color } as CSSProperties}
      aria-hidden="true"
    >
      {guild.id === "night-market" ? <Moon /> : <Lamp />}
    </span>
  );
}
function hostFor(social: SocialState, projectId: string) {
  return social.guilds.find((guild) => guild.projectIds.includes(projectId));
}
function makersFor(demo: DemoState, projectId: string) {
  const authors = new Set(
    demo.moments
      .filter((moment) => moment.projectId === projectId)
      .map((moment) => moment.authorId),
  );
  return demo.users.filter((user) => authors.has(user.id));
}
function RoomProgress({
  demo,
  projectId,
  details = false,
}: {
  demo: DemoState;
  projectId: string;
  details?: boolean;
}) {
  const activity = projectActivity(demo, projectId);
  return (
    <div className={`room-progress ${details ? "room-progress-detail" : ""}`}>
      <span>
        <Users size={15} aria-hidden="true" />
        <strong>{activity.contributors}</strong>{" "}
        {activity.contributors === 1 ? "contributor" : "contributors"}
      </span>
      <span
        role="img"
        aria-label={`${activity.moments} published ${activity.moments === 1 ? "moment" : "moments"}`}
      >
        <svg
          className="upward-branch-icon"
          width="18"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 18v-6M12 12 5 7M12 12 19 7" />
          <circle cx="12" cy="20" r="2" />
          <circle cx="4" cy="5" r="2" />
          <circle cx="20" cy="5" r="2" />
        </svg>
        <strong>{activity.moments}</strong>{" "}
        {activity.moments === 1 ? "moment" : "moments"}
      </span>
      {details && (
        <p>
          {activity.longestPath <= 1
            ? "The opening is published. Add the next moment."
            : `Longest branch: ${activity.longestPath} moments, including the opening.`}{" "}
          Counts reflect published work.
        </p>
      )}
    </div>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="social-empty">
      <Lamp size={35} />
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function Lobby(props: ViewProps) {
  const { social, demo, userId, navigate, onOpenProject, artDirections, onArtDirectionChange } = props;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("malfoy-hogwarts");
  const open = showcaseProjects(listPublicProjects(social, demo));
  const rooms = open.filter((project) => {
    const host = hostFor(social, project.id);
    const story = fandomStory(project.id);
    const text =
      `${project.title} ${project.description} ${host?.name ?? ""} ${story?.fandom ?? ""} ${storyStyleLabel(project.id) ?? ""}`.toLowerCase();
    return (
      text.includes(query.trim().toLowerCase()) &&
      (filter !== "mine" ||
        (!!host && isGuildMember(social, userId, host.id))) &&
      (filter !== "made" ||
        demo.moments.some(
          (moment) =>
            moment.projectId === project.id && moment.authorId === userId,
        ))
    );
  });
  const selected =
    rooms.find((project) => project.id === selectedId) ?? rooms[0];
  const host = selected ? hostFor(social, selected.id) : null;
  const selectedStory = selected ? fandomStory(selected.id) : undefined;
  function showRoomDetails(projectId: string) {
    setSelectedId(projectId);
    requestAnimationFrame(() => {
      const preview = document.getElementById("room-preview");
      preview?.focus({ preventScroll: true });
      if (window.matchMedia("(max-width: 760px)").matches)
        preview?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
          block: "start",
        });
    });
  }
  const entryActions = selected ? (
    <div className={`room-entry-actions${selectedStory ? " fandom-room-entry-actions" : ""}`}>
      <Button
        className="social-button yellow"
        onClick={() => onOpenProject(selected.id)}
      >
        Step inside <ArrowRight size={19} />
      </Button>
      {selectedStory && (
        <Button
          variant="outline"
          className="social-button outline"
          onClick={() => onOpenProject(selected.id, {
            momentId: `${selectedStory.id}-${selectedStory.leadEnding}`,
            task: "read",
          })}
        >
          Read a complete path <BookOpen size={18} />
        </Button>
      )}
    </div>
  ) : null;
  return (
    <div className="lobby-layout">
      <section className="room-browser" aria-label="Open creative rooms">
        <div className="lobby-heading">
          <h1>Who’s making what tonight?</h1>
          <span className="small-drawing" aria-hidden="true">
            <Feather />
          </span>
        </div>
        <p className="lobby-example-note">
          Explore three unofficial fan stories and one original. Prepared examples with fictional collaborators.
        </p>
        <div className="lobby-tools">
          <label className="social-search">
            <Search size={18} />
            <span className="sr-only">Find a room or guild</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a room or guild"
            />
          </label>
          <div className="social-segments" role="group" aria-label="Filter rooms">
            {[
              ["all", "All rooms"],
              ["mine", "My guilds"],
              ["made", "Built on by me"],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {rooms.length ? (
          <div className="room-grid">
            {rooms.map((project) => {
              const guild = hostFor(social, project.id);
              const makers = makersFor(demo, project.id);
              const story = fandomStory(project.id);
              const style = storyStyleLabel(project.id);
              return (
                <article
                  key={project.id}
                  className={`room-card ${story ? "fandom-room " : ""}${selected?.id === project.id ? "selected" : ""}`}
                >
                  <button
                    className="room-art-button"
                    aria-label={`Show room details for ${project.title}, ${story ? "Fan story" : "Open story"}`}
                    aria-controls="room-preview"
                    onClick={() => showRoomDetails(project.id)}
                    aria-pressed={selected?.id === project.id}
                  >
                    <Cover project={{ ...project, coverUrl: fandomImageInStyle(project.id, project.coverUrl, artDirections[project.id]) }} />
                    <Badge className="room-ribbon">
                      <Globe2 size={12} />
                      {story ? "Fan story" : "Open story"}
                    </Badge>
                  </button>
                  <div className="room-card-body">
                    <h2>{project.title}</h2>
                    <p className="room-host">
                      {story ? story.fandom : guild ? (
                        <>
                          Hosted by{" "}
                          <RouteLink
                            route={{ kind: "guild", guildId: guild.id }}
                            navigate={navigate}
                          >
                            {guild.name}
                          </RouteLink>
                        </>
                      ) : (
                        "A story made together"
                      )}
                    </p>
                    {style && <p className="room-style">{style}</p>}
                    <div className="room-presence">
                      <div className="social-avatar-stack">
                        {makers.slice(0, 3).map((user) => (
                          <Maker key={user.id} id={user.id} name={user.name} />
                        ))}
                      </div>
                      <RoomProgress demo={demo} projectId={project.id} />
                    </div>
                    <RoomPeek
                      project={project}
                      demo={demo}
                      onEnter={() => onOpenProject(project.id)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty title="A room is waiting somewhere.">
            <p>Try a different name or view all rooms.</p>
            <button
              className="social-button purple"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Show all rooms
            </button>
          </Empty>
        )}
        <ContextPlate icon={Feather} tone="butter" className="lobby-invitation">
          <div className="lobby-invitation-copy">
            <div>
              <strong>Bring one strange little idea.</strong>
              <p>
                You can read a story and find your starting point before spending.
              </p>
            </div>
            <Button asChild variant="link" className="social-link">
              <RouteLink route={{ kind: "spaces" }} navigate={navigate}>
                Find your people <ArrowRight size={16} />
              </RouteLink>
            </Button>
          </div>
        </ContextPlate>
      </section>
      {selected && (
        <aside
          id="room-preview"
          className="room-preview"
          aria-label={`Preview of ${selected.title}`}
          tabIndex={-1}
        >
          <div className="room-preview-art">
            <Cover project={{ ...selected, coverUrl: fandomImageInStyle(selected.id, selected.coverUrl, artDirections[selected.id]) }} />
            <h2>{selected.title}</h2>
          </div>
          <div className="room-preview-body">
            <div className="featured-makers">
              {makersFor(demo, selected.id)
                .slice(0, 3)
                .map((person) => (
                  <div key={person.id}>
                    <Maker id={person.id} name={person.name} large />
                    <span>{person.name}</span>
                  </div>
                ))}
            </div>
            <RoomProgress demo={demo} projectId={selected.id} details={!selectedStory?.visualStyles} />
            <ContextPlate icon={Feather} tone="paper" className="room-invitation-plate">
              <h3>
                {selectedStory ? selectedStory.question : selected.id === "moon-bus"
                  ? "Help us invent the way home."
                  : "There’s room for your version."}
              </h3>
              {entryActions}
              <small>
                Open project · anyone can fork · uses your personal balance
              </small>
            </ContextPlate>
            {selectedStory?.visualStyles && (
              <FandomArtDirection projectId={selected.id} value={artDirections[selected.id]} onChange={onArtDirectionChange} />
            )}
            <p>{selected.description}</p>
            {selectedStory && (
              <p className="room-preview-note">Unofficial fan story · {selectedStory.artStyle}</p>
            )}
            <div className="room-story-sample">
              <BookOpen size={18} />
              <p>
                {
                  demo.moments.find((moment) => moment.id === selected.seedId)
                    ?.panels[0].caption
                }
              </p>
            </div>
            {host && (
              <div className="host-invitation">
                <GuildMark guild={host} />
                <div>
                  <strong>{host.name}</strong>
                  <p>{host.tagline}</p>
                </div>
                <Button asChild variant="outline" className="social-button outline">
                  <RouteLink route={{ kind: "guild", guildId: host.id }} navigate={navigate}>
                    Meet the guild <ArrowRight size={15} />
                  </RouteLink>
                </Button>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function ProjectTile({ project, ...props }: ViewProps & { project: Project }) {
  const makers = makersFor(props.demo, project.id);
  const momentCount = props.demo.moments.filter(
    (moment) => moment.projectId === project.id,
  ).length;
  return (
    <article className="project-tile">
      <div className="project-tile-art">
        <Cover project={project} />
        <Badge
          className={`room-ribbon ${project.visibility === "private" ? "private" : ""}`}
        >
          {project.visibility === "private" ? (
            <LockKeyhole size={12} />
          ) : (
            <Globe2 size={12} />
          )}
          {project.visibility === "private"
            ? "Private project"
            : "Open project"}
        </Badge>
      </div>
      <div className="project-tile-body">
        <h3>{project.title}</h3>
        <p>{project.description}</p>
        <div className="tile-byline">
          {makers.slice(0, 3).map((person) => (
            <Maker key={person.id} id={person.id} name={person.name} />
          ))}
          <span>
            {momentCount} published {momentCount === 1 ? "moment" : "moments"}
          </span>
        </div>
        <button
          className="social-button purple"
          onClick={() => props.onOpenProject(project.id)}
        >
          {project.visibility === "private"
            ? "Continue together"
            : "Enter room"}
          <ArrowRight size={17} />
        </button>
      </div>
    </article>
  );
}

function GuildProfile(props: ViewProps & { guildId: string }) {
  const { social, demo, userId, navigate, guildId, mutate } = props;
  if (!social.guilds.some((guild) => guild.id === guildId))
    return (
      <Empty title="That guild isn’t here.">
        <RouteLink route={{ kind: "lobby" }} navigate={navigate}>
          Return to the lobby
        </RouteLink>
      </Empty>
    );
  const guild = getPublicGuildProfile(social, demo, guildId);
  const projects = listPublicProjects(social, demo, guildId);
  const joined = isGuildMember(social, userId, guildId);
  const requested = social.joinRequests.some(
    (request) =>
      request.guildId === guildId &&
      request.userId === userId &&
      request.status === "pending",
  );
  const makers = demo.users.filter((user) =>
    projects.some((project) =>
      demo.moments.some(
        (moment) =>
          moment.projectId === project.id && moment.authorId === user.id,
      ),
    ),
  );
  return (
    <div className="guild-profile">
      <div className="social-breadcrumb">
        <RouteLink route={{ kind: "lobby" }} navigate={navigate}>
          Lobby
        </RouteLink>
        <ChevronRight size={14} />
        <span>{guild.name}</span>
      </div>
      <section className="guild-hero">
        <div className="guild-hero-copy">
          <GuildMark guild={guild} large />
          <div>
            <h1>{guild.name}</h1>
            <p className="handwritten">{guild.tagline}</p>
            <p className="public-label">
              <Globe2 size={14} />
              Public guild profile
            </p>
            <div className="guild-join-row">
              {joined ? (
                <RouteLink
                  route={{ kind: "hall", guildId }}
                  navigate={navigate}
                  className="social-button purple"
                >
                  Enter your hall <ArrowRight size={17} />
                </RouteLink>
              ) : (
                <button
                  className="social-button purple"
                  disabled={requested}
                  onClick={() =>
                    mutate(
                      (current) =>
                        requestGuildJoin(current, demo, { userId, guildId }),
                      "Your request is saved. A guild steward can review it in this local preview.",
                    )
                  }
                >
                  {requested ? (
                    <>
                      <Check size={16} />
                      Request sent
                    </>
                  ) : (
                    <>
                      Request to join <ArrowRight size={16} />
                    </>
                  )}
                </button>
              )}
              <a
                className="social-link"
                href="#guild-membership"
                onClick={(event) => {
                  event.preventDefault();
                  document
                    .getElementById("guild-membership")
                    ?.scrollIntoView({ block: "center" });
                }}
              >
                How membership works
              </a>
            </div>
          </div>
        </div>
        <Scene
          sheet="people"
          frame={3}
          label="Friends making stories at a lantern-lit workbench"
          className="guild-hero-image"
        />
      </section>
      <div className="profile-columns">
        <section>
          <div className="section-title">
            <h2>Make something with us</h2>
            <p>You can fork these stories without joining.</p>
          </div>
          <div className="profile-projects">
            {projects.map((project) => (
              <ProjectTile key={project.id} {...props} project={project} />
            ))}
          </div>
        </section>
        <aside className="profile-aside">
          <section className="guild-invitation">
            <h2>An invitation for you</h2>
            <Maker id="priya" name="Priya, sample maker" large />
            <blockquote>“{guild.invitation}”</blockquote>
            <p>{guild.description}</p>
          </section>
          <section className="public-makers">
            <h2>Meet some of the makers</h2>
            <div>
              {makers.map((person) => (
                <div key={person.id}>
                  <Maker id={person.id} name={person.name} large />
                  <strong>{person.name}</strong>
                  <span>Contributes to public stories</span>
                </div>
              ))}
            </div>
          </section>
          <section id="guild-membership" className="membership-explainer">
            <h2>A group worth returning to.</h2>
            <p>
              Ask to join and a steward reviews your request. Membership opens
              the guild’s shared ideas and member hall. Private project
              invitations and spending allowances are handled separately.
            </p>
            <p>Stories keep their individual makers and credits.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function GuildRail({
  social,
  userId,
  guildId,
  navigate,
}: ViewProps & { guildId?: string }) {
  return (
    <nav className="guild-rail" aria-label="Your spaces">
      <h2>Your guilds</h2>
      {social.guilds
        .filter((guild) => isGuildMember(social, userId, guild.id))
        .map((guild) => (
          <RouteLink
            key={guild.id}
            route={{ kind: "hall", guildId: guild.id }}
            navigate={navigate}
            className={`guild-rail-link ${guild.id === guildId ? "selected" : ""}`}
          >
            <GuildMark guild={guild} />
            <span>{guild.name}</span>
            <ChevronRight size={16} />
          </RouteLink>
        ))}
      <RouteLink
        route={{ kind: "spaces" }}
        navigate={navigate}
        className="guild-rail-more"
      >
        <Users size={17} />
        All my spaces
      </RouteLink>
      <RouteLink
        route={{ kind: "desk" }}
        navigate={navigate}
        className="guild-rail-desk"
      >
        <Feather size={24} />
        <span>
          Your desk<small>Sketch, collect and experiment.</small>
        </span>
      </RouteLink>
      <div className="rail-art">
        <Scene frame={5} label="Lanterns light a path through a paper forest" />
        <p>
          Different people.
          <br />
          Brighter worlds together.
        </p>
      </div>
    </nav>
  );
}

function GuildHall(props: ViewProps & { guildId: string }) {
  const { social, demo, userId, guildId, navigate, mutate, onOpenProject } =
    props;
  const [tab, setTab] = useState("hall");
  const guild = social.guilds.find((item) => item.id === guildId);
  if (!guild || !isGuildMember(social, userId, guildId))
    return (
      <Empty title="Meet the guild first.">
        <p>The member hall opens after your request is accepted.</p>
        <RouteLink
          route={guild ? { kind: "guild", guildId } : { kind: "lobby" }}
          navigate={navigate}
          className="social-button purple"
        >
          {guild ? "View public profile" : "Return to lobby"}
          <ArrowRight size={17} />
        </RouteLink>
      </Empty>
    );
  const projects = listGuildProjects(social, demo, userId, guildId);
  const members = social.memberships.filter(
    (member) => member.guildId === guildId,
  );
  const isSteward = members.some(
    (member) => member.userId === userId && member.role === "steward",
  );
  const requests = isSteward
    ? social.joinRequests.filter(
        (request) =>
          request.guildId === guildId && request.status === "pending",
      )
    : [];
  const board = social.spaces.find((space) => space.guildId === guildId)!;
  const ideas = listIdeas(social, demo, userId, board.id);
  const privateProject = projects.find(
    (project) => project.visibility === "private",
  );
  const pool =
    privateProject &&
    demo.accounts.find(
      (account) =>
        account.kind === "group" && account.groupId === privateProject.groupId,
    );
  const allowance =
    privateProject &&
    demo.memberships.find(
      (member) =>
        member.groupId === privateProject.groupId && member.userId === userId,
    );
  return (
    <div className="hall-layout">
      <GuildRail {...props} />
      <div className="hall-center">
        <div className="social-breadcrumb">
          <RouteLink route={{ kind: "spaces" }} navigate={navigate}>
            My spaces
          </RouteLink>
          <ChevronRight size={14} />
          <span>{guild.name}</span>
        </div>
        <section className="hall-welcome">
          <div>
            <h1>Good to have you back.</h1>
            <div className="hall-name">
              <GuildMark guild={guild} />
              <div>
                <h2>{guild.name}</h2>
                <p>A small circle. A wide imagination.</p>
              </div>
            </div>
            <RouteLink
              route={{ kind: "guild", guildId }}
              navigate={navigate}
              className="social-link"
            >
              View public profile <ArrowRight size={15} />
            </RouteLink>
          </div>
          <Scene
            sheet="people"
            frame={3}
            label="Sam, Priya and Jules draw stories around a shared table"
          />
        </section>
        <div className="social-segments hall-tabs" role="group" aria-label="Guild hall view">
          {["hall", "projects", "people"].map((value) => (
            <button
              key={value}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
          <RouteLink
            route={{ kind: "ideas", boardId: board.id }}
            navigate={navigate}
          >
            Ideas <ArrowRight size={14} />
          </RouteLink>
        </div>
        {tab !== "people" && (
          <section className="hall-project-section">
            <h2>What we’re making</h2>
            <div className="hall-projects">
              {projects.map((project) => (
                <ProjectTile key={project.id} {...props} project={project} />
              ))}
            </div>
          </section>
        )}
        {guildId === "paper-lantern" && tab === "hall" && <GuildFundingHallEntry />}
        {tab === "people" && (
          <section className="hall-people">
            <h2>The people at this table</h2>
            {members.map((member) => {
              const person = demo.users.find(
                (user) => user.id === member.userId,
              )!;
              return (
                <div key={person.id}>
                  <Maker id={person.id} name={person.name} large />
                  <div>
                    <h3>{person.name}</h3>
                    <p>
                      {member.role === "steward"
                        ? "Guild steward"
                        : "Guild member"}
                    </p>
                  </div>
                  <span>
                    {person.id === userId ? "You" : "Sample collaborator"}
                  </span>
                </div>
              );
            })}
            <p>
              Being in the guild does not automatically open private projects or
              authorize spending.
            </p>
          </section>
        )}
        {tab === "hall" && (
          <section className="hall-idea-invitation">
            <Scene
              sheet="people"
              frame={5}
              label="A pot full of growing clouds"
            />
            <div>
              <p>An idea looking for company</p>
              <h3>{ideas[0]?.title ?? "What should we make next?"}</h3>
              <p>
                {ideas[0]?.body ?? "Leave a little spark for someone to find."}
              </p>
            </div>
            <RouteLink
              route={{ kind: "ideas", boardId: board.id }}
              navigate={navigate}
              className="social-button purple"
            >
              Open idea board <ArrowRight size={17} />
            </RouteLink>
          </section>
        )}
        {isSteward && (
          <section className="guild-requests">
            <h2>Invitations to the table</h2>
            {requests.length ? (
              requests.map((request) => {
                const person = demo.users.find(
                  (user) => user.id === request.userId,
                )!;
                return (
                  <div className="guild-request" key={request.id}>
                    <Maker id={person.id} name={person.name} />
                    <div>
                      <strong>{person.name} wants to join</strong>
                      <p>
                        {request.message ||
                          "Ready to make something with the guild."}
                      </p>
                    </div>
                    <button
                      className="social-button outline"
                      onClick={() =>
                        mutate(
                          (current) =>
                            approveGuildJoin(current, demo, {
                              actorId: userId,
                              requestId: request.id,
                            }),
                          `${person.name} joined the guild. Private access and spending limits are unchanged.`,
                        )
                      }
                    >
                      Welcome {person.name}
                      <Check size={16} />
                    </button>
                  </div>
                );
              })
            ) : (
              <p>
                No requests waiting. Public visitors can ask to join from your
                guild profile.
              </p>
            )}
          </section>
        )}
      </div>
      <aside className="hall-aside">
        <section className="around-hall">
          <h2>Around the hall</h2>
          {members.map((member) => {
            const person = demo.users.find(
              (user) => user.id === member.userId,
            )!;
            const contributions = demo.moments.filter(
              (moment) =>
                projects.some((project) => project.id === moment.projectId) &&
                moment.authorId === person.id,
            ).length;
            return (
              <div key={person.id}>
                <Maker id={person.id} name={person.name} large />
                <div>
                  <h3>
                    {person.name} {person.id === userId && <small>you</small>}
                  </h3>
                  <p>{contributions} published contributions</p>
                  <span>
                    {member.role === "steward"
                      ? "Keeps the lantern lit"
                      : "Making room for another idea"}
                  </span>
                </div>
              </div>
            );
          })}
          <p className="social-fine">Contributions, not live presence.</p>
        </section>
        {privateProject && pool ? (
          <section className="hall-cartridge">
            <MiniCartridge
              available={pool.available}
              reserved={pool.reserved}
              spent={pool.spent}
            />
            <h2>Private-project cartridge</h2>
            <p>
              <strong>{formatCredits(pool.available)}</strong> sample credits
              available
            </p>
            <button
              className="social-link"
              onClick={() =>
                onOpenProject(privateProject.id, { task: "balance" })
              }
            >
              View balance and spending allowance <ArrowRight size={15} />
            </button>
            <p className="social-fine">
              {allowance?.canSpend
                ? "Your assigned allowance applies."
                : "You can read this project; spending is not enabled for you."}{" "}
              Open projects use your personal balance.
            </p>
          </section>
        ) : (
          <section className="hall-cartridge">
            <BookOpen size={26} />
            <h2>Start with an open story.</h2>
            <p>
              Use your personal balance when you decide to make a fork. Reading
              costs nothing.
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}

function MiniCartridge({
  available,
  reserved,
  spent,
}: {
  available: number;
  reserved: number;
  spent: number;
}) {
  const total = Math.max(available + reserved + spent, 1);
  return (
    <div
      className="social-cartridge"
      role="img"
      aria-label={`${formatCredits(available)} available, ${formatCredits(reserved)} reserved and ${formatCredits(spent)} spent, sample credits`}
    >
      <div className="cartridge-ridges" />
      <div className="social-cartridge-label">
        <Moon size={25} />
        <span>
          MORE LITTLE
          <br />
          WORLDS
        </span>
        <div className="social-fuel-meter">
          <i style={{ width: `${(available / total) * 100}%` }} />
          <b style={{ width: `${(reserved / total) * 100}%` }} />
        </div>
      </div>
      <div className="social-cartridge-pins" />
    </div>
  );
}

function Spaces(props: ViewProps) {
  const { social, demo, userId, navigate, onOpenProject, onUpdateDemo } = props;
  const guilds = social.guilds.filter((guild) =>
    isGuildMember(social, userId, guild.id),
  );
  const friends = social.spaces.filter(
    (space) =>
      space.kind === "group" &&
      demo.memberships.some(
        (member) =>
          member.groupId === space.groupId &&
          member.userId === userId &&
          ["active", "invited"].includes(member.status),
      ),
  );
  return (
    <div className="spaces-page">
      <div className="spaces-intro">
        <div>
          <h1>My spaces</h1>
          <p>Your guilds, close friends and unfinished stories.</p>
        </div>
        <Button asChild variant="outline" className="social-button outline">
          <RouteLink route={{ kind: "desk" }} navigate={navigate}>
            <Feather size={17} />
            Your desk <ArrowRight size={17} />
          </RouteLink>
        </Button>
      </div>
      <div className="spaces-columns">
        <section>
          <SectionPlate title="Your guilds" icon={Lamp} tone="night" className="spaces-room-sign" />
          <div className="space-list">
            {guilds.map((guild) => (
              <RouteLink
                key={guild.id}
                route={{ kind: "hall", guildId: guild.id }}
                navigate={navigate}
                className="space-entry"
              >
                <GuildMark guild={guild} large />
                <div>
                  <h3>{guild.name}</h3>
                  <p>{guild.tagline}</p>
                  <small>
                    {listGuildProjects(social, demo, userId, guild.id).length}{" "}
                    projects you can enter
                  </small>
                </div>
                <ArrowRight size={23} />
              </RouteLink>
            ))}
          </div>
          {!guilds.length && (
            <p>
              You haven’t joined a guild yet. Start with a story in the lobby.
            </p>
          )}
          <div className="spaces-discover">
            <Compass size={19} />
            <RouteLink route={{ kind: "lobby" }} navigate={navigate}>
              Meet a guild through what it makes
            </RouteLink>
          </div>
        </section>
        <section>
          <SectionPlate title="Just among friends" icon={Users} tone="lavender" className="spaces-room-sign" />
          {friends.map((space) => {
            const member = demo.memberships.find(
              (item) =>
                item.groupId === space.groupId && item.userId === userId,
            )!;
            const group = demo.groups.find(
              (item) => item.id === space.groupId,
            )!;
            const projects = demo.projects.filter(
              (project) => project.groupId === space.groupId,
            );
            return (
              <article className="friend-space" key={space.id}>
                <div className="friend-space-title">
                  <LockKeyhole size={23} />
                  <div>
                    <h3>{space.name}</h3>
                    <p>Invite only · a little corner of our own</p>
                  </div>
                </div>
                {member.status === "invited" ? (
                  <>
                    <p>
                      You’re invited. Joining allows members to publish covered
                      finished stories externally with credits. Notes, private
                      drafts, prompts and membership stay private.
                    </p>
                    <Button
                      className="social-button yellow"
                      onClick={() =>
                        onUpdateDemo(
                          (current) =>
                            acceptGroupTerms(current, {
                              userId,
                              groupId: group.id,
                            }),
                          "You joined the sample friend group and accepted its finished-work sharing terms.",
                        )
                      }
                    >
                      Accept invitation and terms <ArrowRight size={17} />
                    </Button>
                  </>
                ) : (
                  <>
                    <p>{space.description}</p>
                    <div className="friend-space-actions">
                      <Button asChild className="social-button yellow">
                        <RouteLink route={{ kind: "ideas", boardId: space.id }} navigate={navigate}>
                          Ideas left for us <ArrowRight size={17} />
                        </RouteLink>
                      </Button>
                      {projects[0] && (
                        <Button
                          variant="link"
                          className="social-link"
                          onClick={() => onOpenProject(projects[0].id)}
                        >
                          Continue our story <ArrowRight size={15} />
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </article>
            );
          })}
          {!friends.length && <p>A friend’s invitation will appear here.</p>}
          <RouteLink
            route={{ kind: "desk" }}
            navigate={navigate}
            className="personal-desk-link"
          >
            <Feather size={27} />
            <div>
              <h3>Your desk</h3>
              <p>
                A place for your sketches, experiments and unfinished stories.
              </p>
            </div>
            <ArrowRight size={20} />
          </RouteLink>
        </section>
      </div>
    </div>
  );
}

function IdeasBoard(props: ViewProps & { boardId: string }) {
  const { demo, social, userId, navigate, boardId, onOpenProject } = props;
  const [mode, setMode] = useState<"board" | "timeline">("board");
  const [composer, setComposer] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const space = social.spaces.find((item) => item.id === boardId);
  if (!space || !canAccessBoard(social, demo, userId, boardId))
    return (
      <Empty title="This board belongs to its members.">
        <p>
          Return to your spaces to review an invitation or choose a group you
          belong to.
        </p>
        <RouteLink
          route={{ kind: "spaces" }}
          navigate={navigate}
          className="social-button purple"
        >
          My spaces <ArrowRight size={17} />
        </RouteLink>
      </Empty>
    );
  const ideas = listIdeas(social, demo, userId, boardId);
  const selected =
    ideas.find((idea) => idea.id === selectedId) ??
    ideas.find((idea) => idea.context) ??
    ideas[0];
  const activities = listBoardActivity(social, demo, userId, boardId);
  const contextProject =
    selected?.context &&
    demo.projects.find((project) => project.id === selected.context?.projectId);
  const contextMoment =
    selected?.context &&
    demo.moments.find((moment) => moment.id === selected.context?.momentId);
  const members = demo.users.filter((user) =>
    space.kind === "guild"
      ? isGuildMember(social, user.id, space.guildId!)
      : demo.memberships.some(
          (member) =>
            member.groupId === space.groupId &&
            member.userId === user.id &&
            member.status === "active",
        ),
  );
  function draftIdea(idea: SavedIdea) {
    if (idea.context)
      onOpenProject(idea.context.projectId, {
        momentId: idea.context.momentId,
        prompt: [idea.title, idea.body].filter(Boolean).join("\n\n"),
        task: "create",
        ideaId: idea.id,
      });
  }
  const emptyBoard = (
    <Empty title="Leave the first little spark.">
      <p>
        A question, a sketch, an impossible ending. It can start small.
      </p>
      <Button className="social-button purple" onClick={() => setComposer(true)}>
        Leave an idea <Plus size={17} />
      </Button>
    </Empty>
  );
  return (
    <div className="ideas-page">
      <div className="social-breadcrumb">
        <RouteLink route={{ kind: "spaces" }} navigate={navigate}>
          My spaces
        </RouteLink>
        <ChevronRight size={14} />
        {space.guildId ? (
          <RouteLink
            route={{ kind: "hall", guildId: space.guildId }}
            navigate={navigate}
          >
            {space.name}
          </RouteLink>
        ) : (
          <span>{space.name}</span>
        )}
        <ChevronRight size={14} />
        <span>Ideas</span>
      </div>
      <div className="ideas-layout">
        <Tabs
          className="ideas-center"
          value={mode}
          onValueChange={(value) => setMode(value as "board" | "timeline")}
        >
          <div className="ideas-heading">
            <div>
              <h1>Ideas left for us.</h1>
              <p>Something to pick up when you return.</p>
              <span>
                <LockKeyhole size={15} />
                {space.kind === "group" ? "Invite only" : "Guild members only"}
              </span>
            </div>
            <div className="board-makers">
              {members.map((person) => (
                <div key={person.id}>
                  <Maker id={person.id} name={person.name} large />
                  <span>{person.name}</span>
                </div>
              ))}
            </div>
            <Button
              className="social-button purple"
              onClick={() => {
                setComposer(true);
                if (composer) document.getElementById("idea-title")?.focus();
              }}
              aria-expanded={composer}
            >
              <Plus size={18} />
              Leave an idea
            </Button>
          </div>
          <div className="board-toolbar">
            <TabsList className="social-segments" aria-label="Ideas view">
              <TabsTrigger value="board">
                <LayoutGrid size={16} />
                Board
              </TabsTrigger>
              <TabsTrigger value="timeline">
                <List size={16} />
                Timeline
              </TabsTrigger>
            </TabsList>
            <span>
              <Check size={14} />
              Saved for this group, in this browser
            </span>
          </div>
          {composer && (
            <IdeaComposer
              {...props}
              space={space}
              onClose={() => setComposer(false)}
              onCreated={(id) => {
                setSelectedId(id);
                setComposer(false);
              }}
            />
          )}
          <TabsContent value="board" className="ideas-view-panel">
          {!ideas.length ? emptyBoard : (
            <div className="idea-grid">
              {ideas.map((idea, index) => (
                <IdeaCard
                  key={idea.id}
                  {...props}
                  idea={idea}
                  index={index}
                  selected={selected?.id === idea.id}
                  select={() => setSelectedId(idea.id)}
                  makeDraft={() => draftIdea(idea)}
                />
              ))}
            </div>
          )}
          </TabsContent>
          <TabsContent value="timeline" className="ideas-view-panel">
          {!ideas.length ? emptyBoard : (
            <ol className="idea-timeline">
              {activities.map((activity) => {
                const idea = ideas.find((item) => item.id === activity.ideaId);
                const person = demo.users.find(
                  (user) => user.id === activity.actorId,
                );
                if (!idea || !person) return null;
                const reply = idea.replies.find(
                  (item) => item.id === activity.replyId,
                );
                return (
                  <li key={activity.id}>
                    <Maker id={person.id} name={person.name} />
                    <div>
                      <p>
                        <strong>{person.name}</strong>{" "}
                        {activity.kind === "reply-added"
                          ? "replied"
                          : activity.kind === "idea-pinned"
                            ? "pinned an idea"
                            : activity.kind === "idea-unpinned"
                              ? "unpinned an idea"
                              : "left an idea"}
                        <time
                          dateTime={new Date(activity.createdAt).toISOString()}
                        >
                          {formatWhen(activity.createdAt)}
                        </time>
                      </p>
                      <button
                        onClick={() => {
                          setSelectedId(idea.id);
                          setMode("board");
                        }}
                      >
                        {idea.title}
                      </button>
                      <p>{reply?.body ?? idea.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          </TabsContent>
          <p className="board-boundary">
            <LockKeyhole size={15} />
            Notes stay private. Turning an idea into a draft does not publish it
            or spend credits.
          </p>
        </Tabs>
        <aside className="ideas-aside">
          <section className="since-here">
            <SectionPlate title="Recently left here" icon={MessageCircle} tone="lavender" className="ideas-recent-sign" />
            {activities.slice(0, 5).map((activity) => {
              const person = demo.users.find(
                (user) => user.id === activity.actorId,
              )!;
              const idea = ideas.find((item) => item.id === activity.ideaId);
              if (!idea) return null;
              return (
                <button
                  key={activity.id}
                  onClick={() => {
                    setSelectedId(idea.id);
                    setMode("board");
                  }}
                >
                  <Maker id={person.id} name={person.name} />
                  <span>
                    <strong>
                      {person.name}{" "}
                      {activity.kind === "reply-added"
                        ? "replied"
                        : activity.kind === "idea-added"
                          ? "left an idea"
                          : "updated a pin"}
                    </strong>
                    <time dateTime={new Date(activity.createdAt).toISOString()}>
                      {formatWhen(activity.createdAt)}
                    </time>
                  </span>
                </button>
              );
            })}
            {!activities.length && (
              <p>The group’s next idea will show up here.</p>
            )}
          </section>
          {selected && (
            <section className="try-idea">
              <h2>Try this little idea</h2>
              {contextProject ? (
                <Cover project={contextProject} />
              ) : (
                <Scene
                  sheet="people"
                  frame={5}
                  label="A small pot of growing clouds"
                />
              )}
              <h3>{selected.title}</h3>
              {contextMoment ? (
                <ContextPlate icon={BookOpen} tone="lavender" className="idea-starting-plate">
                  <p>
                    Starts from {contextMoment.title}
                  </p>
                  <Button
                    className="social-button purple"
                    onClick={() => draftIdea(selected)}
                  >
                    Make a draft <ArrowRight size={18} />
                  </Button>
                  <small>Review generation cost before creating.</small>
                  <Button
                    variant="link"
                    className="social-link"
                    onClick={() =>
                      onOpenProject(contextProject!.id, {
                        momentId: contextMoment.id,
                        task: "read",
                      })
                    }
                  >
                    Go to the story <ArrowRight size={15} />
                  </Button>
                </ContextPlate>
              ) : (
                <p>
                  This idea has no story attached yet. Leave a new idea with a
                  starting moment to take it into the workspace.
                </p>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function formatWhen(value: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function IdeaCard(
  props: ViewProps & {
    idea: SavedIdea;
    index: number;
    selected: boolean;
    select: () => void;
    makeDraft: () => void;
  },
) {
  const { demo, social, userId, mutate, idea, index, selected, select } = props;
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const author = demo.users.find((user) => user.id === idea.authorId)!;
  const project =
    idea.context &&
    demo.projects.find((item) => item.id === idea.context?.projectId);
  const canPin = canAccessBoard(social, demo, userId, idea.spaceId);
  const attachment = idea.imageUrl?.startsWith("data:") ? (
    <img className="idea-attachment" src={idea.imageUrl} alt={idea.title} />
  ) : idea.imageUrl ? (
    <StoryArt
      src={idea.imageUrl}
      description={idea.title}
      className="idea-attachment"
    />
  ) : null;
  return (
    <article
      className={`idea-note note-${index % 3} ${selected ? "is-selected" : ""}`}
    >
      <div className="idea-author">
        <Maker id={author.id} name={author.name} />
        <span>
          {author.name}
          <time dateTime={new Date(idea.createdAt).toISOString()}>
            {formatWhen(idea.createdAt)}
          </time>
        </span>
        {canPin ? (
          <button
            className="note-pin"
            aria-label={
              idea.pinned ? `Unpin ${idea.title}` : `Pin ${idea.title}`
            }
            aria-pressed={idea.pinned}
            onClick={() =>
              mutate(
                (current) =>
                  toggleIdeaPin(current, demo, { userId, ideaId: idea.id }),
                idea.pinned ? "Idea unpinned." : "Idea pinned for the group.",
              )
            }
          >
            <Pin size={17} />
          </button>
        ) : (
          idea.pinned && <Pin size={15} aria-label="Pinned idea" />
        )}
      </div>
      <button className="idea-title" aria-pressed={selected} onClick={select}>
        {idea.title}
      </button>
      {attachment}
      <p className="idea-body">{idea.body}</p>
      {project && (
        <button
          className="note-story-link"
          onClick={() =>
            props.onOpenProject(project.id, {
              momentId: idea.context!.momentId,
              task: "read",
            })
          }
        >
          <Cover project={project} />
          <span>
            {project.title}
            <small>
              {
                demo.moments.find(
                  (moment) => moment.id === idea.context!.momentId,
                )?.title
              }
            </small>
          </span>
          <ChevronRight size={16} />
        </button>
      )}
      <div className="note-replies">
        {idea.replies.slice(replying ? 0 : -1).map((item) => {
          const person = demo.users.find((user) => user.id === item.authorId)!;
          return (
            <div key={item.id}>
              <Maker id={person.id} name={person.name} />
              <p>
                <strong>{person.name}</strong>
                {item.body}
              </p>
            </div>
          );
        })}
      </div>
      <div className="note-actions">
        <button onClick={() => setReplying(!replying)} aria-expanded={replying}>
          <MessageCircle size={16} />
          {idea.replies.length}{" "}
          {idea.replies.length === 1 ? "reply" : "replies"}
        </button>
        <button onClick={() => setReplying(true)}>
          Reply <ArrowRight size={15} />
        </button>
      </div>
      {replying && (
        <form
          className="note-reply-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              mutate(
                (current) =>
                  replyToIdea(current, demo, {
                    userId,
                    ideaId: idea.id,
                    body: reply,
                  }),
                "Your reply was left for the group.",
              )
            ) {
              setReply("");
              setReplying(false);
            }
          }}
        >
          <label htmlFor={`reply-${idea.id}`}>Leave a reply</label>
          <textarea
            id={`reply-${idea.id}`}
            maxLength={1000}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            required
            rows={2}
          />
          <button className="social-button purple" type="submit">
            Post reply <Send size={15} />
          </button>
        </form>
      )}
    </article>
  );
}

function IdeaComposer(
  props: ViewProps & {
    space: SocialSpace;
    onClose: () => void;
    onCreated: (id: string) => void;
  },
) {
  const { demo, userId, space, mutate, onClose, onCreated } = props;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [image, setImage] = useState<string | undefined>();
  const [fileError, setFileError] = useState("");
  const [readingImage, setReadingImage] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [momentId, setMomentId] = useState("");
  const projects = demo.projects.filter(
    (project) =>
      canAccessProject(demo, userId, project.id) &&
      (space.kind === "guild"
        ? project.visibility === "open"
        : project.visibility === "open" || project.groupId === space.groupId),
  );
  const moments = demo.moments.filter(
    (moment) => moment.projectId === projectId,
  );
  async function attach(file?: File) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      ) ||
      file.size > 600_000
    ) {
      setFileError(
        "Choose a PNG, JPEG, WebP or GIF smaller than 600 KB for this browser preview.",
      );
      return;
    }
    setReadingImage(true);
    setFileError("");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("The image could not be read. Try another file."));
        reader.readAsDataURL(file);
      });
      setImage(data);
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : "The image could not be read.",
      );
    } finally {
      setReadingImage(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    let created = "";
    if (
      mutate((current) => {
        const next = addIdea(current, demo, {
          userId,
          spaceId: space.id,
          title,
          body,
          imageUrl: image,
          ...(projectId
            ? { context: { projectId, momentId: momentId || moments[0]?.id } }
            : {}),
        });
        created = next.ideas.find(
          (idea) => !current.ideas.some((old) => old.id === idea.id),
        )!.id;
        return next;
      }, "Your idea is saved for this group.")
    )
      onCreated(created);
  }
  return (
    <form className="idea-composer" onSubmit={submit}>
      <div className="composer-title">
        <h2>Leave a little spark.</h2>
        <button
          type="button"
          className="social-icon-button"
          aria-label="Close new idea"
          onClick={() => {
            if (
              (!title && !body && !image) ||
              window.confirm("Discard this unposted note?")
            )
              onClose();
          }}
        >
          <X size={20} />
        </button>
      </div>
      <p>Only {space.name} can see it. It can be unfinished.</p>
      <label htmlFor="idea-title">A thought or a question</label>
      <input
        autoFocus
        id="idea-title"
        required
        maxLength={120}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="What if the oven remembers tomorrow?"
      />
      <label htmlFor="idea-body">A little more context, or add a sketch</label>
      <textarea
        id="idea-body"
        value={body}
        maxLength={2000}
        required={!image}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Leave something for the next person to pick up…"
        rows={3}
      />
      <div className="composer-context">
        <label>
          Attach to a story
          <select
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setMomentId("");
            }}
          >
            <option value="">Just an idea for now</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        {projectId && (
          <label>
            Starting moment
            <select
              value={momentId || moments[0]?.id || ""}
              onChange={(event) => setMomentId(event.target.value)}
            >
              {moments.map((moment) => (
                <option key={moment.id} value={moment.id}>
                  {moment.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="composer-attachment">
        <label className="social-button outline">
          <ImagePlus size={17} />
          {readingImage ? "Reading sketch…" : "Add a sketch"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => {
              void attach(event.target.files?.[0]);
            }}
          />
        </label>
        <span>Image under 600 KB · saved on this device</span>
        {image && (
          <>
            <img src={image} alt="Your attached sketch" />
            <button
              className="social-link"
              type="button"
              onClick={() => setImage(undefined)}
            >
              Remove sketch
            </button>
          </>
        )}
      </div>
      {fileError && (
        <p className="social-error" role="alert">
          {fileError}
        </p>
      )}
      <button
        className="social-button purple"
        type="submit"
        disabled={readingImage}
      >
        Leave it for the group <ArrowRight size={17} />
      </button>
    </form>
  );
}
