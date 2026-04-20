import { fromBuffer, toBuffer } from "../fs/encoding.js";

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Convert host-provided source text into the shell's internal byte-carrier shape.
 *
 * Public APIs hand scripts to just-bash as JS strings, which means UTF-8 source
 * literals are already decoded to Unicode code points. Internally we represent
 * byte streams as latin1-shaped strings (one code unit per byte), so we need to
 * re-byteify host text once at the script ingress.
 *
 * If the script already looks like an internal byte-carrier string, leave it as-is.
 */
export function normalizeSourceTextToBytes(source: string): string {
  if (!source) {
    return source;
  }

  let hasHighByte = false;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code > 0xff) {
      return fromBuffer(toBuffer(source, "utf8"), "binary");
    }
    if (code > 0x7f) {
      hasHighByte = true;
    }
  }

  if (!hasHighByte) {
    return source;
  }

  const binaryBytes = toBuffer(source, "binary");
  try {
    const decoded = strictUtf8Decoder.decode(binaryBytes);
    if (decoded !== source) {
      return source;
    }
  } catch {
    // Not already a UTF-8 byte-carrier string; encode it below.
  }

  return fromBuffer(toBuffer(source, "utf8"), "binary");
}
