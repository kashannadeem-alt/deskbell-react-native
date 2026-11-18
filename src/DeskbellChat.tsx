import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useDeskbellStore } from "./DeskbellProvider";
import { offerFrom } from "./store";
import { t } from "./strings";
import type { DeskbellMessage, DeskbellOffer } from "./types";

type Props = {
  /** Start the purchase for offer.productId, then call track("offer_accepted", …) on success. */
  onOfferPress?: (offer: DeskbellOffer) => void;
  /** Shows a Done button in the title bar that calls this, e.g. to close the modal. */
  onClose?: () => void;
  /** Hide the built-in title bar if your navigator already shows one. */
  showHeader?: boolean;
  /**
   * Whether the user is looking at the chat. Screens in tab bars stay mounted when you switch tabs,
   * so pass the screen's focus state (e.g. Expo Router's `useIsFocused()`) to get unread badges there.
   */
  active?: boolean;
  style?: StyleProp<ViewStyle>;
};

// Optional peer dependencies; the chat works without them. Metro only treats a require as optional when the call
// sits directly inside a try block, so a missing package doesn't break the app's bundle.
/* eslint-disable @typescript-eslint/no-require-imports */
let Application: { applicationId: string | null } | null = null;
let ImagePicker: {
  launchImageLibraryAsync(o: object): Promise<{ canceled: boolean; assets?: { base64?: string | null; mimeType?: string }[] }>;
} | null = null;
try {
  Application = require("expo-application");
} catch {}
try {
  ImagePicker = require("expo-image-picker");
} catch {}
/* eslint-enable @typescript-eslint/no-require-imports */

/** The support chat screen. Render it in a modal or a stack screen. */
export function DeskbellChat({ onOfferPress, onClose, showHeader = true, active = true, style }: Props) {
  const store = useDeskbellStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const dark = useColorScheme() === "dark";
  const colors = dark ? DARK : LIGHT;
  const accent = state.config.accentColor || "#1B1813";
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // iOS doesn't shrink a multiline TextInput when its text is cleared, so size it from its content.
  const [inputHeight, setInputHeight] = useState(MIN_INPUT);
  const list = useRef<FlatList<DeskbellMessage>>(null);

  // Poll quickly and mark replies read only while the chat is on screen; the provider's slower poll covers the rest.
  useEffect(() => {
    if (!active) return;
    store.setChatVisible(true);
    store.poll();
    const timer = setInterval(() => store.poll(), 3000);
    return () => {
      clearInterval(timer);
      store.setChatVisible(false);
    };
  }, [store, active]);

  async function send() {
    const text = draft;
    if (!text.trim()) return;
    setDraft("");
    setSending(true);
    await store.send(text).catch(() => setDraft(text));
    setSending(false);
  }

  async function pickPhoto() {
    if (!ImagePicker) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.7,
      // iOS photos are often HEIC, which browsers can't show in the inbox; ask for a JPEG instead.
      preferredAssetRepresentationMode: "compatible",
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset?.base64) return;
    await store.send("", { data: asset.base64, mimeType: asset.mimeType ?? "image/jpeg" });
  }

  function pressOffer(offer: DeskbellOffer) {
    store.track("offer_opened", `User opened the offer “${offer.title}”`);
    onOfferPress?.(offer);
  }

  // Opens the store's own review page. Both stores forbid calling their native review prompt from a button,
  // since the system may silently show nothing; a link to the listing is the allowed way to do this.
  function pressReview(url: string) {
    store.track("review_opened");
    Linking.openURL(url).catch(() => {
      if (url.startsWith("market://")) Linking.openURL(url.replace("market://details", "https://play.google.com/store/apps/details"));
    });
  }

  // Newest first because the list is inverted, which keeps it pinned to the bottom.
  const data = [...state.messages].reverse();

  return (
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: colors.bg }, style]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {showHeader && (
        <View style={[styles.header, { borderColor: colors.line }]}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {state.config.title}
          </Text>
          {onClose && (
            <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button">
              <Text style={{ color: accent, fontSize: 16, fontWeight: "600" }}>{t("done")}</Text>
            </Pressable>
          )}
        </View>
      )}
      {!state.ready && !state.error ? (
        <ActivityIndicator style={styles.flex} />
      ) : (
        <FlatList
          ref={list}
          inverted
          data={data}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          ListFooterComponent={
            <>
              {!!state.config.welcomeMessage && <Text style={[styles.welcome, { color: colors.muted }]}>{state.config.welcomeMessage}</Text>}
              {!!state.config.aiEnabled && (
                <AIConsent consent={state.aiConsent} accent={accent} colors={colors} onChoose={(allowed) => store.setAIConsent(allowed)} />
              )}
            </>
          }
          renderItem={({ item }) => (
            <MessageRow message={item} accent={accent} colors={colors} imageUrl={(p) => store.imageUrl(p)} onOffer={pressOffer} onReview={pressReview} />
          )}
        />
      )}
      {state.error && <Text style={[styles.error, { color: colors.muted }]}>{t("error")}</Text>}
      <View style={[styles.composer, { borderColor: colors.line, backgroundColor: colors.bg }]}>
        {ImagePicker && (
          <Pressable onPress={pickPhoto} hitSlop={8} style={styles.iconButton} accessibilityLabel="Send a photo">
            <Text style={{ fontSize: 20, color: colors.muted }}>＋</Text>
          </Pressable>
        )}
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t("message")}
          placeholderTextColor={colors.muted}
          multiline
          onContentSizeChange={(e) => setInputHeight(Math.min(MAX_INPUT, Math.max(MIN_INPUT, e.nativeEvent.contentSize.height + 18)))}
          style={[styles.input, { height: draft ? inputHeight : MIN_INPUT, backgroundColor: colors.bubble, color: colors.text }]}
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim() || sending}
          style={[styles.send, { backgroundColor: accent, opacity: draft.trim() ? 1 : 0.4 }]}
          accessibilityLabel="Send"
        >
          <Text style={styles.sendIcon}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

