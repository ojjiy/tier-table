import type {
  Room,
  Answer,
  Draft,
  Placement,
  RoundResult,
} from "../domain/types";
import type { HostAction } from "./types";
import { finalizeCandidates, quota, validateDraft } from "../domain/words";
import { completePlacement, scoreRound } from "../domain/game";
export function requireThat(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function nameOf(name: string) {
  requireThat(
    name.trim().length > 0 && [...name.trim()].length <= 20,
    "名前は1〜20文字で入力してください",
  );
  return name.trim();
}
export function newRoom(id: string, playerId: string, name: string): Room {
  return {
    id,
    hostId: playerId,
    players: [{ id: playerId, name: nameOf(name), joinedAt: Date.now() }],
    roster: [],
    phase: "lobby",
    roundId: "0",
    roundIndex: 0,
    theme: "",
    candidates: [],
    predictionDeadline: null,
    rejected: [],
  };
}
export function member(room: Room, id: string) {
  requireThat(
    room.players.some((p) => p.id === id),
    "このルームに参加していません",
  );
}
export function current(room: Room, roundId: string) {
  requireThat(
    room.roundId === roundId,
    "ラウンドが変わりました。画面を確認してください",
  );
}
export function checkDraft(
  room: Room,
  id: string,
  roundId: string,
  draft: Draft,
) {
  member(room, id);
  current(room, roundId);
  requireThat(
    room.phase === "collect" && draft.playerId === id,
    "今は入力できません",
  );
  requireThat(
    draft.words.length === quota(room.roster.length) &&
      draft.words.every((w) => typeof w === "string" && [...w].length <= 40),
    "入力数または文字数が不正です",
  );
}
export function checkSubmission(
  room: Room,
  id: string,
  words: string[],
  drafts: Draft[],
) {
  const errors = validateDraft(id, words, drafts, quota(room.roster.length));
  requireThat(
    !Object.keys(errors).length,
    Object.values(errors)[0] ?? "入力を確認してください",
  );
}
export function checkAnswer(
  room: Room,
  id: string,
  roundId: string,
  p: Placement,
  now: number,
) {
  member(room, id);
  current(room, roundId);
  requireThat(
    completePlacement(room.candidates, p),
    "すべてのワードを配置してください",
  );
  const hero = room.roster[room.roundIndex];
  requireThat(
    room.phase === "predict" || (id === hero && room.phase === "arrange"),
    "回答の受付は終了しています",
  );
}
export function transition(
  room: Room,
  id: string,
  action: HostAction,
  drafts: Draft[],
  ready: string[],
  results: RoundResult[],
  now = Date.now(),
): Room {
  requireThat(room.hostId === id, "ホストだけが進行できます");
  const next = structuredClone(room);
  switch (action.type) {
    case "start":
      requireThat(
        room.phase === "lobby" &&
          room.players.length >= 2 &&
          room.players.length <= 6,
        "2〜6人で開始してください",
      );
      next.roster = room.players.map((p) => p.id);
      next.roundId = "1";
      next.phase = "theme";
      break;
    case "theme":
      requireThat(room.phase === "theme", "テーマ入力の時間ではありません");
      requireThat(
        action.theme.trim() && [...action.theme.trim()].length <= 100,
        "テーマは1〜100文字で入力してください",
      );
      next.theme = action.theme.trim();
      next.phase = "collect";
      break;
    case "candidates": {
      requireThat(
        room.phase === "collect" &&
          room.roster.every((pid) =>
            drafts.some((d) => d.playerId === pid && d.submitted),
          ),
        "全員の送信を待ってください",
      );
      const r = finalizeCandidates(room.roster, drafts);
      next.rejected = r.rejected;
      if (r.ready) {
        next.candidates = r.candidates;
        next.phase = "predict";
        next.predictionDeadline = null;
      }
      break;
    }
    case "close":
      requireThat(room.phase === "predict", "予想中ではありません");
      requireThat(
        room.roster.every((pid) => ready.includes(pid)),
        "主役を含む全員の確定を待ってください",
      );
      next.phase = "reveal";
      break;
    case "next":
      requireThat(
        room.phase === "reveal" &&
          results.some((r) => r.roundId === room.roundId),
        "正解の公開を待ってください",
      );
      next.roundIndex++;
      next.phase = next.roundIndex >= room.roster.length ? "finished" : "theme";
      next.roundId = String(next.roundIndex + 1);
      next.theme = "";
      next.candidates = [];
      next.predictionDeadline = null;
      next.rejected = [];
      break;
  }
  return next;
}
export function resultOf(
  room: Room,
  correct: Placement,
  guesses: Record<string, Answer>,
): RoundResult {
  return {
    roundId: room.roundId,
    theme: room.theme,
    candidates: room.candidates,
    correct,
    guesses,
    scores: scoreRound(
      room.candidates,
      correct,
      guesses,
      room.roster[room.roundIndex],
    ),
  };
}
