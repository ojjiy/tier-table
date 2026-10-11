import { test, expect, type Page } from "@playwright/test";
async function words(p: Page, ws: string[]) {
  for (let i = 0; i < ws.length; i++)
    await p.getByLabel(`ワード${i + 1}`, { exact: true }).fill(ws[i]);
  await p.getByRole("button", { name: "ワードを送信", exact: true }).click();
}
async function place(p: Page) {
  await expect(p.locator(".game-panel button.word-chip")).toHaveCount(6);
  await expect(p.locator("select")).toHaveCount(0);
  while (await p.locator(".word-bank .word-chip").count())
    await p
      .locator(".word-bank .word-chip")
      .first()
      .dragTo(p.locator(".tier-S"));
  await p.getByRole("button", { name: "配置を確定", exact: true }).click();
}
test("2タブで2ラウンドを遊び、320pxでもはみ出さず復帰する", async ({
  context,
  page: a,
}) => {
  await a.goto("/");
  await a.getByLabel("あなたの名前").fill("あお");
  await a.getByRole("button", { name: "ルームをつくる" }).click();
  await expect(
    a.getByRole("heading", { name: "みんなを待っています" }),
  ).toBeVisible();
  const guestContext = process.env.TEST_FIREBASE
    ? await context.browser()!.newContext()
    : context;
  const b = await guestContext.newPage();
  await b.goto(a.url());
  await b.getByLabel("あなたの名前").fill("みどり");
  await b.getByRole("button", { name: "ルームに参加" }).click();
  await expect(a.getByText("みどり", { exact: true })).toBeVisible();
  await expect(b.locator(".players .player")).toHaveCount(2);
  const bounds = await b.locator(".players").boundingBox();
  const panel = await b.locator(".game-panel").boundingBox();
  expect(bounds!.y).toBeLessThan(panel!.y);
  await a.getByRole("button", { name: "ゲームをはじめる" }).click();
  for (let round = 0; round < 2; round++) {
    await a
      .getByLabel("今回のテーマ", { exact: true })
      .fill("休日に食べたいもの");
    await a.getByRole("button", { name: "ワード募集をはじめる" }).click();
    await a.getByLabel("ワード1", { exact: true }).fill("カレー");
    await expect(b.locator(".others")).toContainText("カレー");
    await b.getByLabel("ワード1", { exact: true }).fill("カレー");
    await b.getByLabel("ワード2", { exact: true }).fill("パン");
    await b.getByLabel("ワード3", { exact: true }).fill("ピザ");
    await b.getByRole("button", { name: "ワードを送信", exact: true }).click();
    await expect(b.locator("#error")).toContainText("重複");
    await words(a, ["カレー", "うどん", "寿司"]);
    await words(b, ["ラーメン", "パン", "ピザ"]);
    await a.getByRole("button", { name: "配置へ進む" }).click();
    const hero = round === 0 ? a : b,
      guess = round === 0 ? b : a;
    await expect(
      hero.getByRole("heading", { name: "あなたの好みで並べよう" }),
    ).toBeVisible();
    await expect(guess.locator(".word-bank .word-chip")).toHaveCount(6);
    await expect(guess.locator(".timer")).toHaveCount(0);
    await expect(
      guess.getByRole("heading", { name: "主役の好みを予想しよう" }),
    ).toBeVisible();
    await guess.reload();
    await expect(
      guess.getByRole("heading", { name: "主役の好みを予想しよう" }),
    ).toBeVisible();
    if (round === 0) {
      await guess.setViewportSize({ width: 320, height: 780 });
      const chip = guess.locator(".word-bank .word-chip").first(),
        row = guess.locator(".tier-S");
      await row.scrollIntoViewIfNeeded();
      const from = await chip.boundingBox(),
        to = await row.boundingBox();
      const cdp = await guess.context().newCDPSession(guess);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: from!.x + from!.width / 2, y: from!.y + from!.height / 2 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: to!.x + to!.width / 2, y: to!.y + to!.height / 2 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
      await expect(guess.locator(".word-bank .word-chip")).toHaveCount(5);
    }
    await place(guess);
    await expect(
      guess.getByRole("heading", { name: "答え合わせ" }),
    ).toHaveCount(0);
    await place(hero);
    await expect(a.getByRole("heading", { name: "答え合わせ" })).toBeVisible();
    await expect(a.getByText("6点", { exact: true }).first()).toBeVisible();
    await a
      .getByRole("button", {
        name: round === 0 ? "次のラウンドへ" : "最終結果を見る",
      })
      .click();
  }
  await expect(a.getByRole("heading", { name: "みんなの結果" })).toBeVisible();
  await a.setViewportSize({ width: 320, height: 780 });
  expect(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  if (guestContext !== context) await guestContext.close();
});
test("入力されたHTMLは実行されない", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("あなたの名前").fill("<img src=x>");
  await page.getByRole("button", { name: "ルームをつくる" }).click();
  await expect(
    page.getByRole("heading", { name: "みんなを待っています" }),
  ).toBeVisible();
  await expect(page.locator(".players img")).toHaveCount(0);
});

