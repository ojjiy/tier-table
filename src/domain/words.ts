import type { Draft, Word } from "./types";
export function quota(n: number): number {
  if (!Number.isInteger(n) || n < 2 || n > 6)
    throw new Error("参加人数は2〜6人です");
  return Math.ceil(5 / n);
}
export function wordKey(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}
export function validateDraft(
  playerId: string,
  words: string[],
  drafts: Draft[],
  count: number,
): Record<number, string> {
  const errors: Record<number, string> = {};
  const seen = new Set<string>();
  const other = new Set(
    drafts
      .filter((d) => d.playerId !== playerId)
      .flatMap((d) => d.words)
      .map(wordKey)
      .filter(Boolean),
  );
  if (words.length !== count) errors[0] = `${count}個入力してください`;
  words.forEach((text, i) => {
    const key = wordKey(text);
    if (!key) errors[i] = "ワードを入力してください";
    else if ([...text.trim()].length > 40)
      errors[i] = "40文字以内で入力してください";
    else if (seen.has(key)) errors[i] = "自分の入力と重複しています";
    else if (other.has(key)) errors[i] = "ほかの人の入力と重複しています";
    seen.add(key);
  });
  return errors;
}
export function finalizeCandidates(roster: string[], drafts: Draft[]) {
  const seen = new Set<string>();
  const candidates: Word[] = [];
  const rejected: { playerId: string; slot: number }[] = [];
  for (const id of roster) {
    const draft = drafts.find((d) => d.playerId === id);
    if (!draft?.submitted) continue;
    draft.words.forEach((text, slot) => {
      const key = wordKey(text);
      if (!key || seen.has(key)) {
        rejected.push({ playerId: id, slot });
        return;
      }
      seen.add(key);
      candidates.push({
        id: `${id}-${slot}`,
        text: text.trim(),
        ownerId: id,
        slot,
      });
    });
  }
  return {
    candidates,
    rejected,
    ready:
      candidates.length >= 5 &&
      candidates.length <= 10 &&
      roster.every((id) =>
        drafts.some((d) => d.playerId === id && d.submitted),
      ),
  };
}
