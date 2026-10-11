export const TIERS = ["S", "A", "B", "C", "D"] as const;
export type Tier = (typeof TIERS)[number];
export type Phase =
  "lobby" | "theme" | "collect" | "arrange" | "predict" | "reveal" | "finished";
export interface Player {
  id: string;
  name: string;
  joinedAt: number;
}
export interface Word {
  id: string;
  text: string;
  ownerId: string;
  slot: number;
}
export interface Draft {
  playerId: string;
  words: string[];
  submitted: boolean;
}
export type Placement = Record<string, Tier>;
export interface Answer {
  placement: Placement;
  submittedAt: number;
}
export interface RoundResult {
  roundId: string;
  theme: string;
  candidates: Word[];
  correct: Placement;
  guesses: Record<string, Answer>;
  scores: Record<string, number>;
}
export interface Room {
  id: string;
  hostId: string;
  players: Player[];
  roster: string[];
  phase: Phase;
  roundId: string;
  roundIndex: number;
  theme: string;
  candidates: Word[];
  predictionDeadline: number | null;
  rejected: { playerId: string; slot: number }[];
}
