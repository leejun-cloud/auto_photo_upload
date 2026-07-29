import { randomUUID } from 'node:crypto';
import type {
  AgencyCredentialRecord,
  AssetRecord,
  ContributorAddress,
  ContributorPayment,
  ContributorProfile,
  ContributorTax,
  FtpProtocol,
  JobRecord,
  JobStatus,
  MediaType,
  PlatformKey,
  ReleaseStatus,
  StorageBackend,
  SubmissionRecord,
  UserRecord,
} from './domain';
import { adminDb } from './firebase/admin';
import { nowIso } from './utils';

const USERS = 'stockflow_users';
const ASSETS = 'stockflow_assets';
const SUBMISSIONS = 'stockflow_submissions';
const CREDENTIALS = 'stockflow_agency_credentials';
const PROFILES = 'stockflow_contributor_profiles';
const JOBS = 'stockflow_jobs';

type Row = Record<string, unknown>;

function col(name: string) {
  return adminDb().collection(name);
}

// ---- insert-shape mirrors (identical to repository.ts) ----
type AssetInsert = Omit<AssetRecord, 'id' | 'createdAt' | 'updatedAt'>;
type SubmissionInsert = {
  assetId: string;
  userId: string;
  platform: PlatformKey;
  status: 'exported' | 'failed';
  exportBackend: StorageBackend;
  exportPath: string;
  payloadJson: string;
};
type AgencyCredentialInsert = {
  userId: string;
  platform: PlatformKey;
  protocol: FtpProtocol;
  host: string;
  port: number;
  username: string;
  encryptedPassword: string;
};
type ContributorProfileInsert = {
  userId: string;
  legalNameFull: string;
  displayName: string;
  country: string;
  phone: string;
  address: ContributorAddress;
  tax: ContributorTax;
  payment: ContributorPayment;
};

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value ? (JSON.parse(value) as T) : fallback;
  return value as T;
}