test("入力中のIMEイベントとフォーカスを保ち、共有・コピーできる", async ({
  context,
  page: a,
}) => {
  await a.setViewportSize({ width: 320, height: 780 });
  await a.goto("/");
  await a.getByLabel("あなたの名前").fill("主役");
  await a.getByRole("button", { name: "ルームをつくる" }).click();
  await expect(
    a.getByRole("heading", { name: "みんなを待っています" }),
  ).toBeVisible();
  const b = await context.newPage();
  await b.goto(a.url());
  await b.getByLabel("あなたの名前").fill("相手");
  await b.getByRole("button", { name: "ルームに参加" }).click();
  await a.getByRole("button", { name: "ゲームをはじめる" }).click();
  await a
    .getByLabel("今回のテーマ", { exact: true })
    .fill(
      "とても長い日本語のテーマでも画面からはみ出さず読みやすく表示できるか確認します",
    );
  await a.getByRole("button", { name: "ワード募集をはじめる" }).click();
  const input = a.getByLabel("ワード1", { exact: true });
  await input.focus();
  await input.dispatchEvent("compositionstart");
  await input.fill("変換中");
  await input.dispatchEvent("input", { isComposing: true });
  await a.waitForTimeout(650);
  await expect(b.locator(".others")).not.toContainText("変換中");
  await input.dispatchEvent("compositionend");
  await expect(b.locator(".others")).toContainText("変換中");
  await b.getByLabel("ワード1", { exact: true }).fill("別の入力");
  await expect(a.locator(".others")).toContainText("別の入力");
  await expect(input).toBeFocused();
  const copied = await a.locator("h1").evaluate((n) => {
    const r = document.createRange();
    r.selectNodeContents(n);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    return s.toString();
  });
  expect(copied).toBe("候補ワードを持ち寄ろう");
  expect(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  if (!process.env.TEST_FIREBASE) {
    await a.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k.startsWith("tier-room:")) throw new Error("保存テストエラー");
        return original.call(this, k, v);
      };
    });
    await input.fill("りんご");
    await a.getByLabel("ワード2", { exact: true }).fill("みかん");
    await a.getByLabel("ワード3", { exact: true }).fill("ぶどう");
    await a.getByRole("button", { name: "ワードを送信", exact: true }).click();
    await expect(a.locator("#error")).toContainText("保存テストエラー");
    await expect(input).toHaveValue("りんご");
    await expect(a.locator("#collection-status")).toContainText("0 / 2");
  }
});

