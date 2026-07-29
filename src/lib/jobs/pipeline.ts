import type { AssetRecord, PlatformKey, SubmissionRecord } from '../domain';
import { generateMetadata as realGenerateMetadata, type GeneratedMetadata } from '../ai/metadata';
import { uploadToAgencies as realUploadToAgencies, type UploadResult } from '../ftp/uploader';
import { createSubmission as realCreateSubmission, getAssetByIdForUser, updateAssetMetadata as realUpdateAssetMetadata } from '../repository';
import { readStoredObject } from '../storage';

// External calls are injectable so the pipeline is unit-testable without DB/network,
// mirroring the UploadDeps idiom in ftp/uploader.ts.
export type PipelineDeps = {
  loadAsset?: (userId: string, assetId: string) => Promise<AssetRecord | null>;
  readBytes?: (storageBackend: AssetRecord['storageBackend'], storagePath: string) => Promise<Buffer>;
  generateMetadata?: (bytes: Buffer, mimeType: string) => Promise<GeneratedMetadata>;
  updateAssetMetadata?: (userId: string, assetId: string, metadata: GeneratedMetadata) => Promise<AssetRecord | null>;
  uploadToAgencies?: (params: { userId: string; asset: AssetRecord; fileBytes: Buffer; platforms: PlatformKey[] }) => Promise<UploadResult[]>;
  createSubmission?: (input: {
    assetId: string;
    userId: string;
    platform: PlatformKey;
    status: 'exported' | 'failed';
    exportBackend: AssetRecord['storageBackend'];
    exportPath: string;
    payloadJson: string;
  }) => Promise<SubmissionRecord>;
};

export type PipelineSummary = {
  metadataGenerated: boolean;
  results: UploadResult[];
};

export async function runAssetPipeline(
  params: { userId: string; assetId: string; platforms: PlatformKey[]; generateMetadata: boolean },
  deps: PipelineDeps = {},
): Promise<PipelineSummary> {
  const loadAsset = deps.loadAsset ?? getAssetByIdForUser;
  const readBytes = deps.readBytes ?? readStoredObject;
  const generateMetadata = deps.generateMetadata ?? realGenerateMetadata;
  const updateAssetMetadata = deps.updateAssetMetadata ?? realUpdateAssetMetadata;
  const uploadToAgencies = deps.uploadToAgencies ?? realUploadToAgencies;
  const createSubmission = deps.createSubmission ?? realCreateSubmission;

  let asset = await loadAsset(params.userId, params.assetId);
  if (!asset) throw new Error(`asset not found: ${params.assetId}`);

  const fileBytes = await readBytes(asset.storageBackend, asset.storagePath);

  let metadataGenerated = false;
  if (params.generateMetadata) {
    const metadata = await generateMetadata(fileBytes, asset.mimeType);
    const updated = await updateAssetMetadata(params.userId, params.assetId, metadata);
    if (updated) asset = updated;
    metadataGenerated = true;
  }

  const results = await uploadToAgencies({ userId: params.userId, asset, fileBytes, platforms: params.platforms });

  for (const result of results) {
    await createSubmission({
      assetId: asset.id,
      userId: params.userId,
      platform: result.platform,
      status: result.status === 'uploaded' ? 'exported' : 'failed',
      exportBackend: asset.storageBackend,
      exportPath: result.remotePath,
      payloadJson: JSON.stringify(result),
    });
  }

  return { metadataGenerated, results };
}
