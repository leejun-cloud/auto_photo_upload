'use client';

// Firebase JS SDK (브라우저). NEXT_PUBLIC_FIREBASE_* 환경변수로 초기화한다.
// 초기화는 실제 인증 동작 시점까지 지연되므로, 빌드 시 환경변수가 없어도 크래시하지 않는다.
import { getApp, getApps, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function auth() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}

export async function signUp(email: string, password: string): Promise<string> {
  const cred = await createUserWithEmailAndPassword(auth(), email, password);
  return cred.user.getIdToken();
}

export async function signIn(email: string, password: string): Promise<string> {
  const cred = await signInWithEmailAndPassword(auth(), email, password);
  return cred.user.getIdToken();
}

export async function signInWithGoogle(): Promise<string> {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth(), provider);
  return cred.user.getIdToken();
}

export async function signOutClient(): Promise<void> {
  await signOut(auth());
}
