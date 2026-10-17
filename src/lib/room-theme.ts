import { KESSLER_ROOM_ID } from "./kessler-room.ts";

export type RoomTheme = "neon";

/**
 * Which skin a room wears, decided from the room id alone so a page can paint it on first render,
 * before any room data has arrived. A room without an entry uses the base paper look.
 */
export function roomTheme(roomId: string | null | undefined): RoomTheme | undefined {
  return roomId === KESSLER_ROOM_ID ? "neon" : undefined;
}
