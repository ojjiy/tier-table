# みんなのティア予想

通話しながら遊ぶ、2〜6人のティア表予想ゲームです。ホストがテーマを決め、参加者がワードを持ち寄り、主役の好みを予想します。既存作品のアイデアを参考にした独自の非公式ブラウザ実装です。

## 遊び方

1. 名前を入力してルームを作り、URLを共有します。
2. ホストが開始し、テーマを入力します。
3. 全員（主役を含む）が候補ワードを入力します。2人なら1人3個、3〜4人なら2個、5〜6人なら1個です。
4. 主役とほかの人が同時にS〜Dへ配置します。主役は自分の好み、ほかの人は主役の好みを予想します。時間制限はありません。1段に複数置けます。段内の順番は問いません。
5. 主役を含む全員が確定したら答え合わせ。一致したワードごとに1点です。
6. 入室順に主役を交代し、全員が1回担当したら累計順位を表示します。

候補は約400ms遅延で共有します。送信時に重複を確認し、配置開始時にも重複を除きます。除去後に5個未満なら、重なったワードを修正して再送信します。同義語や「カレー／カレーライス」の意味的な重複は判定しません。

## ローカルで起動

Node.js 24 LTSを推奨します。

```sh
npm ci
npm run dev
```

[ローカル画面](http://127.0.0.1:4173/)を開きます。Firebaseを設定しなくても同じブラウザの複数タブで遊べます。別ブラウザ・別端末・プライベートウィンドウ間では同期しません。この確認モードの保存データは同一ブラウザ内にあるため、回答の秘密性は保証しません。

## Firebaseを設定してオンラインで遊ぶ

既存ito用とは別のFirebaseプロジェクトを使ってください。

1. [Firebase Console](https://console.firebase.google.com/)でプロジェクトを作成し、Webアプリを登録します。Analyticsは不要です。
2. Authentication → Sign-in methodで「匿名」を有効にします。
3. Firestore DatabaseをStandard edition・本番モードで作成します。リージョンは参加者に近い場所を選んでください。
4. `firestore.rules`の全文をFirestore → ルールへ貼り付けて公開します。テスト用の全許可ルールは使用しません。CLIの場合は `npx firebase login` の後に `npx firebase deploy --only firestore:rules --project YOUR_PROJECT_ID` でも配置できます。
5. Authentication → Settings → Authorized domainsに公開先ドメイン（例：`ojjiy.github.io`）を追加します。
6. `.env.example`を`.env.local`へコピーし、Webアプリの`apiKey`、`authDomain`、`projectId`、`appId`を対応する`VITE_FIREBASE_*`へ入力します。
7. 開発サーバーを再起動します。画面右上が「オンライン」になればFirebaseモードです。

Firebase Web設定はブラウザへ公開される識別情報です。サービスアカウント秘密鍵や管理者用資格情報を入力しないでください。アクセスは匿名認証とFirestoreルールで制御します。プレイヤー同士の回答は公開まで読み取れず、回答の変更もできません。部外者にはロビーへの参加に必要な情報のみ読み取りを許可し、開始後のゲーム情報は参加者だけが読めます。

### App Check

App Checkを強制適用する場合は、Webアプリに登録したサイトキーを`VITE_FIREBASE_APPCHECK_SITE_KEY`へ、プロバイダを`VITE_FIREBASE_APPCHECK_PROVIDER`へ設定します。値はreCAPTCHA Enterpriseなら`enterprise`、reCAPTCHA v3なら`v3`です。GitHub ActionsのVariablesにも同名で登録してください。許可ドメインには自分の公開先（例：`ojjiy.github.io`）を登録します。シークレットキーは使用しません。

アプリはFirebase接続前にApp Checkを初期化し、トークンの自動更新を有効にします。Emulatorでは本番App Checkを起動しません。許可していないlocalhostでは本番接続が拒否されるため、ローカル確認はFirebase設定を空にしたモードかEmulatorを使ってください。[Firebase公式の設定手順](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)も参照できます。

## GitHub Pagesへ公開

1. 本リポジトリをGitHubへpushします。
2. Settings → Pages → Build and deploymentで **GitHub Actions** を選びます。
3. Settings → Secrets and variables → Actions → **Variables** に以下の4つを登録します。
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
4. `main`へのpushまたはActionsの手動実行でテスト・ビルド・公開します。

公開URLは通常 `https://OWNER.github.io/REPOSITORY/` です。サブパスはワークフローがリポジトリ名から設定します。Firebase Variablesが空なら、公開画面もローカル確認モードとなり、オンライン参加はできません。

## 検証

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:e2e:pages
```

Firestore権限とFirebase同期のテストにはJava 21以上も必要です。テストは`demo-tier-table`のEmulatorだけに接続し、本番データを変更しません。

```sh
npm run test:rules
npm run test:e2e:firebase
```

GitHub ActionsでもJavaとChromiumを用意し、上記の検証を実行します。

## 復帰と制限

- 同じタブでの再読み込みは参加IDを引き継ぎます。タブを閉じる、ブラウザデータを削除するなどで匿名IDを失うと、開始済みゲームへ復帰できません。
- 主役がいなくなった場合は正解の公開を待ちます。主役が元のタブで復帰すると公開します。
- 参加者一覧から、自分以外の人を確認ダイアログ付きでキックできます。ホストをキックした場合は、残った入室順で先頭の人へホストを引き継ぎます。
- キック時は進行中のラウンドをやり直し、人数に合わせて入力数を調整します。完了済みの得点は保持します。公開済みの答え合わせは完了扱いとして次の主役へ進み、残り1人なら結果を表示して終了します。
- キックされた同じ参加IDでは再参加できません。新しい匿名IDの取得まで阻止する本人認証は行いません。
- ワード募集の厳密な排他制御は行いません。入力の見える化と二段階の重複検証で対応します。
- ルームの有効期限や自動削除は初期版に含みません。不要になったルームはFirebase Consoleで配下のデータも含め削除できます。

日本語はBudouXをバンドルし、テキストノードと`wbr`で表示します。入力欄・URL・短い更新ラベルには適用しません。
