"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Download,
  Grip,
  ImagePlus,
  LayoutGrid,
  LockKeyhole,
  PanelsTopLeft,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { canAccessProject, DEMO_LIMITS } from "@/domain";
import { publishOriginalProject } from "@/domain/original-project";
import {
  addDeskCard,
  commitDeskChange,
  createDeskState,
  DESK_LIMITS,
  DESK_STORAGE_KEY,
  getDeskBoard,
  loadDeskState,
  removeDeskCard,
  updateDeskCard,
  type DeskCard,
  type DeskState,
} from "@/social/desk";
import type { SocialSpacesProps } from "./social-spaces";
import { StoryArt } from "./story-art";
import { Button } from "./ui/button";
import { SectionPlate } from "./visual-plates";

type Intent = "edit" | "sketch" | "fork" | "opening" | null;
const cardId = () => `piece-${crypto.randomUUID()}`;

function download(text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "fork-night-personal-desk.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PersonalDesk(props: SocialSpacesProps) {
  const { demo, userId, navigate, onOpenProject, onUpdateDemo } = props;
  const [state, setState] = useState<DeskState>(createDeskState);
  const current = useRef(state);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [intent, setIntent] = useState<Intent>(null);
  const unkept = useRef(false);
  const inspector = useRef<HTMLElement>(null);
  const markDirty = useCallback((dirty: boolean) => {
    unkept.current = dirty;
  }, []);
  const canLeave = useCallback(
    () =>
      !unkept.current ||
      window.confirm(
        "Leave this unkept sketch or edit? Choose Cancel to keep working, then save it on your desk.",
      ),
    [],
  );
  const [arranged, setArranged] = useState(false);
  const [moving, setMoving] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const gesture = useRef<{
    id: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [targetProject, setTargetProject] = useState("");
  const [targetMoment, setTargetMoment] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [rights, setRights] = useState(false);
  const openingId = useRef("");
  const originalSave = useRef<string | null>(null);
  const cards = useMemo(
    () => getDeskBoard(state, demo, userId).cards,
    [state, demo, userId],
  );
  const chosen = selected.flatMap(
    (id) => cards.find((card) => card.id === id) ?? [],
  );
  const projects = demo.projects.filter((project) =>
    canAccessProject(demo, userId, project.id),
  );
  const drafts = props.drafts.filter(
    (draft) =>
      draft.userId === userId &&
      canAccessProject(demo, userId, draft.projectId),
  );
  const inherited = chosen.filter((card) => card.context);
  const sharedSource = inherited[0]?.context;
  const mixedSources = inherited.some(
    (card) =>
      card.context?.projectId !== sharedSource?.projectId ||
      card.context?.momentId !== sharedSource?.momentId,
  );
  const twoOriginals =
    chosen.length === 2 &&
    chosen.every((card) => card.kind === "image" && !card.context);
  const project = projects.find(
    (item) => item.id === (sharedSource?.projectId ?? targetProject),
  );
  const parentId = sharedSource?.momentId ?? targetMoment;

  useEffect(() => {
    props.onDeskLeaveGuardChange(canLeave);
    return () => props.onDeskLeaveGuardChange(null);
  }, [props.onDeskLeaveGuardChange, canLeave]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (unkept.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  useEffect(() => {
    if (!["edit", "fork", "opening"].includes(intent ?? "")) return;
    const region = inspector.current;
    const field = region?.querySelector<HTMLElement>(
      "input:not([type=checkbox]), select:not(:disabled)",
    );
    (field ?? region)?.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 760px)").matches)
      region?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [intent, intent === "edit" ? selected[0] : null]);

  useEffect(() => {
    try {
      originalSave.current = localStorage.getItem(DESK_STORAGE_KEY);
      const saved = loadDeskState(localStorage, demo);
      current.current = saved;
      setState(saved);
    } catch (reason) {
      setBlocked(true);
      setError(
        reason instanceof Error
          ? reason.message
          : "Your saved desk could not be read. Download the original before resetting it.",
      );
    }
    setArranged(window.matchMedia("(max-width: 760px)").matches);
    setReady(true);
    // Remounting for another sample user restores that user's board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function change(
    action: (value: DeskState) => DeskState,
    message = "Saved on your desk",
  ) {
    if (!ready || blocked) return false;
    try {
      const next = commitDeskChange(
        localStorage,
        current.current,
        demo,
        userId,
        action,
      );
      current.current = next;
      setState(next);
      setError("");
      setNotice(message);
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Your desk could not be saved. Download it before leaving.",
      );
      return false;
    }
  }
  function placement() {
    return {
      x: Math.min(
        DESK_LIMITS.maxX,
        35 + (scroller.current?.scrollLeft ?? 0) + (cards.length % 3) * 310,
      ),
      y: Math.min(
        DESK_LIMITS.maxY,
        35 +
          (scroller.current?.scrollTop ?? 0) +
          (Math.floor(cards.length / 3) % 3) * 360,
      ),
    };
  }
  function add(
    kind: "note" | "image",
    title: string,
    imageUrl?: string,
    text = "",
    context?: DeskCard["context"],
    keepingSketch = false,
  ) {
    if (!keepingSketch && !canLeave()) return false;
    const id = cardId();
    const piece: DeskCard = {
      id,
      kind,
      title,
      text,
      ...placement(),
      ...(imageUrl ? { imageUrl } : {}),
      ...(context ? { context } : {}),
    };
    if (change((value) => addDeskCard(value, demo, { userId, ...piece }))) {
      setSelected([id]);
      setIntent("edit");
      return true;
    }
    return false;
  }
  function addSamples() {
    if (!canLeave()) return;
    const pieces: DeskCard[] = [
      {
        id: cardId(),
        kind: "image",
        title: "A bus to the moon",
        text: "The last bus doesn't stop at the edge of town.",
        imageUrl: "/art/social-worlds.webp#scene=0",
        x: 50,
        y: 65,
      },
      {
        id: cardId(),
        kind: "image",
        title: "An unexpected stop",
        text: "It stops at a bakery where tomorrow is still in the oven.",
        imageUrl: "/art/social-worlds.webp#scene=3",
        x: 390,
        y: 130,
      },
      {
        id: cardId(),
        kind: "note",
        title: "What if…",
        text: "Every passenger brings a different ending. Which one does the driver choose?",
        x: 710,
        y: 55,
      },
    ];
    if (
      change(
        (value) =>
          pieces.reduce(
            (next, piece) => addDeskCard(next, demo, { userId, ...piece }),
            value,
          ),
        "Three sample pieces added. Arrange them or make something of your own.",
      )
    )
      setSelected([]);
  }
  function moveTo(id: string, x: number, y: number) {
    change(
      (value) =>
        updateDeskCard(value, demo, {
          userId,
          cardId: id,
          changes: {
            x: Math.max(0, Math.min(DESK_LIMITS.maxX, x)),
            y: Math.max(0, Math.min(DESK_LIMITS.maxY, y)),
          },
        }),
      "Position saved",
    );
  }
  function beginMove(
    event: ReactPointerEvent<HTMLButtonElement>,
    card: DeskCard,
  ) {
    if (arranged || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      id: card.id,
      startX: event.clientX,
      startY: event.clientY,
      x: card.x,
      y: card.y,
    };
  }
  function drag(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    if (!active) return;
    setMoving({
      id: active.id,
      x: Math.max(
        0,
        Math.min(DESK_LIMITS.maxX, active.x + event.clientX - active.startX),
      ),
      y: Math.max(
        0,
        Math.min(DESK_LIMITS.maxY, active.y + event.clientY - active.startY),
      ),
    });
  }
  function finishMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    if (active)
      moveTo(
        active.id,
        active.x + event.clientX - active.startX,
        active.y + event.clientY - active.startY,
      );
    gesture.current = null;
    setMoving(null);
  }
  function toggle(id: string) {
    if (!canLeave()) return;
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((entry) => entry !== id)
        : [...previous, id],
    );
    setIntent(null);
    setRights(false);
  }
  function startFork() {
    const first = sharedSource
      ? projects.find((item) => item.id === sharedSource.projectId)
      : projects[0];
    setTargetProject(first?.id ?? "");
    setTargetMoment(sharedSource?.momentId ?? first?.seedId ?? "");
    setIntent("fork");
  }
  function startOpening() {
    openingId.current = `desk-${crypto.randomUUID()}`;
    setProjectTitle(chosen[0]?.title ?? "");
    setRights(false);
    setIntent("opening");
  }
  function fork() {
    if (!project || !parentId || !chosen.length || mixedSources) return;
    const brief = chosen
      .map((card) => `${card.title}${card.text ? `: ${card.text}` : ""}`)
      .join("\n\n");
    if (brief.length > DEMO_LIMITS.maxPromptLength) {
      setError(
        `Choose fewer pieces or shorten their captions. A fork brief can hold ${DEMO_LIMITS.maxPromptLength} characters.`,
      );
      return;
    }
    onOpenProject(project.id, {
      task: "create",
      momentId: parentId,
      prompt: brief,
    });
  }
  function publishOpening() {
    if (!twoOriginals || !rights || !projectTitle.trim()) return;
    const next = onUpdateDemo(
      (value) =>
        publishOriginalProject(value, {
          userId,
          projectId: openingId.current,
          title: projectTitle.trim(),
          description:
            "An opening made on a personal desk. Where could it go next?",
          panels: [
            {
              imageUrl: chosen[0].imageUrl!,
              caption: chosen[0].text.trim() || chosen[0].title,
              ...(chosen[0].context ? { context: chosen[0].context } : {}),
            },
            {
              imageUrl: chosen[1].imageUrl!,
              caption: chosen[1].text.trim() || chosen[1].title,
              ...(chosen[1].context ? { context: chosen[1].context } : {}),
            },
          ],
        }),
      "Your opening is published in this local preview. Your desk stays yours.",
    );
    if (next) onOpenProject(openingId.current);
  }

  return (
    <div className="creative-desk">
      <div className="social-breadcrumb">
        <a
          href="#/spaces"
          onClick={(event) => {
            event.preventDefault();
            navigate({ kind: "spaces" });
          }}
        >
          My spaces
        </a>
        <ChevronRight size={14} />
        <span>Your desk</span>
      </div>
      <div className="creative-desk-heading">
        <div>
          <h1>Your desk</h1>
          <p>A little room for things that aren’t stories yet.</p>
        </div>
        <span>
          <LockKeyhole size={15} /> Just{" "}
          {demo.users.find((user) => user.id === userId)?.name}’s workspace
        </span>
      </div>
      {error && (
        <div className="social-save-warning" role="alert">
          <p>{error}</p>
          <button
            onClick={() =>
              download(
                blocked
                  ? (originalSave.current ?? "")
                  : JSON.stringify(current.current),
              )
            }
          >
            <Download size={15} /> Download saved work
          </button>
          {blocked && (
            <button
              onClick={() => {
                if (
                  !window.confirm(
                    "Reset this browser’s personal desks for all sample users? Download the original first. Published stories and project drafts are kept separately.",
                  )
                )
                  return;
                try {
                  const next = createDeskState();
                  localStorage.setItem(DESK_STORAGE_KEY, JSON.stringify(next));
                  current.current = next;
                  setState(next);
                  setBlocked(false);
                  setError("");
                } catch {
                  setError(
                    "Storage is still unavailable. Keep your download and try again with browser storage enabled.",
                  );
                }
              }}
            >
              Reset saved desks
            </button>
          )}
        </div>
      )}
      {!ready ? (
        <p role="status">Unrolling your canvas…</p>
      ) : (
        <>
          <div className="desk-tools" role="group" aria-label="Creative tools">
            <div className="desk-creation-tools">
              <Button
                variant="default"
                disabled={blocked || intent === "sketch"}
                className="social-button purple desk-tool"
                onClick={() => {
                  if (!canLeave()) return;
                  setIntent("sketch");
                  setSelected([]);
                }}
              >
                <span className="desk-tool-icon">
                  <Pencil size={23} aria-hidden="true" />
                </span>
                <span>Draw something</span>
              </Button>
              <Button
                variant="outline"
                disabled={blocked}
                className="social-button outline desk-tool"
                onClick={() => upload.current?.click()}
              >
                <span className="desk-tool-icon">
                  <ImagePlus size={23} aria-hidden="true" />
                </span>
                <span>Add image</span>
              </Button>
              <Button
                variant="outline"
                disabled={blocked}
                className="social-button outline desk-tool"
                onClick={() => add("note", "A little idea")}
              >
                <span className="desk-tool-icon">
                  <StickyNote size={23} aria-hidden="true" />
                </span>
                <span>Add note</span>
              </Button>
            </div>
            <input
              ref={upload}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Add an image to your desk"
              tabIndex={-1}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (
                  !["image/png", "image/jpeg", "image/webp"].includes(
                    file.type,
                  ) ||
                  file.size > DESK_LIMITS.maxImageBytes
                ) {
                  setError("Choose a PNG, JPEG or WebP image under 1 MB.");
                  return;
                }
                try {
                  const url = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = () =>
                      reject(
                        new Error(
                          "That image could not be read. Try another file.",
                        ),
                      );
                    reader.readAsDataURL(file);
                  });
                  add(
                    "image",
                    file.name
                      .replace(/\.[^.]+$/, "")
                      .slice(0, DESK_LIMITS.maxTitle) || "New image",
                    url,
                  );
                } catch (reason) {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "Could not read that image.",
                  );
                }
              }}
            />
            <div className="desk-utility-tools">
              <Button
                variant="ghost"
                className="desk-layout-toggle"
                aria-pressed={arranged}
                onClick={() => setArranged(!arranged)}
              >
                <LayoutGrid size={17} />{" "}
                {arranged ? "Arranged view" : "Free canvas"}
              </Button>
              <Button
                variant="ghost"
                className="desk-backup"
                aria-label="Download your personal desk"
                onClick={() =>
                  download(
                    JSON.stringify({
                      version: 1,
                      boards: { [userId]: getDeskBoard(state, demo, userId) },
                    }),
                  )
                }
              >
                <Download size={18} />
              </Button>
            </div>
          </div>
          <div className="desk-workbench">
            <div className="desk-board-column">
              {intent === "sketch" && (
                <SketchPad
                  onSave={(url) =>
                    add("image", "New sketch", url, "", undefined, true)
                  }
                  onClose={() => setIntent(null)}
                  onDirty={markDirty}
                />
              )}
              <div
                ref={scroller}
                className={`desk-board-viewport ${arranged ? "arranged" : ""}`}
                role="region"
                aria-label="Personal creative canvas"
                tabIndex={0}
              >
                <div
                  className="desk-canvas"
                  style={
                    arranged
                      ? undefined
                      : {
                          width: DESK_LIMITS.boardWidth,
                          minHeight: DESK_LIMITS.boardHeight,
                        }
                  }
                >
                  {!cards.length && (
                    <div className="desk-canvas-welcome">
                      <Pencil size={36} />
                      <h2>Leave something unfinished.</h2>
                      <p>
                        A sketch, a character, a scene that might go somewhere.
                        Move things around and see what belongs together.
                      </p>
                      <button
                        className="social-button outline"
                        disabled={blocked}
                        onClick={addSamples}
                      >
                        Try three sample pieces <Plus size={17} />
                      </button>
                      <small>
                        Or start with the drawing and image tools above.
                      </small>
                    </div>
                  )}
                  {cards.map((card) => {
                    const position = moving?.id === card.id ? moving : card;
                    const checked = selected.includes(card.id);
                    return (
                      <article
                        key={card.id}
                        className={`desk-piece ${card.kind} ${checked ? "chosen" : ""}`}
                        style={
                          arranged
                            ? undefined
                            : { left: position.x, top: position.y }
                        }
                      >
                        <div className="desk-piece-tools">
                          <label>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(card.id)}
                            />
                            <span>
                              {checked
                                ? `Selected ${selected.indexOf(card.id) + 1}`
                                : "Select"}
                            </span>
                            <span className="sr-only"> {card.title}</span>
                          </label>
                          {!arranged && (
                            <button
                              className="desk-grab"
                              aria-label={`Move ${card.title}. Use arrow keys, or drag.`}
                              title="Drag, or focus and use arrow keys"
                              disabled={blocked}
                              onPointerDown={(event) => beginMove(event, card)}
                              onPointerMove={drag}
                              onPointerUp={finishMove}
                              onPointerCancel={() => {
                                gesture.current = null;
                                setMoving(null);
                              }}
                              onKeyDown={(event) => {
                                const delta: Record<string, [number, number]> =
                                  {
                                    ArrowLeft: [-20, 0],
                                    ArrowRight: [20, 0],
                                    ArrowUp: [0, -20],
                                    ArrowDown: [0, 20],
                                  };
                                const step = delta[event.key];
                                if (step) {
                                  event.preventDefault();
                                  moveTo(
                                    card.id,
                                    card.x + step[0],
                                    card.y + step[1],
                                  );
                                }
                              }}
                            >
                              <Grip size={18} />
                            </button>
                          )}
                        </div>
                        {card.imageUrl && (
                          <button
                            className="desk-piece-image"
                            aria-label={`Select ${card.title}`}
                            onClick={() => toggle(card.id)}
                          >
                            <StoryArt
                              src={card.imageUrl}
                              description={card.text || card.title}
                            />
                          </button>
                        )}
                        <div className="desk-piece-copy">
                          <h2>{card.title}</h2>
                          {card.text && <p>{card.text}</p>}
                          {card.context && (
                            <small className="desk-source">
                              From{" "}
                              {
                                demo.projects.find(
                                  (entry) =>
                                    entry.id === card.context?.projectId,
                                )?.title
                              }{" "}
                              · source kept
                            </small>
                          )}
                        </div>
                        <button
                          className="desk-piece-edit"
                          onClick={() => {
                            if (!canLeave()) return;
                            setSelected([card.id]);
                            setIntent("edit");
                          }}
                        >
                          <Pencil size={13} /> Edit{" "}
                          {card.kind === "image" ? "caption" : "note"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>
              <div className="desk-canvas-footer">
                <span>
                  {cards.length} {cards.length === 1 ? "piece" : "pieces"} ·{" "}
                  {arranged
                    ? "Reading order, with canvas positions kept"
                    : "Drag the grip to move · arrow keys work too"}
                </span>
                <span role="status">
                  {notice || "Nothing leaves this desk until you choose."}
                </span>
              </div>
            </div>
            <aside
              ref={inspector}
              tabIndex={-1}
              className="desk-inspector"
              aria-label="Make something from your pieces"
            >
              {intent === "edit" && chosen.length === 1 ? (
                <PieceEditor
                  key={chosen[0].id}
                  card={chosen[0]}
                  disabled={blocked}
                  onDirty={markDirty}
                  onCancel={() => setIntent(null)}
                  onSave={(title, text) => {
                    if (
                      change((value) =>
                        updateDeskCard(value, demo, {
                          userId,
                          cardId: chosen[0].id,
                          changes: { title, text },
                        }),
                      )
                    )
                      setIntent(null);
                  }}
                  onDelete={() => {
                    if (
                      !window.confirm(
                        `Remove “${chosen[0].title}” from your desk? Published work stays as it is.`,
                      )
                    )
                      return;
                    if (
                      change(
                        (value) =>
                          removeDeskCard(value, demo, {
                            userId,
                            cardId: chosen[0].id,
                          }),
                        "Piece removed",
                      )
                    ) {
                      setSelected([]);
                      setIntent(null);
                    }
                  }}
                />
              ) : intent === "fork" ? (
                <>
                  <button
                    className="desk-back-link"
                    onClick={() => setIntent(null)}
                  >
                    Back to selection
                  </button>
                  <h2>Take an idea further</h2>
                  <p>
                    Your titles and captions become a fork brief. Visual pieces
                    stay on this desk; this preview generates sample artwork.
                  </p>
                  <label>
                    Project
                    <select
                      value={project?.id ?? ""}
                      disabled={!!sharedSource}
                      onChange={(event) => {
                        setTargetProject(event.target.value);
                        setTargetMoment(
                          projects.find(
                            (entry) => entry.id === event.target.value,
                          )?.seedId ?? "",
                        );
                      }}
                    >
                      <option value="">Choose a project</option>
                      {projects.map((entry) => (
                        <option value={entry.id} key={entry.id}>
                          {entry.title}
                          {entry.visibility === "private" ? " · private" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Start from
                    <select
                      value={parentId}
                      disabled={!!sharedSource}
                      onChange={(event) => setTargetMoment(event.target.value)}
                    >
                      <option value="">Choose a moment</option>
                      {demo.moments
                        .filter((moment) => moment.projectId === project?.id)
                        .map((moment) => (
                          <option key={moment.id} value={moment.id}>
                            {moment.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  {sharedSource && (
                    <p className="desk-callout">
                      This piece keeps its original fork point, credits and
                      inherited costs.
                    </p>
                  )}
                  <button
                    className="social-button purple"
                    onClick={fork}
                    disabled={!project || !parentId || mixedSources}
                  >
                    Prepare fork brief <ArrowRight size={17} />
                  </button>
                  <small>
                    You’ll see the quote before generation. Existing drafts are
                    protected; nothing is published here.
                  </small>
                </>
              ) : intent === "opening" && twoOriginals ? (
                <>
                  <button
                    className="desk-back-link"
                    onClick={() => setIntent(null)}
                  >
                    Back to selection
                  </button>
                  <h2>Your opening scene</h2>
                  <div className="desk-opening-preview">
                    {chosen.map((card, index) => (
                      <figure key={card.id}>
                        <StoryArt
                          src={card.imageUrl!}
                          description={card.text || card.title}
                        />
                        <figcaption>
                          {index + 1}. {card.text || card.title}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                  <button
                    className="desk-back-link"
                    onClick={() => setSelected([...selected].reverse())}
                  >
                    Swap panel order
                  </button>
                  <label>
                    Project name
                    <input
                      value={projectTitle}
                      maxLength={120}
                      onChange={(event) => setProjectTitle(event.target.value)}
                      placeholder="Where does your story begin?"
                    />
                  </label>
                  <p>
                    Only these two panels and captions become the first moment
                    of a new <strong>open project</strong>. Your other pieces
                    and notes stay on your desk.
                  </p>
                  <label className="desk-rights">
                    <input
                      type="checkbox"
                      checked={rights}
                      onChange={(event) => setRights(event.target.checked)}
                    />
                    I can share and allow others to remix these original or
                    supplied sample visuals.
                  </label>
                  <button
                    className="social-button purple"
                    onClick={publishOpening}
                    disabled={!rights || !projectTitle.trim() || blocked}
                  >
                    Publish opening in preview <ArrowRight size={17} />
                  </button>
                  <small>
                    Local preview only. No verified generation cost, so this
                    opening has no reuse fee. No payment is made.
                  </small>
                </>
              ) : (
                <>
                  <SectionPlate
                    className="desk-selection-sign"
                    title={chosen.length
                      ? "What could these become?"
                      : "Room to play."}
                    description={chosen.length
                      ? `${chosen.length} ${chosen.length === 1 ? "piece" : "pieces"} selected. Keep experimenting, or give the idea somewhere to go.`
                      : "Collect a few pieces. Select one or more when you want to build on them."}
                    icon={Pencil}
                    tone="lavender"
                  />
                  {chosen.length > 0 && (
                    <ol className="desk-selection">
                      {chosen.map((card) => (
                        <li key={card.id}>
                          {card.imageUrl ? (
                            <StoryArt
                              src={card.imageUrl}
                              description={card.title}
                            />
                          ) : (
                            <StickyNote size={25} />
                          )}
                          <span>{card.title}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="desk-task-choices">
                    <Button
                      variant="ghost"
                      className="desk-task-choice brief"
                      aria-label="Use in a project"
                      aria-describedby="desk-project-choice-hint"
                      type="button"
                      disabled={!chosen.length || mixedSources || blocked}
                      onClick={startFork}
                    >
                      <span className="desk-task-icon">
                        <StickyNote size={25} aria-hidden="true" />
                      </span>
                      <span className="desk-task-copy">
                        <strong>Use in a project</strong>
                        <small id="desk-project-choice-hint">
                          {mixedSources
                            ? "Choose pieces from a single fork point to keep their lineage intact."
                            : "Develop selected notes and captions into a fork brief."}
                        </small>
                      </span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      className="desk-task-choice opening"
                      aria-label="Start a new project"
                      aria-describedby="desk-opening-choice-hint"
                      type="button"
                      disabled={!twoOriginals || blocked}
                      onClick={startOpening}
                    >
                      <span className="desk-task-icon">
                        <PanelsTopLeft size={25} aria-hidden="true" />
                      </span>
                      <span className="desk-task-copy">
                        <strong>Start a new project</strong>
                        <small id="desk-opening-choice-hint">
                          {inherited.length
                            ? "Work from a project stays linked to its original story. Use original pieces for a new opening."
                            : "Select two original images or sketches, in panel order. You’ll review them before publishing."}
                        </small>
                      </span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </Button>
                  </div>
                  {chosen.length > 0 && (
                    <button
                      className="desk-back-link"
                      onClick={() => setSelected([])}
                    >
                      Clear selection
                    </button>
                  )}
                </>
              )}
            </aside>
          </div>
          <section
            className="desk-project-shelf"
            aria-labelledby="desk-projects-title"
          >
            <SectionPlate
              title="Still on your workbench"
              headingId="desk-projects-title"
              description="Your unfinished project versions stay attached to the story they came from."
              icon={PanelsTopLeft}
              tone="paper"
            />
            {drafts.length ? (
              <div className="desk-shelf-items">
                {drafts.map((draft) => {
                  const story = demo.projects.find(
                    (entry) => entry.id === draft.projectId,
                  )!;
                  const source = demo.moments.find(
                    (moment) => moment.id === draft.selectedId,
                  );
                  const operation = demo.operations.find(
                    (item) => item.id === draft.operationId,
                  );
                  return (
                    <article key={draft.projectId}>
                      <StoryArt
                        src={story.coverUrl}
                        description={story.title}
                      />
                      <div>
                        <h3>{story.title}</h3>
                        <p>
                          {operation?.status === "reserved"
                            ? "Generation reserved"
                            : operation?.status === "delivered"
                              ? "Ready for review"
                              : "Unpublished idea"}
                        </p>
                        <button
                          className="social-link"
                          onClick={() => onOpenProject(story.id)}
                        >
                          {operation?.status === "delivered"
                            ? "Review draft"
                            : "Resume work"}{" "}
                          <ArrowRight size={15} />
                        </button>
                        {source && (
                          <button
                            disabled={blocked}
                            className="social-link"
                            onClick={() =>
                              add(
                                "image",
                                source.title.slice(0, 120),
                                source.panels[0].imageUrl,
                                draft.prompt.slice(0, DESK_LIMITS.maxText),
                                { projectId: story.id, momentId: source.id },
                              )
                            }
                          >
                            Pin source to desk <Plus size={15} />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="desk-shelf-empty">
                No project drafts yet. Your canvas can be the starting point.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function PieceEditor({
  card,
  disabled,
  onSave,
  onCancel,
  onDelete,
  onDirty,
}: {
  card: DeskCard;
  disabled: boolean;
  onSave: (title: string, text: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [text, setText] = useState(card.text);
  useEffect(() => {
    onDirty(title !== card.title || text !== card.text);
  }, [title, text, card.title, card.text, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(title.trim(), text);
      }}
    >
      <h2>{card.kind === "image" ? "A little context" : "Catch the idea"}</h2>
      {card.imageUrl && (
        <StoryArt src={card.imageUrl} description={card.title} />
      )}
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={DESK_LIMITS.maxTitle}
          required
        />
      </label>
      <label>
        {card.kind === "image" ? "Caption or idea" : "Note"}
        <textarea
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={DESK_LIMITS.maxText}
          placeholder="What could happen here?"
        />
      </label>
      <button
        className="social-button purple"
        disabled={disabled || !title.trim()}
      >
        <Check size={17} /> Keep on desk
      </button>
      <button type="button" className="desk-back-link" onClick={onCancel}>
        Cancel edits
      </button>
      <button
        type="button"
        className="desk-remove"
        disabled={disabled}
        onClick={onDelete}
      >
        <Trash2 size={15} /> Remove piece
      </button>
    </form>
  );
}

function SketchPad({
  onSave,
  onClose,
  onDirty,
}: {
  onSave: (url: string) => boolean;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const snapshots = useRef<ImageData[]>([]);
  const olderMarks = useRef(false);
  const [ink, setInk] = useState("#332447");
  const [marks, setMarks] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    onDirty(marks > 0);
  }, [marks, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (context) {
      context.fillStyle = "#fffaf0";
      context.fillRect(0, 0, 800, 500);
    }
  }, []);
  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - box.left) * 800) / box.width,
      ((event.clientY - box.top) * 500) / box.height,
    ];
  }
  return (
    <section className="desk-sketch-pad" aria-label="Draw a sketch">
      <div className="desk-sketch-heading">
        <h2>Follow the pencil.</h2>
        <button
          aria-label="Close sketch"
          onClick={() => {
            if (!marks || window.confirm("Leave this unsaved sketch?"))
              onClose();
          }}
        >
          <X size={19} />
        </button>
      </div>
      <div className="desk-ink-tools" aria-label="Drawing tools">
        {[
          ["#332447", "Ink"],
          ["#7440bd", "Violet"],
          ["#ba443b", "Red"],
          ["#316d60", "Green"],
        ].map(([value, name]) => (
          <button
            key={value}
            aria-label={`${name} pencil`}
            aria-pressed={ink === value}
            style={{ backgroundColor: value }}
            onClick={() => setInk(value)}
          >
            {ink === value && <Check size={14} />}
          </button>
        ))}
        <button
          className="desk-undo"
          disabled={snapshots.current.length === 0}
          onClick={() => {
            const previous = snapshots.current.pop();
            if (previous) {
              canvas.current?.getContext("2d")?.putImageData(previous, 0, 0);
              setMarks(snapshots.current.length + (olderMarks.current ? 1 : 0));
            }
          }}
        >
          <Undo2 size={16} /> Undo stroke
        </button>
      </div>
      <canvas
        ref={canvas}
        width={800}
        height={500}
        aria-label="Drawing surface. Use a mouse, pen or touch. You can also add an existing image with the Add image tool."
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const context = event.currentTarget.getContext("2d");
          if (!context) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          snapshots.current.push(context.getImageData(0, 0, 800, 500));
          if (snapshots.current.length > 20) {
            snapshots.current.shift();
            olderMarks.current = true;
          }
          const [x, y] = point(event);
          context.strokeStyle = ink;
          context.fillStyle = ink;
          context.lineWidth = 4;
          context.lineCap = "round";
          context.lineJoin = "round";
          context.beginPath();
          context.arc(x, y, 2, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.moveTo(x, y);
          drawing.current = true;
          setMarks(snapshots.current.length + (olderMarks.current ? 1 : 0));
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const context = event.currentTarget.getContext("2d");
          if (!context) return;
          const [x, y] = point(event);
          context.lineTo(x, y);
          context.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      {error && <p role="alert">{error}</p>}
      <div className="desk-sketch-actions">
        <span>A sketch is a piece you can move, caption and combine.</span>
        <button
          className="social-button purple"
          disabled={!marks}
          onClick={() => {
            try {
              if (canvas.current)
                onSave(canvas.current.toDataURL("image/webp", 0.9));
            } catch {
              setError(
                "The sketch could not be saved. Try again before leaving.",
              );
            }
          }}
        >
          Keep sketch <Check size={17} />
        </button>
      </div>
    </section>
  );
}
