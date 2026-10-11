import type { Room, Draft, Answer, RoundResult } from "../domain/types";
export type HostAction =
  | { type: "start" | "candidates" | "close" | "next" }
  | { type: "theme"; theme: string };
export interface RoomSnapshot {
  room: Room;
  drafts: Draft[];
  answer?: Answer;
  ready: string[];
  results: RoundResult[];
}
export interface Store {
  mode: "local" | "firebase";
  playerId: string;
  createRoom(name: string): Promise<string>;
  joinRoom(id: string, name: string): Promise<void>;
  kickPlayer(id: string, targetId: string): Promise<void>;
  read(id: string): Promise<RoomSnapshot>;
  subscribe(
    id: string,
    listener: (s: RoomSnapshot) => void,
    onError: (e: Error) => void,
  ): () => void;
  saveDraft(id: string, roundId: string, draft: Draft): Promise<void>;
  submitDraft(id: string, roundId: string, words: string[]): Promise<void>;
  saveAnswer(id: string, roundId: string, answer: Answer): Promise<void>;
  advance(id: string, action: HostAction): Promise<void>;
  publishCorrect(id: string, roundId: string): Promise<void>;
}
