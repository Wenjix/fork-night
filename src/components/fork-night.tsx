"use client";

import { AppHeader } from "./app-header";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Download,
  GitBranch,
  Globe2,
  Layers3,
  LockKeyhole,
  Palette,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  Film,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  acceptGroupTerms,
  assertLedgerConservation,
  canAccessProject,
  createDemoState,
  deliverFork,
  discardFork,
  demoReuseFee,
  exportBranch,
  formatCredits,
  getFundingAccount,
  getPath,
  getQuote,
  parseCredits,
  publishFork,
  removeMember,
  reserveFork,
  setMemberLimit,
  topUp,
  withdraw,
  validateDemoState,
  DEMO_LIMITS,
  DEMO_UNIT,
  type DemoState,
  type ForkOperation,
  type ForkQuote,
  type Panel,
} from "@/domain";
import { BrandStrip, Chip } from "./brand-badge";
import { ToArrow } from "./inline-arrow";
import { MakerName } from "./maker-name";
import { SectionPlate } from "./visual-plates";
import { StoryArt } from "./story-art";
import { StoryMap } from "./story-map";
import { StoryFilm } from "./story-film";
import { PreparedFilmInvite, PreparedStoryFilm } from "./prepared-story-film";
import { PREPARED_FILMS } from "@/lib/prepared-story-film";
import { roomTheme, type RoomTheme } from "@/lib/room-theme";
import { BLADE_RUNNER_RESTYLE, restyledMoment } from "@/lib/prepared-restyle";
import { PreparedRestyle } from "./prepared-restyle";
import { makeFilmPlan } from "@/lib/story-film";
import { artAssetUrl, isApprovedArtUrl } from "@/lib/art";
import { renderFinishedHtml } from "@/lib/finished-export";
import { SocialSpaces } from "./social-spaces";
import { extendSocialDemo } from "@/social/model";
import { extendFandomDemo } from "@/domain/fandom-fixtures";
import { fandomStory } from "@/lib/fandom-stories";
import { ART_DIRECTIONS_STORAGE_KEY, fandomImageInStyle, fandomMomentInStyle, fandomVisualStyle, restoreArtDirections, type ArtDirections } from "@/lib/fandom-art-direction";
import { FandomArtDirection } from "./fandom-art-direction";
// The film page and the segmented control are styled with the room, so their components import no CSS and can be rendered in a test.
import "@/app/prepared-story-film.css";
import "@/app/segments.css";
import {
  formatSocialRoute,
  parseSocialRoute,
  rememberWorkspaceDraft,
  restoreLocalWorkspace,
  switchWorkspaceContext,
  unfinishedDrafts,
  type LocalWorkspace,
  type OpenProjectOptions,
  type SocialRoute,
} from "@/social/navigation";

const STORAGE_KEY = "fork-night.local-workspace.v1";
type Task =
  | "detail"
  | "compose"
  | "quote"
  | "working"
  | "review"
  | "receipt"
  | "balance"
  | "members";
type Workspace = LocalWorkspace;
const extendDemoCatalog = (state: DemoState) =>
  extendFandomDemo(extendSocialDemo(state));
const initialWorkspace = (): Workspace => ({
  state: extendDemoCatalog(createDemoState()),
  userId: "sam",
  projectId: "night-city-after-hours",
  selectedId: "night-city-after-hours-opening",
  draft: "",
  operationId: null,
  drafts: {},
});

function resumedTask(workspace: Workspace): Task {
  const active = workspace.state.operations.find(
    (item) => item.id === workspace.operationId,
  );
  if (active?.status === "reserved") return "working";
  if (active?.status === "delivered") return "review";
  return workspace.draft.trim() ? "compose" : "detail";
}

function Credits({ amount }: { amount: number }) {
  return (
    <span className="credits">
      {formatCredits(amount)}
      <span>{amount === DEMO_UNIT ? " credit" : " credits"}</span>
    </span>
  );
}
/**
 * A local room from its toolbar to its footer in one element, so the room's skin has no cream edge:
 * the toolbar, the preview band and the footer sit inside the skin together with the story.
 * The page header stays outside it.
 */
function StoryRoomShell({ active, skin, children }: { active: boolean; skin?: RoomTheme; children: ReactNode }) {
  return active ? <div className="story-room" data-room-theme={skin}>{children}</div> : <>{children}</>;
}
function downloadFile(text: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function embeddedFile(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("A story file could not be prepared for download."));
    reader.readAsDataURL(blob);
  });
}

