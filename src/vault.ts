import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Session } from "./types";
const vault = registerPlugin<{
  get(): Promise<{ value: string | null }>;
  set(options: { value: string }): Promise<void>;
  clear(): Promise<void>;
}>("AccountVault");
// Browser preview sessions are memory-only; no bearer token is put in Web Storage.
let browserSession: Session | null = null;
export const sessionVault = {
  async read(): Promise<Session | null> {
    if (!Capacitor.isNativePlatform()) return browserSession;
    const { value } = await vault.get();
    return value ? JSON.parse(value) : null;
  },
  async write(session: Session) {
    if (Capacitor.isNativePlatform())
      await vault.set({ value: JSON.stringify(session) });
    else browserSession = session;
  },
  async clear() {
    if (Capacitor.isNativePlatform()) await vault.clear();
    browserSession = null;
  },
};
