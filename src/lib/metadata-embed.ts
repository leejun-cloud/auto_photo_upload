import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { embedJpegMetadata, isJpeg, type EmbedMetadata } from './metadata-embed-jpeg';

export type { EmbedMetadata };

// Embeds title/description/keywords as IPTC + XMP into the file bytes.
//
// JPEG takes a pure-JavaScript path. The previous implementation always shelled
// out to exiftool, which is a Perl script; Vercel's serverless runtime has no
// Perl, so every production upload failed with "Perl must be installed" before
// reaching FTP. Photos must never depend on an external binary.
//
// Video containers still need exiftool (writing XMP into MP4/MOV atoms is not
// something we want to hand-roll), so those keep the binary path and fail loudly
// with an actionable message where Perl is unavailable.
export async function embedMetadata(fileBytes: Buffer, metadata: EmbedMetadata): Promise<Buffer> {
  if (isJpeg(fileBytes)) {
    try {
      return embedJpegMetadata(fileBytes, metadata);
    } catch (error) {
      throw new Error(`Failed to embed metadata: ${(error as Error).message}`);
    }
  }

  return embedViaExiftool(fileBytes, metadata);
}

async function embedViaExiftool(fileBytes: Buffer, metadata: EmbedMetadata): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'stockflow-embed-'));
  const filePath = path.join(dir, `${randomUUID()}.mp4`);

  try {
    await writeFile(filePath, fileBytes);

    // Lazy-import so the JPEG path never loads the binary wrapper.
    const { exiftool } = await import('exiftool-vendored');

    // Typed as a loose record because exiftool's WriteTags type does not model
    // namespaced tag names like 'XMP-dc:Title'.
    const tags: Record<string, string | string[]> = {
      'XMP-dc:Title': metadata.title,
      'XMP-dc:Description': metadata.description,
      'XMP-dc:Subject': metadata.keywords,
    };

    await exiftool.write(filePath, tags, { writeArgs: ['-overwrite_original', '-codedcharacterset=utf8'] });

    return await readFile(filePath);
  } catch (error) {
    const message = (error as Error).message;
    if (/perl/i.test(message)) {
      throw new Error(
        'Failed to embed metadata: video metadata requires Perl/exiftool, which is unavailable in this runtime. Photos (JPEG) are unaffected.',
      );
    }
    throw new Error(`Failed to embed metadata: ${message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
