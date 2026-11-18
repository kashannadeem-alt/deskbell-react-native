// Runs the framework-free store against a live Deskbell server: DESKBELL_URL=... DESKBELL_APP_KEY=... npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { DeskbellStore, isDeskbellNotification, offerFrom } from "../store";

const baseUrl = process.env.DESKBELL_URL;
const appKey = process.env.DESKBELL_APP_KEY;

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v) };
}

test("offerFrom reads offer payloads", () => {
  const offer = offerFrom({
    id: 7,
    sender: "agent",
    authorName: null,
    kind: "offer",
    body: "",
    payload: { title: "Yearly", productId: "pro.yearly" },
    createdAt: 0,
  });
  assert.deepEqual(offer, { messageId: 7, title: "Yearly", subtitle: undefined, cta: "View offer", productId: "pro.yearly" });
});

test("identify, send, track and poll against the server", { skip: !baseUrl || !appKey }, async () => {
  const storage = memoryStorage();
  const store = new DeskbellStore({ appKey: appKey!, baseUrl: baseUrl!, storage, device: { platform: "node test", locale: "en-US" } });
  await store.identify({ name: "RN Test", plan: "Free", metadata: { source: "rn-sdk-test" } });
  assert.ok(store.getState().ready, store.getState().error ?? "not ready");
  assert.ok(await storage.getItem("deskbell.deviceId"));

  await store.send("hello from the react native sdk");
  await store.track("custom", "User finished onboarding");
  const kinds = store.getState().messages.map((m) => `${m.sender}:${m.kind}`);
  assert.ok(kinds.includes("user:text"));
  assert.ok(kinds.includes("system:event"));

  // A second store with the same storage is the same device, so it sees the same thread.
  const again = new DeskbellStore({ appKey: appKey!, baseUrl: baseUrl!, storage });
  await again.identify();
  assert.equal(again.getState().messages.length, store.getState().messages.length);
});

/** A stand-in server that records each call and answers like the real API. */
function fakeServer(options: { checkIns?: boolean | null } = {}) {
  const calls: { method: string; path: string; body: Record<string, unknown> | undefined; token?: string }[] = [];
  // One token per user, like the real server: same device + userId → same token.
  const tokens = new Map<string, string>();
  // Each user's check-in answer; options.checkIns is what identify reports for a new user (undefined = older server).
  const checkIns = new Map<string, boolean | null | undefined>();
  const fetch = (async (url: string, init: RequestInit) => {
    const path = url.split("/api/v1/")[1];
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const token = (init.headers as Record<string, string> | undefined)?.["X-User-Token"];
    calls.push({ method: init.method ?? "GET", path, body, token });
    const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (path === "identify") {
      const key = `${body?.deviceId}|${body?.userId ?? ""}`;
      if (!tokens.has(key)) tokens.set(key, `t${tokens.size + 1}`);
      const t = tokens.get(key)!;
      if (!checkIns.has(t)) checkIns.set(t, options.checkIns);
      return reply({
        token: t,
        aiConsent: null,
        ...(checkIns.get(t) === undefined ? {} : { checkIns: checkIns.get(t) }),
        config: { appName: "", title: "Support", welcomeMessage: "", accentColor: "#000000", appStoreId: null, aiEnabled: true },
      });
    }
    if (path === "consent") return reply({ aiConsent: body?.ai });
    if (path === "user") return reply({ deleted: 1 });
    if (path === "activity" || path === "subscription") return reply({ ok: true });
    if (path === "push") {
      if (typeof body?.checkIns === "boolean") checkIns.set(token!, body.checkIns);
      return reply({ push: typeof body?.token === "string", checkIns: checkIns.get(token!) ?? null });
    }
    return reply({ messages: [] });
  }) as typeof globalThis.fetch;
  const sent = (path: string) => calls.filter((c) => c.path === path);
  const events = () => sent("activity").flatMap((c) => c.body!.events as { kind: string; name: string; detail?: string; at: number }[]);
  return { calls, fetch, sent, events };
}

function newStore(server: ReturnType<typeof fakeServer>, extra: Partial<ConstructorParameters<typeof DeskbellStore>[0]> = {}) {
  return new DeskbellStore({ appKey: "dsk_x", baseUrl: "https://example.test", storage: memoryStorage(), fetch: server.fetch, ...extra });
}

test("AI consent starts unasked and is sent to the server", async () => {
  const server = fakeServer();
  const store = new DeskbellStore({ appKey: "dsk_x", baseUrl: "https://example.test", storage: memoryStorage(), fetch: server.fetch });
  await store.identify();
  assert.equal(store.getState().config.aiEnabled, true);
  assert.equal(store.getState().aiConsent, null);
  await store.setAIConsent(false);
  assert.equal(store.getState().aiConsent, false);
  assert.deepEqual(server.calls.find((c) => c.path === "consent")?.body, { ai: false });
});

