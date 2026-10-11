import { TIERS, type Answer, type Placement, type Word } from "./types";
export function completePlacement(candidates: Word[], p: Placement): boolean {
  return (
    Object.keys(p).length === candidates.length &&
    candidates.every((w) => TIERS.includes(p[w.id]))
  );
}
export function scoreRound(
  candidates: Word[],
  correct: Placement,
  guesses: Record<string, Answer>,
  protagonistId: string,
) {
  return Object.fromEntries(
    Object.entries(guesses).map(([id, a]) => [
      id,
      id === protagonistId
        ? 0
        : candidates.filter((w) => a.placement[w.id] === correct[w.id]).length,
    ]),
  );
}
export function rankScores(scores: Record<string, number>) {
  const sorted = Object.entries(scores).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return sorted.map(([playerId, score], i) => ({
    playerId,
    score,
    rank: sorted.findIndex((x) => x[1] === score) + 1,
  }));
}
export function nextProtagonist(
  roster: string[],
  roundIndex: number,
): string | null {
  return roster[roundIndex] ?? null;
}
