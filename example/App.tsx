import { DeskbellChat, DeskbellProvider, useDeskbell, type DeskbellOffer } from "@deskbell/react-native";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

// Set these in .env.local: EXPO_PUBLIC_DESKBELL_APP_KEY=dsk_…  EXPO_PUBLIC_DESKBELL_URL=http://localhost:3100
const APP_KEY = process.env.EXPO_PUBLIC_DESKBELL_APP_KEY ?? "dsk_your_app_key";
const BASE_URL = process.env.EXPO_PUBLIC_DESKBELL_URL ?? "http://localhost:3100";

export default function App() {
  return (
    <DeskbellProvider appKey={APP_KEY} baseUrl={BASE_URL} user={{ name: "Expo Demo", plan: "Free", metadata: { source: "expo-example" } }}>
      <Settings />
    </DeskbellProvider>
  );
}

function Settings() {
  const deskbell = useDeskbell();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState("");

  useEffect(() => {
    deskbell.screen("Settings");
    // A real app would pass what RevenueCat, expo-iap or its backend says, and register for push with
    // deskbell.setPushToken((await Notifications.getDevicePushTokenAsync()).data).
    deskbell.setSubscription({ status: "free" });
  }, []);

  function handleOffer(offer: DeskbellOffer) {
    // A real app would start the purchase for offer.productId here (RevenueCat, expo-iap, …).
    deskbell.track("offer_accepted", `User upgraded to ${offer.title}`);
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Text style={styles.title}>Settings</Text>
      <View style={styles.card}>
        <Text style={styles.row}>Plan</Text>
        <Text style={styles.muted}>Free</Text>
      </View>
      <Pressable style={styles.card} onPress={() => setOpen(true)}>
        <Text style={[styles.row, styles.link]}>💬 Contact support</Text>
        {deskbell.unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{deskbell.unreadCount}</Text>
          </View>
        )}
      </Pressable>
      {deskbell.error && <Text style={styles.error}>{deskbell.error}</Text>}

      {/* Test controls: each one exercises an SDK call so it can be checked against the dashboard. */}
      <ScrollView>
        <Text style={styles.section}>Where the user is</Text>
        <Action
          label={`Next onboarding step (now ${step})`}
          onPress={() => {
            const next = step + 1;
            setStep(next);
            deskbell.setStage(`onboarding_${next}`);
            deskbell.screen(`Onboarding ${next}`);
          }}
        />
        <Action label="Open Paywall" onPress={() => deskbell.screen("Paywall")} />
        <Action label="Report “Sync failed”" onPress={() => deskbell.reportIssue("Sync failed", "Backup")} />
        <Action label="Start a trial" onPress={() => deskbell.setSubscription({ status: "trial", productId: "pro.yearly", expiresAt: Date.now() + 7 * 864e5 })} />

        <Text style={styles.section}>Notifications</Text>
        <Action
          label="Register a test push token"
          onPress={() => deskbell.setPushToken(Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""))}
        />
        <View style={styles.card}>
          <Text style={styles.row}>Message me if I get stuck</Text>
          <Switch value={deskbell.checkInsAllowed ?? false} onValueChange={(v) => void deskbell.allowCheckIns(v).catch((e) => setStatus(String(e)))} />
        </View>
        <Action
          label="Simulate tapping a Deskbell push"
          onPress={() => {
            if (deskbell.handleNotificationTap({ aps: { alert: "Hi" }, deskbell: { conversationId: "x" } })) setOpen(true);
          }}
        />

        <Text style={styles.section}>Account data</Text>
        <Action label="Sign out (reset)" onPress={() => deskbell.reset()} />
        <Action
          label="Delete my support data"
          onPress={() => deskbell.deleteUserData().then(() => setStatus("Deleted"), (e) => setStatus(String(e)))}
        />
        {status !== "" && <Text style={styles.error}>{status}</Text>}
      </ScrollView>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={styles.sheet}>
          <DeskbellChat onOfferPress={handleOffer} onClose={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 13, color: "#8a8a8e", textTransform: "uppercase", marginTop: 8, marginBottom: 6, marginLeft: 4 },
  screen: { flex: 1, backgroundColor: "#f2f2f7", paddingHorizontal: 20, paddingTop: 60 },
  title: { fontSize: 34, fontWeight: "700", marginTop: 16, marginBottom: 20 },
  card: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 22, padding: 14, marginBottom: 8 },
  row: { fontSize: 17 },
  muted: { fontSize: 17, color: "#8a8a8e" },
  link: { color: "#007aff", fontSize: 17 },
  badge: { backgroundColor: "#ff3b30", borderRadius: 10, minWidth: 20, paddingHorizontal: 6, alignItems: "center" },
  badgeText: { color: "#fff", fontWeight: "700", fontSize: 13, lineHeight: 20 },
  error: { color: "#8a8a8e", fontSize: 13 },
  sheet: { flex: 1, backgroundColor: "#fff" },
});
