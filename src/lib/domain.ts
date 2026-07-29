export type PlatformKey = 'adobe' | 'shutterstock' | 'alamy' | 'getty';

export type ReleaseStatus = 'none' | 'model_attached' | 'property_attached' | 'both_attached';
export type StorageBackend = 'local' | 's3' | 'firebase';
export type MediaType = 'image' | 'video';

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type AssetRecord = {
  id: string;
  userId: string;
  originalFilename: string;
  storageBackend: StorageBackend;
  storagePath: string;
  mimeType: string;
  mediaType: MediaType;
  fileSize: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  title: string;
  description: string;
  keywords: string[];
  releaseStatus: ReleaseStatus;
  createdAt: string;
  updatedAt: string;
};

export type SubmissionRecord = {
  id: string;
  assetId: string;
  userId: string;
  platform: PlatformKey;
  status: 'exported' | 'failed';
  exportBackend: StorageBackend;
  exportPath: string;
  createdAt: string;
  updatedAt: string;
};

export type FtpProtocol = 'ftp' | 'ftps' | 'sftp';

export type AgencyCredentialRecord = {
  id: string;
  userId: string;
  platform: PlatformKey;
  protocol: FtpProtocol;
  host: string;
  port: number;
  username: string;
  encryptedPassword: string;
  createdAt: string;
  updatedAt: string;
};

export type ContributorAddress = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

export type ContributorTax = {
  foreignTin: string;
  usTin: string;
};

export type ContributorPayment = {
  method: string;
  payoutEmail: string;
};

export type ContributorProfile = {
  id: string;
  userId: string;
  identity: {
    legalNameFull: string;
    displayName: string;
    country: string;
    phone: string;
  };
  address: ContributorAddress;
  tax: ContributorTax;
  payment: ContributorPayment;
  createdAt: string;
  updatedAt: string;
};

export type JobStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

export type JobRecord = {
  id: string;
  userId: string;
  assetId: string | null;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  runAfter: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformPayload = {
  assetId: string;
  platform: PlatformKey;
  metadata: Record<string, unknown>;
  instructions: string[];
  exportBaseName: string;
};
