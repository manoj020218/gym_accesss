import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/store/auth';
import { useNotifStore } from '../src/store/notifications';

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const token    = useAuthStore((s) => s.token);
  const router   = useRouter();
  const segments = useSegments();

  useEffect(() => {
    const inAuth = segments[0] === 'login';
    if (!token && !inAuth) router.replace('/login');
    if (token  &&  inAuth) router.replace('/(tabs)/');
  }, [token, segments]);

  return <>{children}</>;
}

function NotificationSetup() {
  const addNotification = useNotifStore((s) => s.addNotification);
  const memberId = useAuthStore((s) => s.memberId);
  const { memberApi } = require('../src/api/member');

  useEffect(() => {
    if (!Device.isDevice) return;

    (async () => {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') return;

      const token = (await Notifications.getDevicePushTokenAsync()).data;
      if (memberId && token) {
        memberApi.registerFcmToken(memberId, token).catch(() => null);
      }
    })();

    const sub = Notifications.addNotificationReceivedListener((notif) => {
      addNotification({
        title: notif.request.content.title ?? 'Notification',
        body:  notif.request.content.body  ?? '',
        type:  'system',
      });
    });

    return () => sub.remove();
  }, [memberId]);

  return null;
}

export default function RootLayout() {
  useEffect(() => { SplashScreen.hideAsync(); }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthGate>
          <NotificationSetup />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#05050A' } }}>
            <Stack.Screen name="login" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </AuthGate>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
