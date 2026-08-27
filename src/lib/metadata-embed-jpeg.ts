// Pure-JavaScript IPTC(IIM) + XMP embedding for JPEG.
//
// Why this exists: `exiftool-vendored` shells out to exiftool, which is a Perl
// script. Vercel's serverless runtime has no Perl on $PATH, so every embed call
// threw "Perl must be installed" and the whole upload pipeline died before it
// ever reached FTP. Local machines (macOS ships Perl) hid the bug.
//
// Stock agencies (Adobe Stock, Shutterstock, Alamy) read IPTC IIM and/or XMP
// for title/description/keywords, so writing those two blocks directly covers
// the fields the submission pipeline actually needs — with zero binaries.

export type EmbedMetadata = {
  title: string;
  description: string;
  keywords: string[];
};

const MARKER_SOI = 0xd8;
const MARKER_SOS = 0xda;
const MARKER_EOI = 0xd9;
const MARKER_APP1 = 0xe1;
const MARKER_APP13 = 0xed;

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const PHOTOSHOP_HEADER = 'Photoshop 3.0\0';

// IPTC IIM field length ceilings from the IPTC spec. Agencies reject or
// truncate oversized fields, so clamp before writing.
const MAX_OBJECT_NAME_BYTES = 64;
const MAX_CAPTION_BYTES = 2000;
const MAX_KEYWORD_BYTES = 64;

type Segment = { marker: number; data: Buffer };

export function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Cut a string to a byte budget without splitting a multi-byte UTF-8 char. */
function truncateUtf8(value: string, maxBytes: number): Buffer {
  const buf = Buffer.from(value, 'utf8');
  if (buf.length <= maxBytes) return buf;
  let end = maxBytes;
  // Walk back off any continuation byte (0b10xxxxxx) so we never emit a partial char.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Split a JPEG into its marker segments plus the trailing entropy-coded scan.
 * Parsing stops at SOS/EOI because everything after that is compressed data,
 * not segments.
 */
function parseSegments(bytes: Buffer): { segments: Segment[]; rest: Buffer } {
  if (!isJpeg(bytes)) throw new Error('not a JPEG buffer');

  const segments: Segment[] = [];
  let offset = 2; // skip SOI

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) break;

    // Skip 0xFF fill bytes that some encoders emit between segments.
    let markerPos = offset + 1;
    while (markerPos < bytes.length && bytes[markerPos] === 0xff) markerPos += 1;
    if (markerPos >= bytes.length) break;

    const marker = bytes[markerPos];

    // Start of scan / end of image: hand the remainder back untouched.
    if (marker === MARKER_SOS || marker === MARKER_EOI) {
      return { segments, rest: bytes.subarray(offset) };
    }

    // Standalone markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerPos + 1;
      continue;
    }

    if (markerPos + 3 > bytes.length) break;
    const length = bytes.readUInt16BE(markerPos + 1);
    if (length < 2 || markerPos + 1 + length > bytes.length) break;

    segments.push({ marker, data: bytes.subarray(markerPos + 3, markerPos + 1 + length) });
    offset = markerPos + 1 + length;
  }

  return { segments, rest: bytes.subarray(offset) };
}

function serializeSegment(segment: Segment): Buffer {
  const length = segment.data.length + 2;
  if (length > 0xffff) throw new Error('JPEG segment exceeds 64KB');
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = segment.marker;
  header.writeUInt16BE(length, 2);
  return Buffer.concat([header, segment.data]);
}

function isXmpSegment(segment: Segment): boolean {
  return segment.marker === MARKER_APP1 && segment.data.subarray(0, XMP_HEADER.length).toString('latin1') === XMP_HEADER;
}

function isPhotoshopSegment(segment: Segment): boolean {
  return (
    segment.marker === MARKER_APP13 &&
    segment.data.subarray(0, PHOTOSHOP_HEADER.length).toString('latin1') === PHOTOSHOP_HEADER
  );
}

