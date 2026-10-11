import type { Store, RoomSnapshot, HostAction } from "./types";
import type { Room, Draft, Answer, RoundResult } from "../domain/types";
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
  resultOf,
} from "./logic";
interface State {
  room: Room;
  drafts: Record<string, Record<string, Draft>>;
  answers: Record<string, Record<string, Answer>>;
  results: RoundResult[];
}
interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
export class LocalStore implements Store {
  mode = "local" as const;
  constructor(
    public playerId: string,
    private storage: StorageLike = localStorage,
  ) {}
  private load(id: string): State {
    const s = this.storage.getItem(`tier-room:${id}`);
    requireThat(
      s,
      "ルームが見つかりません。同じブラウザの別タブで開いてください",
    );
    return JSON.parse(s);
  }
  private write(id: string, s: State) {
    this.storage.setItem(`tier-room:${id}`, JSON.stringify(s));
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("tier-update"));
  }
  async createRoom(name: string) {
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    this.write(id, {
      room: newRoom(id, this.playerId, name),
      drafts: {},
      answers: {},
      results: [],
    });
    return id;
  }
  async joinRoom(id: string, name: string) {
    const s = this.load(id);
    if (s.room.players.some((p) => p.id === this.playerId)) return;
    requireThat(
      s.room.phase === "lobby" && s.room.players.length < 6,
      "開始済み、または満員です",
    );
    s.room.players.push({
      id: this.playerId,
      name: nameOf(name),
      joinedAt: Date.now(),
    });
    this.write(id, s);
  }
  async read(id: string): Promise<RoomSnapshot> {
    const s = this.load(id);
    member(s.room, this.playerId);
    return {
      room: s.room,
      drafts: Object.values(s.drafts[s.room.roundId] ?? {}),
      answer: s.answers[s.room.roundId]?.[this.playerId],
      ready: Object.keys(s.answers[s.room.roundId] ?? {}).filter(
        (id) => id !== s.room.roster[s.room.roundIndex],
      ),
      results: s.results,
    };
  }
  subscribe(
    id: string,
    listener: (s: RoomSnapshot) => void,
    onError: (e: Error) => void,
  ) {
    let active = true;
    const update = () => {
      void this.read(id)
        .then((s) => {
          if (active) listener(s);
        })
        .catch((e) => {
          if (active) onError(e);
        });
    };
    window.addEventListener("storage", update);
    window.addEventListener("tier-update", update);
    update();
    return () => {
      active = false;
      window.removeEventListener("storage", update);
      window.removeEventListener("tier-update", update);
    };
  }
  async saveDraft(id: string, roundId: string, draft: Draft) {
    const s = this.load(id);
    checkDraft(s.room, this.playerId, roundId, draft);
    (s.drafts[roundId] ??= {})[this.playerId] = draft;
    this.write(id, s);
  }
  async submitDraft(id: string, roundId: string, words: string[]) {
    const s = this.load(id);
    checkSubmission(
      s.room,
      this.playerId,
      words,
      Object.values(s.drafts[roundId] ?? {}),
    );
    await this.saveDraft(id, roundId, {
      playerId: this.playerId,
      words: words.map((w) => w.trim()),
      submitted: true,
    });
  }
  async saveAnswer(id: string, roundId: string, answer: Answer) {
    const s = this.load(id);
    checkAnswer(s.room, this.playerId, roundId, answer.placement, Date.now());
    requireThat(!s.answers[roundId]?.[this.playerId], "回答は送信済みです");
    (s.answers[roundId] ??= {})[this.playerId] = {
      placement: answer.placement,
      submittedAt: Date.now(),
    };
    if (s.room.phase === "arrange") {
      s.room.phase = "predict";
      s.room.predictionDeadline = Date.now() + 180000;
    }
    this.write(id, s);
  }
  async advance(id: string, action: HostAction) {
    const s = this.load(id);
    s.room = transition(
      s.room,
      this.playerId,
      action,
      Object.values(s.drafts[s.room.roundId] ?? {}),
      Object.keys(s.answers[s.room.roundId] ?? {}),
      s.results,
    );
    this.write(id, s);
  }
  async publishCorrect(id: string, roundId: string) {
    const s = this.load(id);
    current(s.room, roundId);
    requireThat(
      s.room.phase === "reveal" &&
        s.room.roster[s.room.roundIndex] === this.playerId,
      "正解はまだ公開できません",
    );
    if (s.results.some((r) => r.roundId === roundId)) return;
    const answers = s.answers[roundId] ?? {};
    requireThat(answers[this.playerId], "正解が保存されていません");
    s.results.push(resultOf(s.room, answers[this.playerId].placement, answers));
    this.write(id, s);
  }
}
