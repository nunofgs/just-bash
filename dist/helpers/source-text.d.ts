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
export declare function normalizeSourceTextToBytes(source: string): string;
