import type {
  DeskbellActivityEvent,
  DeskbellConfig,
  DeskbellMessage,
  DeskbellOffer,
  DeskbellPushOptions,
  DeskbellStorage,
  DeskbellSubscription,
  DeskbellUser,
} from "./types";

export type DeskbellState = {
  config: DeskbellConfig;
  messages: DeskbellMessage[];
  /** Replies from your team the user hasn't seen yet. */
  unreadCount: number;
  ready: boolean;
  error: string | null;
  /** The user's answer to the AI notice: null until asked. AI replies only run once it's true. */
  aiConsent: boolean | null;
  /** Whether the user agreed to check-in pushes: null until asked. See allowCheckIns(). */
  checkInsAllowed: boolean | null;
};

export type StoreOptions = {
  appKey: string;
  baseUrl: string;
  storage?: DeskbellStorage;
  /** Device details sent with identify, e.g. { platform: "iPhone · iOS 26.1", locale: "en-US" }. */
  device?: { platform?: string; locale?: string; appVersion?: string };
  fetch?: typeof fetch;
  /** Defaults for setPushToken(). The provider fills these from Platform.OS and __DEV__. */
  push?: DeskbellPushOptions;
};

const DEFAULT_CONFIG: DeskbellConfig = { appName: "", title: "Support", welcomeMessage: "", accentColor: "#1B1813", appStoreId: null, aiEnabled: false };
const INITIAL_STATE: DeskbellState = { config: DEFAULT_CONFIG, messages: [], unreadCount: 0, ready: false, error: null, aiConsent: null, checkInsAllowed: null };
const DEVICE_KEY = "deskbell.deviceId";
const LAST_READ_KEY = "deskbell.lastReadMessageId";
const ACTIVITY_DELAY = 1000;
const ACTIVITY_BATCH = 50;
/** Oldest events are dropped past this while the server can't be reached. */
const ACTIVITY_LIMIT = 500;

function randomId() {
  return "rn-" + Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join("");
}

/** Trims and cuts text to the server's limit without splitting an emoji. */
function clip(text: string, max: number) {
  let out = text.trim().slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out;
}

/**
 * True for a push Deskbell sent. Pass the APNs userInfo on iOS (`{ aps, deskbell: { conversationId } }`)
 * or the FCM data object on Android (`{ deskbell: "1", conversationId }`). With expo-notifications that's
 * `request.trigger.payload` on iOS and `request.content.data` on Android; with React Native Firebase, `remoteMessage.data`.
 */
export function isDeskbellNotification(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const marker = (data as { deskbell?: unknown }).deskbell;
  if (marker && typeof marker === "object") return true;
  return marker === "1" || marker === 1 || marker === true || marker === "true";
}

export function offerFrom(message: DeskbellMessage): DeskbellOffer | null {
  const p = message.payload;
  if (message.kind !== "offer" || !p?.title || !p.productId) return null;
  return { messageId: message.id, title: p.title, subtitle: p.subtitle, cta: p.cta || "View offer", productId: p.productId };
}

/** Holds the chat state and talks to the Deskbell API. Framework-free so it can be tested in Node. */
export class DeskbellStore {
  private state: DeskbellState = INITIAL_STATE;
  private listeners = new Set<() => void>();
  private token: string | null = null;
  private deviceIdLoad: Promise<string> | null = null;
  private identifying: Promise<void> | null = null;
  private user: DeskbellUser = {};
  private lastRead = 0;
  private chatVisible = false;
  private generation = 0;
  private activity: DeskbellActivityEvent[] = [];
  private activityTimer: ReturnType<typeof setTimeout> | null = null;
  private activityFlush: Promise<void> = Promise.resolve();
  private lastScreen: string | null = null;
  // The last subscription and push registration, replayed when identify yields a new user.
  // The *Sent keys (user token + body) stop the same thing being posted twice.
  private subscription: Record<string, unknown> | null = null;
  private subscriptionSent: string | null = null;
  private push: Record<string, unknown> | null = null;
  private pushSent: string | null = null;
  private readonly fetch: typeof fetch;
  private readonly options: StoreOptions;

