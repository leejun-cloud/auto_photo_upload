import { describe, expect, it } from 'vitest';
import { embedMetadata } from '../src/lib/metadata-embed';
import { embedJpegMetadata } from '../src/lib/metadata-embed-jpeg';
import { tinyJpeg } from './tiny-jpeg';

// These tests deliberately avoid exiftool. The production bug they guard against
// was that embedding shelled out to exiftool (a Perl script), which does not exist
// on Vercel's serverless runtime — so every upload failed with "Perl must be
// installed". A test that needs Perl to run cannot catch that regression.

const APP1 = 0xe1;
const APP13 = 0xed;
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const PHOTOSHOP_HEADER = 'Photoshop 3.0\0';

type Segment = { marker: number; data: Buffer };

/** Minimal independent JPEG segment reader used only for assertions. */
function readSegments(bytes: Buffer): Segment[] {
  const segments: Segment[] = [];
  let offset = 2;
  while (offset < bytes.length && bytes[offset] === 0xff) {
    let markerPos = offset + 1;
    while (markerPos < bytes.length && bytes[markerPos] === 0xff) markerPos += 1;
    const marker = bytes[markerPos];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerPos + 1;
      continue;
    }
    const length = bytes.readUInt16BE(markerPos + 1);
    segments.push({ marker, data: bytes.subarray(markerPos + 3, markerPos + 1 + length) });
    offset = markerPos + 1 + length;
  }
  return segments;
}

function readXmp(bytes: Buffer): string {
  const segment = readSegments(bytes).find(
    (s) => s.marker === APP1 && s.data.subarray(0, XMP_HEADER.length).toString('latin1') === XMP_HEADER,
  );
  if (!segment) throw new Error('no XMP segment found');
  return segment.data.subarray(XMP_HEADER.length).toString('utf8');
}

/** Returns IPTC IIM datasets keyed as "record:dataset". */
function readIptc(bytes: Buffer): Map<string, string[]> {
  const segment = readSegments(bytes).find(
    (s) => s.marker === APP13 && s.data.subarray(0, PHOTOSHOP_HEADER.length).toString('latin1') === PHOTOSHOP_HEADER,
  );
  if (!segment) throw new Error('no IPTC segment found');

  const out = new Map<string, string[]>();
  let p = PHOTOSHOP_HEADER.length;
  while (p < segment.data.length - 11) {
    if (segment.data.subarray(p, p + 4).toString('latin1') !== '8BIM') break;
    const resourceId = segment.data.readUInt16BE(p + 4);
    const size = segment.data.readUInt32BE(p + 8);
    const block = segment.data.subarray(p + 12, p + 12 + size);

    if (resourceId === 0x0404) {
      let q = 0;
      while (q < block.length - 4 && block[q] === 0x1c) {
        const key = `${block[q + 1]}:${block[q + 2]}`;
        const len = block.readUInt16BE(q + 3);
        const value = block.subarray(q + 5, q + 5 + len).toString('utf8');
        out.set(key, [...(out.get(key) ?? []), value]);
        q += 5 + len;
      }
    }
    p += 12 + size + (size % 2);
  }
  return out;
}

const META = {
  title: 'Library class scene',
  description: 'Students learning together.',
  keywords: ['library', 'students', 'education'],
};

describe('metadata embed engine', () => {
  it('writes IPTC title, caption and keywords into a JPEG', async () => {
    const embedded = await embedMetadata(tinyJpeg, META);
    const iptc = readIptc(embedded);

    expect(iptc.get('2:5')?.[0]).toBe('Library class scene');
    expect(iptc.get('2:120')?.[0]).toBe('Students learning together.');
    expect(iptc.get('2:25')).toEqual(['library', 'students', 'education']);
  });

  it('declares UTF-8 and round-trips non-ASCII keywords', async () => {
    const embedded = await embedMetadata(tinyJpeg, {
      title: '도서관 수업',
      description: '함께 배우는 학생들.',
      keywords: ['도서관', '학생', 'education'],
    });

    const iptc = readIptc(embedded);
    // 1:90 CodedCharacterSet must be ESC % G, otherwise agencies mis-decode the text.
    expect(Buffer.from(iptc.get('1:90')![0], 'utf8')).toEqual(Buffer.from([0x1b, 0x25, 0x47]));
    expect(iptc.get('2:5')?.[0]).toBe('도서관 수업');
    expect(iptc.get('2:25')).toEqual(['도서관', '학생', 'education']);
  });

  it('writes XMP dc: fields inside a valid xpacket', async () => {
    const xmp = readXmp(await embedMetadata(tinyJpeg, META));

    expect(xmp).toContain('<?xpacket begin=');
    expect(xmp.trimEnd().endsWith('<?xpacket end="w"?>')).toBe(true);
    expect(xmp).toContain('Library class scene');
    expect(xmp).toContain('Students learning together.');
    for (const keyword of META.keywords) {
      expect(xmp).toContain(`<rdf:li>${keyword}</rdf:li>`);
    }
  });

  it('produces a structurally valid JPEG and is idempotent on re-embed', async () => {
    const once = await embedMetadata(tinyJpeg, META);
    const twice = await embedMetadata(once, META);

    expect(once.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    // Re-embedding must replace, not append, or files grow on every retry.
    expect(twice.length).toBe(once.length);
    expect(readIptc(twice).get('2:25')).toEqual(META.keywords);
  });

  it('escapes XML metacharacters instead of corrupting the packet', () => {
    const xmp = readXmp(
      embedJpegMetadata(tinyJpeg, {
        title: 'Rock & Roll <live>',
        description: 'A "loud" show',
        keywords: ['a&b'],
      }),
    );

    expect(xmp).toContain('Rock &amp; Roll &lt;live&gt;');
    expect(xmp).toContain('<rdf:li>a&amp;b</rdf:li>');
  });

  it('runs without any external binary on the JPEG path', async () => {
    // Guards the regression directly: if this ever spawns exiftool again it will
    // break on runtimes without Perl.
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const embedded = await embedMetadata(tinyJpeg, META);
      expect(readIptc(embedded).get('2:5')?.[0]).toBe('Library class scene');
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