test("two identify calls at launch share one device ID", async () => {
  const server = fakeServer();
  const store = new DeskbellStore({ appKey: "dsk_x", baseUrl: "https://example.test", storage: memoryStorage(), fetch: server.fetch });
  await Promise.all([store.identify({ name: "A" }), store.identify({ plan: "Pro" })]);
  const ids = new Set(server.calls.filter((c) => c.path === "identify").map((c) => (c.body as { deviceId: string }).deviceId));
  assert.equal(ids.size, 1);
});

test("identify sends userHash with userId", async () => {
  const server = fakeServer();
  const store = new DeskbellStore({ appKey: "dsk_x", baseUrl: "https://example.test", storage: memoryStorage(), fetch: server.fetch });
  await store.identify({ userId: "u_1", userHash: "abc123" });
  const body = server.calls.find((c) => c.path === "identify")?.body;
  assert.equal(body?.userId, "u_1");
  assert.equal(body?.userHash, "abc123");
});

test("deleteUserData deletes on the server, then starts over as a new anonymous device", async () => {
  const server = fakeServer();
  const storage = memoryStorage();
  const store = new DeskbellStore({ appKey: "dsk_x", baseUrl: "https://example.test", storage, fetch: server.fetch });
  await store.identify({ userId: "u_1", userHash: "abc123", name: "Ava" });
  const firstDevice = await storage.getItem("deskbell.deviceId");
  await store.setAIConsent(true);

  await store.deleteUserData();
  assert.ok(server.calls.some((c) => c.method === "DELETE" && c.path === "user"));
  const identifies = server.calls.filter((c) => c.path === "identify");
  const last = identifies.at(-1)!.body!;
  assert.equal(last.userId, undefined);
  assert.equal(last.name, undefined);
  assert.notEqual(last.deviceId, firstDevice);
  assert.equal(store.getState().aiConsent, null);
  assert.equal(store.getState().messages.length, 0);
});

test("activity is buffered and sent in one request about a second later, cut to the server's limits", async () => {
  const server = fakeServer();
  const store = newStore(server);
  await store.identify();
  store.screen("Home");
  store.screen("Home"); // same screen twice in a row is one visit
  store.setStage("onboarding_done");
  store.reportIssue("x".repeat(100), "y".repeat(400));
  store.screen(" "); // blank names are dropped
  assert.equal(server.sent("activity").length, 0);

  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(server.sent("activity").length, 1);
  assert.equal(server.sent("activity")[0].token, "t1");
  const events = server.events();
  assert.deepEqual(
    events.map((e) => [e.kind, e.name, e.detail]),
    [
      ["screen", "Home", undefined],
      ["stage", "onboarding_done", undefined],
      ["issue", "x".repeat(80), "y".repeat(300)],
    ],
  );
  assert.ok(events.every((e) => typeof e.at === "number" && e.at > 0));
});

test("flush sends at most 50 events per request", async () => {
  const server = fakeServer();
  const store = newStore(server);
  await store.identify();
  for (let i = 0; i < 120; i++) store.setStage(`step ${i}`);
  await store.flush();
  assert.deepEqual(
    server.sent("activity").map((c) => (c.body!.events as unknown[]).length),
    [50, 50, 20],
  );
  assert.equal(server.events().at(-1)!.name, "step 119");
});

test("events recorded before identify finishes are delivered after it", async () => {
  const server = fakeServer();
  const store = newStore(server);
  store.screen("Launch");
  const identifying = store.identify({ userId: "u_1" });
  store.setStage("signed_in");
  await identifying;
  await store.flush();
  assert.deepEqual(server.events().map((e) => e.name), ["Launch", "signed_in"]);
  const firstActivity = server.calls.findIndex((c) => c.path === "activity");
  assert.ok(firstActivity > server.calls.findIndex((c) => c.path === "identify"));
  assert.ok(server.sent("activity").every((c) => c.token === "t1"));
});

test("reset drops the old user's queued activity", async () => {
  const server = fakeServer();
  const store = newStore(server);
  await store.identify({ userId: "u_1" });
  store.screen("Account");
  await store.reset();
  store.screen("Welcome");
  await store.flush();
  assert.deepEqual(server.events().map((e) => e.name), ["Welcome"]);
  assert.equal(server.sent("activity")[0].token, "t2");
});

test("startSession sends a session open event and checks for messages", async () => {
  const server = fakeServer();
  const store = newStore(server);
  await store.identify();
  const polls = server.calls.filter((c) => c.path.startsWith("messages")).length;
  await store.startSession();
  assert.deepEqual(server.events().map((e) => [e.kind, e.name]), [["session", "open"]]);
  assert.equal(server.calls.filter((c) => c.path.startsWith("messages")).length, polls + 1);
});

