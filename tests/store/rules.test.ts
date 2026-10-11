import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  writeBatch,
  deleteDoc,
} from "firebase/firestore";
let env: RulesTestEnvironment;
const room = {
  id: "r",
  hostId: "a",
  memberIds: ["a", "b"],
  players: [
    { id: "a", name: "a", joinedAt: 1 },
    { id: "b", name: "b", joinedAt: 2 },
  ],
  roster: ["a", "b"],
  phase: "collect",
  roundId: "1",
  roundIndex: 0,
  theme: "テーマ",
  candidates: [{ id: "a-0", text: "a", ownerId: "a", slot: 0 }],
  predictionDeadline: null,
  rejected: [],
};
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-tier-table",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
}, 30000);
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "rooms/r"), room);
  });
});
const db = (id: string) => env.authenticatedContext(id).firestore();
it("部外者は開始済みルームを読めない", async () => {
  await assertFails(getDoc(doc(db("c"), "rooms/r")));
  await assertSucceeds(getDoc(doc(db("b"), "rooms/r")));
});
it("他人の入力・古いラウンドへの書き込みを拒否", async () => {
  const draft = { playerId: "a", words: ["a", "b", "c"], submitted: false };
  await assertSucceeds(
    setDoc(doc(db("a"), "rooms/r/rounds/1/drafts/a"), draft),
  );
  await assertFails(setDoc(doc(db("b"), "rooms/r/rounds/1/drafts/a"), draft));
  await assertFails(setDoc(doc(db("a"), "rooms/r/rounds/old/drafts/a"), draft));
});
it("確定後のワード変更は禁止", async () => {
  await env.withSecurityRulesDisabled((c) =>
    updateDoc(doc(c.firestore(), "rooms/r"), { phase: "arrange" }),
  );
  await assertFails(
    setDoc(doc(db("a"), "rooms/r/rounds/1/drafts/a"), {
      playerId: "a",
      words: ["a", "b", "c"],
      submitted: true,
    }),
  );
});
it("正解は主役だけが読み、ホストでも予想中に公開を早められない", async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), "rooms/r"), {
      phase: "predict",
      predictionDeadline: Date.now() + 180000,
    });
    await setDoc(doc(c.firestore(), "rooms/r/rounds/1/answers/a"), {
      placement: { "a-0": "S" },
      submittedAt: 1,
    });
  });
  await assertSucceeds(getDoc(doc(db("a"), "rooms/r/rounds/1/answers/a")));
  await assertFails(getDoc(doc(db("b"), "rooms/r/rounds/1/answers/a")));
  await assertFails(updateDoc(doc(db("a"), "rooms/r"), { phase: "reveal" }));
  await assertFails(
    setDoc(doc(db("b"), "rooms/r/rounds/1/result/public"), {
      correct: { "a-0": "S" },
    }),
  );
});
it("予想の提出済みマーカーを偽造できない", async () => {
  await env.withSecurityRulesDisabled((c) =>
    updateDoc(doc(c.firestore(), "rooms/r"), {
      phase: "predict",
      predictionDeadline: Date.now() + 180000,
    }),
  );
  await assertFails(
    setDoc(doc(db("b"), "rooms/r/rounds/1/ready/b"), { ready: true }),
  );
  const bdb = db("b");
  const batch = writeBatch(bdb);
  batch.set(doc(bdb, "rooms/r/rounds/1/answers/b"), {
    placement: { "a-0": "S" },
    submittedAt: Date.now(),
  });
  batch.set(doc(bdb, "rooms/r/rounds/1/ready/b"), { ready: true });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(db("a"), "rooms/r"), { phase: "reveal" }));
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), "rooms/r/rounds/1/answers/a"), {
      placement: { "a-0": "S" },
      submittedAt: 1,
    }),
  );
  await assertSucceeds(updateDoc(doc(db("a"), "rooms/r"), { phase: "reveal" }));
});
it("時間制限なく回答でき、全員提出までは公開しない", async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), "rooms/r"), {
      phase: "predict",
      predictionDeadline: Date.now() - 1,
    });
    await setDoc(doc(c.firestore(), "rooms/r/rounds/1/answers/a"), {
      placement: { "a-0": "S" },
      submittedAt: 1,
    });
  });
  await assertFails(updateDoc(doc(db("a"), "rooms/r"), { phase: "reveal" }));
  await assertSucceeds(
    setDoc(doc(db("b"), "rooms/r/rounds/1/answers/b"), {
      placement: { "a-0": "S" },
      submittedAt: Date.now(),
    }),
  );
  await assertSucceeds(updateDoc(doc(db("a"), "rooms/r"), { phase: "reveal" }));
  await assertSucceeds(
    setDoc(doc(db("a"), "rooms/r/rounds/1/result/public"), {
      roundId: "1",
      theme: "テーマ",
      candidates: room.candidates,
      correct: { "a-0": "S" },
      protagonistId: "a",
    }),
  );
  await assertSucceeds(getDoc(doc(db("b"), "rooms/r/rounds/1/answers/a")));
});
it("6人でも未提出者がいる間は早期公開を拒否する", async () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await updateDoc(doc(admin, "rooms/r"), {
      players: ids.map((id, i) => ({ id, name: id, joinedAt: i })),
      memberIds: ids,
      roster: ids,
      phase: "predict",
      predictionDeadline: Date.now() + 180000,
    });
    for (const id of ["a", "b", "c", "d", "e"])
      await setDoc(doc(admin, `rooms/r/rounds/1/answers/${id}`), {
        placement: { "a-0": "S" },
        submittedAt: 1,
      });
  });
  await assertFails(updateDoc(doc(db("a"), "rooms/r"), { phase: "reveal" }));
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), "rooms/r/rounds/1/answers/f"), {
      placement: { "a-0": "S" },
      submittedAt: 1,
    }),
  );
  await assertSucceeds(updateDoc(doc(db("a"), "rooms/r"), { phase: "reveal" }));
});
it("旧版の主役配置中ルームから提出しても進行できる", async () => {
  await env.withSecurityRulesDisabled((c) =>
    updateDoc(doc(c.firestore(), "rooms/r"), { phase: "arrange" }),
  );
  const { FirebaseStore } = await import("../../src/store/firebase");
  const store = new FirebaseStore(db("a"), "a");
  await store.saveAnswer("r", "1", {
    placement: { "a-0": "S" },
    submittedAt: Date.now(),
  });
  await assertSucceeds(getDoc(doc(db("a"), "rooms/r/rounds/1/ready/a")));
  expect((await getDoc(doc(db("a"), "rooms/r"))).data()?.phase).toBe("predict");
  await env.withSecurityRulesDisabled((c) =>
    deleteDoc(doc(c.firestore(), "rooms/r/rounds/1/ready/a")),
  );
  expect((await store.read("r")).ready).toContain("a");
});
it("参加者がホストをキックし、退出者の読み書き・再参加を拒否する", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await updateDoc(doc(admin, "rooms/r"), {
      players: [...room.players, { id: "c", name: "c", joinedAt: 3 }],
      memberIds: ["a", "b", "c"],
      roster: ["a", "b", "c"],
      phase: "predict",
      candidates: Array.from({ length: 6 }, (_, i) => ({
        id: "w" + i,
        text: "w" + i,
        ownerId: "a",
        slot: i,
      })),
    });
  });
  const { FirebaseStore } = await import("../../src/store/firebase");
  const b = new FirebaseStore(db("b"), "b");
  await b.kickPlayer("r", "a");
  const snapshot = await b.read("r");
  expect(snapshot.room.hostId).toBe("b");
  expect(snapshot.room.phase).toBe("theme");
  expect(snapshot.room.roundId).toBe("2");
  expect(snapshot.room.roster).toEqual(["b", "c"]);
  await assertFails(getDoc(doc(db("a"), "rooms/r")));
  await assertFails(
    setDoc(doc(db("a"), "rooms/r/rounds/2/drafts/a"), {
      playerId: "a",
      words: ["x", "y", "z"],
      submitted: true,
    }),
  );
  await expect(
    new FirebaseStore(db("a"), "a").kickPlayer("r", "b"),
  ).rejects.toThrow();
  await expect(b.kickPlayer("r", "b")).rejects.toThrow();
  await new FirebaseStore(db("c"), "c").kickPlayer("r", "b");
  expect((await getDoc(doc(db("c"), "rooms/r"))).data()?.phase).toBe(
    "finished",
  );
});
it("キックに便乗した状態改ざんとロビーへの再参加を拒否する", async () => {
  await env.withSecurityRulesDisabled((c) =>
    updateDoc(doc(c.firestore(), "rooms/r"), {
      phase: "lobby",
      roster: [],
      roundId: "0",
      departed: [],
      departedIds: [],
      roundIds: [],
    }),
  );
  const { FirebaseStore } = await import("../../src/store/firebase");
  const a = new FirebaseStore(db("a"), "a");
  await assertFails(
    updateDoc(doc(db("b"), "rooms/r"), { hostId: "b", phase: "finished" }),
  );
  await a.kickPlayer("r", "b");
  await assertFails(getDoc(doc(db("b"), "rooms/r")));
  await expect(
    new FirebaseStore(db("b"), "b").joinRoom("r", "b"),
  ).rejects.toThrow();
  await assertFails(
    updateDoc(doc(db("b"), "rooms/r"), {
      players: room.players,
      memberIds: ["a", "b"],
    }),
  );
});
it.each([0, 1])("旧ルームのラウンド%dから通常の次へ進める", async (index) => {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore(),
      n = String(index + 1),
      hero = room.roster[index];
    await updateDoc(doc(db, "rooms/r"), {
      phase: "reveal",
      roundIndex: index,
      roundId: n,
    });
    await setDoc(doc(db, `rooms/r/rounds/${n}/answers/${hero}`), {
      placement: { "a-0": "S" },
      submittedAt: 1,
    });
    await setDoc(doc(db, `rooms/r/rounds/${n}/result/public`), {
      roundId: n,
      theme: room.theme,
      candidates: room.candidates,
      correct: { "a-0": "S" },
      protagonistId: hero,
    });
  });
  const { FirebaseStore } = await import("../../src/store/firebase");
  const store = new FirebaseStore(db("a"), "a");
  await store.advance("r", { type: "next" });
  const s = await store.read("r");
  expect(s.room.phase).toBe(index === 0 ? "theme" : "finished");
  expect(s.room.roundIds).toEqual(["1", "2"]);
});
it.each([
  ["a", "f"],
  ["f", "a"],
])("6人のルームでも%sが%sをキックできる", async (actor, target) => {
  await env.withSecurityRulesDisabled((c) =>
    updateDoc(doc(c.firestore(), "rooms/r"), {
      players: ["a", "b", "c", "d", "e", "f"].map((id, i) => ({
        id,
        name: id,
        joinedAt: i,
      })),
      memberIds: ["a", "b", "c", "d", "e", "f"],
      roster: ["a", "b", "c", "d", "e", "f"],
      roundIndex: 3,
      roundId: "4",
      phase: "predict",
    }),
  );
  const { FirebaseStore } = await import("../../src/store/firebase");
  const store = new FirebaseStore(db(actor), actor);
  await store.kickPlayer("r", target);
  expect((await store.read("r")).room.players).toHaveLength(5);
});