test("送信中はワードを固定し、完了後に編集できる", async ({
  context,
  page: a,
}) => {
  test.skip(
    Boolean(process.env.TEST_FIREBASE),
    "local storeの遅延を使うUI競合試験",
  );
  await a.goto("/");
  await a.getByLabel("あなたの名前").fill("a");
  await a.getByRole("button", { name: "ルームをつくる" }).click();
  await expect(
    a.getByRole("heading", { name: "みんなを待っています" }),
  ).toBeVisible();
  const b = await context.newPage();
  await b.goto(a.url());
  await b.getByLabel("あなたの名前").fill("b");
  await b.getByRole("button", { name: "ルームに参加" }).click();
  await a.getByRole("button", { name: "ゲームをはじめる" }).click();
  await a.getByLabel("今回のテーマ", { exact: true }).fill("t");
  await a.getByRole("button", { name: "ワード募集をはじめる" }).click();
  for (let i = 0; i < 3; i++)
    await a
      .getByLabel(`ワード${i + 1}`, { exact: true })
      .fill(["りんご", "みかん", "ぶどう"][i]);
  await a.evaluate(async () => {
    const path = "/src/store/local.ts";
    const { LocalStore } = await import(path);
    const original = LocalStore.prototype.submitDraft;
    LocalStore.prototype.submitDraft = async function (...args: unknown[]) {
      await new Promise((r) => setTimeout(r, 1200));
      return original.apply(this, args);
    };
  });
  await a.getByRole("button", { name: "ワードを送信", exact: true }).click();
  await expect(a.getByLabel("ワード1", { exact: true })).toBeDisabled();
  await expect(
    a.getByRole("button", { name: "送信済み・再送信できます", exact: true }),
  ).toBeVisible();
  await expect(a.getByLabel("ワード1", { exact: true })).toBeEnabled();
});

test("長い候補を画面外のD段までタッチドラッグできる", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/");
  await expect(page.getByLabel("あなたの名前")).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/ui/placement.ts";
    const { createPlacementEditor } = await import(path);
    document.querySelector("main")!.replaceChildren();
    const area = document.createElement("div");
    document.querySelector("main")!.append(area);
    createPlacementEditor(
      area,
      Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        text: `${i}長い候補ワードをドラッグして画面の外にある段まで配置できるか確認`,
        ownerId: "a",
        slot: i,
      })),
      {},
      () => {},
    );
  });
  const chip = page.locator(".word-bank .word-chip").first();
  await chip.scrollIntoViewIfNeeded();
  const from = await chip.boundingBox();
  const before = await page.evaluate(() => scrollY);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from!.x + 50, y: from!.y + 15 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 160, y: 770 }],
  });
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before + 100);
  await expect
    .poll(async () => (await page.locator(".tier-D").boundingBox())!.y)
    .toBeLessThan(700);
  const to = await page.locator(".tier-D").boundingBox();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 160, y: Math.max(10, to!.y + 35) }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".tier-D .word-chip")).toHaveCount(1);
  await expect(page.locator(".drag-ghost")).toHaveCount(0);
  await cdp.detach();
});
test("複数の指が触れてもドラッグの残像を残さない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("あなたの名前")).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/ui/placement.ts";
    const { createPlacementEditor } = await import(path);
    const m = document.querySelector("main")!;
    m.replaceChildren();
    createPlacementEditor(
      m,
      [
        { id: "a", text: "一つ目", ownerId: "a", slot: 0 },
        { id: "b", text: "二つ目", ownerId: "a", slot: 1 },
      ],
      {},
      () => {},
    );
  });
  const a = await page.locator(".word-bank .word-chip").nth(0).boundingBox(),
    b = await page.locator(".word-bank .word-chip").nth(1).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const p1 = { id: 1, x: a!.x + 15, y: a!.y + 15 },
    p2 = { id: 2, x: b!.x + 15, y: b!.y + 15 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [p1],
  });
  p1.y += 20;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [p1],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [p1, p2],
  });
  p2.y += 20;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [p1, p2],
  });
  await expect(page.locator(".drag-ghost")).toHaveCount(1);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".drag-ghost")).toHaveCount(0);
  await expect(page.locator(".dragging")).toHaveCount(0);
  await cdp.detach();
});
