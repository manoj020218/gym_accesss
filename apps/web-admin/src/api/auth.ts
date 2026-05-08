import axios from 'axios';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { useAuthStore, type AuthUser } from '../store/auth';

const firebaseConfig = {
  apiKey:    import.meta.env['VITE_FIREBASE_API_KEY'],
  authDomain: import.meta.env['VITE_FIREBASE_AUTH_DOMAIN'],
  projectId: import.meta.env['VITE_FIREBASE_PROJECT_ID'],
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]!;
const firebaseAuth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

const BASE_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3000';

export async function loginWithGoogle(): Promise<void> {
  const result = await signInWithPopup(firebaseAuth, googleProvider);
  const idToken = await result.user.getIdToken();

  const res = await axios.post<{ accessToken: string; refreshToken: string; user: AuthUser }>(
    `${BASE_URL}/api/v1/auth/google/login`,
    { idToken },
  );

  const { accessToken, refreshToken, user } = res.data;
  useAuthStore.getState().setAuth(accessToken, refreshToken, user);
}

export async function logout(): Promise<void> {
  await firebaseAuth.signOut().catch(() => null);
  useAuthStore.getState().logout();
}

export async function fetchMe() {
  const { api } = await import('./client');
  const res = await api.get<AuthUser>('/auth/me');
  return res.data;
}
