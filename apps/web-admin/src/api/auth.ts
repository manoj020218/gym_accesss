import axios from 'axios';
import { useAuthStore, type AuthUser } from '../store/auth';

const BASE_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:8080';

// ── Firebase — only initialise if a real API key is configured ─────────────
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, type Auth } from 'firebase/auth';

const fbApiKey = import.meta.env['VITE_FIREBASE_API_KEY'] as string | undefined;

let firebaseAuth: Auth | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (fbApiKey) {
  const fbApp = getApps().length === 0
    ? initializeApp({
        apiKey:    fbApiKey,
        authDomain: import.meta.env['VITE_FIREBASE_AUTH_DOMAIN'],
        projectId:  import.meta.env['VITE_FIREBASE_PROJECT_ID'],
      })
    : getApps()[0]!;
  firebaseAuth  = getAuth(fbApp);
  googleProvider = new GoogleAuthProvider();
}

// ── Auth functions ──────────────────────────────────────────────────────────
export async function loginWithGoogle(): Promise<void> {
  if (!firebaseAuth || !googleProvider) {
    throw new Error('Firebase is not configured. Use Dev Login in development.');
  }
  const result  = await signInWithPopup(firebaseAuth, googleProvider);
  const idToken = await result.user.getIdToken();

  const res = await axios.post<{ accessToken: string; refreshToken: string; user: AuthUser }>(
    `${BASE_URL}/api/v1/auth/google/login`,
    { idToken },
  );
  const { accessToken, refreshToken, user } = res.data;
  useAuthStore.getState().setAuth(accessToken, refreshToken, user);
}

export async function loginWithSeed(username: string, password: string): Promise<void> {
  const res = await axios.post<{ accessToken: string; refreshToken: string; user: AuthUser }>(
    `${BASE_URL}/api/v1/auth/seed-login`,
    { username, password },
  );
  const { accessToken, refreshToken, user } = res.data;
  useAuthStore.getState().setAuth(accessToken, refreshToken, user);
}

export async function loginAsDev(): Promise<void> {
  const res = await axios.post<{ accessToken: string; refreshToken: string; user: AuthUser }>(
    `${BASE_URL}/api/v1/auth/dev-login`,
  );
  const { accessToken, refreshToken, user } = res.data;
  useAuthStore.getState().setAuth(accessToken, refreshToken, user);
}

export async function logout(): Promise<void> {
  await firebaseAuth?.signOut().catch(() => null);
  useAuthStore.getState().logout();
}

export async function fetchMe() {
  const { api } = await import('./client');
  const res = await api.get<AuthUser>('/auth/me');
  return res.data;
}
