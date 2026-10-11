import { it, expect } from "vitest";
import { kickTransition, newRoom, transition } from "../../src/store/logic";
function room() {
  const r = newRoom("r", "a", "A");
  r.players.push(
    { id: "b", name: "B", joinedAt: 2 },
    { id: "c", name: "C", joinedAt: 3 },
  );
  return transition(r, "a", { type: "start" }, [], [], []);
}
it("他の参加者がホストをキックし、次の主役でやり直す", () => {
  const r = room();
  r.phase = "predict";
  r.candidates = [{ id: "w", text: "w", ownerId: "a", slot: 0 }];
  const n = kickTransition(r, "b", "a", false);
  expect(n.hostId).toBe("b");
  expect(n.roster).toEqual(["b", "c"]);
  expect(n.roundIndex).toBe(0);
  expect(n.phase).toBe("theme");
  expect(n.roundId).not.toBe(r.roundId);
  expect(n.candidates).toEqual([]);
  expect(n.departed?.[0].name).toBe("A");
});
it("主役以外のキックは主役を維持し、候補募集をやり直す", () => {
  const r = room();
  r.phase = "collect";
  const n = kickTransition(r, "a", "c", false);
  expect(n.roster[n.roundIndex]).toBe("a");
  expect(n.phase).toBe("theme");
  expect(n.roundIds).toEqual(["1", "2"]);
});
it("公開済みラウンドのIDは保持し、次の主役へ進む", () => {
  const r = room();
  r.phase = "reveal";
  const n = kickTransition(r, "b", "c", true);
  expect(n.roundIds).toContain("1");
  expect(n.roundIndex).toBe(1);
  expect(n.roster[n.roundIndex]).toBe("b");
});
it("残り1人なら終了し、自分自身のキックは禁止", () => {
  const r = room();
  const n = kickTransition(kickTransition(r, "a", "c", false), "b", "a", false);
  expect(n.phase).toBe("finished");
  expect(n.hostId).toBe("b");
  expect(() => kickTransition(r, "a", "a", false)).toThrow();
});
it("開始待ちなら募集を維持し、退出者の再参加を防ぐ情報を残す", () => {
  const r = newRoom("r", "a", "A");
  r.players.push({ id: "b", name: "B", joinedAt: 2 });
  const n = kickTransition(r, "a", "b", false);
  expect(n.phase).toBe("lobby");
  expect(n.departed?.map((p) => p.id)).toEqual(["b"]);
});
it("履歴フィールドのない旧ルームも次のラウンド番号を飛ばさない", () => {
  const r = room();
  delete r.roundIds;
  r.phase = "reveal";
  const n = transition(
    r,
    "a",
    { type: "next" },
    [],
    [],
    [
      {
        roundId: "1",
        theme: "t",
        candidates: [],
        correct: {},
        guesses: {},
        scores: {},
      },
    ],
  );
  expect(n.roundId).toBe("2");
  expect(n.roundIds).toEqual(["1", "2"]);
});