export function ForkNight() {
  const deskLeaveGuard = useRef<(() => boolean) | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [socialRoute, setSocialRoute] = useState<SocialRoute>({
    kind: "lobby",
  });
  const [draftConflict, setDraftConflict] = useState<{
    projectId: string;
    options: OpenProjectOptions;
    held: boolean;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFailure, setSaveFailure] = useState<"read" | "write" | null>(null);
  const [task, setTask] = useState<Task>("detail");
  const [view, setView] = useState<"map" | "read" | "video" | "images-to-video">("map");
  const [mobileDetails, setMobileDetails] = useState(false);
  const [quote, setQuote] = useState<ForkQuote | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [thanks, setThanks] = useState("");
  const [amount, setAmount] = useState("5");
  const [menu, setMenu] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [artDirections, setArtDirections] = useState<ArtDirections>({});
  const [restyleApplied, setRestyleApplied] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const taskHeading = useRef<HTMLHeadingElement>(null);
  const conflictHeading = useRef<HTMLHeadingElement>(null);
  const originalSave = useRef<string | null>(null);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const { state, userId, projectId, selectedId, draft } = workspace;
  const user = state.users.find((item) => item.id === userId)!;
  const project = state.projects.find((item) => item.id === projectId)!;
  const fanStory = fandomStory(projectId);
  const preparedFilm = PREPARED_FILMS[projectId];
  const hasPreparedFilm = !!preparedFilm;
  const showingPreparedFilm = hasPreparedFilm && view === "images-to-video";
  const projectRouteAvailable =
    socialRoute.kind !== "project" || socialRoute.projectId === projectId;
  const accessible =
    projectRouteAvailable && canAccessProject(state, userId, projectId);
  const selected =
    state.moments.find(
      (item) => item.id === selectedId && item.projectId === projectId,
    ) ?? state.moments.find((item) => item.id === project.seedId)!;
  const path = accessible ? getPath(state, projectId, selected.id) : [];
  const visualStyle = fandomVisualStyle(projectId, artDirections[projectId]);
  // A prepared restyle changes only how this room's frames are shown, never the saved story.
  const present = (moment: typeof selected) => {
    const styled = fandomMomentInStyle(projectId, moment, visualStyle?.id);
    return restyleApplied ? restyledMoment(styled) : styled;
  };
  const presentedSelected = present(selected);
  const presentedPath = path.map(present);
  const presentedState = visualStyle || restyleApplied ? {
    ...state,
    moments: state.moments.map(moment => moment.projectId === projectId ? present(moment) : moment),
  } : state;
  const restyleScenes = BLADE_RUNNER_RESTYLE.frames.map(item => {
    const moment = state.moments.find(candidate => candidate.id === item.momentId);
    return { title: moment?.title ?? "", caption: moment?.panels[0].caption ?? "" };
  });
  const account = accessible
    ? getFundingAccount(state, userId, projectId)
    : null;
  const author = state.users.find((item) => item.id === selected.authorId)!;
  const group = state.groups.find((item) => item.id === project.groupId);
  const membership = state.memberships.find(
    (item) => item.userId === userId && item.groupId === project.groupId,
  );
  const invited = projectRouteAvailable && membership?.status === "invited";
  const mayNameProject = projectRouteAvailable && (accessible || invited);
  const inProject = socialRoute.kind === "project";
  // An open room wears the skin it has. A room that is not available wears the skin of the room that was asked for,
  // never the skin of the room opened last.
  const roomSkin = accessible
    ? fanStory?.theme
    : roomTheme(socialRoute.kind === "project" ? socialRoute.projectId : projectId);
  const visibleProjects = state.projects.filter(
    (item) =>
      canAccessProject(state, userId, item.id) ||
      state.memberships.some(
        (member) =>
          member.userId === userId &&
          member.groupId === item.groupId &&
          member.status === "invited",
      ),
  );
  const operation = state.operations.find(
    (item) =>
      item.id === workspace.operationId &&
      item.quote.userId === userId &&
      item.quote.projectId === projectId,
  );
  const pending = state.operations.filter(
    (item) =>
      item.quote.userId === userId &&
      item.quote.projectId === projectId &&
      ["reserved", "delivered"].includes(item.status),
  );
  const upstream =
    project.visibility === "open"
      ? path.reduce((sum, item) => sum + demoReuseFee(item), 0)
      : 0;

  useEffect(() => {
    let restored = workspaceRef.current;
    try {
      const rawStyles = localStorage.getItem(ART_DIRECTIONS_STORAGE_KEY);
      if (rawStyles) setArtDirections(restoreArtDirections(JSON.parse(rawStyles)));
    } catch {
      // A visual preference must never prevent recovery of a story or reserved operation.
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      originalSave.current = raw;
      if (raw)
        restored = restoreLocalWorkspace(JSON.parse(raw), extendDemoCatalog);
    } catch {
      setSaveFailure("read");
      setSaveError(
        "Your local save couldn’t be read. Download the original save before resetting it.",
      );
    }
    const route = parseSocialRoute(window.location.hash);
    if (
      route.kind === "project" &&
      restored.state.projects.some((item) => item.id === route.projectId)
    ) {
      restored = switchWorkspaceContext(
        restored,
        restored.userId,
        route.projectId,
      );
    }
    workspaceRef.current = restored;
    setWorkspace(restored);
    setSocialRoute(route);
    const restoredTask = resumedTask(restored);
    setTask(restoredTask);
    const opensFilm = route.kind === "project" && route.view === "images-to-video";
    setView(opensFilm ? "images-to-video" : "map");
    setMobileDetails(!opensFilm && restoredTask !== "detail");
    setLoaded(true);
  }, []);

  useEffect(() => {
    const restoreRoute = () => {
      const route = parseSocialRoute(window.location.hash);
      if (
        route.kind !== "desk" &&
        deskLeaveGuard.current &&
        !deskLeaveGuard.current()
      ) {
        window.history.replaceState(null, "", "#/desk");
        return;
      }
      const current = workspaceRef.current;
      if (
        route.kind === "project" &&
        current.state.projects.some((item) => item.id === route.projectId)
      ) {
        const next = switchWorkspaceContext(
          current,
          current.userId,
          route.projectId,
        );
        workspaceRef.current = next;
        setWorkspace(next);
        const nextTask = resumedTask(next);
        setTask(nextTask);
        const opensFilm = route.view === "images-to-video";
        setView(opensFilm ? "images-to-video" : "map");
        setMobileDetails(!opensFilm && nextTask !== "detail");
        setQuote(null);
      }
      setSocialRoute(route);
      setDraftConflict(null);
      setMenu(false);
    };
    window.addEventListener("hashchange", restoreRoute);
    window.addEventListener("popstate", restoreRoute);
    return () => {
      window.removeEventListener("hashchange", restoreRoute);
      window.removeEventListener("popstate", restoreRoute);
    };
  }, []);

  useEffect(() => {
    if (!loaded || saveError) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(rememberWorkspaceDraft(workspace)),
      );
    } catch {
      setSaveFailure("write");
      setSaveError(
        "This browser couldn’t save your changes. Download your current work to keep it.",
      );
    }
  }, [workspace, loaded, saveError]);

  useEffect(() => {
    if (task !== "detail" || mobileDetails)
      taskHeading.current?.focus({ preventScroll: true });
  }, [task, mobileDetails, selectedId]);

  useEffect(() => {
    if (draftConflict) conflictHeading.current?.focus();
  }, [draftConflict]);

  function update(action: (current: DemoState) => DemoState, message?: string) {
    try {
      const current = workspaceRef.current;
      const next = action(current.state);
      assertLedgerConservation(next);
      validateDemoState(next);
      if (!loaded || saveFailure === "read")
        throw new Error(
          "Resolve the saved-work warning before making changes.",
        );
      const saved = rememberWorkspaceDraft({ ...current, state: next });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      } catch {
        throw new Error(
          "This browser could not save that change. It has not been applied. Download your work or free some storage, then try again.",
        );
      }
      workspaceRef.current = saved;
      setWorkspace(workspaceRef.current);
      setError("");
      if (message) setNotice(message);
      return next;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "That action couldn’t finish. Please try again.",
      );
      return null;
    }
  }

  function changeArtDirection(targetProjectId: string, styleId: "anime" | "film") {
    if (!fandomStory(targetProjectId)?.visualStyles?.some(style => style.id === styleId)) return;
    const next = { ...artDirections, [targetProjectId]: styleId };
    setArtDirections(next);
    try {
      localStorage.setItem(ART_DIRECTIONS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      setNotice("This visual choice is available for this visit. Your story and saved work are unchanged.");
    }
  }

  function openTask(next: Task) {
    if (showingPreparedFilm) showStoryView("map");
    if (
      next === "compose" &&
      operation &&
      ["reserved", "delivered"].includes(operation.status)
    ) {
      setWorkspace((current) => ({
        ...current,
        selectedId: operation.quote.parentId,
        draftSourceId: operation.quote.parentId,
      }));
      setTask(operation.status === "reserved" ? "working" : "review");
      setMobileDetails(true);
      setNotice(
        "Your saved generation is ready to resume. Finish or discard it before starting another draft here.",
      );
      return;
    }
    if (
      next === "compose" &&
      draft.trim() &&
      workspace.draftSourceId &&
      workspace.draftSourceId !== selectedId
    ) {
      setDraftConflict({
        projectId,
        options: { momentId: selectedId, task: "create" },
        held: false,
      });
      return;
    }
    if (next === "compose") {
      setWorkspace((current) => ({
        ...current,
        draftSourceId: current.selectedId,
      }));
    }
    setTask(next);
    setError("");
    setMobileDetails(true);
  }
  function writeRoute(route: SocialRoute) {
    const hash = formatSocialRoute(route);
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    setSocialRoute(route);
    setMenu(false);
  }
  function showStoryView(next: "map" | "read" | "video" | "images-to-video") {
    if (next === "images-to-video" && !hasPreparedFilm) return;
    setView(next);
    setMobileDetails(false);
    writeRoute({ kind: "project", projectId, ...(next === "images-to-video" ? { view: next } : {}) });
  }
  function navigate(route: SocialRoute) {
    if (route.kind === "project") {
      openProject(route.projectId);
      return;
    }
    if (
      route.kind !== "desk" &&
      deskLeaveGuard.current &&
      !deskLeaveGuard.current()
    )
      return;
    const remembered = rememberWorkspaceDraft(workspaceRef.current);
    workspaceRef.current = remembered;
    setWorkspace(remembered);
    setDraftConflict(null);
    writeRoute(route);
    window.scrollTo({ top: 0 });
  }
  function openProject(
    id: string,
    options: OpenProjectOptions = {},
    replaceDraft = false,
  ) {
    if (deskLeaveGuard.current && !deskLeaveGuard.current()) return;
    const current = workspaceRef.current;
    const target = current.state.projects.find((item) => item.id === id);
    if (!target) {
      writeRoute({ kind: "project", projectId: id });
      return;
    }
    let next = switchWorkspaceContext(current, current.userId, id);
    const allowed = canAccessProject(next.state, next.userId, id);
    if (
      options.momentId &&
      !next.state.moments.some(
        (item) => item.id === options.momentId && item.projectId === id,
      )
    ) {
      setError(
        "That published moment is unavailable. Open the project and choose a moment from its map.",
      );
      return;
    }
    const held = next.state.operations.some(
      (item) =>
        item.id === next.operationId &&
        ["reserved", "delivered"].includes(item.status),
    );
    const changesSource =
      options.momentId !== undefined && options.momentId !== next.selectedId;
    const changesPrompt =
      options.prompt !== undefined && options.prompt !== next.draft;
    const createsAgain = options.task === "create" && held;
    if (
      allowed &&
      ((held && (changesSource || changesPrompt || createsAgain)) ||
        (!replaceDraft &&
          next.draft.trim() &&
          (changesSource || changesPrompt)))
    ) {
      setDraftConflict({ projectId: id, options, held });
      return;
    }
    if (allowed) {
      next = {
        ...next,
        selectedId: options.momentId ?? next.selectedId,
        draftSourceId:
          options.momentId ?? next.draftSourceId ?? next.selectedId,
        draft:
          options.prompt !== undefined
            ? options.prompt.slice(0, DEMO_LIMITS.maxPromptLength)
            : replaceDraft
              ? ""
              : next.draft,
        operationId: replaceDraft ? null : next.operationId,
        ideaId: options.ideaId ?? (replaceDraft ? undefined : next.ideaId),
      };
    }
    workspaceRef.current = next;
    setWorkspace(next);
    const nextTask = allowed
      ? options.task === "balance" || options.task === "members"
        ? options.task
        : options.task === "create"
          ? "compose"
          : options.task === "read"
            ? "detail"
            : resumedTask(next)
      : "detail";
    setTask(nextTask);
    setQuote(null);
    setThanks("");
    setDraftConflict(null);
    setMobileDetails(nextTask !== "detail");
    setView(options.task === "read" ? "read" : "map");
    writeRoute({ kind: "project", projectId: id });
  }
  function selectMoment(id: string) {
    setWorkspace((current) => ({ ...current, selectedId: id }));
    setTask("detail");
    setQuote(null);
    if (window.innerWidth < 820) setMobileDetails(true);
    setError("");
  }
  function switchProject(id: string) {
    openProject(id);
  }
  function switchUser(id: string) {
    if (deskLeaveGuard.current && !deskLeaveGuard.current()) return;
    const next = switchWorkspaceContext(
      workspaceRef.current,
      id,
      workspaceRef.current.projectId,
    );
    workspaceRef.current = next;
    setWorkspace(next);
    const nextTask = resumedTask(next);
    setTask(nextTask);
    setMobileDetails(nextTask !== "detail");
    setQuote(null);
    setThanks("");
    setDraftConflict(null);
    setError("");
  }
  function reviewQuote(event: FormEvent) {
    event.preventDefault();
    try {
      setQuote(
        getQuote(state, {
          userId,
          projectId,
          parentId: selected.id,
          prompt: draft,
        }),
      );
      openTask("quote");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  function authorize() {
    if (!quote) return;
    const next = update((current) => reserveFork(current, quote));
    if (next) {
      setWorkspace({
        ...workspace,
        state: next,
        operationId: `op-${quote.id}`,
        draftSourceId: quote.parentId,
      });
      openTask("working");
    }
  }
  function collect() {
    if (!operation) return;
    if (update((current) => deliverFork(current, operation.id)))
      openTask("review");
  }
  function settle(publish: boolean) {
    if (!operation) return;
    const next = update((current) =>
      publish
        ? publishFork(current, operation.id, thanks)
        : discardFork(current, operation.id),
    );
    if (next) {
      const done = next.operations.find((item) => item.id === operation.id)!;
      setWorkspace({
        ...workspace,
        state: next,
        selectedId: done.publishedMomentId ?? operation.quote.parentId,
        draft: "",
        draftSourceId: undefined,
      });
      setThanks("");
      openTask("receipt");
    }
  }
  function resume(item: ForkOperation) {
    setWorkspace({
      ...workspace,
      operationId: item.id,
      selectedId: item.quote.parentId,
      draft: item.quote.prompt,
      draftSourceId: item.quote.parentId,
    });
    openTask(item.status === "reserved" ? "working" : "review");
  }
  async function exportStory() {
    setExporting(true);
    setError("");
    try {
      const savedBranch = exportBranch(state, {
        userId,
        projectId,
        momentId: selected.id,
      });
      const branch = {
        ...savedBranch,
        moments: savedBranch.moments.map(moment => fandomMomentInStyle(projectId, moment, visualStyle?.id)),
      };
      const assets = [
        ...new Set(
          branch.moments.flatMap((moment) =>
            moment.panels
              .filter((panel) => isApprovedArtUrl(panel.imageUrl))
              .map((panel) => artAssetUrl(panel.imageUrl)),
          ),
        ),
      ];
      const [artwork, interfaceFont] = await Promise.all([
        Promise.all(
          assets.map(async (asset) => {
            const response = await fetch(asset);
            if (!response.ok)
              throw new Error(
                "The story artwork is unavailable. Try the download again.",
              );
            const blob = await response.blob();
            const data = await embeddedFile(blob);
            return [asset, data] as const;
          }),
        ).then(entries => Object.fromEntries(entries)),
        (async () => {
          const [font, license] = await Promise.all([fetch("/fonts/inter-latin.woff2"), fetch("/fonts/OFL.txt")]);
          if (!font.ok || !license.ok) throw new Error("The story font is unavailable. Try the download again.");
          const [dataUrl, text] = await Promise.all([
            font.arrayBuffer().then(bytes => embeddedFile(new Blob([bytes], { type: "font/woff2" }))),
            license.text(),
          ]);
          return { dataUrl, license: text };
        })(),
      ]);
      downloadFile(
        renderFinishedHtml(branch, artwork, interfaceFont),
        "text/html;charset=utf-8",
        `fork-night-${selected.id}.html`,
      );
      setNotice(
        "Your finished story is downloaded, with artwork and credits. No extra charge.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The export couldn’t finish. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  }
  function backup() {
    downloadFile(
      JSON.stringify(rememberWorkspaceDraft(workspace)),
      "application/json",
      "fork-night-current-work.json",
    );
  }
  function backupOriginal() {
    if (originalSave.current !== null)
      downloadFile(
        originalSave.current,
        "application/json",
        "fork-night-original-save.json",
      );
  }
  function reset() {
    if (deskLeaveGuard.current && !deskLeaveGuard.current()) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      setSaveError(null);
      setSaveFailure(null);
      originalSave.current = null;
      const next = initialWorkspace();
      workspaceRef.current = next;
      setWorkspace(next);
      setTask("detail");
      setQuote(null);
      setResetPending(false);
      setError("");
      setDraftConflict(null);
      writeRoute({ kind: "lobby" });
      setNotice(
        "The sample stories and balances have been restored. Guild ideas are kept separately.",
      );
    } catch {
      setSaveFailure("write");
      setSaveError(
        "Storage is unavailable. Download your current work before trying again in a browser with storage enabled.",
      );
    }
  }

  const back = (
    <button className="text-button back" onClick={() => openTask("detail")}>
      <ArrowLeft size={16} /> Back to the moment
    </button>
  );
  // Each view has its own icon; the button that is on says so with aria-pressed, like the one for the prepared film always did.
  const storyViews: { id: "map" | "read" | "video" | "images-to-video"; label: ReactNode; icon: LucideIcon; pressed: boolean }[] = [
    { id: "map", label: "Story map", icon: GitBranch, pressed: view === "map" && !mobileDetails },
    { id: "read", label: "Read this path", icon: BookOpen, pressed: view === "read" && !mobileDetails },
    { id: "video", label: "Make a video", icon: Clapperboard, pressed: view === "video" },
    ...(hasPreparedFilm ? [{ id: "images-to-video" as const, label: <>Images <ToArrow />video</>, icon: Film, pressed: showingPreparedFilm }] : []),
  ];

  return (
    <div
      className={inProject ? "app-shell" : "social-root"}
    >
      {inProject && (
        <>
          <a
            className="skip-link"
            href="#story-workspace"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById("story-workspace")?.focus();
            }}
          >
            Skip to your story
          </a>
          <AppHeader current="spaces" onLocalNavigate={navigate} tone={roomSkin === "neon" ? "night" : undefined}>
            <label className="user-switch workspace-user-switch">
              <span className="avatar" style={{ backgroundColor: user.color }}>{user.initials}</span>
              <select aria-label="Preview as collaborator" value={userId} onChange={event => switchUser(event.target.value)}>
                {state.users.filter(item => !item.agent).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>
          </AppHeader>
        </>
      )}
      <StoryRoomShell active={inProject} skin={roomSkin}>
      {inProject && (
        <>
          <div className="story-room-toolbar" role="group" aria-label="Story workspace tools">
            <div className="project-navigation">
              <button
                className={`nav-button ${menu ? "active" : ""}`}
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                Your stories <ChevronDown size={15} />
              </button>
              {menu && (
                <div className="project-menu">
                  <p>Pick up a story</p>
                  {visibleProjects.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => switchProject(item.id)}
                    >
                      <StoryArt
                        src={fandomImageInStyle(item.id, item.coverUrl, artDirections[item.id])}
                        description={`${item.title}, story illustration`}
                      />
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.visibility === "open"
                            ? "Open project"
                            : (state.groups.find(
                                (entry) => entry.id === item.groupId,
                              )?.name ?? "Invite-only project")}
                        </small>
                      </span>
                      {item.id === projectId && <Check size={17} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <a className="button primary" href="/pilot">Make a story together</a>
            {account && (
              <button
                className="balance-button"
                onClick={() => openTask("balance")}
              >
                <Wallet size={17} aria-hidden="true" />
                <span>{formatCredits(account.available)}</span>
                <span> credits</span>
                <Plus size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="demo-strip" role="region" aria-label="Local preview">
            <span className="demo-strip-text">
              <Chip>Local preview</Chip>{" "}
              Prepared stories · simulated generation and credits · saved
              in this browser
            </span>
            <button
              type="button"
              onClick={() => setShowInfo(!showInfo)}
              aria-expanded={showInfo}
              aria-label="How this preview works"
            >
              <CircleHelp size={16} aria-hidden="true" />
              <span>How this preview works</span>
            </button>
          </div>
        </>
      )}
      {showInfo && (
        <section className="preview-explanation">
          <h2>A working rehearsal for the real thing.</h2>
          <p>
            Switch collaborators to try the shared story. Forking reserves
            sample credits, delivers a pre-made candidate, then settles when you
            publish or discard. Everything is stored on this device.
          </p>
          <p>
            There is no live AI, wallet, blockchain transaction, or secure
            private storage yet. Use fictional content here. The image
            experiment runner is a separate tool.
          </p>
          <div className="button-row">
            <button className="button secondary" onClick={backup}>
              <Download size={15} /> Back up this preview
            </button>
            <button
              className="text-button"
              onClick={() => setResetPending(true)}
            >
              <RotateCcw size={15} /> Reset sample data
            </button>
          </div>
          {resetPending && (
            <div className="inline-confirm">
              <p>
                Reset the local stories, drafts and simulated balances? This
                replaces your story changes in this browser. Saved guild and
                clubhouse ideas are kept separately.
              </p>
              <button className="button danger" onClick={reset}>
                Reset local preview
              </button>
              <button
                className="button secondary"
                onClick={() => setResetPending(false)}
              >
                Keep my work
              </button>
            </div>
          )}
        </section>
      )}
      {saveError && (
        <div className="save-warning" role="alert">
          <span>{saveError}</span>
          {saveFailure === "read" && originalSave.current !== null && (
            <button onClick={backupOriginal}>Download original save</button>
          )}
          <button onClick={backup}>Download current work</button>
          <button
            onClick={() => {
              setShowInfo(true);
              setResetPending(true);
            }}
          >
            Review reset
          </button>
        </div>
      )}
      {error && (
        <div className="workspace-alert error-message" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {draftConflict && (
        <section
          className="draft-switch-notice"
          aria-label="Keep your existing draft"
        >
          <h2 ref={conflictHeading} tabIndex={-1}>
            {draftConflict.held
              ? "Your generation is still saved."
              : "You already have an unfinished draft here."}
          </h2>
          <p>
            {draftConflict.held
              ? "Finish or discard that generation before creating a different draft in this project. Its reservation and original starting point remain intact."
              : "Starting from this idea would replace your unsubmitted prompt and starting point in this project. Your existing draft is unchanged until you choose."}
          </p>
          <div className="button-row">
            <button
              className="button primary"
              onClick={() => openProject(draftConflict.projectId)}
            >
              Return to your saved draft
            </button>
            {!draftConflict.held && (
              <button
                className="button secondary"
                onClick={() =>
                  openProject(
                    draftConflict.projectId,
                    draftConflict.options,
                    true,
                  )
                }
              >
                Replace unsubmitted idea
              </button>
            )}
            <button
              className="text-button"
              onClick={() => setDraftConflict(null)}
            >
              Keep everything as it is
            </button>
          </div>
        </section>
      )}

      {inProject ? (
        <main id="story-workspace" tabIndex={-1}>
          <section className="project-heading">
            <div className="project-heading-main">
              <h1>
                {mayNameProject ? project.title : "Project unavailable"}
                <span className="title-period">.</span>
              </h1>
              <div className="project-meta" data-stack={mayNameProject && project.visibility === "open" ? undefined : "true"}>
                <span>
                  {mayNameProject && project.visibility === "open" ? (
                    <Globe2 size={14} />
                  ) : (
                    <LockKeyhole size={14} />
                  )}
                  {mayNameProject && project.visibility === "open"
                    ? "Open story"
                    : "Invite-only project"}
                </span>
                <span className="dot-separator" />
                {mayNameProject && project.visibility === "open"
                  ? "Everyone can make a version"
                  : "A private workspace, with shareable finished stories"}
              </div>
              {mayNameProject && fanStory && (
                <BrandStrip label="Story origin and style" className="project-tags">
                  <Chip icon={BookOpen}>{fanStory.original ? fanStory.fandom : `Unofficial fan story · ${fanStory.fandom}`}</Chip>
                  <Chip icon={Palette}>{visualStyle?.label ?? fanStory.artStyle}</Chip>
                </BrandStrip>
              )}
              <p className="project-description">
                {mayNameProject
                  ? project.description
                  : "This project is unavailable to this sample collaborator."}
              </p>
              {mayNameProject && projectId === "kessler-night-shift" && <div className="project-actions">
                <a className="button secondary" href="/pilot?room=kessler-ward">Join the shared Kessler Ward room <ArrowUpRight size={17} aria-hidden="true" /></a>
                <small>This prepared preview stays in your browser. Make new scenes together in the shared room.</small>
              </div>}
            </div>
            {accessible && (
              <div className="collaborators">
                <div className="avatar-stack">
                  {state.users
                    .filter((person) =>
                      state.moments.some(
                        (moment) =>
                          moment.projectId === projectId &&
                          moment.authorId === person.id,
                      ),
                    )
                    .map((item) => (
                      <span
                        key={item.id}
                        className="avatar"
                        style={{ backgroundColor: item.color }}
                        title={`${item.name}, sample collaborator`}
                      >
                        {item.initials}
                        {item.agent && <Sparkles className="avatar-agent-mark" size={11} aria-hidden="true" />}
                      </span>
                    ))}
                </div>
                <span>Made together</span>
                {group && accessible && (
                  <button
                    className="icon-button"
                    aria-label="Group members and limits"
                    onClick={() => openTask("members")}
                  >
                    <Settings2 size={17} />
                  </button>
                )}
              </div>
            )}
          </section>

          {!accessible ? (
            <SectionPlate
              className="join-project"
              icon={Users}
              title={invited ? "There’s a place for you here." : "This story belongs to a friend group."}
              description={
                <>
                  <p>
                    {invited
                      ? `${group?.name ?? "This group"} invited you to make something together. Before you enter, here’s what sharing means.`
                      : "You don’t currently have access. Switch to an invited sample collaborator to try the group flow."}
                  </p>
                  {invited && (
                    <>
                      <ul>
                        <li>
                          Your unpublished drafts and prompts stay yours. The member
                          list stays inside this group.
                        </li>
                        <li>
                          Members may publish finished branches externally,
                          including credited contributions.
                        </li>
                        <li>
                          New moments spend shared credits within your personal
                          group allowance.
                        </li>
                      </ul>
                      <p className="fine-print">
                        Sample terms {group?.termsVersion}. This local preview does
                        not provide real privacy.
                      </p>
                    </>
                  )}
                </>
              }
              action={
                <>
                  {invited && (
                    <button
                      className="button primary"
                      onClick={() =>
                        update(
                          (current) =>
                            acceptGroupTerms(current, {
                              userId,
                              groupId: project.groupId!,
                            }),
                          "You joined the sample group and accepted its finished-work sharing terms.",
                        )
                      }
                    >
                      Agree & join the story <ArrowRight size={17} />
                    </button>
                  )}
                  <button
                    className="button secondary"
                    onClick={() => navigate({ kind: "lobby" })}
                  >
                    Explore open projects
                  </button>
                </>
              }
            />
          ) : (
            <>
              {hasPreparedFilm && !showingPreparedFilm && <PreparedFilmInvite film={preparedFilm} onOpen={() => showStoryView("images-to-video")} />}
              {fanStory?.visualStyles && (
                <div className="workspace-art-direction">
                  <FandomArtDirection projectId={projectId} value={visualStyle?.id} onChange={changeArtDirection} />
                </div>
              )}
              <div className={`workspace-toolbar ${hasPreparedFilm ? "fn-film-toolbar" : ""}`}>
                <div className="fn-segments" role="group" aria-label="Story view">
                  {storyViews.map(({ id, label, icon: Icon, pressed }) => (
                    <button key={id} type="button" aria-pressed={pressed} onClick={() => showStoryView(id)}>
                      <Icon size={16} aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <span className="toolbar-hint">
                  {showingPreparedFilm ? "Prepared four-image example" : <><Layers3 size={15} /> {path.length} moment{path.length === 1 ? "" : "s"} in your selected path</>}
                </span>
                {!showingPreparedFilm && <button
                  className="text-button export-top"
                  onClick={exportStory}
                  disabled={exporting}
                >
                  <ArrowDownToLine size={16} />{" "}
                  {exporting ? "Preparing…" : "Export story"}
                </button>}
              </div>
              <div
                className={`workspace ${showingPreparedFilm ? "fn-film-workspace" : ""} ${mobileDetails ? "mobile-details" : ""}`}
              >
                <div className="main-pane">
                  {showingPreparedFilm ? <PreparedStoryFilm film={preparedFilm} /> : view === "map" ? (
                    <StoryMap
                      state={presentedState}
                      project={project}
                      selected={presentedSelected}
                      onSelect={selectMoment}
                    />
                  ) : view === "video" ? (
                    <div className="story-video-pane"><StoryFilm key={`${project.id}:${selected.id}:${visualStyle?.id ?? "saved"}:${path.map(moment => moment.version).join(":")}`} plan={makeFilmPlan(visualStyle ? `${project.title} · ${visualStyle.label}` : project.title, presentedPath.map(moment => ({ id: moment.id, title: moment.title, maker: state.users.find(person => person.id === moment.authorId)?.name ?? "Unknown maker", version: moment.version, panels: moment.panels })))} /></div>
                  ) : (
                    <div className="story-reader">
                      <div className="reader-intro">
                        <BookOpen size={21} />
                        <p>
                          One path, read from the beginning.
                          <br />
                          <span>Other endings stay on their own branches.</span>
                        </p>
                      </div>
                      {presentedPath.map((moment, index) => {
                        const maker = state.users.find((item) => item.id === moment.authorId);
                        return (
                        <article key={moment.id} className="reader-moment">
                          <div className="reader-title">
                            <span className="sequence-number">{index + 1}</span>
                            <div>
                              <h2>{moment.title}</h2>
                              <p>
                                by{" "}
                                {maker && <MakerName name={maker.name} agent={maker.agent} />}
                              </p>
                            </div>
                          </div>
                          <StoryPanels panels={moment.panels} />
                          {moment.builtOnThanks && (
                            <p className="thank-you">
                              “{moment.builtOnThanks}”
                            </p>
                          )}
                          <button
                            className="text-button"
                            onClick={() => {
                              openProject(projectId, {
                                momentId: moment.id,
                                task: "create",
                              });
                            }}
                          >
                            Make a version from here <ArrowUpRight size={15} />
                          </button>
                        </article>
                        );
                      })}
                      <button
                        className="button primary"
                        onClick={exportStory}
                        disabled={exporting}
                      >
                        <Download size={17} />{" "}
                        {exporting
                          ? "Preparing your story…"
                          : "Download finished story"}
                      </button>
                    </div>
                  )}
                </div>

                {!showingPreparedFilm && <aside
                  className="inspector"
                  aria-label="Selected moment and creation workspace"
                >
                  <button
                    className="text-button mobile-only back"
                    onClick={() => setMobileDetails(false)}
                  >
                    <ArrowLeft size={16} /> Back to{" "}
                    {view === "map" ? "the map" : "reading"}
                  </button>
                  {task === "detail" && (
                    <>
                      <StoryArt
                        src={presentedSelected.panels[0].imageUrl}
                        description={selected.panels[0].caption}
                        className="selected-art"
                      />
                      <div className="detail-heading">
                        <h2 ref={taskHeading} tabIndex={-1}>
                          {selected.title}
                        </h2>
                        <span className="author-inline">
                          <span
                            className="avatar small"
                            style={{ backgroundColor: author.color }}
                          >
                            {author.initials}
                          </span>
                          Made by <MakerName name={author.name} agent={author.agent} />
                          <Chip className="version-chip">v{selected.version}</Chip>
                        </span>
                      </div>
                      <p className="selected-caption">
                        {selected.panels[0].caption}
                      </p>
                      {selected.builtOnThanks && (
                        <p className="thank-you">“{selected.builtOnThanks}”</p>
                      )}
                      <div className="inherited-work">
                        <div className="section-title">
                          <h3>Built on their imagination</h3>
                          <span>
                            {path.length} credit{path.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        {path.map((item) => {
                          const maker = state.users.find((u) => u.id === item.authorId);
                          return (
                          <div className="credit-row" key={item.id}>
                            <span>
                              {maker && <MakerName name={maker.name} agent={maker.agent} />}
                              <small>
                                {item.parentId ? item.title : "The opening"}
                              </small>
                            </span>
                            <span>
                              {project.visibility === "open"
                                ? <Credits amount={demoReuseFee(item)} />
                                : "Shared"}
                            </span>
                          </div>
                          );
                        })}
                        <div className="total-row">
                          <span>To build on this path</span>
                          <Credits amount={upstream} />
                        </div>
                        <p className="fine-print">
                          {project.visibility === "open"
                            ? "Paid to these makers when you publish. New generation is quoted separately."
                            : "No internal maker fees. Your group shares generation costs and keeps the credits."}
                        </p>
                      </div>
                      {hasPreparedFilm && selected.id === preparedFilm?.lastSceneId && (
                        <button
                          className="button primary full"
                          onClick={() => {
                            showStoryView("images-to-video");
                            requestAnimationFrame(() => document.querySelector(".fn-film-demo")?.scrollIntoView({ block: "start" }));
                          }}
                        >
                          <Film size={18} /> Turn these {preparedFilm.pathScenes} scenes into a video{" "}
                          <ArrowRight size={17} />
                        </button>
                      )}
                      {(BLADE_RUNNER_RESTYLE.momentIds as readonly string[]).includes(selected.id) && (
                        <PreparedRestyle
                          scenes={restyleScenes}
                          applied={restyleApplied}
                          onApply={() => setRestyleApplied(true)}
                          onRestore={() => setRestyleApplied(false)}
                        />
                      )}
                      <button
                        className={`button ${hasPreparedFilm && selected.id === preparedFilm?.lastSceneId ? "secondary" : "primary"} full`}
                        onClick={() => openTask("compose")}
                      >
                        <GitBranch size={18} /> Make a version from here{" "}
                        <ArrowRight size={17} />
                      </button>
                      <button
                        className="button secondary full"
                        onClick={() => {
                          setView("read");
                          setMobileDetails(false);
                        }}
                      >
                        <BookOpen size={17} /> Read the whole path
                      </button>
                      <p className="fine-print centered">
                        Looking around is always free.
                      </p>
                      {(pending.length > 0 || draft.trim()) && (
                        <div className="saved-drafts">
                          <h3>Your saved work</h3>
                          {draft.trim() &&
                            !(
                              operation &&
                              ["reserved", "delivered"].includes(
                                operation.status,
                              )
                            ) && (
                              <button onClick={() => openProject(projectId)}>
                                <span>
                                  Resume your unsubmitted idea
                                  <small>
                                    {state.moments.find(
                                      (item) =>
                                        item.id === workspace.draftSourceId,
                                    )?.title ?? selected.title}
                                  </small>
                                </span>
                                <ChevronRight size={17} />
                              </button>
                            )}
                          {pending.map((item) => (
                            <button key={item.id} onClick={() => resume(item)}>
                              <span>
                                {item.status === "reserved"
                                  ? "Generation reserved"
                                  : "Draft ready to review"}
                                <small>
                                  {
                                    state.moments.find(
                                      (m) => m.id === item.quote.parentId,
                                    )?.title
                                  }
                                </small>
                              </span>
                              <ChevronRight size={17} />
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {task === "compose" && (
                    <>
                      {back}
                      <h2 ref={taskHeading} tabIndex={-1}>
                        What happens next?
                      </h2>
                      <p className="muted">
                        Your version starts after{" "}
                        <strong>{selected.title}</strong>.
                      </p>
                      <div className="source-preview">
                        <StoryArt
                          src={presentedSelected.panels[0].imageUrl}
                          description={selected.panels[0].caption}
                        />
                        <div>
                          <strong>
                            {path.length} moment{path.length === 1 ? "" : "s"}{" "}
                            inherited
                          </strong>
                          <span>Story, characters, approved references</span>
                        </div>
                      </div>
                      <details className="context-details">
                        <summary>Read the context that travels</summary>
                        {path.map((item) => (
                          <p key={item.id}>
                            <strong>{item.title}</strong>
                            <br />
                            {item.storyContext}
                          </p>
                        ))}
                      </details>
                      <form onSubmit={reviewQuote}>
                        <label className="field-label" htmlFor="continuation">
                          Your next moment
                        </label>
                        <textarea
                          id="continuation"
                          value={draft}
                          onChange={(event) =>
                            setWorkspace({
                              ...workspace,
                              draft: event.target.value,
                              draftSourceId: selectedId,
                            })
                          }
                          placeholder={fanStory ? "What choice should they make next?" : "What if the signal isn’t coming from the sea, but from tomorrow?"}
                          maxLength={DEMO_LIMITS.maxPromptLength}
                          minLength={3}
                          rows={6}
                          required
                        />
                        <p className="fine-print">
                          {fanStory
                            ? "Saved in this browser as you type. This prepared example reuses your selected illustration with an authored continuation."
                            : "Saved in this browser as you type. Find it under Your drafts when you return. Two panels with captions; sample artwork is used in this preview."}
                        </p>
                        <div className="output-format">
                          <Layers3 size={18} />
                          <span>{fanStory ? "Prepared one-panel continuation" : "Two-panel comic"}</span>
                          <span>Images first</span>
                        </div>
                        <button
                          className="button primary full"
                          type="submit"
                          disabled={draft.trim().length < 3}
                        >
                          Review the quote <ArrowRight size={17} />
                        </button>
                      </form>
                    </>
                  )}

                  {task === "quote" && quote && (
                    <>
                      <button
                        className="text-button back"
                        onClick={() => openTask("compose")}
                      >
                        <ArrowLeft size={16} /> Edit your idea
                      </button>
                      <h2 ref={taskHeading} tabIndex={-1}>
                        A little clarity before creating.
                      </h2>
                      <p className="muted">
                        A fixed ceiling. No surprise spending.
                      </p>
                      <div className="quote-idea">
                        <p>{quote.prompt}</p>
                        <small>
                          From{" "}
                          {
                            state.moments.find(
                              (item) => item.id === quote.parentId,
                            )?.title
                          }
                        </small>
                      </div>
                      <div className="quote-lines">
                        <div>
                          <span>Inherited work</span>
                          <Credits amount={quote.upstreamTotal} />
                        </div>
                        <div>
                          <span>New generation, at most</span>
                          <Credits amount={quote.generationMax} />
                        </div>
                        <div className="quote-total">
                          <strong>Reserve up to</strong>
                          <Credits amount={quote.totalMax} />
                        </div>
                      </div>
                      <div className="funding-source">
                        {account?.kind === "group" ? (
                          <Users size={20} />
                        ) : (
                          <Wallet size={20} />
                        )}
                        <span>
                          <strong>
                            {account?.kind === "group"
                              ? `${group?.name} cartridge`
                              : `${user.name}’s own credits`}
                          </strong>
                          <small>
                            {formatCredits(account?.available ?? 0)} credits
                            available
                          </small>
                        </span>
                      </div>
                      <ul className="quote-promises">
                        <li>
                          <ShieldCheck size={16} /> Unused credits return to
                          this balance.
                        </li>
                        <li>
                          <Check size={16} /> Inherited fees settle only on
                          publish.
                        </li>
                        <li>
                          <Check size={16} /> A delivered draft costs credits
                          even if discarded.
                        </li>
                      </ul>
                      <p className="fine-print">
                        Quote expires{" "}
                        {new Date(quote.expiresAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        . No real money, API calls or network fees in this
                        preview.
                      </p>
                      {account && account.available < quote.totalMax ? (
                        <>
                          <p className="error-message">
                            {account.kind === "group"
                              ? "This cartridge needs a recharge. Your own credits will not be charged."
                              : "Your own credits need a top-up."}
                          </p>
                          <button
                            className="button primary full"
                            onClick={() => openTask("balance")}
                          >
                            {account.kind === "group"
                              ? "Recharge the group"
                              : "Add sample credits"}
                          </button>
                        </>
                      ) : (
                        <button
                          className="button primary full"
                          onClick={authorize}
                        >
                          Reserve {formatCredits(quote.totalMax)} & create{" "}
                          <ArrowRight size={17} />
                        </button>
                      )}
                    </>
                  )}

                  {task === "working" && operation && (
                    <>
                      <div className="status-symbol">
                        <Layers3 size={30} />
                      </div>
                      <h2 ref={taskHeading} tabIndex={-1}>
                        Your next moment is reserved.
                      </h2>
                      <p>
                        We’ve held <Credits amount={operation.quote.totalMax} />{" "}
                        in{" "}
                        {account?.kind === "group"
                          ? "the group cartridge"
                          : "your own credits"}
                        .
                      </p>
                      <ol className="operation-steps">
                        <li className="complete">
                          <Check size={16} />
                          <span>Starting point and context saved</span>
                        </li>
                        <li className="complete">
                          <Check size={16} />
                          <span>Sample credits reserved</span>
                        </li>
                        <li>
                          <Layers3 size={16} />
                          <span>Collect the sample candidate</span>
                        </li>
                      </ol>
                      <p className="fine-print">
                        The deterministic provider is ready. Collecting again or
                        refreshing this page won’t create another reservation.
                      </p>
                      <button className="button primary full" onClick={collect}>
                        Collect sample draft <ArrowRight size={17} />
                      </button>
                      <p className="fine-print centered">
                        You can return to this job after a refresh.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => openTask("detail")}
                      >
                        Keep exploring while it’s saved
                      </button>
                    </>
                  )}

                  {task === "review" && operation?.candidate && (
                    <>
                      <span className="status-tag">
                        <CheckCheck size={15} /> Draft delivered
                      </span>
                      <h2 ref={taskHeading} tabIndex={-1}>
                        A new turn in the story.
                      </h2>
                      <StoryPanels panels={fandomMomentInStyle(projectId, operation.candidate, visualStyle?.id).panels} />
                      <div className="quote-lines">
                        <div>
                          <span>Delivered generation</span>
                          <Credits amount={operation.generationActual ?? 0} />
                        </div>
                        <div>
                          <span>Inherited work on publish</span>
                          <Credits amount={operation.quote.upstreamTotal} />
                        </div>
                        <div className="quote-total">
                          <strong>Total if published</strong>
                          <Credits
                            amount={
                              (operation.generationActual ?? 0) +
                              operation.quote.upstreamTotal
                            }
                          />
                        </div>
                      </div>
                      <label className="field-label" htmlFor="thank-you">
                        Leave a little credit in your own words
                      </label>
                      <input
                        id="thank-you"
                        value={thanks}
                        maxLength={240}
                        onChange={(event) => setThanks(event.target.value)}
                        placeholder={fanStory ? "Thanks for the choice that led here." : "Thanks, Priya, for the light that answered."}
                      />
                      <p className="fine-print">
                        Your published moment will keep its ancestry and maker
                        credits. {fanStory
                          ? "The illustration is reused from your starting point; the continuation is a prepared example."
                          : "This preview uses the same pre-made candidate for repeatable tests."}
                      </p>
                      <button
                        className="button primary full"
                        onClick={() => settle(true)}
                      >
                        <Send size={17} /> Publish this moment
                      </button>
                      <button
                        className="button subtle full"
                        onClick={() => settle(false)}
                      >
                        <Trash2 size={16} /> Discard · pay{" "}
                        {formatCredits(operation.generationActual ?? 0)}
                      </button>
                    </>
                  )}

                  {task === "receipt" && operation && (
                    <>
                      <div className="status-symbol">
                        <Check size={33} />
                      </div>
                      <h2 ref={taskHeading} tabIndex={-1}>
                        {operation.status === "published"
                          ? "Your turn became part of it."
                          : "Room for another idea."}
                      </h2>
                      <p>
                        {operation.status === "published"
                          ? "A new moment, built on the work that came before. Your branch is ready to read and share."
                          : "Your draft wasn’t published. Delivered generation was charged, and the remaining reservation is available again."}
                      </p>
                      <div className="quote-lines">
                        <div>
                          <span>Sample credits settled</span>
                          <Credits amount={operation.settledAmount ?? 0} />
                        </div>
                        <div>
                          <span>Released to original balance</span>
                          <Credits amount={operation.releasedAmount ?? 0} />
                        </div>
                        <div>
                          <span>Available now</span>
                          <Credits amount={account?.available ?? 0} />
                        </div>
                      </div>
                      <p className="fine-print">
                        Local simulated settlement · recorded once
                      </p>
                      <button
                        className="button primary full"
                        onClick={() => {
                          setTask("detail");
                          setMobileDetails(false);
                          setView("map");
                        }}
                      >
                        Return to the story <ArrowUpRight size={17} />
                      </button>
                      {operation.status === "published" && (
                        <button
                          className="button secondary full"
                          onClick={exportStory}
                          disabled={exporting}
                        >
                          <Download size={16} /> Download this finished branch
                        </button>
                      )}
                    </>
                  )}

                  {task === "balance" && account && (
                    <>
                      {back}
                      <h2 ref={taskHeading} tabIndex={-1}>
                        {account.kind === "group"
                          ? "More stories in the tank."
                          : "Your next idea has a place."}
                      </h2>
                      <p className="muted">
                        {account.kind === "group"
                          ? `A shared cartridge for ${group?.name ?? "your group"}.`
                          : "Your own credits, for all open projects."}
                      </p>
                      {account.kind === "group" ? (
                        <Cartridge
                          name={group!.name}
                          available={account.available}
                          reserved={account.reserved}
                          spent={account.spent}
                          capacity={group!.cartridgeCapacity}
                        />
                      ) : (
                        <div className="personal-balance">
                          <Wallet size={27} />
                          <span>Available to create</span>
                          <strong>
                            {formatCredits(account.available)}
                            <small> credits</small>
                          </strong>
                        </div>
                      )}
                      <div className="balance-breakdown">
                        <div>
                          <span>Available</span>
                          <strong>{formatCredits(account.available)}</strong>
                        </div>
                        <div>
                          <span>Reserved</span>
                          <strong>{formatCredits(account.reserved)}</strong>
                        </div>
                        <div>
                          <span>Spent</span>
                          <strong>{formatCredits(account.spent)}</strong>
                        </div>
                      </div>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          try {
                            update(
                              (current) =>
                                topUp(current, {
                                  userId,
                                  projectId,
                                  amount: parseCredits(amount),
                                  requestId: crypto.randomUUID(),
                                }),
                              "Sample credits added. No real deposit was made.",
                            );
                          } catch (reason) {
                            setError((reason as Error).message);
                          }
                        }}
                      >
                        <label className="field-label" htmlFor="top-up-amount">
                          Add sample credits
                        </label>
                        <div className="amount-input">
                          <input
                            id="top-up-amount"
                            inputMode="decimal"
                            value={amount}
                            onChange={(event) => setAmount(event.target.value)}
                            required
                          />
                          <button className="button primary" type="submit">
                            <Plus size={16} />{" "}
                            {account.kind === "group" ? "Recharge" : "Top up"}
                          </button>
                        </div>
                      </form>
                      {account.kind === "personal" ? (
                        <>
                          <button
                            className="button secondary full"
                            onClick={() => {
                              try {
                                update(
                                  (current) =>
                                    withdraw(current, {
                                      userId,
                                      amount: parseCredits(amount),
                                      requestId: crypto.randomUUID(),
                                    }),
                                  "Available sample credits withdrawn. Reserved credits stayed in place.",
                                );
                              } catch (reason) {
                                setError((reason as Error).message);
                              }
                            }}
                          >
                            <ArrowUpRight size={16} /> Withdraw the entered
                            amount
                          </button>
                          <p className="fine-print">
                            Only available credits can be withdrawn. This is a
                            simulation; no wallet transaction occurs.
                          </p>
                        </>
                      ) : (
                        <p className="fine-print">
                          Recharge supports the group; it doesn’t buy
                          authorship, increase your allowance, or create a
                          personal withdrawal right.
                        </p>
                      )}
                      {account.kind === "personal" && (
                        <div className="maker-rewards">
                          <h3>Your work was built on</h3>
                          <p>
                            <Credits amount={state.claims[userId] ?? 0} /> in
                            simulated maker rewards.
                          </p>
                          <p className="fine-print">
                            Unclaimed rewards are tracked separately from your
                            spendable balance. Claim transactions are not
                            connected yet.
                          </p>
                        </div>
                      )}
                      <h3 className="ledger-heading">Recent activity</h3>
                      <div className="ledger">
                        {state.ledger
                          .filter((entry) => entry.accountId === account.id)
                          .slice(-5)
                          .reverse()
                          .map((entry) => (
                            <div key={entry.id}>
                              <span>{entry.description}</span>
                              <strong>{formatCredits(entry.amount)}</strong>
                            </div>
                          ))}
                      </div>
                    </>
                  )}

                  {task === "members" && group && (
                    <>
                      {back}
                      <h2 ref={taskHeading} tabIndex={-1}>
                        Made with your people.
                      </h2>
                      <p className="muted">
                        {group.name} · shared credits, individual limits
                      </p>
                      {state.memberships
                        .filter((item) => item.groupId === group.id)
                        .map((member) => {
                          const person = state.users.find(
                            (item) => item.id === member.userId,
                          )!;
                          const hasUnfinishedWork = state.operations.some(
                            (item) =>
                              item.quote.userId === member.userId &&
                              state.projects.find(
                                (p) => p.id === item.quote.projectId,
                              )?.groupId === group.id &&
                              ["reserved", "delivered"].includes(item.status),
                          );
                          return (
                            <div className="member-row" key={member.userId}>
                              <span
                                className="avatar"
                                style={{ backgroundColor: person.color }}
                              >
                                {person.initials}
                              </span>
                              <div>
                                <strong>{person.name}</strong>
                                <small>
                                  {member.role} · {member.status}
                                </small>
                                <span>
                                  Allowance{" "}
                                  {formatCredits(member.spendingLimit)} · spent{" "}
                                  {formatCredits(member.spent)}
                                </span>
                              </div>
                              {group.adminId === userId &&
                                member.userId !== userId &&
                                member.status !== "removed" && (
                                  <div className="member-actions">
                                    <button
                                      className="text-button"
                                      onClick={() =>
                                        update(
                                          (current) =>
                                            setMemberLimit(current, {
                                              actorId: userId,
                                              groupId: group.id,
                                              userId: member.userId,
                                              limit:
                                                member.spendingLimit +
                                                1_000_000,
                                            }),
                                          `${person.name}’s sample allowance increased by 1 credit.`,
                                        )
                                      }
                                    >
                                      Add 1 to limit
                                    </button>
                                    <button
                                      className="text-button muted"
                                      disabled={hasUnfinishedWork}
                                      aria-describedby={
                                        hasUnfinishedWork
                                          ? `member-pending-${member.userId}`
                                          : undefined
                                      }
                                      onClick={() =>
                                        update(
                                          (current) =>
                                            removeMember(current, {
                                              actorId: userId,
                                              groupId: group.id,
                                              userId: member.userId,
                                            }),
                                          `${person.name} can no longer access or start work in the sample group.`,
                                        )
                                      }
                                    >
                                      Remove member
                                    </button>
                                    {hasUnfinishedWork && (
                                      <p
                                        id={`member-pending-${member.userId}`}
                                        className="fine-print"
                                      >
                                        Finish or discard {person.name}’s saved
                                        sample work before removal. This preview
                                        keeps outstanding holds intact.
                                      </p>
                                    )}
                                  </div>
                                )}
                            </div>
                          );
                        })}
                      <div className="terms-note">
                        <ShieldCheck size={20} />
                        <p>
                          Members agree once to external publication of finished
                          branches. Drafts, prompts and the member list stay
                          outside exports.
                        </p>
                      </div>
                      <p className="fine-print">
                        Membership here is a local fixture. Real access control
                        and private media delivery still need the Supabase
                        integration proof.
                      </p>
                    </>
                  )}
                </aside>}
              </div>
            </>
          )}
        </main>
      ) : (
        <SocialSpaces
          onDeskLeaveGuardChange={(guard) => {
            deskLeaveGuard.current = guard;
          }}
          demo={state}
          artDirections={artDirections}
          onArtDirectionChange={changeArtDirection}
          userId={userId}
          loaded={loaded}
          route={socialRoute}
          navigate={navigate}
          onUserChange={switchUser}
          onOpenProject={openProject}
          onUpdateDemo={update}
          drafts={unfinishedDrafts(workspace).filter(
            (item) =>
              item.userId === userId &&
              canAccessProject(state, userId, item.projectId),
          )}
        />
      )}
      {inProject && (
        <footer className="app-footer">
          <span>
            <GitBranch size={14} /> A story is better with another point of
            view.
          </span>
          <span>Fork Night · local prototype</span>
        </footer>
      )}
      </StoryRoomShell>
      {notice && (
        <div className="notice" role="status">
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

function StoryPanels({ panels }: { panels: Panel[] }) {
  return (
    <div className="panel-pair">
      {panels.map((panel, index) => (
        <figure key={index}>
          <StoryArt src={panel.imageUrl} description={panel.caption} />
          <figcaption>{panel.caption}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function Cartridge({
  name,
  available,
  reserved,
  spent,
  capacity,
}: {
  name: string;
  available: number;
  reserved: number;
  spent: number;
  capacity: number;
}) {
  const reference = Math.max(capacity, available + reserved + spent);
  return (
    <div className="cartridge">
      <div className="cartridge-top">
        <span>STORY FUEL</span>
        <GitBranch size={22} />
      </div>
      <div className="cartridge-label">
        <span>{name}</span>
        <strong>
          {formatCredits(available)}
          <small> ready to use</small>
        </strong>
        <div
          className="cartridge-gauge"
          role="img"
          aria-label={`${formatCredits(available)} available, ${formatCredits(reserved)} reserved, ${formatCredits(spent)} spent out of ${formatCredits(reference)} credits shown`}
        >
          <span
            className="gauge-available"
            style={{ width: `${(available / reference) * 100}%` }}
          />
          <span
            className="gauge-reserved"
            style={{ width: `${(reserved / reference) * 100}%` }}
          />
          <span
            className="gauge-spent"
            style={{ width: `${(spent / reference) * 100}%` }}
          />
        </div>
        <small>Scale: {formatCredits(reference)} sample credits</small>
      </div>
      <div className="cartridge-pins" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  );
}
