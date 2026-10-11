# ティア表予想ゲーム Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参加者が候補ワードを持ち寄り、交代する主役のティア表を予想するゲームを実装してGitHub Pagesで公開する。

**Architecture:** ViteでTypeScriptの静的サイトをビルドする。進行・入力・秘密の回答を分離し、Firestoreとローカル同期を同じストアインターフェースで扱う。ゲームの計算は純粋関数に集約し、画面や通信から独立して検証する。

**Tech Stack:** TypeScript、Vite、Firebase SDK、BudouX、Vitest、Playwright、Firebase Emulator。

**Spec:** `docs/superpowers/specs/2026-10-11-tier-table-design.md`

## Global Constraints

- 2〜6人、主役も入力に参加し、各自の入力数は `ceil(5 / 参加人数)`。
- S・A・B・C・Dの5段階に複数のワードを配置できる。同じ段内の左右順は採点しない。
- 下書きを約400msのdebounceで同期する。日本語IMEの変換途中では同期を抑える。
- ワードは各40文字。比較はNFKC正規化、前後空白除去、連続空白単一化、英字小文字化。
- ワード募集でトランザクションによる排他制御は行わない。
- 予想は180秒、一致したワードごとに1点。未提出者は0点、主役は得点なし。
- Firebase未設定時は同一ブラウザの複数タブ用ローカルモードと明示する。
- BudouXをバンドルし、320px幅、コピー操作、動的更新を確認する。
- 既存itoのFirebaseデータやルールを変更しない。

## Review Focus

- 同時送信後の重複で候補が5個未満になる場合、修正対象を示して募集に留まる（Task 1・3）。
- 以前のラウンドの遅延書き込みが新ラウンドを汚さない（Task 2）。
- IMEの変換中や通信失敗時に入力内容・カーソルが失われない（Task 3）。
- 再読み込み・期限直前の提出・主役不在でも回答を早期公開しない（Task 2・4）。
- GitHub Pagesのサブパスから共有URLを開ける（Task 5）。

## ファイル構成と共通型