  constructor(options: StoreOptions) {
    this.options = options;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(patch: Partial<DeskbellState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /**
   * The device ID, read or created once. Identify can run twice at launch (the provider's `user` prop and the app's
   * own identify call); without this both would find no stored ID, make two, and split the person into two users.
   */
  private loadDeviceId(): Promise<string> {
    return (this.deviceIdLoad ??= (async () => {
      const storage = this.options.storage;
      const stored = await storage?.getItem(DEVICE_KEY);
      if (stored) return stored;
      const created = randomId();
      await storage?.setItem(DEVICE_KEY, created);
      return created;
    })());
  }

  /** Registers the device (and user, if known). Safe to call again; later calls update the profile. */
  identify(user: DeskbellUser = {}): Promise<void> {
    this.user = { ...this.user, ...user, metadata: { ...this.user.metadata, ...user.metadata } };
    const run = async () => {
      const storage = this.options.storage;
      const deviceId = await this.loadDeviceId();
      this.lastRead = Number((await storage?.getItem(LAST_READ_KEY)) ?? 0) || 0;
      const generation = this.generation;
      const res = await this.request<{ token: string; config: DeskbellConfig; aiConsent?: boolean | null; checkIns?: boolean | null }>(
        "identify",
        { method: "POST", body: { deviceId, ...this.options.device, ...this.user }, auth: false },
      );
      // reset() replaced this user while the request was in flight.
      if (generation !== this.generation) return;
      this.token = res.token;
      this.set({ config: res.config, ready: true, error: null, aiConsent: res.aiConsent ?? null, checkInsAllowed: res.checkIns ?? null });
      // Not awaited: a flush may itself be waiting on this identify.
      if (this.activity.length) void this.flush();
      await Promise.all([this.poll(), this.syncPush(), this.syncSubscription()]);
    };
    this.identifying = run().catch((e: Error) => this.set({ error: e.message }));
    return this.identifying;
  }

  async poll() {
    if (!(await this.ensureToken())) return;
    try {
      const after = this.state.messages.at(-1)?.id ?? 0;
      const res = await this.request<{ messages: DeskbellMessage[] }>(`messages?after=${after}`);
      this.append(res.messages);
      if (this.state.error) this.set({ error: null });
    } catch (e) {
      this.set({ error: (e as Error).message });
    }
  }

  async send(body: string, image?: { data: string; mimeType: string }) {
    const text = body.trim();
    if ((!text && !image) || !(await this.ensureToken())) return;
    const res = await this.request<{ message: DeskbellMessage }>("messages", { method: "POST", body: { body: text || undefined, image } });
    this.append([res.message]);
  }

  /** Logs an event into the thread, e.g. track("offer_accepted", "User upgraded to Yearly"). */
  async track(type: string, text?: string) {
    if (!(await this.ensureToken())) return;
    const res = await this.request<{ message: DeskbellMessage }>("events", { method: "POST", body: { type, text } });
    this.append([res.message]);
  }

  /** Records the user's answer to the AI notice. The chat calls this; you rarely need to. */
  async setAIConsent(allowed: boolean) {
    if (!(await this.ensureToken())) return;
    try {
      const res = await this.request<{ aiConsent: boolean }>("consent", { method: "POST", body: { ai: allowed } });
      this.set({ aiConsent: res.aiConsent, error: null });
    } catch (e) {
      this.set({ error: (e as Error).message });
    }
  }

  /** Records the screen the user is on, e.g. screen("Paywall"). Repeats of the same screen in a row are skipped. */
  screen(name: string) {
    const screen = clip(name, 80);
    if (!screen || screen === this.lastScreen) return;
    this.lastScreen = screen;
    this.record("screen", screen);
  }

  /** Records how far the user got, e.g. setStage("onboarding_done") or setStage("first_export"). */
  setStage(stage: string) {
    this.record("stage", stage);
  }

  /** Records something that went wrong for the user, e.g. reportIssue("Export failed: disk full", "export"). */
  reportIssue(message: string, feature?: string) {
    this.record("issue", message, feature);
  }

  /** Marks a new app session and checks for replies. The provider calls it on launch and whenever the app returns to the foreground. */
  async startSession() {
    this.record("session", "open");
    await Promise.all([this.flush(), this.poll()]);
  }

  /** Sends buffered activity now instead of after the ~1 s delay, e.g. before the app goes to the background. */
  flush(): Promise<void> {
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = null;
    this.activityFlush = this.activityFlush.then(() => this.sendActivity());
    return this.activityFlush;
  }

  /**
   * Tells the inbox what the user pays for. Only posts when it changed.
   * React Native can't read StoreKit or Play Billing itself, so pass it from RevenueCat
   * (customerInfo.entitlements), expo-iap / react-native-iap, or your backend.
   */
  async setSubscription({ status, productId, expiresAt, willRenew }: DeskbellSubscription) {
    const expires = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt;
    this.subscription = {
      status,
      ...(productId ? { productId } : {}),
      ...(expires !== undefined && Number.isFinite(expires) ? { expiresAt: expires } : {}),
      ...(willRenew !== undefined ? { willRenew } : {}),
      source: "app",
    };
    await this.syncSubscription();
  }

  /**
   * Registers the device for replies by push. Pass the native device token, not an Expo push token:
   * the APNs token on iOS and the FCM token on Android, e.g. from expo-notifications' getDevicePushTokenAsync().
   * The token is remembered and sent again for the next user after identify() or reset(). Pass null to unregister.
   */
  async setPushToken(token: string | null, options: DeskbellPushOptions = {}) {
    if (!token) {
      this.push = null;
      this.pushSent = null;
      await this.updatePush({ token: null });
      return;
    }
    const platform = options.platform ?? this.options.push?.platform;
    const environment = options.environment ?? (platform === "ios" ? this.options.push?.environment : undefined);
    this.push = { token, ...(platform ? { platform } : {}), ...(environment ? { environment } : {}) };
    await this.syncPush();
  }

  /**
   * Records whether the user wants check-in pushes, the messages your team sends to users who stopped opening the app.
   * These count as marketing-style pushes under App Store guideline 4.5.4: only pass true after the user explicitly
   * agrees (e.g. a toggle or prompt in your app), and give them a way to turn it off again.
   * Resolves to the saved answer; throws if it couldn't be saved.
   */
  async allowCheckIns(allowed: boolean): Promise<boolean | null> {
    if (!(await this.updatePush({ checkIns: allowed }, true))) throw new Error("Not connected to Deskbell");
    return this.state.checkInsAllowed;
  }

  /**
   * Call it when the user taps a notification. Returns true and fetches new messages when Deskbell sent it,
   * so you can open the chat; false for your own notifications. Takes the same data as isDeskbellNotification().
   */
  handleNotificationTap(data: unknown): boolean {
    if (!isDeskbellNotification(data)) return false;
    void this.poll();
    return true;
  }

  /**
   * Permanently deletes this user's Deskbell data on the server: profile, conversations, messages and photos.
   * Call it from your account-deletion flow; the SDK then starts over as a new anonymous user.
   * From your backend, call DELETE /api/v1/users/{userId} with the identity secret instead.
   */
  async deleteUserData() {
    if (!(await this.ensureToken())) throw new Error("Not connected to Deskbell");
    await this.request("user", { method: "DELETE" });
    await this.reset();
  }

  /** Forgets the user on this device without deleting server data. Call it on sign-out. */
  async reset() {
    this.generation++;
    this.token = null;
    this.user = {};
    this.lastRead = 0;
    // Activity, subscription and check-in answer belong to the old user; the push token belongs to the device.
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = null;
    this.activity = [];
    this.lastScreen = null;
    this.subscription = null;
    this.subscriptionSent = null;
    this.pushSent = null;
    const storage = this.options.storage;
    // A new device ID makes the next identify a brand-new anonymous user.
    const fresh = randomId();
    this.deviceIdLoad = Promise.resolve(fresh);
    await storage?.setItem(DEVICE_KEY, fresh);
    await (storage?.removeItem?.(LAST_READ_KEY) ?? storage?.setItem(LAST_READ_KEY, "0"));
    this.set(INITIAL_STATE);
    await this.identify();
  }

  imageUrl(path: string) {
    return path.startsWith("http") ? path : this.options.baseUrl.replace(/\/$/, "") + path;
  }

  setChatVisible(visible: boolean) {
    this.chatVisible = visible;
    if (visible) this.markRead();
  }

  private append(incoming: DeskbellMessage[]) {
    const known = new Set(this.state.messages.map((m) => m.id));
    const fresh = incoming.filter((m) => !known.has(m.id));
    if (!fresh.length) return;
    const messages = [...this.state.messages, ...fresh].sort((a, b) => a.id - b.id);
    this.set({ messages });
    if (this.chatVisible) this.markRead();
    else this.set({ unreadCount: this.countUnread() });
  }

  private record(kind: DeskbellActivityEvent["kind"], name: string, detail?: string) {
    const event: DeskbellActivityEvent = { kind, name: clip(name, 80), at: Date.now() };
    if (!event.name) return;
    const extra = detail === undefined ? "" : clip(detail, 300);
    if (extra) event.detail = extra;
    this.activity.push(event);
    if (this.activity.length > ACTIVITY_LIMIT) this.activity.splice(0, this.activity.length - ACTIVITY_LIMIT);
    this.activityTimer ??= setTimeout(() => void this.flush(), ACTIVITY_DELAY);
  }

  /** Posts queued activity in batches. Failed events stay queued for the next flush. */
  private async sendActivity() {
    while (this.activity.length) {
      const generation = this.generation;
      if (!(await this.ensureToken()) || generation !== this.generation) return;
      const batch = new Set(this.activity.slice(0, ACTIVITY_BATCH));
      try {
        await this.request("activity", { method: "POST", body: { events: [...batch] } });
      } catch {
        return;
      }
      // reset() already dropped the old user's queue.
      if (generation !== this.generation) return;
      this.activity = this.activity.filter((e) => !batch.has(e));
    }
  }

  private async syncSubscription() {
    if (!this.subscription || !(await this.ensureToken())) return;
    // Read after the await: a newer call or reset() may have replaced it.
    const body = this.subscription;
    if (!body) return;
    const key = this.token + JSON.stringify(body);
    if (key === this.subscriptionSent) return;
    this.subscriptionSent = key;
    try {
      await this.request("subscription", { method: "POST", body });
    } catch {
      if (this.subscriptionSent === key) this.subscriptionSent = null;
    }
  }

  private async syncPush() {
    if (!this.push || !(await this.ensureToken())) return;
    const body = this.push;
    if (!body) return;
    const key = this.token + JSON.stringify(body);
    if (key === this.pushSent) return;
    this.pushSent = key;
    if (!(await this.updatePush(body)) && this.pushSent === key) this.pushSent = null;
  }

  private async updatePush(body: Record<string, unknown>, rethrow = false) {
    if (!(await this.ensureToken())) return false;
    const generation = this.generation;
    try {
      const res = await this.request<{ push: boolean; checkIns: boolean | null }>("push", { method: "POST", body });
      if (generation === this.generation) this.set({ checkInsAllowed: res.checkIns ?? null });
      return true;
    } catch (e) {
      if (rethrow) throw e;
      return false;
    }
  }

  private countUnread() {
    return this.state.messages.filter((m) => m.id > this.lastRead && (m.sender === "agent" || m.sender === "ai")).length;
  }

  private markRead() {
    const last = this.state.messages.at(-1)?.id ?? 0;
    if (last > this.lastRead) {
      this.lastRead = last;
      this.options.storage?.setItem(LAST_READ_KEY, String(last)).catch(() => {});
    }
    if (this.state.unreadCount) this.set({ unreadCount: 0 });
  }

  private async ensureToken() {
    if (!this.token) await (this.identifying ?? this.identify());
    return Boolean(this.token);
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { "X-App-Key": this.options.appKey };
    if (init.auth !== false && this.token) headers["X-User-Token"] = this.token;
    if (init.body) headers["Content-Type"] = "application/json";
    const res = await this.fetch(`${this.options.baseUrl.replace(/\/$/, "")}/api/v1/${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
    return data as T;
  }
}
