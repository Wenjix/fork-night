import catalog from "../data/kessler-films.json" with { type: "json" };
import { pilotPanels, type PilotMoment, type PilotPanel } from "./pilot.ts";
import type { FilmPlan } from "./story-film.ts";

export const MAX_FILM_SHOTS = 6;
export const FILM_SHOT_SECONDS = 3;
export type RoomFilmShot = {
  id: string; sourceId: string; panelIndex: number; title: string; maker: string;
  panel: PilotPanel; image?: string; direction: string;
};
export type RoomFilm = {
  id: string; title: string; description: string; tipId: string; duration: number;
  model: string; provider: string; preparedOn: string;
  video: string | null; poster: string; captions: string; shots: RoomFilmShot[];
};
export const KESSLER_FILMS: readonly RoomFilm[] = catalog;

export function roomFilmHref(href: string, film: RoomFilm): string {
  const url = new URL(href);
  url.search = new URLSearchParams({ room: "kessler-ward", moment: film.tipId, film: film.id }).toString();
  url.hash = "";
  return url.href;
}

export function filmSceneCount(shots: RoomFilmShot[]): number {
  return new Set(shots.map(shot => shot.sourceId)).size;
}

function samePanel(a: PilotPanel, b: PilotPanel) {
  return a.caption === b.caption && a.imageUrl === b.imageUrl && a.imagePath === b.imagePath && a.sha256 === b.sha256;
}

/** Snapshot published sources in ancestry order; a later room refresh cannot rewrite an open edit. */
export function roomFilmShots(path: PilotMoment[]): RoomFilmShot[] {
  return path.flatMap(moment => pilotPanels(moment.panels).map((panel, panelIndex) => {
    const id = `${moment.id}:${panelIndex}`;
    const prepared = KESSLER_FILMS.flatMap(film => film.shots).find(shot => shot.id === id && samePanel(shot.panel, panel));
    return { id, sourceId: moment.id, panelIndex, title: moment.title, maker: moment.maker_label, panel: { ...panel },
      image: prepared?.image, direction: prepared?.direction ?? "Follow this moment’s action, keeping the characters and setting consistent." };
  }));
}

export function suggestedFilmShots(shots: RoomFilmShot[], tipId: string): string[] {
  const prepared = KESSLER_FILMS.find(film => film.tipId === tipId);
  if (prepared && prepared.shots.every(source => shots.some(shot => shot.id === source.id && samePanel(shot.panel, source.panel)))) {
    return prepared.shots.map(shot => shot.id);
  }
  // One panel per moment makes a useful first edit without filling the film with a single multi-panel scene.
  const firstPanels = shots.filter(shot => shot.panelIndex === 0);
  if (firstPanels.length <= MAX_FILM_SHOTS) return firstPanels.map(shot => shot.id);
  return Array.from({ length: MAX_FILM_SHOTS }, (_, index) => firstPanels[Math.round(index * (firstPanels.length - 1) / (MAX_FILM_SHOTS - 1))].id);
}

export function selectedFilmShots(shots: RoomFilmShot[], ids: string[]): RoomFilmShot[] {
  if (!ids.length || ids.length > MAX_FILM_SHOTS || new Set(ids).size !== ids.length || ids.some(id => !shots.some(shot => shot.id === id))) {
    throw new Error("Choose between one and six panels from this branch.");
  }
  return shots.filter(shot => ids.includes(shot.id));
}

export function matchingRoomFilm(shots: RoomFilmShot[]): RoomFilm | undefined {
  return KESSLER_FILMS.find(film => film.shots.length === shots.length && film.shots.every((source, index) =>
    source.id === shots[index].id && samePanel(source.panel, shots[index].panel)));
}

export function storyboardPlan(title: string, shots: RoomFilmShot[], images: string[]): FilmPlan {
  if (images.length !== shots.length || !shots.length || shots.length > MAX_FILM_SHOTS) throw new Error("The storyboard is incomplete. Choose your shots again.");
  return { title, secondsPerShot: FILM_SHOT_SECONDS, shots: shots.map((shot, index) => ({
    id: shot.id, sourceId: shot.sourceId, title: shot.title, maker: shot.maker,
    imageUrl: images[index], caption: shot.panel.caption,
  })) };
}
