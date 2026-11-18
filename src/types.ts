export type DeskbellConfig = {
  appName: string;
  title: string;
  welcomeMessage: string;
  accentColor: string;
  appStoreId: string | null;
  /** AI replies are on for this app. The chat then asks the user before any message goes to the AI provider. */
  aiEnabled?: boolean;
};

export type DeskbellMessage = {
  id: number;
  sender: "user" | "agent" | "ai" | "system";
  authorName: string | null;
  kind: "text" | "offer" | "review_request" | "event";
  body: string;
  payload: {
    image?: string;
    title?: string;
    subtitle?: string;
    cta?: string;
    productId?: string;
    appStoreId?: string | null;
    type?: string;
  } | null;
  createdAt: number;
};

/** An in-chat offer sent from the inbox. Start a purchase for `productId` when it's tapped. */
export type DeskbellOffer = {
  messageId: number;
  title: string;
  subtitle?: string;
  cta: string;
  productId: string;
};

export type DeskbellUser = {
  /** Your own account ID. Links every device of the account to one thread. */
  userId?: string;
  /**
   * Hex HMAC-SHA256 of userId keyed with the app's identity secret. Compute it on your server, never in the app.
   * Apps with identity verification on reject a userId without it.
   */
  userHash?: string;
  name?: string;
  email?: string;
  plan?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

/** Minimal async key-value storage, e.g. AsyncStorage. */
export type DeskbellStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
};

/** Where the user is or what happened, shown next to the thread in the inbox. */
export type DeskbellActivityEvent = {
  kind: "screen" | "stage" | "issue" | "session";
  /** At most 80 characters; longer names are cut. */
  name: string;
  /** At most 300 characters; longer details are cut. */
  detail?: string;
  /** Milliseconds since the epoch. */
  at: number;
};

export type DeskbellSubscriptionStatus = "free" | "trial" | "paid" | "lapsed";

/**
 * What the user pays for. React Native can't read StoreKit or Play Billing on its own,
 * so pass this from RevenueCat, expo-iap, react-native-iap or your backend.
 */
export type DeskbellSubscription = {
  status: DeskbellSubscriptionStatus;
  productId?: string;
  expiresAt?: Date | number;
  willRenew?: boolean;
};

export type DeskbellPushPlatform = "ios" | "android";
export type DeskbellPushEnvironment = "sandbox" | "production";

export type DeskbellPushOptions = {
  /** Defaults to Platform.OS. */
  platform?: DeskbellPushPlatform;
  /**
   * The APNs environment the token belongs to; ignored on Android.
   * Defaults to "sandbox" in development builds (__DEV__) and "production" otherwise.
   * Pass it yourself if a release build is signed with the development aps-environment entitlement.
   */
  environment?: DeskbellPushEnvironment;
};
