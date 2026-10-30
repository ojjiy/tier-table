# Kick後の再参加 Implementation Plan

Goal: 同一IDで退出者が進行中のゲームへ戻れる。
Architecture: 共通joinTransitionで参加更新を生成し、Local/Firebaseから利用。Firestore rulesも同じ状態遷移を検証。
Tech Stack: TypeScript, Firebase, Vitest, Playwright
Spec: docs/superpowers/specs/2026-10-30-kick-rejoin-design.md

- [x] 再参加、ラウンド再開、公開済み結果保持、満員・終了・未退出者の途中参加禁止の回帰テストを追加。
- [x] logic.tsに共通joinTransitionを実装し両storeから呼ぶ。
- [x] Firestoreで退出者のルーム取得と限定的再参加更新を許可。再参加前の回答権限は維持。
- [x] UI説明・README・既存ban前提テストを更新。
- [x] unit/build/E2Eを検証。
- [ ] rulesテスト実行（Java Runtime未導入により実行不可）。