- `src/domain/types.ts`: `Tier = 'S' | 'A' | 'B' | 'C' | 'D'`、`Phase = 'lobby' | 'theme' | 'collect' | 'arrange' | 'predict' | 'reveal' | 'finished'`。`Player { id, name, joinedAt }`、`Word { id, text, ownerId, slot }`、`Draft { playerId, words: string[], submitted: boolean }`、`Placement = Record<string, Tier>`、`Answer { placement, submittedAt }`、`RoundResult { roundId, correct: Placement, guesses: Record<string, Answer>, scores: Record<string, number> }`、`Room { id, hostId, players, roster: string[], phase, roundId, roundIndex, theme, candidates: Word[], predictionDeadline: number | null }`を定義する。
- `src/domain/words.ts`, `game.ts`: 入力検証、候補確定、採点、進行条件。
- `src/store/types.ts`, `local.ts`, `firebase.ts`, `index.ts`: 永続化と購読。`firestore.rules`、`firebase.json`: Firebase用設定。
- `src/ui/japanese-text.ts`, `placement.ts`, `screens.ts`, `styles.css`: テキスト表示、配置操作、各フェーズの画面。
- `src/main.ts`, `index.html`: 起動、購読、イベント接続。
- `tests/domain/*.test.ts`, `tests/store/*.test.ts`, `tests/e2e/*.spec.ts`: ロジック・権限・ユーザー操作の検証。
- `package.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `.env.example`, `.gitignore`, `.github/workflows/pages.yml`, `README.md`: 開発・検証・公開。

### Task 1: 候補ワードとゲーム計算

**Files:** 共通型、domain、domainテスト、package.json、tsconfig.json、.gitignore。

**Interfaces:** `quota(n: number): number`、`wordKey(text: string): string`、`validateDraft(playerId: string, words: string[], drafts: Draft[], count: number): Record<number, string>`、`finalizeCandidates(roster: string[], drafts: Draft[]): { candidates: Word[]; rejected: { playerId: string; slot: number }[]; ready: boolean }`、`scoreRound(candidates: Word[], correct: Placement, guesses: Record<string, Answer>, protagonistId: string): Record<string, number>`をexportする。候補IDはラウンド内で所有者とslotから決定し、テキスト変更で採点対象をすり替えない。

- [ ] Vitestの実行環境を設定し、`quota`の人数2〜6に対する結果が`[3, 2, 2, 1, 1]`になるテストを書く。正規化では`wordKey(' Ａ  B ') === wordKey('a b')`を検証する。
- [ ] `npm test -- tests/domain`で未実装による失敗を確認する。
- [ ] 共通型とwords関数を実装する。未入力・41文字・自分と他人の重複を区別する。候補確定では入室順・slot順を使い、5個未満なら`ready: false`と修正対象を返す。
- [ ] 候補10個以下、競合後4個への差し戻し、同じ段の左右順に依存しない得点、未提出0点、主役除外、同点順位のテストを追加し、game関数を実装する。`nextProtagonist(roster: string[], roundIndex: number): string | null`、`rankScores(scores: Record<string, number>): { playerId: string; score: number; rank: number }[]`をexportする。
- [ ] `npm test -- tests/domain`と`npx tsc --noEmit`が成功することを確認し、このタスクをコミットする。

### Task 2: 同期ストアと回答のアクセス制御

**Files:** store、Firebase設定、storeテスト、.env.example。

**Interfaces:** `createStore(): Promise<Store>`。`Store`は`mode`、`playerId`、`createRoom(name: string): Promise<string>`、`joinRoom(roomId: string, name: string): Promise<void>`、`subscribe(roomId: string, listener: (snapshot: RoomSnapshot) => void): () => void`、`saveDraft(roomId: string, roundId: string, draft: Draft): Promise<void>`、`submitDraft(roomId: string, roundId: string, words: string[]): Promise<void>`、`saveAnswer(roomId: string, roundId: string, answer: Answer): Promise<void>`、`advance(roomId: string, action: HostAction): Promise<void>`、`publishCorrect(roomId: string, roundId: string): Promise<void>`を提供する。`RoomSnapshot`はroom、drafts、自分のanswer、公開済みresultsを含む。`HostAction`は開始、テーマ確定、候補確定、予想締切、次ラウンドに限定する。

- [ ] ローカルストア契約テストを書き、参加上限・開始後参加禁止・ホスト限定進行・古いroundIdの更新拒否を検証する。未実装で失敗することを確認する。
- [ ] localStorageとstorageイベントによるストアを実装する。参加IDはsessionStorageでタブごとに保持し、同じタブの再読み込みでは復帰する。秘密回答をUIへ公開する条件もFirebaseと合わせる。
- [ ] Firestore Emulator権限テストを書く。匿名認証の本人のみ秘密回答を読めること、他人の入力や回答への書き込み禁止、候補確定後の入力変更禁止、期限後の予想変更禁止、部外者の読み取り禁止をassertする。
- [ ] Firestoreストアとルールを実装する。`rooms/{roomId}`と配下のmembers、ラウンド別drafts・answers・resultsを分離する。未参加者はroomIdを知っていてもゲームデータを読めず、ロビー参加用の最小情報だけ取得できる構造とする。進行条件はルールでも検証する。
- [ ] 予想終了時は回答を締め切ってから主役が正解を公開する。公開前の正解は主役のみ読める。予想は公開フェーズでルーム参加者に読み取り可能にし、結果を計算する。正解未公開なら待機して主役復帰時に再試行し、同じラウンドを二重加算しない。
- [ ] `npm test -- tests/store`、`npm run test:rules`を実行して成功を確認し、コミットする。Emulatorが実行できない場合は権限検証を未確認と記録し、公開前の未解決事項として扱う。

### Task 3: ロビー・テーマ・ワード募集画面

**Files:** index.html、main、screens、japanese-text、styles、Vite設定、募集のe2e。

**Interfaces:** `renderScreen(root: HTMLElement, snapshot: RoomSnapshot, actions: UiActions): void`、`setJapaneseText(element: HTMLElement, text: string): void`。`UiActions`はStore操作を呼ぶ非同期ハンドラーを提供し、エラーを画面へ返す。画面更新でフォーカス中のinputを作り直さない。

- [ ] Playwrightで2タブ参加、ホストのテーマ入力、人数に応じた入力欄、相手の下書き反映、重複エラー、保存失敗後の下書き保持を検証するテストを書く。未実装の失敗を確認する。
- [ ] Vite、BudouX、Firebaseを依存関係へ追加し、ホーム、共有リンク、ロビー、テーマ、ワード募集を実装する。Firebase未設定ならローカルモードの制限を明示する。
- [ ] 入力欄をローカル保持し、400ms debounceとcompositionイベントで同期する。送信直前に最新のdraftsで検証し、成功後のみ送信済みにする。募集再開時は修正対象欄を表示する。
- [ ] BudouXをテキストノードと安全なDOM生成で適用する。input、textarea、URL、短い更新ラベルへ適用しない。入力されたHTML風文字列は文字列として表示する。
- [ ] `npm run test:e2e -- tests/e2e/collection.spec.ts`と`npm run build`が成功することを確認し、コミットする。

### Task 4: 配置・予想・結果と復帰

**Files:** placement、screens、main、styles、ゲーム進行のe2e。

**Interfaces:** `createPlacementEditor(container: HTMLElement, candidates: Word[], value: Placement, onChange: (next: Placement) => void): { update(value: Placement): void; destroy(): void }`。段の選択、ドラッグ、キーボードで同一のPlacementを更新する。

- [ ] 2人で募集から主役配置、予想、正解公開、交代、最終順位まで進むe2eを書く。5個超の候補、複数ワード同段、全ワード未配置時の提出不可をassertし、失敗を確認する。
- [ ] 配置エディターと各画面を実装する。未送信配置はローカル保持し、保存エラー時は編集内容を残す。正解は提出まで主役だけに表示する。
- [ ] 期限は保存済みの絶対時刻を用いて描画する。予想の途中状態は本人だけ保持し、期限前の有効な提出のみ採用する。全員提出・期限でホストが締め切り、主役が正解を公開する。
- [ ] 再読み込み復帰、主役不在での公開待機、期限後提出拒否、二重採点防止をe2eへ追加する。Firestoreでは独立したブラウザコンテキストを使う。
- [ ] `npm run test:e2e -- tests/e2e/game.spec.ts`を実行し、320px・PC幅で横はみ出し、BudouX、コピー、動的更新、タップとキーボードを目視確認する。IMEは実機で確認し、自動イベント試験との違いを記録する。
- [ ] このタスクをコミットする。

### Task 5: GitHub Pages公開と最終検証

**Files:** .github/workflows/pages.yml、README.md、vite.config.ts、公開設定、共有URLのe2e。

**Interfaces:** `npm test`、`npm run test:rules`、`npm run test:e2e`、`npm run build`を標準コマンドとする。公開用設定はVite環境変数から読み込み、READMEにFirebase匿名認証・ルール・認可ドメイン・Pages設定を記載する。

- [ ] `/tier-table/`配下でホームと`?room=...`の共有リンクが動くe2eを書き、必要なbase設定前の失敗を確認する。
- [ ] GitHub Actionsでnpm ci、型検査、単体テスト、ビルド、Pages artifact upload、deployを構成する。Firebase設定値はGitHub Variablesで渡し、認証用秘密鍵はフロントへ含めない。
- [ ] ghで認証状態と公開先の既存リポジトリを確認する。既存itoの所有者はojjiyだが、新規公開先は現在の認証・既存tier-tableリポジトリを確認して決める。既存内容を上書きせず、本リポジトリのremoteを設定する。
- [ ] 新アプリ用Firebaseプロジェクトの利用可能性を確認する。新規作成・有料プラン・認証が必要で自動完了できない場合は設定手順を提供し、オンライン同期の検証・公開完了と混同しない。
- [ ] 全標準コマンドを実行する。検出した不具合を修正し、必要な範囲だけ再検証する。READMEに実行方法、ルール、復帰待ち、ローカル制約を記載する。
- [ ] レビューで権限漏れ、未提出・期限、同時送信、サブパスを確認して修正する。コミットとpush後、Pagesワークフロー成功と公開URLをブラウザで確認する。別端末相当の2セッションで最終ゲームを確認し、実測した結果と未確認事項を報告する。

## 自己レビュー

仕様の全節をTask 1〜5へ対応付けた。候補数・重複・締め切り・回答秘匿・復帰・公開の検証を含む。主役不在時の待機とホスト自動移譲なしは仕様どおり。入力に排他トランザクションを導入しない。既存itoのFirebaseは参照だけとし変更しない。