test("setSubscription only posts when it changed", async () => {
  const server = fakeServer();
  const store = newStore(server);
  await store.identify();
  const paid = { status: "paid" as const, productId: "pro.yearly", expiresAt: new Date(1_800_000_000_000), willRenew: true };
  await Promise.all([store.setSubscription(paid), store.setSubscription(paid)]);
  await store.setSubscription({ ...paid, expiresAt: 1_800_000_000_000 });
  assert.equal(server.sent("subscription").length, 1);
  assert.deepEqual(server.sent("subscription")[0].body, {
    status: "paid",
    productId: "pro.yearly",
    expiresAt: 1_800_000_000_000,
    willRenew: true,
    source: "app",
  });

  await store.setSubscription({ ...paid, willRenew: false });
  await store.setSubscription({ status: "lapsed" });
  await store.setSubscription({ status: "lapsed" });
  assert.deepEqual(
    server.sent("subscription").map((c) => [c.body!.status, c.body!.willRenew]),
    [["paid", true], ["paid", false], ["lapsed", undefined]],
  );
});

test("the subscription is sent again for a newly identified user", async () => {
  const server = fakeServer();
  const store = newStore(server);
  await store.identify();
  await store.setSubscription({ status: "trial" });
  await store.identify(); // same user: nothing new
  await store.identify({ userId: "u_1" });
  assert.deepEqual(server.sent("subscription").map((c) => c.token), ["t1", "t2"]);
});

test("push registration, check-in consent and re-registration after reset", async () => {
  const server = fakeServer();
  const store = newStore(server, { push: { platform: "ios", environment: "production" } });
  await store.identify();
  assert.equal(store.getState().checkInsAllowed, null); // older servers leave checkIns out

  await store.setPushToken("a1b2c3");
  assert.deepEqual(server.sent("push")[0].body, { token: "a1b2c3", platform: "ios", environment: "production" });
  await store.setPushToken("a1b2c3", { environment: "sandbox" });
  assert.deepEqual(server.sent("push")[1].body, { token: "a1b2c3", platform: "ios", environment: "sandbox" });
  await store.setPushToken("a1b2c3", { environment: "sandbox" });
  await store.identify(); // same user, already registered
  assert.equal(server.sent("push").length, 2);
  assert.equal(store.getState().checkInsAllowed, null);

  assert.equal(await store.allowCheckIns(true), true);
  assert.deepEqual(server.sent("push").at(-1)!.body, { checkIns: true });
  assert.equal(store.getState().checkInsAllowed, true);

  await store.reset();
  assert.equal(store.getState().checkInsAllowed, null);
  const last = server.sent("push").at(-1)!;
  assert.equal(last.token, "t2");
  assert.deepEqual(last.body, { token: "a1b2c3", platform: "ios", environment: "sandbox" });
});

test("identify reports checkIns, and Android tokens carry no APNs environment", async () => {
  const server = fakeServer({ checkIns: false });
  const store = newStore(server, { push: { platform: "android", environment: "sandbox" } });
  await store.identify();
  assert.equal(store.getState().checkInsAllowed, false);
  await store.setPushToken("fcm-token");
  assert.deepEqual(server.sent("push")[0].body, { token: "fcm-token", platform: "android" });
});

test("setPushToken(null) unregisters and is not replayed after reset", async () => {
  const server = fakeServer();
  const store = newStore(server);
  await store.identify();
  await store.setPushToken("a1b2c3", { platform: "ios" });
  await store.setPushToken(null);
  assert.deepEqual(server.sent("push").at(-1)!.body, { token: null });
  await store.reset();
  assert.equal(server.sent("push").length, 2);
});

test("isDeskbellNotification reads APNs userInfo and FCM data", () => {
  assert.equal(isDeskbellNotification({ aps: { alert: { title: "Ava", body: "Hi" } }, deskbell: { conversationId: "c_1" } }), true);
  assert.equal(isDeskbellNotification({ deskbell: "1", conversationId: "c_1" }), true);
  assert.equal(isDeskbellNotification({ aps: { alert: "Sale" }, campaign: "spring" }), false);
  assert.equal(isDeskbellNotification({ deskbell: "0" }), false);
  assert.equal(isDeskbellNotification(null), false);
  assert.equal(isDeskbellNotification("deskbell"), false);
});

test("handleNotificationTap refreshes messages only for Deskbell pushes", async () => {
  const server = fakeServer();
  const store = newStore(server);
  await store.identify();
  const polls = () => server.calls.filter((c) => c.path.startsWith("messages")).length;
  const before = polls();
  assert.equal(store.handleNotificationTap({ campaign: "spring" }), false);
  assert.equal(store.handleNotificationTap({ deskbell: "1", conversationId: "c_1" }), true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(polls(), before + 1);
});
