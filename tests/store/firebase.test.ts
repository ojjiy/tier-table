import { it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ pending: true }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  getDoc: async (ref: { path: string }) => {
    const room = {
      id: "r",
      hostId: "a",
      players: [
        { id: "a", name: "a" },
        { id: "b", name: "b" },
      ],
      roster: ["a", "b"],
      phase: "reveal",
      roundId: "1",
      roundIndex: 0,
      theme: "t",
      candidates: [{ id: "w", text: "w", ownerId: "a", slot: 0 }],
      predictionDeadline: 1,
      rejected: [],
    };
    const result = {
      roundId: "1",
      theme: "t",
      candidates: room.candidates,
      correct: { w: "S" },
      protagonistId: "a",
    };
    return {
      exists: () => true,
      data: () =>
        ref.path === "rooms/r"
          ? room
          : ref.path.endsWith("public")
            ? result
            : { placement: { w: "S" }, submittedAt: 1 },
      metadata: {
        hasPendingWrites: ref.path.endsWith("public") && state.pending,
      },
    };
  },
  getDocs: async (ref: { path: string }) => {
    if (ref.path.endsWith("/answers")) {
      if (state.pending)
        throw new Error("permission-denied: result not yet committed");
      return {
        docs: [
          { id: "b", data: () => ({ placement: { w: "S" }, submittedAt: 1 }) },
        ],
      };
    }
    return { docs: [] };
  },
  getFirestore: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
  setDoc: vi.fn(),
  writeBatch: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
}));
import { FirebaseStore } from "../../src/store/firebase";
it("公開結果のローカル書き込み中は秘密回答を一覧取得せず、サーバー確定後に採点する", async () => {
  const store = new FirebaseStore({} as any, "a");
  state.pending = true;
  await expect(store.read("r")).resolves.toMatchObject({ results: [] });
  state.pending = false;
  await expect(store.read("r")).resolves.toMatchObject({
    results: [{ scores: { b: 1 } }],
  });
});
