// Firebase Admin (서버 전용). 서비스계정 키는 환경변수로만 보관:
//   FIREBASE_SERVICE_ACCOUNT_B64  (base64로 인코딩한 JSON, 권장)  또는
//   FIREBASE_SERVICE_ACCOUNT       (원문 JSON 문자열)
import admin from 'firebase-admin';

function loadServiceAccount(): admin.ServiceAccount {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  let text = '';
  if (b64) text = Buffer.from(b64, 'base64').toString('utf8');
  else if (raw) text = raw;
  else throw new Error('FIREBASE_SERVICE_ACCOUNT(_B64) 환경변수가 설정되지 않았습니다.');

  let json: Record<string, string>;
  try {
    json = JSON.parse(text);
  } catch {
    json = JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
  }
  if (json.private_key && json.private_key.includes('\\n')) {
    json.private_key = json.private_key.replace(/\\n/g, '\n');
  }
  return json as unknown as admin.ServiceAccount;
}

function getApp() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
  }
  return admin.app();
}

export function adminAuth() {
  return getApp().auth();
}

export function adminDb() {
  return getApp().firestore();
}

export function adminBucket() {
  return getApp().storage().bucket(process.env.FIREBASE_STORAGE_BUCKET || undefined);
}

export async function verifyIdToken(idToken: string) {
  return adminAuth().verifyIdToken(idToken);
}
