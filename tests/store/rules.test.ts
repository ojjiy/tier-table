import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, writeBatch } from "firebase/firestore";
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
  await assertSucceeds(updateDoc(doc(db("a"), "rooms/r"), { phase: "reveal" }));
});
it("期限後の回答を拒否し、答え合わせでのみ回答を公開", async () => {
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
  await assertFails(
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
