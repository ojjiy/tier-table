import "./ui/styles.css";
import { createStore } from "./store";
import type { Store, RoomSnapshot, HostAction } from "./store/types";
import type { Placement } from "./domain/types";
import { quota, validateDraft } from "./domain/words";
import { completePlacement } from "./domain/game";
import { createPlacementEditor } from "./ui/placement";
import { renderPlayers, renderOthers, renderResults } from "./ui/screens";
import { el, jp, button, field } from "./ui/dom";
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML =
  '<header class="site-header"><a class="brand" href="./"><span class="brand-icon" aria-hidden="true"><i>S</i><i>A</i><i>B</i></span><span>みんなのティア予想<small>TIER TOGETHER</small></span></a><span id="mode" class="mode">接続中</span></header><main id="main"></main><footer>好きのちがいが、今日の話題に。<span>通話しながら遊ぶ、ティア表予想ゲーム</span></footer>';
document
  .querySelector(".brand > span:last-child")!
  .firstChild!.replaceWith(jp("span", "みんなのティア予想"));
const main = document.querySelector<HTMLElement>("#main")!;
const mode = document.querySelector<HTMLElement>("#mode")!;
let store: Store;
let snapshot: RoomSnapshot | undefined;
let roomId = new URL(location.href).searchParams.get("room") ?? "";
let unsubscribe: (() => void) | undefined;
let screenKey = "";
let busy = false;
let syncing = false;
let disposed: () => void = () => {};
let actionsPanel: HTMLElement;
let errorBox: HTMLElement;
let content: HTMLElement;
let players: HTMLElement;
let others: HTMLElement | undefined;
let draftInputs: HTMLInputElement[] = [];
let submitButton: HTMLButtonElement | undefined;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let writeQueue = Promise.resolve();
let wordsDirty = false;
let autos = new Set<string>();
const steps = ["テーマ", "ワード募集", "配置と予想", "答え合わせ"];
function showError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  if (errorBox) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  } else {
    main.append(jp("p", message, "notice error"));
  }
}
function clearError() {
  if (errorBox) {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }
}
async function run(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  clearError();
  document.body.classList.add("busy");
  try {
    await fn();
  } catch (e) {
    showError(e);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}
function action(a: HostAction) {
  void run(() => store.advance(roomId, a));
}
function shell() {
  main.replaceChildren();
  const top = el("div", undefined, "room-top");
  top.append(el("span", `ROOM / ${roomId.toUpperCase()}`, "eyebrow"));
  const copy = button(
    "招待リンクをコピー",
    () => {
      void navigator.clipboard
        .writeText(location.href)
        .then(() => {
          copy.textContent = "コピーしました";
        })
        .catch(() =>
          showError(
            "コピーできませんでした。アドレスバーのURLを共有してください。",
          ),
        );
    },
    "text-button",
  );
  top.append(copy);
  main.append(top);
  const grid = el("div", undefined, "room-grid");
  content = el("section", undefined, "paper game-panel");
  errorBox = el("p", undefined, "notice error");
  errorBox.id = "error";
  errorBox.setAttribute("role", "alert");
  errorBox.hidden = true;
  content.append(errorBox);
  const side = el("aside", undefined, "sidebar");
  players = el("div", undefined, "players");
  const roster = el("section", undefined, "roster-bar");
  roster.append(jp("h3", "参加者"), players);
  main.append(roster);
  actionsPanel = el("div", undefined, "progress");
  side.append(
    actionsPanel,
    jp("p", "声はいつもの通話で。操作はそれぞれの画面で。", "side-note"),
  );
  grid.append(content, side);
  main.append(grid);
}
function heading(kicker: string, title: string, description?: string) {
  content.append(el("span", kicker, "eyebrow"), jp("h1", title));
  if (description) content.append(jp("p", description, "lead"));
}
function home(join = false) {
  disposed();
  screenKey = "home";
  snapshot = undefined;
  main.replaceChildren();
  const hero = el("div", undefined, "home-grid");
  const intro = el("section", undefined, "home-intro");
  intro.append(
    el("span", "A LITTLE GUESS. A LOT OF TALK.", "eyebrow"),
    jp("h1", "その「好き」、\n当てられる？"),
    jp(
      "p",
      "ワードを持ち寄って、友だちの好みを予想しよう。意外な並びが、会話のきっかけに。",
      "lead",
    ),
  );
  const preview = el("div", undefined, "preview-board");
  [
    "S|やっぱり、これ",
    "A|迷うけど好き",
    "B|気分しだい",
    "C|たまにはね",
    "D|自分はこっち",
  ].forEach((row) => {
    const [t, text] = row.split("|");
    const r = el("div", undefined, `tier-row tier-${t}`);
    r.append(el("span", t, "tier-label"), jp("span", text, "preview-word"));
    preview.append(r);
  });
  intro.append(preview, el("p", "2〜6人 / スマホ・PC / 通話しながら", "meta"));
  const card = el("section", undefined, "paper join-panel");
  card.append(
    el("span", join ? "YOU ARE INVITED" : "LET’S PLAY", "eyebrow"),
    jp("h2", join ? "ルームへようこそ" : "今日のメンバーで遊ぼう"),
    jp(
      "p",
      join
        ? "名前を入力して、みんなの輪に加わろう。"
        : "ルームをつくったら、リンクを友だちへ。",
      "hint",
    ),
  );
  const name = field("あなたの名前", "name", 20, "例：あお");
  name.input.value = sessionStorage.getItem("tier-name") ?? "";
  card.append(name.wrap);
  errorBox = el("p", undefined, "notice error");
  errorBox.id = "error";
  errorBox.setAttribute("role", "alert");
  errorBox.hidden = true;
  card.append(errorBox);
  const enter = async () => {
    sessionStorage.setItem("tier-name", name.input.value.trim());
    if (join) await store.joinRoom(roomId, name.input.value);
    else {
      roomId = await store.createRoom(name.input.value);
      const u = new URL(location.href);
      u.searchParams.set("room", roomId);
      history.pushState({}, "", u);
    }
    connect();
  };
  card.append(
    button(join ? "ルームに参加" : "ルームをつくる", () => {
      void run(enter);
    }),
  );
  name.input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.isComposing) void run(enter);
  };
  if (join)
    card.append(
      button(
        "ホームに戻る",
        () => {
          location.href = location.pathname;
        },
        "text-button",
      ),
    );
  if (store.mode === "local")
    card.append(
      jp(
        "p",
        "ローカル確認モードです。同じブラウザの別タブで参加できます。別端末・別ブラウザとは同期しません。",
        "notice",
      ),
    );
  const how = el("div", undefined, "how-to");
  [
    ["01", "みんなでワードを入力"],
    ["02", "主役もみんなも同時に配置"],
    ["03", "正解を公開して答え合わせ"],
  ].forEach(([n, t]) => {
    const row = el("div");
    row.append(el("span", n), jp("p", t));
    how.append(row);
  });
  card.append(how);
  hero.append(intro, card);
  main.append(hero);
}
function connect() {
  unsubscribe?.();
  screenKey = "";
  shell();
  unsubscribe = store.subscribe(roomId, update, showError);
}
function localKey(kind: string) {
  return `tier-${kind}:${roomId}:${snapshot!.room.roundId}:${store.playerId}`;
}
function restore<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function update(s: RoomSnapshot) {
  snapshot = s;
  const r = s.room;
  const hero = r.roster[r.roundIndex];
  const own = s.drafts.find((d) => d.playerId === store.playerId);
  const rejected = r.rejected.filter((x) => x.playerId === store.playerId);
  const k = `${r.phase}:${r.roundId}:${Boolean(s.answer)}:${s.results.some((x) => x.roundId === r.roundId)}:${JSON.stringify(rejected)}`;
  if (k !== screenKey) {
    disposed();
    disposed = () => {};
    clearTimeout(syncTimer);
    screenKey = k;
    others = undefined;
    draftInputs = [];
    submitButton = undefined;
    wordsDirty = false;
    shell();
    renderPhase(s);
  }
  renderPlayers(players, s, store.playerId);
  actionsPanel.replaceChildren();
  const phaseIndex =
    (
      { theme: 0, collect: 1, arrange: 2, predict: 2, reveal: 3 } as Record<
        string,
        number
      >
    )[r.phase] ?? -1;
  steps.forEach((t, i) => {
    const row = el(
      "div",
      undefined,
      `progress-step ${i === phaseIndex ? "active" : ""} ${i < phaseIndex ? "done" : ""}`,
    );
    row.append(el("span", i < phaseIndex ? "✓" : String(i + 1)), jp("p", t));
    actionsPanel.append(row);
  });
  if (others) renderOthers(others, s, store.playerId);
  if (r.phase === "collect" && submitButton) {
    submitButton.textContent =
      own?.submitted && !wordsDirty
        ? "送信済み・再送信できます"
        : "ワードを送信";
    const status = document.querySelector("#collection-status");
    if (status)
      status.textContent = `${s.drafts.filter((d) => d.submitted).length} / ${r.roster.length} 人が送信済み`;
    const next = document.querySelector<HTMLButtonElement>("#to-arrange");
    if (next)
      next.disabled = !r.roster.every((id) =>
        s.drafts.some((d) => d.playerId === id && d.submitted),
      );
  }
  if (r.phase === "predict") {
    const status = document.querySelector("#prediction-status");
    if (status)
      status.textContent = `${s.ready.length} / ${r.roster.length} 人が確定済み`;
    if (
      store.playerId === r.hostId &&
      r.roster.every((id) => s.ready.includes(id))
    )
      auto("close", () => store.advance(roomId, { type: "close" }));
  }
  if (
    r.phase === "reveal" &&
    hero === store.playerId &&
    !s.results.some((x) => x.roundId === r.roundId)
  )
    auto("publish", () => store.publishCorrect(roomId, r.roundId));
}
function auto(name: string, fn: () => Promise<void>) {
  const key = `${snapshot!.room.roundId}:${name}`;
  if (autos.has(key)) return;
  autos.add(key);
  void fn().catch((e) => {
    autos.delete(key);
    showError(e);
  });
}
function renderPhase(s: RoomSnapshot) {
  const r = s.room;
  const me = store.playerId;
  const isHost = r.hostId === me;
  const hero = r.roster[r.roundIndex];
  const heroName = r.players.find((p) => p.id === hero)?.name ?? "";
  if (r.phase === "lobby") {
    heading(
      "THE ROOM IS READY",
      "みんなを待っています",
      "招待リンクを送って、2〜6人で集まろう。全員そろったらスタート。",
    );
    const code = el("div", roomId.toUpperCase(), "room-code");
    content.append(code);
    if (isHost) {
      const b = button("ゲームをはじめる", () => action({ type: "start" }));
      b.id = "start";
      content.append(b);
      const refresh = () => {
        b.disabled = (snapshot?.room.players.length ?? 0) < 2;
      };
      refresh();
      const timer = setInterval(refresh, 500);
      disposed = () => clearInterval(timer);
    } else
      content.append(
        jp("p", "ホストがゲームをはじめるのを待っています。", "notice"),
      );
    return;
  }
  if (r.phase === "finished") {
    heading(
      "THAT WAS FUN!",
      "みんなの結果",
      "当てた数より、話したくなった好みがあるはず。",
    );
    renderResults(content, s, true, me, () => {});
    return;
  }
  content.append(
    el(
      "span",
      `ROUND ${r.roundIndex + 1} / ${r.roster.length} · 主役 ${heroName}`,
      "round-badge",
    ),
  );
  if (r.phase === "theme") {
    heading(
      "SET THE THEME",
      "今回のテーマは？",
      isHost
        ? "主役の好みが分かれそうなテーマを考えよう。"
        : "ホストがテーマを考えています。",
    );
    if (isHost) {
      const f = field("今回のテーマ", "theme", 100, "例：休日に食べたいもの");
      f.input.value = restore(localKey("theme"), "");
      f.input.oninput = () =>
        sessionStorage.setItem(
          localKey("theme"),
          JSON.stringify(f.input.value),
        );
      content.append(
        f.wrap,
        button("ワード募集をはじめる", () =>
          action({ type: "theme", theme: f.input.value }),
        ),
      );
    }
    return;
  }
  if (r.phase === "collect") {
    heading(
      "BRING YOUR WORDS",
      "候補ワードを持ち寄ろう",
      `テーマ「${r.theme}」に合うワードを、1人${quota(r.roster.length)}個入力。主役も参加します。`,
    );
    const count = quota(r.roster.length);
    const key = localKey("words");
    const mine = s.drafts.find((d) => d.playerId === me);
    const saved = restore<string[]>(key, mine?.words ?? Array(count).fill(""));
    const form = el("div", undefined, "word-form");
    let composing = false;
    const getWords = () => draftInputs.map((i) => i.value);
    const queueSave = (words: string[]) => {
      const round = r.roundId;
      writeQueue = writeQueue
        .catch(() => {})
        .then(() =>
          store.saveDraft(roomId, round, {
            playerId: me,
            words,
            submitted: false,
          }),
        )
        .catch((e) => {
          showError(e);
        });
    };
    const edited = () => {
      wordsDirty = true;
      sessionStorage.setItem(key, JSON.stringify(getWords()));
      clearTimeout(syncTimer);
      if (!composing) syncTimer = setTimeout(() => queueSave(getWords()), 400);
      if (submitButton) submitButton.textContent = "ワードを送信";
    };
    for (let i = 0; i < count; i++) {
      const f = field(`ワード${i + 1}`, `word-${i}`, 40, `候補を入力`);
      f.input.value = saved[i] ?? "";
      f.input.oninput = edited;
      f.input.addEventListener("compositionstart", () => {
        composing = true;
        clearTimeout(syncTimer);
      });
      f.input.addEventListener("compositionend", () => {
        composing = false;
        edited();
      });
      draftInputs.push(f.input);
      form.append(f.wrap);
    }
    content.append(form);
    if (r.rejected.some((x) => x.playerId === me))
      content.append(
        jp(
          "p",
          "重複を除くと候補が5個未満でした。ほかの人と重なったワードを直して再送信してください。",
          "notice",
        ),
      );
    const send = async () => {
      clearTimeout(syncTimer);
      const inputs = [...draftInputs];
      const words = getWords();
      inputs.forEach((input) => {
        input.disabled = true;
      });
      try {
        await writeQueue;
        const latest = await store.read(roomId);
        const errors = validateDraft(me, words, latest.drafts, count);
        draftInputs.forEach((input, i) => {
          input.setAttribute("aria-invalid", String(Boolean(errors[i])));
        });
        if (Object.keys(errors).length)
          throw new Error(
            Object.entries(errors)
              .map(([i, t]) => `ワード${Number(i) + 1}：${t}`)
              .join(" / "),
          );
        await store.submitDraft(roomId, r.roundId, words);
        wordsDirty = false;
        if (submitButton) submitButton.textContent = "送信済み・再送信できます";
      } finally {
        inputs.forEach((input) => {
          input.disabled = false;
        });
      }
    };
    submitButton = button(
      mine?.submitted ? "送信済み・再送信できます" : "ワードを送信",
      () => {
        void run(send);
      },
    );
    content.append(submitButton);
    const status = el("p", "", "hint");
    status.id = "collection-status";
    status.setAttribute("aria-live", "polite");
    content.append(status);
    content.append(jp("h3", "ほかのみんなの入力"));
    others = el("div", undefined, "others");
    content.append(others);
    if (isHost) {
      const b = button(
        "配置へ進む",
        () => action({ type: "candidates" }),
        "secondary",
      );
      b.id = "to-arrange";
      content.append(b);
    }
    disposed = () => clearTimeout(syncTimer);
    return;
  }
  if (r.phase === "arrange" || r.phase === "predict") {
    const arranging = r.phase === "arrange";
    const editable = !s.answer && (!arranging || hero === me);
    heading(
      hero === me ? "YOUR PERSONAL TIER" : "GUESS THEIR TIER",
      hero === me ? "あなたの好みで並べよう" : "主役の好みを予想しよう",
      `テーマ：${r.theme}`,
    );
    if (r.rejected.length)
      content.append(
        jp(
          "p",
          `重複した${r.rejected.length}個を除き、${r.candidates.length}個で遊びます。`,
          "hint",
        ),
      );
    if (!arranging) {
      const status = el("p", "", "hint");
      status.id = "prediction-status";
      content.append(status);
    }
    if (editable) {
      const key = localKey("placement");
      let placement = restore<Placement>(key, {});
      const editor = el("div");
      let send: HTMLButtonElement;
      const placementEditor = createPlacementEditor(
        editor,
        r.candidates,
        placement,
        (p) => {
          placement = p;
          sessionStorage.setItem(key, JSON.stringify(p));
          send.disabled = !completePlacement(r.candidates, p);
        },
      );
      disposed = () => placementEditor.destroy();
      send = button("配置を確定", () => {
        void run(async () => {
          await store.saveAnswer(roomId, r.roundId, {
            placement,
            submittedAt: Date.now(),
          });
        });
      });
      send.disabled = !completePlacement(r.candidates, placement);
      content.append(editor, send);
    } else
      content.append(
        jp(
          "p",
          s.answer && !arranging
            ? "確定しました。主役を含む全員の確定を待っています。"
            : "いまは待機中です。主役の意外な好みを想像してみよう。",
          "notice",
        ),
      );
    return;
  }
  if (r.phase === "reveal") {
    heading("THE BIG REVEAL", "答え合わせ", `テーマ：${r.theme}`);
    renderResults(content, s, false, me, () => action({ type: "next" }));
  }
}
async function boot() {
  try {
    store = await createStore();
    mode.textContent =
      store.mode === "firebase" ? "オンライン" : "ローカル確認";
    mode.classList.toggle("local", store.mode === "local");
    if (roomId) {
      try {
        await store.read(roomId);
        connect();
      } catch {
        home(true);
      }
    } else home();
  } catch (e) {
    main.replaceChildren(jp("h1", "接続を開始できませんでした"));
    errorBox = el("p", undefined, "notice error");
    main.append(errorBox);
    showError(e);
    main.append(button("もう一度試す", () => location.reload()));
  }
}
window.addEventListener("popstate", () => location.reload());
void boot();