type Colors = typeof LIGHT;

function MessageRow({
  message: m,
  accent,
  colors,
  imageUrl,
  onOffer,
  onReview,
}: {
  message: DeskbellMessage;
  accent: string;
  colors: Colors;
  imageUrl: (path: string) => string;
  onOffer: (o: DeskbellOffer) => void;
  onReview: (url: string) => void;
}) {
  if (m.kind === "event") return <Text style={[styles.event, { color: colors.muted }]}>{m.body}</Text>;

  const offer = offerFrom(m);
  if (offer || m.kind === "review_request") {
    const reviewUrl = storeReviewUrl(m.payload?.appStoreId);
    return (
      <View style={[styles.card, { backgroundColor: colors.bubble }]}>
        {!!m.body && <Text style={[styles.cardBody, { color: colors.text }]}>{m.body}</Text>}
        <View style={[styles.cardInner, { backgroundColor: colors.bg }]}>
          {offer ? (
            <>
              <Text style={[styles.offerTitle, { color: colors.text }]}>{offer.title}</Text>
              {!!offer.subtitle && <Text style={{ color: colors.muted, fontSize: 13 }}>{offer.subtitle}</Text>}
              <Pressable style={[styles.pill, { backgroundColor: accent }]} onPress={() => onOffer(offer)}>
                <Text style={styles.pillText}>{offer.cta || t("offer")}</Text>
              </Pressable>
            </>
          ) : (
            reviewUrl && (
              <Pressable style={[styles.pill, { backgroundColor: accent, marginTop: 0 }]} onPress={() => onReview(reviewUrl)}>
                <Text style={styles.pillText}>{t("review")}</Text>
              </Pressable>
            )
          )}
        </View>
      </View>
    );
  }

  const mine = m.sender === "user";
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View
        style={
          // A photo on its own is shown bare, like Messages; text gets the usual bubble.
          m.payload?.image && !m.body
            ? undefined
            : [styles.bubble, mine ? { backgroundColor: accent, borderBottomRightRadius: 6 } : { backgroundColor: colors.bubble, borderBottomLeftRadius: 6 }]
        }
      >
        {!!m.payload?.image && <Image source={{ uri: imageUrl(m.payload.image) }} style={styles.image} resizeMode="cover" />}
        {!!m.body && <Text style={{ color: mine ? "#fff" : colors.text, fontSize: 15, lineHeight: 20 }}>{m.body}</Text>}
      </View>
      {/* AI replies are always labeled, so users know when they're not talking to a person. */}
      {!mine && (m.sender === "ai" || !!m.authorName) && (
        <Text style={[styles.author, { color: colors.muted }]}>{m.sender === "ai" ? t("aiLabel") : m.authorName}</Text>
      )}
    </View>
  );
}

