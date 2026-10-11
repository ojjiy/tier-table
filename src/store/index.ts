import type { Store } from "./types";
import { LocalStore } from "./local";
export async function createStore(): Promise<Store> {
  const e = import.meta.env;
  if (e.VITE_FIREBASE_API_KEY && e.VITE_FIREBASE_PROJECT_ID) {
    const { firebaseStore } = await import("./firebase");
    return firebaseStore();
  }
  let id = sessionStorage.getItem("tier-player");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("tier-player", id);
  }
  return new LocalStore(id);
}
