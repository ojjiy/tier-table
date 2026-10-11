import type { FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
} from "firebase/app-check";
export function configureAppCheck(
  app: FirebaseApp,
  env: Record<string, string | undefined>,
) {
  const key = env.VITE_FIREBASE_APPCHECK_SITE_KEY;
  if (env.VITE_USE_EMULATORS === "true" || !key) return;
  const provider = env.VITE_FIREBASE_APPCHECK_PROVIDER;
  if (provider !== "enterprise" && provider !== "v3")
    throw new Error(
      "App Checkのプロバイダ設定を確認してください（enterprise または v3）。",
    );
  initializeAppCheck(app, {
    provider:
      provider === "enterprise"
        ? new ReCaptchaEnterpriseProvider(key)
        : new ReCaptchaV3Provider(key),
    isTokenAutoRefreshEnabled: true,
  });
}
