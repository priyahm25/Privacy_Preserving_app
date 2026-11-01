import React, { useEffect } from "react";
import { Platform } from "react-native";
import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { AppProvider } from "@/context/AppContext";
import { PushNotificationsBridge } from "@/components/PushNotificationsBridge";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

console.log("Clerk Publishable Key:", publishableKey);

if (!publishableKey) {
  throw new Error("Missing Clerk Publishable Key in .env");
}

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#050B18" },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="onboarding"
        options={{ headerShown: false, animation: "fade" }}
      />
      <Stack.Screen name="auth" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="file-details/[id]"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="shared"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="notifications"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="ai-assistant"
        options={{ headerShown: false, animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="settings"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="members"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="invite-teammate"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="share-file"
        options={{ headerShown: false, animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="accept-invitation/[token]"
        options={{ headerShown: false, animation: "fade" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    // `tokenCache` is backed by expo-secure-store, which has no web
    // implementation - on web its promises never settle, which silently hangs
    // every Clerk flow (sign-up appears to do nothing at all). Native keeps the
    // secure cache; web falls back to Clerk's own browser storage.
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={Platform.OS === "web" ? undefined : tokenCache}
    >
      <SafeAreaProvider>
        <ErrorBoundary>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <AppProvider>
              <PushNotificationsBridge />
              <RootLayoutNav />
            </AppProvider>
          </GestureHandlerRootView>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}