// ---- mappers (return the same domain shapes as the SQL mappers) ----
function mapUser(row: Row): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAsset(row: Row): AssetRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    originalFilename: String(row.original_filename),
    storageBackend: String(row.storage_backend) as StorageBackend,
    storagePath: String(row.storage_path),
    mimeType: String(row.mime_type),
    mediaType: String(row.media_type) as MediaType,
    fileSize: Number(row.file_size),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    title: String(row.title),
    description: String(row.description),
    keywords: Array.isArray(row.keywords_json) ? (row.keywords_json as string[]) : JSON.parse(String(row.keywords_json)),
    releaseStatus: String(row.release_status) as ReleaseStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSubmission(row: Row): SubmissionRecord {
  return {
    id: String(row.id),
    assetId: String(row.asset_id),
    userId: String(row.user_id),
    platform: String(row.platform) as PlatformKey,
    status: String(row.status) as 'exported' | 'failed',
    exportBackend: String(row.export_backend) as StorageBackend,
    exportPath: String(row.export_path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAgencyCredential(row: Row): AgencyCredentialRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    platform: String(row.platform) as PlatformKey,
    protocol: String(row.protocol) as FtpProtocol,
    host: String(row.host),
    port: Number(row.port),
    username: String(row.username),
    encryptedPassword: String(row.encrypted_password),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapContributorProfile(row: Row): ContributorProfile {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    identity: {
      legalNameFull: String(row.legal_name_full),
      displayName: String(row.display_name),
      country: String(row.country),
      phone: String(row.phone ?? ''),
    },
    address: parseJsonColumn<ContributorAddress>(row.address_json, { line1: '', line2: '', city: '', region: '', postalCode: '', country: '' }),
    tax: parseJsonColumn<ContributorTax>(row.tax_json, { foreignTin: '', usTin: '' }),
    payment: parseJsonColumn<ContributorPayment>(row.payment_json, { method: '', payoutEmail: '' }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapJob(row: Row): JobRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    assetId: row.asset_id == null ? null : String(row.asset_id),
    type: String(row.type),
    status: String(row.status) as JobStatus,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    payload: parseJsonColumn<Record<string, unknown>>(row.payload_json, {}),
    result: parseJsonColumn<Record<string, unknown> | null>(row.result_json, null),
    error: row.error == null ? null : String(row.error),
    runAfter: String(row.run_after),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// Sort ISO-string timestamps (ISO 8601 is lexicographically sortable).
function byCreatedAtDesc(a: Row, b: Row) {
  return String(a.created_at) < String(b.created_at) ? 1 : -1;
}
function byCreatedAtAsc(a: Row, b: Row) {
  return String(a.created_at) < String(b.created_at) ? -1 : 1;
}

// ---- users ----
export async function getUserByFirebaseUid(firebaseUid: string): Promise<UserRecord | null> {
  const snap = await col(USERS).where('firebase_uid', '==', firebaseUid).limit(1).get();
  return snap.empty ? null : mapUser(snap.docs[0].data() as Row);
}

export async function createUserFromFirebase(input: { uid: string; email: string; name: string }): Promise<UserRecord> {
  const now = nowIso();
  const existing = await col(USERS).where('firebase_uid', '==', input.uid).limit(1).get();
  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    await ref.update({ email: input.email, updated_at: now });
    return mapUser({ ...(existing.docs[0].data() as Row), email: input.email, updated_at: now });
  }
  const id = randomUUID();
  const row: Row = { id, firebase_uid: input.uid, email: input.email, name: input.name, created_at: now, updated_at: now };
  await col(USERS).doc(id).set(row);
  return mapUser(row);
}

// ---- assets ----
export async function createAsset(input: AssetInsert): Promise<AssetRecord> {
  const id = randomUUID();
  const now = nowIso();
  const row: Row = {
    id,
    user_id: input.userId,
    original_filename: input.originalFilename,
    storage_backend: input.storageBackend,
    storage_path: input.storagePath,
    mime_type: input.mimeType,
    media_type: input.mediaType,
    duration_seconds: input.durationSeconds,
    file_size: input.fileSize,
    width: input.width,
    height: input.height,
    title: input.title,
    description: input.description,
    keywords_json: input.keywords,
    release_status: input.releaseStatus,
    created_at: now,
    updated_at: now,
  };
  await col(ASSETS).doc(id).set(row);
  return mapAsset(row);
}

export async function updateAssetMetadata(
  userId: string,
  assetId: string,
  metadata: { title: string; description: string; keywords: string[] },
): Promise<AssetRecord | null> {
  const doc = await col(ASSETS).doc(assetId).get();
  if (!doc.exists) return null;
  const row = doc.data() as Row;
  if (String(row.user_id) !== userId) return null;
  const now = nowIso();
  const updated: Row = { ...row, title: metadata.title, description: metadata.description, keywords_json: metadata.keywords, updated_at: now };
  await doc.ref.update({ title: metadata.title, description: metadata.description, keywords_json: metadata.keywords, updated_at: now });
  return mapAsset(updated);
}

export async function listAssetsForUser(userId: string) {
  const [assetsSnap, subsSnap] = await Promise.all([
    col(ASSETS).where('user_id', '==', userId).get(),
    col(SUBMISSIONS).where('user_id', '==', userId).get(),
  ]);
  const assetRows = assetsSnap.docs.map((d) => d.data() as Row).sort(byCreatedAtDesc);
  const submissionRows = subsSnap.docs.map((d) => d.data() as Row).sort(byCreatedAtDesc);

  const grouped = new Map<string, SubmissionRecord[]>();
  for (const row of submissionRows) {
    const submission = mapSubmission(row);
    const list = grouped.get(submission.assetId) ?? [];
    list.push(submission);
    grouped.set(submission.assetId, list);
  }

  return assetRows.map((row) => ({
    ...mapAsset(row),
    submissions: grouped.get(String(row.id)) ?? [],
  }));
}

export async function getAssetByIdForUser(userId: string, assetId: string) {
  const doc = await col(ASSETS).doc(assetId).get();
  if (!doc.exists) return null;
  const row = doc.data() as Row;
  if (String(row.user_id) !== userId) return null;
  return mapAsset(row);
}

// ---- submissions ----
export async function createSubmission(input: SubmissionInsert) {
  const id = randomUUID();
  const now = nowIso();
  const row: Row = {
    id,
    asset_id: input.assetId,
    user_id: input.userId,
    platform: input.platform,
    status: input.status,
    export_backend: input.exportBackend,
    export_path: input.exportPath,
    payload_json: input.payloadJson,
    created_at: now,
    updated_at: now,
  };
  await col(SUBMISSIONS).doc(id).set(row);
  return mapSubmission(row);
}

export async function getSubmissionByIdForUser(userId: string, submissionId: string) {
  const doc = await col(SUBMISSIONS).doc(submissionId).get();
  if (!doc.exists) return null;
  const row = doc.data() as Row;
  if (String(row.user_id) !== userId) return null;
  return mapSubmission(row);
}

// ---- agency credentials (upsert key = user_id + platform) ----
export async function upsertAgencyCredential(input: AgencyCredentialInsert): Promise<AgencyCredentialRecord> {
  const now = nowIso();
  const snap = await col(CREDENTIALS).where('user_id', '==', input.userId).get();
  const existing = snap.docs.find((d) => String((d.data() as Row).platform) === input.platform);
  const id = existing ? String((existing.data() as Row).id) : randomUUID();
  const createdAt = existing ? String((existing.data() as Row).created_at) : now;
  const row: Row = {
    id,
    user_id: input.userId,
    platform: input.platform,
    protocol: input.protocol,
    host: input.host,
    port: input.port,
    username: input.username,
    encrypted_password: input.encryptedPassword,
    created_at: createdAt,
    updated_at: now,
  };
  await col(CREDENTIALS).doc(id).set(row);
  return mapAgencyCredential(row);
}

export async function getAgencyCredential(userId: string, platform: PlatformKey): Promise<AgencyCredentialRecord | null> {
  const snap = await col(CREDENTIALS).where('user_id', '==', userId).get();
  const doc = snap.docs.find((d) => String((d.data() as Row).platform) === platform);
  return doc ? mapAgencyCredential(doc.data() as Row) : null;
}

// Never returns the (encrypted) password — decryption happens only in the upload worker via getAgencyCredential.
export async function listAgencyCredentials(userId: string): Promise<Omit<AgencyCredentialRecord, 'encryptedPassword'>[]> {
  const snap = await col(CREDENTIALS).where('user_id', '==', userId).get();
  return snap.docs
    .map((d) => mapAgencyCredential(d.data() as Row))
    .sort((a, b) => (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0))
    .map(({ encryptedPassword: _encryptedPassword, ...safe }) => safe);
}

// ---- contributor profile (upsert key = user_id) ----
export async function getContributorProfile(userId: string): Promise<ContributorProfile | null> {
  const snap = await col(PROFILES).where('user_id', '==', userId).limit(1).get();
  return snap.empty ? null : mapContributorProfile(snap.docs[0].data() as Row);
}

export async function upsertContributorProfile(input: ContributorProfileInsert): Promise<ContributorProfile> {
  const now = nowIso();
  const snap = await col(PROFILES).where('user_id', '==', input.userId).limit(1).get();
  const existing = snap.empty ? null : snap.docs[0];
  const id = existing ? String((existing.data() as Row).id) : randomUUID();
  const createdAt = existing ? String((existing.data() as Row).created_at) : now;
  const row: Row = {
    id,
    user_id: input.userId,
    legal_name_full: input.legalNameFull,
    display_name: input.displayName,
    country: input.country,
    address_json: input.address,
    phone: input.phone,
    tax_json: input.tax,
    payment_json: input.payment,
    created_at: createdAt,
    updated_at: now,
  };
  await col(PROFILES).doc(id).set(row);
  return mapContributorProfile(row);
}

// ---- jobs ----
export async function enqueueJob(input: {
  userId: string;
  assetId?: string | null;
  type: string;
  payload: Record<string, unknown>;
}): Promise<JobRecord> {
  const id = randomUUID();
  const now = nowIso();
  const row: Row = {
    id,
    user_id: input.userId,
    asset_id: input.assetId ?? null,
    type: input.type,
    status: 'pending',
    attempts: 0,
    max_attempts: 3,
    payload_json: JSON.stringify(input.payload),
    result_json: null,
    error: null,
    run_after: now,
    created_at: now,
    updated_at: now,
  };
  await col(JOBS).doc(id).set(row);
  return mapJob(row);
}

async function getJobById(jobId: string): Promise<JobRecord | null> {
  const doc = await col(JOBS).doc(jobId).get();
  return doc.exists ? mapJob(doc.data() as Row) : null;
}

// Atomically claim the oldest ready pending job and flip it to 'processing'.
// Uses only a single-field equality query (status == 'pending'); ordering and the
// run_after<=now gate are applied in memory so no composite index is required.
export async function claimNextReadyJob(): Promise<JobRecord | null> {
  const db = adminDb();
  const jobs = db.collection(JOBS);
  const now = nowIso();

  const snap = await jobs.where('status', '==', 'pending').get();
  const candidates = snap.docs
    .map((d) => d.data() as Row)
    .filter((row) => String(row.run_after) <= now)
    .sort(byCreatedAtAsc);

  for (const candidate of candidates) {
    const ref = jobs.doc(String(candidate.id));
    // Re-read inside a transaction so two workers can't claim the same job.
    const claimed = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return null;
      const row = doc.data() as Row;
      if (String(row.status) !== 'pending' || String(row.run_after) > nowIso()) return null;
      const updatedAt = nowIso();
      tx.update(ref, { status: 'processing', updated_at: updatedAt });
      return mapJob({ ...row, status: 'processing', updated_at: updatedAt });
    });
    if (claimed) return claimed;
  }
  return null;
}

export async function markJobSucceeded(id: string, result: Record<string, unknown>): Promise<void> {
  await col(JOBS).doc(id).update({ status: 'succeeded', result_json: JSON.stringify(result), updated_at: nowIso() });
}

// Increment attempts; requeue (pending, delayed by backoffMs) while retries remain, else mark failed.
export async function markJobFailed(id: string, errorMessage: string, backoffMs: number): Promise<void> {
  const job = await getJobById(id);
  if (!job) return;
  const now = nowIso();
  const attempts = job.attempts + 1;
  const willRetry = attempts < job.maxAttempts;
  const status: JobStatus = willRetry ? 'pending' : 'failed';
  const runAfter = willRetry ? new Date(Date.now() + backoffMs).toISOString() : job.runAfter;
  await col(JOBS).doc(id).update({ status, attempts, error: errorMessage, run_after: runAfter, updated_at: now });
}

export async function listJobsForUser(userId: string): Promise<JobRecord[]> {
  const snap = await col(JOBS).where('user_id', '==', userId).get();
  return snap.docs.map((d) => d.data() as Row).sort(byCreatedAtDesc).map(mapJob);
}

export async function getJobForUser(userId: string, jobId: string): Promise<JobRecord | null> {
  const doc = await col(JOBS).doc(jobId).get();
  if (!doc.exists) return null;
  const row = doc.data() as Row;
  if (String(row.user_id) !== userId) return null;
  return mapJob(row);
}

// Reset a user's failed job so the worker can pick it up again.
export async function retryJob(userId: string, jobId: string): Promise<JobRecord | null> {
  const doc = await col(JOBS).doc(jobId).get();
  if (!doc.exists) return null;
  const row = doc.data() as Row;
  if (String(row.user_id) !== userId) return null;
  const now = nowIso();
  const updated: Row = { ...row, status: 'pending', attempts: 0, run_after: now, error: null, updated_at: now };
  await doc.ref.update({ status: 'pending', attempts: 0, run_after: now, error: null, updated_at: now });
  return mapJob(updated);
}
