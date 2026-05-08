import axios from 'axios';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithCredential, GoogleAuthProvider, signOut } from 'firebase/auth';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore, type AuthUser } from '../store/auth';

WebBrowser.maybeCompleteAuthSession();

const firebaseConfig = {
  apiKey:    process.env['EXPO_PUBLIC_FIREBASE_API_KEY'] ?? '',
  authDomain: process.env['EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'] ?? '',
  projectId: process.env['EXPO_PUBLIC_FIREBASE_PROJECT_ID'] ?? '',
};

const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]!;
const firebaseAuth = getAuth(firebaseApp);

const BASE_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export function useGoogleAuth() {
  return Google.useAuthRequest({
    webClientId:     process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'],
    androidClientId: process.env['EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID'],
    iosClientId:     process.env['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'],
  });
}

export async function loginWithGoogleToken(accessToken: string): Promise<void> {
  const credential = GoogleAuthProvider.credential(null, accessToken);
  const result     = await signInWithCredential(firebaseAuth, credential);
  const idToken    = await result.user.getIdToken();

  const res = await axios.post<{ accessToken: string; refreshToken: string; user: AuthUser }>(
    `${BASE_URL}/api/v1/auth/google/login`,
    { idToken },
  );
  const { accessToken: jwt, refreshToken, user } = res.data;
  useAuthStore.getState().setAuth(jwt, refreshToken, user);
}

export async function logout(): Promise<void> {
  await signOut(firebaseAuth).catch(() => null);
  useAuthStore.getState().logout();
}