function buildXmpSegment(metadata: EmbedMetadata): Segment {
  const keywords = metadata.keywords.map((kw) => `      <rdf:li>${escapeXml(kw)}</rdf:li>`).join('\n');

  const packet =
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about=""\n` +
    `    xmlns:dc="http://purl.org/dc/elements/1.1/"\n` +
    `    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">\n` +
    `   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.title)}</rdf:li></rdf:Alt></dc:title>\n` +
    `   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.description)}</rdf:li></rdf:Alt></dc:description>\n` +
    `   <photoshop:Headline>${escapeXml(metadata.title)}</photoshop:Headline>\n` +
    `   <dc:subject>\n    <rdf:Bag>\n${keywords}\n    </rdf:Bag>\n   </dc:subject>\n` +
    `  </rdf:Description>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>`;

  return {
    marker: MARKER_APP1,
    data: Buffer.concat([Buffer.from(XMP_HEADER, 'latin1'), Buffer.from(packet, 'utf8')]),
  };
}

/** One IPTC IIM dataset record: 0x1C, record no, dataset no, 2-byte length, value. */
function iptcDataset(record: number, dataset: number, value: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header[0] = 0x1c;
  header[1] = record;
  header[2] = dataset;
  header.writeUInt16BE(value.length, 3);
  return Buffer.concat([header, value]);
}

function buildIptcSegment(metadata: EmbedMetadata): Segment {
  const parts: Buffer[] = [];

  // 1:90 CodedCharacterSet = ESC % G  -> declares UTF-8 so Korean/accented text survives.
  parts.push(iptcDataset(1, 90, Buffer.from([0x1b, 0x25, 0x47])));

  if (metadata.title) parts.push(iptcDataset(2, 5, truncateUtf8(metadata.title, MAX_OBJECT_NAME_BYTES)));
  if (metadata.description) parts.push(iptcDataset(2, 120, truncateUtf8(metadata.description, MAX_CAPTION_BYTES)));
  for (const keyword of metadata.keywords) {
    if (keyword) parts.push(iptcDataset(2, 25, truncateUtf8(keyword, MAX_KEYWORD_BYTES)));
  }

  const iptcBlock = Buffer.concat(parts);

  // Wrap in an 8BIM Image Resource Block (resource id 0x0404 = IPTC-NAA).
  const resourceHeader = Buffer.alloc(12);
  resourceHeader.write('8BIM', 0, 'latin1');
  resourceHeader.writeUInt16BE(0x0404, 4);
  resourceHeader.writeUInt16BE(0x0000, 6); // empty Pascal name, padded to even
  resourceHeader.writeUInt32BE(iptcBlock.length, 8);

  const padding = iptcBlock.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0);

  return {
    marker: MARKER_APP13,
    data: Buffer.concat([Buffer.from(PHOTOSHOP_HEADER, 'latin1'), resourceHeader, iptcBlock, padding]),
  };
}

/**
 * Returns a new JPEG with title/description/keywords written as IPTC IIM + XMP.
 * Existing XMP / Photoshop-IPTC blocks are replaced so repeat runs stay idempotent.
 * Image pixel data is never re-encoded.
 */
export function embedJpegMetadata(fileBytes: Buffer, metadata: EmbedMetadata): Buffer {
  const { segments, rest } = parseSegments(fileBytes);

  const kept = segments.filter((segment) => !isXmpSegment(segment) && !isPhotoshopSegment(segment));
  const iptc = buildIptcSegment(metadata);
  const xmp = buildXmpSegment(metadata);

  // JFIF/EXIF APP0 must stay first; insert our metadata directly after it.
  const leadingAppCount = kept.findIndex((segment) => segment.marker !== 0xe0);
  const splitAt = leadingAppCount === -1 ? kept.length : leadingAppCount;

  const ordered = [...kept.slice(0, splitAt), iptc, xmp, ...kept.slice(splitAt)];

  return Buffer.concat([
    Buffer.from([0xff, MARKER_SOI]),
    ...ordered.map(serializeSegment),
    rest,
  ]);
}
