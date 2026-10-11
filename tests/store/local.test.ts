import { it, expect, beforeEach } from "vitest";
import { LocalStore } from "../../src/store/local";
const data = new Map<string, string>();
const storage = {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => {
    data.set(k, v);
  },
};
beforeEach(() => data.clear());
it("開始後の参加・非ホストの進行・古いラウンド更新を拒否する", async () => {
  const a = new LocalStore("a", storage),
    b = new LocalStore("b", storage),
    c = new LocalStore("c", storage);
  const id = await a.createRoom("主役");
  await b.joinRoom(id, "予想");
  await expect(b.advance(id, { type: "start" })).rejects.toThrow();
  await a.advance(id, { type: "start" });
  await expect(c.joinRoom(id, "遅刻")).rejects.toThrow();
  await a.advance(id, { type: "theme", theme: "好きなもの" });
  await expect(
    a.saveDraft(id, "old", {
      playerId: "a",
      words: ["x", "y", "z"],
      submitted: false,
    }),
  ).rejects.toThrow();
});
it("秘密回答、公開、交代、累計結果まで進む", async () => {
  const a = new LocalStore("a", storage),
    b = new LocalStore("b", storage);
  const id = await a.createRoom("a");
  await b.joinRoom(id, "b");
  await a.advance(id, { type: "start" });
  await a.advance(id, { type: "theme", theme: "テーマ" });
  const round = (await a.read(id)).room.roundId;
  await a.submitDraft(id, round, ["a", "b", "c"]);
  await b.submitDraft(id, round, ["d", "e", "f"]);
  await a.advance(id, { type: "candidates" });
  const p = Object.fromEntries(
    (await a.read(id)).room.candidates.map((w) => [w.id, "S"]),
  ) as any;
  await a.saveAnswer(id, round, { placement: p, submittedAt: Date.now() });
  expect((await b.read(id)).answer).toBeUndefined();
  await expect(a.advance(id, { type: "close" })).rejects.toThrow();
  await b.saveAnswer(id, round, { placement: p, submittedAt: Date.now() });
  await a.advance(id, { type: "close" });
  await a.publishCorrect(id, round);
  expect((await b.read(id)).results[0].scores.b).toBe(6);
  await a.advance(id, { type: "next" });
  expect((await a.read(id)).room.roundIndex).toBe(1);
});
it("同時送信の重複が5個未満になったら修正待ちにする", async () => {
  const a = new LocalStore("a", storage),
    b = new LocalStore("b", storage);
  const id = await a.createRoom("a");
  await b.joinRoom(id, "b");
  await a.advance(id, { type: "start" });
  await a.advance(id, { type: "theme", theme: "t" });
  const r = (await a.read(id)).room.roundId;
  await a.saveDraft(id, r, {
    playerId: "a",
    words: ["a", "b", "c"],
    submitted: true,
  });
  await b.saveDraft(id, r, {
    playerId: "b",
    words: ["a", "c", "d"],
    submitted: true,
  });
  await a.advance(id, { type: "candidates" });
  expect((await a.read(id)).room.phase).toBe("collect");
  expect((await a.read(id)).room.rejected).toHaveLength(2);
});
it("参加者が主役より先に提出でき、時間経過でも締め切らない", async () => {
  const a = new LocalStore("a", storage),
    b = new LocalStore("b", storage);
  const id = await a.createRoom("a");
  await b.joinRoom(id, "b");
  await a.advance(id, { type: "start" });
  await a.advance(id, { type: "theme", theme: "t" });
  const r = (await a.read(id)).room.roundId;
  await a.submitDraft(id, r, ["a", "b", "c"]);
  await b.submitDraft(id, r, ["d", "e", "f"]);
  await a.advance(id, { type: "candidates" });
  const p = Object.fromEntries(
    (await a.read(id)).room.candidates.map((w) => [w.id, "S"]),
  ) as any;
  expect((await a.read(id)).room.phase).toBe("predict");
  const state = JSON.parse(storage.getItem(`tier-room:${id}`)!);
  state.room.predictionDeadline = Date.now() - 1;
  storage.setItem(`tier-room:${id}`, JSON.stringify(state));
  await b.saveAnswer(id, r, { placement: p, submittedAt: Date.now() });
  await expect(a.advance(id, { type: "close" })).rejects.toThrow();
  await a.saveAnswer(id, r, { placement: p, submittedAt: Date.now() });
  await a.advance(id, { type: "close" });
  await a.publishCorrect(id, r);
  expect((await a.read(id)).results[0].scores.b ?? 0).toBe(6);
});
it("別タブ相当の同時回答で送信済み回答を失わない", async () => {
  const a = new LocalStore("a", storage);
  const id = await a.createRoom("a");
  await new LocalStore("b", storage).joinRoom(id, "b");
  await new LocalStore("c", storage).joinRoom(id, "c");
  await a.advance(id, { type: "start" });
  await a.advance(id, { type: "theme", theme: "t" });
  const r = (await a.read(id)).room.roundId;
  await a.submitDraft(id, r, ["a", "b"]);
  await new LocalStore("b", storage).submitDraft(id, r, ["c", "d"]);
  await new LocalStore("c", storage).submitDraft(id, r, ["e", "f"]);
  await a.advance(id, { type: "candidates" });
  const p = Object.fromEntries(
    (await a.read(id)).room.candidates.map((w) => [w.id, "S"]),
  ) as any;
  await a.saveAnswer(id, r, { placement: p, submittedAt: Date.now() });
  let concurrent: Promise<void> | undefined;
  let inserted = false;
  let c: LocalStore;
  const interleaved = {
    getItem: storage.getItem,
    setItem: (k: string, v: string) => {
      if (!inserted && JSON.parse(v).answers?.[r]?.b) {
        inserted = true;
        concurrent = c.saveAnswer(id, r, {
          placement: p,
          submittedAt: Date.now(),
        });
      }
      storage.setItem(k, v);
    },
  };
  const b = new LocalStore("b", interleaved);
  c = new LocalStore("c", interleaved);
  await b.saveAnswer(id, r, { placement: p, submittedAt: Date.now() });
  await concurrent;
  expect((await b.read(id)).ready.sort()).toEqual(["a", "b", "c"]);
  expect((await c.read(id)).answer).toBeDefined();
});
