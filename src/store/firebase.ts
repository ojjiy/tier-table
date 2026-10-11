import { initializeApp } from "firebase/app";
import { configureAppCheck } from "./app-check";
import {
  getAuth,
  setPersistence,
  browserSessionPersistence,
  signInAnonymously,
  connectAuthEmulator,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  onSnapshot,
  runTransaction,
  writeBatch,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";
import type { Store, RoomSnapshot, HostAction } from "./types";
import type {
  Room,
  Draft,
  Answer,
  RoundResult,
  Placement,
  Word,
} from "../domain/types";
import { scoreRound } from "../domain/game";
import {
  newRoom,
  nameOf,
  member,
  current,
  requireThat,
  checkDraft,
  checkSubmission,
  checkAnswer,
  transition,
  kickTransition,
  roundHistory,
} from "./logic";
interface PublicResult {
  roundId: string;
  theme: string;
  candidates: Word[];
  correct: Placement;
  protagonistId: string;
}
export async function firebaseStore(): Promise<Store> {
  const e = import.meta.env;
  const app = initializeApp({
    apiKey: e.VITE_FIREBASE_API_KEY,
    authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: e.VITE_FIREBASE_PROJECT_ID,
    appId: e.VITE_FIREBASE_APP_ID,
  });
  configureAppCheck(app, e);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (e.VITE_USE_EMULATORS === "true") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  await setPersistence(auth, browserSessionPersistence);
  await auth.authStateReady();
  const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
  return new FirebaseStore(db, user.uid);
}
export class FirebaseStore implements Store {
  mode = "firebase" as const;
  constructor(
    private db: Firestore,
    public playerId: string,
  ) {}
  private ref(id: string) {
    return doc(this.db, "rooms", id);
  }
  private rref(id: string, n: string, kind: string, uid: string) {
    return doc(this.db, "rooms", id, "rounds", n, kind, uid);
  }
  private async room(id: string) {
    const s = await getDoc(this.ref(id));
    requireThat(s.exists(), "ルームが見つかりません");
    return s.data() as Room;
  }
  async createRoom(name: string) {
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const room = newRoom(id, this.playerId, name);
    await setDoc(this.ref(id), { ...room, memberIds: [this.playerId] });
    return id;
  }
  async joinRoom(id: string, name: string) {
    await runTransaction(this.db, async (t) => {
      const s = await t.get(this.ref(id));
      requireThat(s.exists(), "ルームが見つかりません");
      const room = s.data() as Room;
      requireThat(
        !room.departed?.some((p) => p.id === this.playerId),
        "このルームから退出しています",
      );
      if (room.players.some((p) => p.id === this.playerId)) return;
      requireThat(
        room.phase === "lobby" && room.players.length < 6,
        "開始済み、または満員です",
      );
      const players = [
        ...room.players,
        { id: this.playerId, name: nameOf(name), joinedAt: Date.now() },
      ];
      t.update(this.ref(id), { players, memberIds: players.map((p) => p.id) });
    });
  }
  private async list<T>(id: string, n: string, kind: string): Promise<T[]> {
    return (
      await getDocs(collection(this.db, "rooms", id, "rounds", n, kind))
    ).docs.map((d) => d.data() as T);
  }
  async read(id: string): Promise<RoomSnapshot> {
    const room = await this.room(id);
    member(room, this.playerId);
    const [drafts, own, readyDocs] = await Promise.all([
      this.list<Draft>(id, room.roundId, "drafts"),
      getDoc(this.rref(id, room.roundId, "answers", this.playerId)),
      getDocs(
        collection(this.db, "rooms", id, "rounds", room.roundId, "ready"),
      ),
    ]);
    // Recover a legacy answer whose separate readiness write was interrupted.
    const recovered =
      room.phase === "predict" &&
      own.exists() &&
      !own.metadata.hasPendingWrites &&
      !readyDocs.docs.some((d) => d.id === this.playerId);
    if (recovered)
      await setDoc(this.rref(id, room.roundId, "ready", this.playerId), {
        ready: true,
      });
    const results: RoundResult[] = [];
    for (const n of roundHistory(room)) {
      const pub = await getDoc(this.rref(id, n, "result", "public"));
      if (!pub.exists() || pub.metadata.hasPendingWrites) continue;
      const p = pub.data() as PublicResult;
      const answers = await getDocs(
        collection(this.db, "rooms", id, "rounds", n, "answers"),
      );
      const guesses = Object.fromEntries(
        answers.docs.map((d) => [d.id, d.data() as Answer]),
      );
      results.push({
        ...p,
        guesses,
        scores: scoreRound(p.candidates, p.correct, guesses, p.protagonistId),
      });
    }
    return {
      room,
      drafts,
      answer: own.exists() ? (own.data() as Answer) : undefined,
      ready: [
        ...new Set([
          ...readyDocs.docs
            .filter((d) => !d.metadata.hasPendingWrites)
            .map((d) => d.id),
          ...(recovered ? [this.playerId] : []),
          // Older rounds entered predict only after the protagonist submitted.
          ...(room.phase === "predict" && room.predictionDeadline !== null
            ? [room.roster[room.roundIndex]]
            : []),
        ]),
      ],
      results,
    };
  }
  async kickPlayer(id: string, targetId: string) {
    await runTransaction(this.db, async (t) => {
      const live = await t.get(this.ref(id));
      requireThat(live.exists(), "ルームが見つかりません");
      const room = live.data() as Room;
      const result = await t.get(
        this.rref(id, room.roundId, "result", "public"),
      );
      const next = kickTransition(
        room,
        this.playerId,
        targetId,
        result.exists(),
      );
      t.set(this.ref(id), {
        ...next,
        memberIds: next.players.map((p) => p.id),
      });
    });
  }
  subscribe(
    id: string,
    listener: (s: RoomSnapshot) => void,
    handler: (e: Error) => void,
  ) {
    let active = true,
      round = "",
      scheduled = false,
      running = false,
      dirty = false;
    let children: (() => void)[] = [];
    const onError = (error: Error) => {
      if (!active) return;
      if ((error as Error & { code?: string }).code !== "permission-denied") {
        handler(error);
        return;
      }
      void this.room(id)
        .then((room) => {
          member(room, this.playerId);
          if (active) handler(error);
        })
        .catch((e) => {
          if (!active) return;
          const code = (e as { code?: string }).code;
          handler(
            code === "permission-denied" || code === "room-removed"
              ? Object.assign(new Error("ルームから退出しました"), {
                  code: "room-removed",
                })
              : error,
          );
        });
    };
    const refresh = () => {
      dirty = true;
      if (scheduled || running) return;
      scheduled = true;
      queueMicrotask(async () => {
        scheduled = false;
        if (!active) return;
        running = true;
        dirty = false;
        try {
          const s = await this.read(id);
          if (active) listener(s);
        } catch (e) {
          if (active) onError(e as Error);
        } finally {
          running = false;
          if (dirty && active) refresh();
        }
      });
    };
    const sub = onSnapshot(
      this.ref(id),
      (s) => {
        if (!s.exists()) {
          onError(new Error("ルームが見つかりません"));
          return;
        }
        const r = s.data() as Room;
        if (round !== r.roundId) {
          children.forEach((u) => u());
          round = r.roundId;
          children = [
            onSnapshot(
              collection(this.db, "rooms", id, "rounds", round, "drafts"),
              refresh,
              onError,
            ),
            onSnapshot(
              collection(this.db, "rooms", id, "rounds", round, "ready"),
              { includeMetadataChanges: true },
              refresh,
              onError,
            ),
            onSnapshot(
              this.rref(id, round, "result", "public"),
              { includeMetadataChanges: true },
              (result) => {
                if (!result.metadata.hasPendingWrites) refresh();
              },
              onError,
            ),
            onSnapshot(
              this.rref(id, round, "answers", this.playerId),
              refresh,
              onError,
            ),
          ];
        }
        refresh();
      },
      onError,
    );
    return () => {
      active = false;
      sub();
      children.forEach((u) => u());
    };
  }
  async saveDraft(id: string, n: string, draft: Draft) {
    const room = await this.room(id);
    checkDraft(room, this.playerId, n, draft);
    await setDoc(this.rref(id, n, "drafts", this.playerId), draft);
  }
  async submitDraft(id: string, n: string, words: string[]) {
    const room = await this.room(id);
    current(room, n);
    const drafts = await this.list<Draft>(id, n, "drafts");
    checkSubmission(room, this.playerId, words, drafts);
    await this.saveDraft(id, n, {
      playerId: this.playerId,
      words: words.map((w) => w.trim()),
      submitted: true,
    });
  }
  async saveAnswer(id: string, n: string, answer: Answer) {
    const room = await this.room(id);
    checkAnswer(room, this.playerId, n, answer.placement, Date.now());
    const batch = writeBatch(this.db);
    batch.set(this.rref(id, n, "answers", this.playerId), {
      placement: answer.placement,
      submittedAt: Date.now(),
    });
    if (room.phase === "arrange")
      batch.update(this.ref(id), {
        phase: "predict",
        predictionDeadline: null,
      });
    if (room.phase !== "arrange")
      batch.set(this.rref(id, n, "ready", this.playerId), { ready: true });
    await batch.commit();
    // Legacy arrange rooms must change phase before the marker passes the rules.
    if (room.phase === "arrange")
      await setDoc(this.rref(id, n, "ready", this.playerId), { ready: true });
  }
  async advance(id: string, action: HostAction) {
    const s = await this.read(id);
    const next = transition(
      s.room,
      this.playerId,
      action,
      s.drafts,
      s.ready,
      s.results,
    );
    await runTransaction(this.db, async (t) => {
      const live = await t.get(this.ref(id));
      requireThat(
        live.exists() &&
          live.data().phase === s.room.phase &&
          live.data().roundId === s.room.roundId,
        "進行が変わりました。もう一度確認してください",
      );
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(next) as (keyof Room)[])
        if (JSON.stringify(next[key]) !== JSON.stringify(s.room[key]))
          patch[key] = next[key];
      if (Object.keys(patch).length) t.update(this.ref(id), patch);
    });
  }
  async publishCorrect(id: string, n: string) {
    const room = await this.room(id);
    current(room, n);
    requireThat(
      room.phase === "reveal" && room.roster[room.roundIndex] === this.playerId,
      "まだ正解を公開できません",
    );
    const target = this.rref(id, n, "result", "public");
    if ((await getDoc(target)).exists()) return;
    const own = await getDoc(this.rref(id, n, "answers", this.playerId));
    requireThat(own.exists(), "正解が保存されていません");
    await setDoc(target, {
      roundId: n,
      theme: room.theme,
      candidates: room.candidates,
      correct: own.data().placement,
      protagonistId: this.playerId,
    });
  }
}
