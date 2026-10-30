import { it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  pending: true,
  ownExists: true,
  phase: "reveal",
  deadline: 1 as number | null,
}));
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
      phase: state.phase,
      roundId: "1",
      roundIndex: 0,
      theme: "t",
      candidates: [{ id: "w", text: "w", ownerId: "a", slot: 0 }],
      predictionDeadline: state.deadline,
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
      exists: () => !ref.path.includes("/answers/") || state.ownExists,
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
  getDocFromServer: vi.fn(async () => ({
    exists: () => true,
    data: () => ({ players: [] }),
  })),
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

it("旧版で予想中のルームは既存の主役回答を提出済みとして扱う", async () => {
  state.pending = false;
  state.phase = "predict";
  state.deadline = 123;
  state.ownExists = false;
  expect((await new FirebaseStore({} as any, "b").read("r")).ready).toContain(
    "a",
  );
  state.deadline = null;
  expect(
    (await new FirebaseStore({} as any, "a").read("r")).ready,
  ).not.toContain("a");
});

it("kick直後は古いルーム購読を解除してからサーバーで退出を確認する", async () => {
  const { onSnapshot, getDocFromServer } = await import("firebase/firestore");
  vi.mocked(onSnapshot).mockClear();
  vi.mocked(getDocFromServer).mockClear();
  const unsubscribe = vi.fn();
  vi.mocked(onSnapshot).mockReturnValue(unsubscribe);
  const handler = vi.fn(),
    listener = vi.fn();
  const stop = new FirebaseStore({} as any, "a").subscribe(
    "r",
    listener,
    handler,
  );
  const onError = vi.mocked(onSnapshot).mock.calls[0][3] as unknown as (
    e: Error,
  ) => void;
  onError(Object.assign(new Error("denied"), { code: "permission-denied" }));
  await vi.waitFor(() =>
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ code: "room-removed" }),
    ),
  );
  expect(unsubscribe).toHaveBeenCalled();
  expect(unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(getDocFromServer).mock.invocationCallOrder[0],
  );
  expect(getDocFromServer).toHaveBeenCalled();
  expect(listener).not.toHaveBeenCalled();
  stop();
});

it("ルームの参加者から外れた購読通知だけで退出を伝える", async () => {
  const { onSnapshot } = await import("firebase/firestore");
  vi.mocked(onSnapshot).mockClear();
  vi.mocked(onSnapshot).mockReturnValue(() => {});
  const handler = vi.fn(),
    listener = vi.fn();
  const stop = new FirebaseStore({} as any, "a").subscribe(
    "r",
    listener,
    handler,
  );
  const update = vi.mocked(onSnapshot).mock.calls[0][2] as unknown as (
    s: unknown,
  ) => void;
  update({
    metadata: { fromCache: false, hasPendingWrites: false },
    exists: () => true,
    data: () => ({ players: [{ id: "b" }], roundId: "2" }),
  });
  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({ code: "room-removed" }),
  );
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  expect(listener).not.toHaveBeenCalled();
  stop();
});
it("入室直後の古いキャッシュだけでは退出扱いにしない", async () => {
  const { onSnapshot } = await import("firebase/firestore");
  vi.mocked(onSnapshot).mockClear();
  vi.mocked(onSnapshot).mockReturnValue(() => {});
  const handler = vi.fn();
  const stop = new FirebaseStore({} as any, "a").subscribe(
    "r",
    vi.fn(),
    handler,
  );
  const update = vi.mocked(onSnapshot).mock.calls[0][2] as unknown as (
    s: unknown,
  ) => void;
  update({
    exists: () => true,
    data: () => ({ players: [{ id: "b" }], roundId: "2" }),
    metadata: { fromCache: true, hasPendingWrites: false },
  });
  expect(handler).not.toHaveBeenCalled();
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  stop();
});

it.each(["member", "unavailable"])(
  "退出以外のエラーでは購読を再開する: %s",
  async (mode) => {
    const { onSnapshot, getDocFromServer } = await import("firebase/firestore");
    vi.mocked(onSnapshot).mockClear();
    vi.mocked(onSnapshot).mockReturnValue(() => {});
    if (mode === "member")
      vi.mocked(getDocFromServer).mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ players: [{ id: "a" }] }),
      } as any);
    else
      vi.mocked(getDocFromServer).mockRejectedValueOnce(
        Object.assign(new Error("offline"), { code: "unavailable" }),
      );
    const handler = vi.fn();
    const stop = new FirebaseStore({} as any, "a").subscribe(
      "r",
      vi.fn(),
      handler,
    );
    const error = Object.assign(new Error("denied"), {
      code: "permission-denied",
    });
    const onError = vi.mocked(onSnapshot).mock.calls[0][3] as unknown as (
      e: Error,
    ) => void;
    onError(error);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(error));
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    stop();
  },
);
