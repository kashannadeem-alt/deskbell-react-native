# @deskbell/react-native

In-app support chat for React Native and Expo apps, from [Deskbell](https://deskbell.lol). Your users write to you inside your app; your team answers from one inbox (or Telegram), with AI replies from your docs while you sleep.

Plain TypeScript with no native module, so it works in **Expo Go**, dev builds and bare React Native (0.76+), on iOS and Android.

## Install

```bash
npm install github:kashannadeem-alt/deskbell-react-native
npx expo install @react-native-async-storage/async-storage expo-application expo-image-picker
```

The Expo packages are optional: AsyncStorage keeps the device ID across launches, `expo-application` gives the Play Store review link and app version, and `expo-image-picker` lets users send photos.

## Use

Get an app key at [deskbell.lol](https://deskbell.lol/signup) (14-day free trial, no card).

```tsx
// app/_layout.tsx
import { DeskbellProvider } from "@deskbell/react-native";

export default function RootLayout() {
  return (
    <DeskbellProvider appKey="dsk_your_app_key">
      <Stack />
    </DeskbellProvider>
  );
}

// app/support.tsx (present as a modal)
import { DeskbellChat } from "@deskbell/react-native";
export default function Support() {
  return <DeskbellChat />;
}
```

Identifying users, offers, push, check-ins and store privacy answers: **[deskbell.lol/docs](https://deskbell.lol/docs#react-native)**. Each app's settings page in the dashboard also has a one-paste setup prompt for your coding agent.

## Example app

`example/` is an Expo app that uses the SDK from `../src`. Put `EXPO_PUBLIC_DESKBELL_APP_KEY=dsk_...` in `example/.env.local`, then `npm install && npx expo start`.

## License

MIT
