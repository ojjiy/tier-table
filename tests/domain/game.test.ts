import { describe, it, expect } from "vitest";
import {
  quota,
  wordKey,
  validateDraft,
  finalizeCandidates,
} from "../../src/domain/words";
import { scoreRound, rankScores, nextProtagonist } from "../../src/domain/game";
describe("ワード募集", () => {
  it("人数に合わせて均等に5〜10個を募集する", () =>
    expect([2, 3, 4, 5, 6].map(quota)).toEqual([3, 2, 2, 1, 1]));
  it("全角英字・空白・大文字を正規化する", () =>
    expect(wordKey(" Ａ  B ")).toBe(wordKey("a b")));
  it("空欄、文字数、自分と他者の重複を検出する", () => {
    expect(
      Object.keys(
        validateDraft(
          "a",
          ["", "x".repeat(41), " Ａ "],
          [{ playerId: "b", words: ["a"], submitted: false }],
          3,
        ),
      ),
    ).toEqual(["0", "1", "2"]);
    expect(validateDraft("a", ["パン", "パン"], [], 2)[1]).toBeTruthy();
  });
  it("同時送信の重複を入室順で除外し、5個未満なら戻す", () => {
    const r = finalizeCandidates(
      ["a", "b"],
      [
        { playerId: "b", words: ["a", "c", "d"], submitted: true },
        { playerId: "a", words: ["a", "b", "c"], submitted: true },
      ],
    );
    expect(r.candidates.map((w) => w.text)).toEqual(["a", "b", "c", "d"]);
    expect(r.ready).toBe(false);
    expect(r.rejected).toHaveLength(2);
  });
  it("5個以上なら重複を除いて確定する", () => {
    const r = finalizeCandidates(
      ["a", "b"],
      [
        { playerId: "a", words: ["a", "b", "c"], submitted: true },
        { playerId: "b", words: ["a", "d", "e"], submitted: true },
      ],
    );
    expect(r.ready).toBe(true);
    expect(r.candidates).toHaveLength(5);
  });
});
describe("採点・交代", () => {
  it("段一致を採点し、主役と未提出者を加点しない", () => {
    const candidates = [
      { id: "a-0", text: "a", ownerId: "a", slot: 0 },
      { id: "a-1", text: "b", ownerId: "a", slot: 1 },
    ];
    expect(
      scoreRound(
        candidates,
        { "a-0": "S", "a-1": "S" },
        {
          a: { placement: { "a-0": "S", "a-1": "S" }, submittedAt: 1 },
          b: { placement: { "a-1": "S", "a-0": "S" }, submittedAt: 1 },
        },
        "a",
      ),
    ).toEqual({ a: 0, b: 2 });
  });
  it("同点は同順位にする", () =>
    expect(rankScores({ a: 3, b: 3, c: 1 }).map((x) => x.rank)).toEqual([
      1, 1, 3,
    ]));
  it("一巡で終了する", () => {
    expect(nextProtagonist(["a", "b"], 1)).toBe("b");
    expect(nextProtagonist(["a", "b"], 2)).toBeNull();
  });
});
