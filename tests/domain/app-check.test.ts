import { it, expect, vi, beforeEach } from "vitest";
const initialize = vi.hoisted(() => vi.fn());
vi.mock("firebase/app-check", () => ({
  initializeAppCheck: initialize,
  ReCaptchaEnterpriseProvider: class {
    kind = "enterprise";
    constructor(public siteKey: string) {}
  },
  ReCaptchaV3Provider: class {
    kind = "v3";
    constructor(public siteKey: string) {}
  },
}));
import { configureAppCheck } from "../../src/store/app-check";
beforeEach(() => initialize.mockClear());
it("Emulatorでは本番App Checkを呼び出さない", () => {
  configureAppCheck({} as any, {
    VITE_USE_EMULATORS: "true",
    VITE_FIREBASE_APPCHECK_SITE_KEY: "key",
    VITE_FIREBASE_APPCHECK_PROVIDER: "enterprise",
  });
  expect(initialize).not.toHaveBeenCalled();
});
it("Enterpriseの公開キーでトークン自動更新を有効にする", () => {
  configureAppCheck({} as any, {
    VITE_FIREBASE_APPCHECK_SITE_KEY: "key",
    VITE_FIREBASE_APPCHECK_PROVIDER: "enterprise",
  });
  expect(initialize).toHaveBeenCalledWith(
    {},
    expect.objectContaining({
      provider: expect.objectContaining({ siteKey: "key", kind: "enterprise" }),
      isTokenAutoRefreshEnabled: true,
    }),
  );
});
it("v3を選択でき、不明なプロバイダは明示的に拒否する", () => {
  configureAppCheck({} as any, {
    VITE_FIREBASE_APPCHECK_SITE_KEY: "key",
    VITE_FIREBASE_APPCHECK_PROVIDER: "v3",
  });
  expect(initialize.mock.calls[0][1].provider.kind).toBe("v3");
  expect(() =>
    configureAppCheck({} as any, {
      VITE_FIREBASE_APPCHECK_SITE_KEY: "key",
      VITE_FIREBASE_APPCHECK_PROVIDER: "other",
    }),
  ).toThrow();
});
