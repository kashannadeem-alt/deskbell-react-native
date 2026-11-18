import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { DeskbellStore, isDeskbellNotification } from "./store";
import { deviceLocale } from "./strings";
import type { DeskbellPushOptions, DeskbellStorage, DeskbellSubscription, DeskbellUser } from "./types";

/** AsyncStorage when it's installed, so the device ID survives restarts; in-memory otherwise. */
function defaultStorage(): DeskbellStorage {
  try {
    // Optional peer dependency; Metro treats a require inside try/catch as optional.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@react-native-async-storage/async-storage").default as DeskbellStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: async (k) => memory.get(k) ?? null,
      setItem: async (k, v) => void memory.set(k, v),
      removeItem: async (k) => void memory.delete(k),
    };
  }
}

/** Device model and app version for the inbox's user panel, read from Expo modules when the app has them. */
function deviceDetails() {
  // Optional peer dependencies. Metro only treats a require as optional when the require call itself sits inside a
  // try block, so each one gets its own; a helper that takes a closure would make a missing module break the bundle.
  /* eslint-disable @typescript-eslint/no-require-imports */
  let Device: { modelName: string | null } | null = null;
  let Application: { nativeApplicationVersion: string | null; nativeBuildVersion: string | null } | null = null;
  let Constants: { expoConfig?: { version?: string; ios?: { buildNumber?: string } } | null } | null = null;
  try {
    Device = require("expo-device");
  } catch {}
  try {
    Application = require("expo-application");
  } catch {}
  try {
    Constants = require("expo-constants").default;
  } catch {}
  /* eslint-enable @typescript-eslint/no-require-imports */

  // Android reports its API level, not the marketing version.
  const os = Platform.OS === "ios" ? `iOS ${Platform.Version}` : Platform.OS === "android" ? `Android (API ${Platform.Version})` : `${Platform.OS} ${Platform.Version}`;
  const version = Application?.nativeApplicationVersion ?? Constants?.expoConfig?.version;
  const build = Application?.nativeBuildVersion ?? Constants?.expoConfig?.ios?.buildNumber;
  return {
    platform: Device?.modelName ? `${Device.modelName} · ${os}` : os,
    appVersion: version ? (build ? `${version} (${build})` : version) : undefined,
    locale: deviceLocale(),
  };
}

const DeskbellContext = createContext<DeskbellStore | null>(null);

type Props = {
  appKey: string;
  /** Your own Deskbell server, if you run one. Defaults to the hosted https://deskbell.lol */
  baseUrl?: string;
  /** Identify straight away, e.g. when the user is already signed in. */
  user?: DeskbellUser;
  storage?: DeskbellStorage;
  children: ReactNode;
};

export const DEFAULT_BASE_URL = "https://deskbell.lol";

export function DeskbellProvider({ appKey, baseUrl = DEFAULT_BASE_URL, user, storage, children }: Props) {
  const [store] = useState(
    () =>
      new DeskbellStore({
        appKey,
        baseUrl,
        storage: storage ?? defaultStorage(),
        device: deviceDetails(),
        push: {
          platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : undefined,
          environment: __DEV__ ? "sandbox" : "production",
        },
      }),
  );

  const userKey = JSON.stringify(user ?? {});
  useEffect(() => {
    store.identify(JSON.parse(userKey));
  }, [store, userKey]);

  // A session starts on launch and on each return from the background; replies are checked now and then while
  // the app is open, so unread badges stay current. Buffered activity goes out before the app is backgrounded.
  useEffect(() => {
    // A launch in the background (e.g. a silent push) starts its session once the user opens the app.
    let backgrounded = AppState.currentState === "background";
    if (!backgrounded) store.startSession();
    const t = setInterval(() => {
      if (AppState.currentState === "active") store.poll();
    }, 30_000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") {
        backgrounded = true;
        void store.flush();
      } else if (s === "active") {
        // Coming back from "inactive" alone is a system sheet or Face ID closing, not a new session.
        void (backgrounded ? store.startSession() : store.poll());
        backgrounded = false;
      }
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [store]);

  return <DeskbellContext value={store}>{children}</DeskbellContext>;
}

export function useDeskbellStore() {
  const store = useContext(DeskbellContext);
  if (!store) throw new Error("Wrap your app in <DeskbellProvider> to use Deskbell");
  return store;
}

/**
 * Chat state plus actions: identify after sign-in, track events, read the unread count for a badge,
 * and tell your team where the user is, what they pay for and how to reach them by push.
 */
export function useDeskbell() {
  const store = useDeskbellStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return useMemo(
    () => ({
      ...state,
      identify: (user: DeskbellUser) => store.identify(user),
      track: (type: string, text?: string) => store.track(type, text),
      refresh: () => store.poll(),
      /** Deletes this user's Deskbell data on the server, e.g. when they delete their account. */
      deleteUserData: () => store.deleteUserData(),
      /** Forgets the user on this device, e.g. on sign-out. Server data stays. */
      reset: () => store.reset(),
      /** Records the screen the user is on, e.g. screen("Paywall"). */
      screen: (name: string) => store.screen(name),
      /** Records how far the user got, e.g. setStage("onboarding_done"). */
      setStage: (stage: string) => store.setStage(stage),
      /** Records something that went wrong, e.g. reportIssue("Sync failed", "sync"). */
      reportIssue: (message: string, feature?: string) => store.reportIssue(message, feature),
      /** What the user pays for, from RevenueCat, expo-iap or your backend. Only posts when it changed. */
      setSubscription: (subscription: DeskbellSubscription) => store.setSubscription(subscription),
      /** The native APNs/FCM device token (e.g. getDevicePushTokenAsync().data), or null to unregister. */
      setPushToken: (token: string | null, options?: DeskbellPushOptions) => store.setPushToken(token, options),
      /**
       * Check-in pushes are marketing-style under App Store guideline 4.5.4: pass true only after the user
       * explicitly agrees, and give them a way to turn it off. The answer shows up as checkInsAllowed.
       */
      allowCheckIns: (allowed: boolean) => store.allowCheckIns(allowed),
      /** True when Deskbell sent this notification; fetches new messages so you can open the chat. */
      handleNotificationTap: (data: unknown) => store.handleNotificationTap(data),
      isDeskbellNotification,
    }),
    [state, store],
  );
}
