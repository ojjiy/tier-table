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
    departed: [],
    departedIds: [],
    roundIds: [],
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
  if (!room.players.some((p) => p.id === id))
    throw Object.assign(new Error("このルームには参加できません"), {
      code: "room-removed",
    });
}
export function roundHistory(room: Room): string[] {
  return (
    room.roundIds ??
    Array.from(
      { length: room.roster.length ? room.roundIndex + 1 : 0 },
      (_, i) => String(i + 1),
    )
  );
}
function allocateRound(room: Room) {
  const ids = roundHistory(room);
  room.roundId = String(Math.max(0, ...ids.map(Number)) + 1);
  room.roundIds = [...ids, room.roundId];
}
export function kickTransition(
  room: Room,
  actor: string,
  target: string,
  completed: boolean,
): Room {
  member(room, actor);
  requireThat(actor !== target, "自分自身はキックできません");
  requireThat(room.phase !== "finished", "終了したゲームではキックできません");
  const player = room.players.find((p) => p.id === target);
  requireThat(player, "対象の参加者は既に退出しています");
  const next = structuredClone(room);
  next.players = room.players.filter((p) => p.id !== target);
  next.departed = [...(room.departed ?? []), player];
  next.departedIds = [...(room.departedIds ?? []), target];
  if (room.hostId === target) next.hostId = next.players[0].id;
  if (room.phase === "lobby") return next;
  const removedIndex = room.roster.indexOf(target);
  requireThat(removedIndex >= 0, "参加者情報を確認してください");
  next.roster = room.roster.filter((id) => id !== target);
  next.roundIndex = room.roundIndex - (removedIndex < room.roundIndex ? 1 : 0);
  if (completed)
    next.roundIndex =
      room.roundIndex + 1 - (removedIndex <= room.roundIndex ? 1 : 0);
  next.phase =
    next.players.length < 2 || next.roundIndex >= next.roster.length
      ? "finished"
      : "theme";
  next.roundIds = roundHistory(room);
  if (next.phase === "theme") allocateRound(next);
  next.candidates = [];
  next.predictionDeadline = null;
  next.rejected = [];
  if (completed) next.theme = "";
  return next;
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
      next.roundIds = ["1"];
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
      next.roundIds = roundHistory(room);
      next.roundIndex++;
      next.phase = next.roundIndex >= room.roster.length ? "finished" : "theme";
      if (next.phase === "theme") allocateRound(next);
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
