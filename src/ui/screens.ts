import { el, jp, button } from "./dom";
import { TIERS, type Placement, type Word } from "../domain/types";
import type { RoomSnapshot } from "../store/types";
import { rankScores } from "../domain/game";
export function renderPlayers(root: HTMLElement, s: RoomSnapshot, me: string) {
  root.replaceChildren();
  for (const p of s.room.players) {
    const item = el("div", undefined, "player");
    const avatar = el("span", p.name.slice(0, 1), "avatar");
    const name = el("span", p.name);
    item.append(avatar, name);
    if (p.id === me) item.append(el("small", "あなた"));
    if (p.id === s.room.hostId) item.append(el("small", "ホスト"));
    root.append(item);
  }
}
export function renderOthers(root: HTMLElement, s: RoomSnapshot, me: string) {
  root.replaceChildren();
  for (const p of s.room.players.filter((p) => p.id !== me)) {
    const draft = s.drafts.find((d) => d.playerId === p.id);
    const item = el("div", undefined, "other-player");
    item.append(
      el("strong", p.name),
      el("small", draft?.submitted ? "送信済み" : "入力中"),
    );
    const ws = el("div", undefined, "other-words");
    for (const text of draft?.words ?? []) {
      if (text.trim()) ws.append(jp("span", text, "mini-chip"));
    }
    if (!ws.childNodes.length)
      ws.append(el("span", "まだ入力がありません", "muted"));
    item.append(ws);
    root.append(item);
  }
}
export function renderBoard(
  root: HTMLElement,
  candidates: Word[],
  placement: Placement,
) {
  const board = el("div", undefined, "tier-board");
  for (const tier of TIERS) {
    const row = el("div", undefined, `tier-row tier-${tier}`);
    row.append(el("span", tier, "tier-label"));
    const items = el("div", undefined, "tier-items");
    for (const w of candidates.filter((w) => placement[w.id] === tier))
      items.append(jp("span", w.text, "word-chip"));
    row.append(items);
    board.append(row);
  }
  root.append(board);
}
export function renderResults(
  root: HTMLElement,
  s: RoomSnapshot,
  final: boolean,
  me: string,
  next: () => void,
) {
  if (final) {
    const totals = Object.fromEntries(s.room.roster.map((id) => [id, 0]));
    for (const r of s.results)
      for (const [id, points] of Object.entries(r.scores))
        totals[id] = (totals[id] ?? 0) + points;
    const list = el("div", undefined, "score-list");
    for (const p of rankScores(totals)) {
      const row = el("div", undefined, "score-row");
      row.append(
        el("span", String(p.rank).padStart(2, "0"), "rank"),
        el(
          "strong",
          s.room.players.find((x) => x.id === p.playerId)?.name ?? "",
        ),
        el("span", `${p.score}点`, "points"),
      );
      list.append(row);
    }
    root.append(
      list,
      jp(
        "p",
        "意外な好みは見つかった？ また集まって、次のテーマで遊ぼう。",
        "hint",
      ),
      button(
        "ホームへ",
        () => {
          location.href = location.pathname;
        },
        "secondary",
      ),
    );
    return;
  }
  const r = s.results.find((r) => r.roundId === s.room.roundId);
  if (!r) {
    root.append(
      jp(
        "p",
        "主役の正解を待っています。主役がこのルームに戻ると公開されます。",
        "notice",
      ),
    );
    return;
  }
  root.append(
    jp(
      "h3",
      `${s.room.players.find((p) => p.id === s.room.roster[s.room.roundIndex])?.name}のティア表`,
    ),
  );
  renderBoard(root, r.candidates, r.correct);
  const list = el("div", undefined, "score-list");
  for (const p of s.room.players.filter(
    (p) => p.id !== s.room.roster[s.room.roundIndex],
  )) {
    const details = el("details");
    const summary = el("summary");
    summary.append(
      el("span", p.name),
      el("strong", `${r.scores[p.id] ?? 0}点`),
    );
    details.append(summary);
    if (r.guesses[p.id])
      renderBoard(details, r.candidates, r.guesses[p.id].placement);
    else details.append(el("p", "時間内の回答はありませんでした"));
    list.append(details);
  }
  root.append(list);
  if (me === s.room.hostId)
    root.append(
      button(
        s.room.roundIndex === s.room.roster.length - 1
          ? "最終結果を見る"
          : "次のラウンドへ",
        next,
      ),
    );
  else root.append(jp("p", "ホストが次へ進めるのを待っています。", "hint"));
}
