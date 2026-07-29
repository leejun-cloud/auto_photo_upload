import { Readable } from 'node:stream';
import type { AgencyCredentialRecord, AssetRecord, FtpProtocol, PlatformKey } from '../domain';
import { decryptSecret } from '../crypto';
import { logError } from '../logger';
import { embedMetadata } from '../metadata-embed';
import { getAgencyCredential } from '../repository';
import { sanitizeFilename } from '../utils';
import { FTP_ENDPOINTS, type FtpEndpoint } from './endpoints';

// A minimal transport interface so the FTP/SFTP client can be injected/mocked in tests.
export type UploadClient = {
  connect(endpoint: FtpEndpoint, username: string, password: string): Promise<void>;
  uploadFrom(bytes: Buffer, remotePath: string): Promise<void>;
  close(): Promise<void>;
};

export type ClientFactory = (protocol: FtpProtocol) => UploadClient;

export type UploadResult = {
  platform: PlatformKey;
  status: 'uploaded' | 'failed';
  remotePath: string;
  error?: string;
};

export type UploadDeps = {
  createClient?: ClientFactory;
  embed?: typeof embedMetadata;
  loadCredential?: (userId: string, platform: PlatformKey) => Promise<AgencyCredentialRecord | null>;
  retries?: number;
};

const RETRIES = 2;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Real client factory. Libraries are lazy-imported so mocked test paths never load them.
function defaultCreateClient(protocol: FtpProtocol): UploadClient {
  if (protocol === 'sftp') {
    let client: import('ssh2-sftp-client') | null = null;
    return {
      async connect(endpoint, username, password) {
        const SftpClient = (await import('ssh2-sftp-client')).default;
        client = new SftpClient();
        await client.connect({ host: endpoint.host, port: endpoint.port, username, password });
      },
      async uploadFrom(bytes, remotePath) {
        await client!.put(bytes, remotePath);
      },
      async close() {
        await client?.end();
      },
    };
  }

  let client: import('basic-ftp').Client | null = null;
  return {
    async connect(endpoint, username, password) {
      const { Client } = await import('basic-ftp');
      client = new Client();
      await client.access({ host: endpoint.host, port: endpoint.port, user: username, password, secure: protocol === 'ftps' });
    },
    async uploadFrom(bytes, remotePath) {
      await client!.uploadFrom(Readable.from(bytes), remotePath);
    },
    async close() {
      client?.close();
    },
  };
}

async function uploadOne(
  endpoint: FtpEndpoint,
  credential: AgencyCredentialRecord,
  bytes: Buffer,
  remotePath: string,
  createClient: ClientFactory,
  retries: number,
): Promise<void> {
  const password = decryptSecret(credential.encryptedPassword);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const client = createClient(endpoint.protocol);
    try {
      await client.connect(endpoint, credential.username, password);
      await client.uploadFrom(bytes, remotePath);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(200 * (attempt + 1));
    } finally {
      await client.close().catch(() => {});
    }
  }
  throw lastError;
}

export async function uploadToAgencies(
  params: { userId: string; asset: AssetRecord; fileBytes: Buffer; platforms: PlatformKey[] },
  deps: UploadDeps = {},
): Promise<UploadResult[]> {
  const createClient = deps.createClient ?? defaultCreateClient;
  const embed = deps.embed ?? embedMetadata;
  const loadCredential = deps.loadCredential ?? getAgencyCredential;
  const retries = deps.retries ?? RETRIES;

  // Metadata is asset-level, so embed once and fan the same bytes out to every platform.
  const embedded = await embed(params.fileBytes, {
    title: params.asset.title,
    description: params.asset.description,
    keywords: params.asset.keywords,
  });

  const settled = await Promise.allSettled(
    params.platforms.map(async (platform): Promise<UploadResult> => {
      const remotePath = sanitizeFilename(params.asset.originalFilename);
      const endpoint = FTP_ENDPOINTS[platform];
      if (!endpoint) throw new Error(`No FTP endpoint configured for platform: ${platform}`);
      const credential = await loadCredential(params.userId, platform);
      if (!credential) throw new Error(`No credential configured for platform: ${platform}`);
      await uploadOne(endpoint, credential, embedded, remotePath, createClient, retries);
      return { platform, status: 'uploaded', remotePath };
    }),
  );

  return settled.map((result, index) => {
    const platform = params.platforms[index];
    if (result.status === 'fulfilled') return result.value;
    // Log the raw error server-side only; never leak host/stack details to the client-facing field.
    logError('ftp.upload_failed', result.reason, { platform });
    return {
      platform,
      status: 'failed',
      remotePath: sanitizeFilename(params.asset.originalFilename),
      error: '업로드 실패 (연결 또는 인증 오류)',
    };
  });
}