/** The store's review page for this platform: the App Store write-review page on iOS, the Play listing on Android. */
function storeReviewUrl(appStoreId: string | null | undefined) {
  if (Platform.OS === "ios") return appStoreId ? `https://apps.apple.com/app/id${appStoreId}?action=write-review` : null;
  if (Platform.OS === "android") return Application?.applicationId ? `market://details?id=${Application.applicationId}` : null;
  return null;
}

/** Asks before any message goes to the AI provider (App Store 5.1.2(i)), then shows the choice with a way to change it. */
function AIConsent({ consent, accent, colors, onChoose }: { consent: boolean | null; accent: string; colors: Colors; onChoose: (allowed: boolean) => void }) {
  const [changing, setChanging] = useState(false);
  const choose = (allowed: boolean) => {
    setChanging(false);
    onChoose(allowed);
  };
  if (consent !== null && !changing) {
    return (
      <Pressable onPress={() => setChanging(true)} accessibilityRole="button" style={styles.aiStatus}>
        <Text style={{ color: colors.muted, fontSize: 11, textAlign: "center" }}>
          {t(consent ? "aiOn" : "aiOff")} · {t("change")}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.consent, { backgroundColor: colors.bubble }]}>
      <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18 }}>{t("aiNotice")}</Text>
      <View style={styles.consentButtons}>
        <Pressable style={[styles.pill, styles.consentButton, { backgroundColor: colors.muted }]} onPress={() => choose(false)} accessibilityRole="button">
          <Text style={styles.pillText}>{t("aiDecline")}</Text>
        </Pressable>
        <Pressable style={[styles.pill, styles.consentButton, { backgroundColor: accent }]} onPress={() => choose(true)} accessibilityRole="button">
          <Text style={styles.pillText}>{t("aiAllow")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const MIN_INPUT = 38;
const MAX_INPUT = 120;

const LIGHT = { bg: "#ffffff", text: "#161616", muted: "#8a8a8a", bubble: "#efefee", line: "#ebebea" };
const DARK = { bg: "#000000", text: "#f5f5f5", muted: "#8e8e93", bubble: "#2c2c2e", line: "#2c2c2e" };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { height: 52, justifyContent: "center", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: "600", paddingHorizontal: 80 },
  // Leading edge: React Native has no built-in safe-area insets, and the trailing corner can sit under hardware cutouts.
  close: { position: "absolute", left: 16 },
  list: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  welcome: { textAlign: "center", fontSize: 13, paddingVertical: 14 },
  consent: { borderRadius: 16, padding: 12, marginBottom: 8 },
  consentButtons: { flexDirection: "row", gap: 8 },
  consentButton: { flex: 1, paddingHorizontal: 10 },
  aiStatus: { paddingBottom: 8 },
  event: { textAlign: "center", fontSize: 11, paddingVertical: 4 },
  error: { textAlign: "center", fontSize: 12, paddingVertical: 4 },
  row: { maxWidth: "80%" },
  rowMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  rowTheirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, gap: 6 },
  image: { width: 220, height: 220, borderRadius: 14 },
  author: { fontSize: 11, marginTop: 2, marginHorizontal: 6 },
  card: { alignSelf: "flex-start", width: "80%", borderRadius: 20, padding: 8, gap: 8 },
  cardBody: { fontSize: 15, paddingHorizontal: 6, paddingTop: 4 },
  cardInner: { borderRadius: 14, padding: 12, gap: 4 },
  offerTitle: { fontSize: 15, fontWeight: "600" },
  pill: { marginTop: 8, borderRadius: 999, paddingVertical: 9, alignItems: "center" },
  pillText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  iconButton: { width: 34, height: 36, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, borderRadius: 18, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 15 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginBottom: 1 },
  sendIcon: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
