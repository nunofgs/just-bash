/**
 * Byte/text boundary types for the shell pipeline.
 *
 * Shell pipes carry bytes, not text. Internally we represent a byte buffer as
 * a JS string where `s.charCodeAt(i)` is the i-th byte (0–255), the same
 * convention as `Buffer.from(s, "latin1")`. That's a space-cheap byte buffer,
 * but the type system can't tell it apart from a real `string`, and command
 * authors keep writing `ctx.stdin.split(...)` / `RegExp.test(ctx.stdin)` /
 * `JSON.parse(ctx.stdin)` over data that is actually UTF-8 packed in latin1.
 * The result is silent mojibake — every multibyte codepoint gets misread as
 * several latin1 chars, then re-encoded as UTF-8 on the way out.
 *
 * `ByteString` is opaque (deliberately not assignable to/from `string`) so
 * you cannot accidentally call string methods on it. The only ways out are
 * `latin1FromBytes` (passthrough — stay byte-clean) and `decodeBytesToUtf8`
 * (decode — process as text). Pick one explicitly per call site.
 */
declare const __byteString: unique symbol;
export interface ByteString {
    readonly [__byteString]: true;
}
/**
 * Tag a latin1 byte buffer (each char = one byte) as a `ByteString`. Use at
 * the pipeline edge: `cmdCtx.stdin = unsafeBytesFromLatin1(prevStdout)`.
 * Avoid inside command implementations.
 */
export declare function unsafeBytesFromLatin1(s: string): ByteString;
/**
 * Reveal the underlying latin1 byte buffer. Use when a command intentionally
 * forwards bytes unchanged (cat, head, tee, base64 -d, gzip, ...). Calling
 * regex / parse / `.length-as-chars` on the result re-introduces the
 * mojibake bug — if you need text, use `decodeBytesToUtf8` instead.
 */
export declare function latin1FromBytes(b: ByteString): string;
/**
 * Decode a `ByteString` as UTF-8. Use when a command interprets stdin as
 * text (jq, sed, grep, awk, ...). Returns proper Unicode where multibyte
 * codepoints occupy a single JS char, so regex and parsers work correctly.
 *
 * Falls back to the raw latin1 view if the bytes are not valid UTF-8 (e.g.
 * a binary stream piped into grep). Callers that want hard failure on
 * invalid UTF-8 should encode + decode manually with `{ fatal: true }`.
 */
export declare function decodeBytesToUtf8(b: ByteString): string;
/**
 * UTF-8 encode `s` (treating every char as a Unicode codepoint) into a
 * `ByteString`. Use at sites that *know* their input is decoded Unicode
 * text and need to emit it back as bytes — typically the inverse of an
 * earlier `decodeBytesToUtf8` call inside the same command.
 */
export declare function encodeUtf8ToBytes(s: string): ByteString;
/**
 * Convert host-provided JS Unicode text into the pipeline's latin1-byte
 * shape. Use at every host→shell *string* ingress: `Bash.exec`'s
 * `commandLine`, `cwd`, `args[]`, `ExecOptions.stdin` (when host hands
 * a `string`), `ExecOptions.env` values, heredoc / here-string bodies.
 * Once a value is byte-shape, every internal boundary (commands, pipes,
 * variables, redirects) is byte-faithful by default.
 *
 * Not for file *content*: `InitialFiles` string values are written to
 * disk via `InMemoryFs.toBuffer` which UTF-8-encodes them on write, so
 * the on-disk bytes are already correct without a normalization pass.
 *
 * Idempotent: re-normalizing an already byte-shape string is a no-op,
 * so recursive entry points (`bash -c <script>`, recursive `exec`,
 * `source script.sh`) don't double-encode.
 *
 * Detection rule:
 *  - any char > 0xFF  → real Unicode → UTF-8 encode and pack as latin1.
 *  - pure ASCII (all ≤ 0x7F) → already byte-shape (1 char = 1 byte).
 *  - mixed 0x80..0xFF → ambiguous. Could be host latin1 text (`é` = `é`)
 *    or already byte-shape (`é` packed as `Ã©`). Decode as UTF-8: if it
 *    yields a different string (i.e. it WAS a valid UTF-8 byte buffer),
 *    treat as byte-shape and pass through. Otherwise treat as host text
 *    and encode.
 */
export declare function bytesFromHostText(source: string): string;
/** The empty `ByteString`. */
export declare const EMPTY_BYTES: ByteString;
/**
 * Convert a `Uint8Array` to a `ByteString`. Each byte becomes one char.
 * The reverse is `Uint8Array.from(latin1FromBytes(b), (c) => c.charCodeAt(0))`.
 */
export declare function bytesFromUint8Array(buf: Uint8Array): ByteString;
/**
 * Read a file's raw bytes from any `IFileSystem`. Prefers the optional
 * {@link IFileSystem.readFileBytes} method (built-in filesystems implement
 * it natively), falling back to {@link IFileSystem.readFileBuffer} +
 * conversion for external/custom filesystems written before
 * `readFileBytes` existed. Use this from internal commands instead of
 * calling `fs.readFileBytes` directly so user-supplied filesystems keep
 * working.
 */
export declare function readBytesFrom(fs: {
    readFileBytes?(path: string): Promise<ByteString>;
    readFileBuffer(path: string): Promise<Uint8Array>;
}, path: string): Promise<ByteString>;
/** Either-or shape of a command's `stdout` / `stderr`. */
export type OutputKind = "text" | "bytes";
/**
 * Read the explicit shape of a command's stdout. Returns the producer's
 * `stdoutKind` tag verbatim if set. Defaults to `"bytes"` to match the
 * byte-shape pipeline contract — internal builtins pass through
 * ingress-normalized bytes, and the legacy `stdoutEncoding: "binary"`
 * flag agrees with that default.
 */
export declare function stdoutKind(result: {
    stdoutKind?: OutputKind;
    stdoutEncoding?: "binary";
}): OutputKind;
/**
 * Coerce a command's stdout to a `ByteString` for the byte-shaped pipe.
 * Text gets UTF-8 encoded once (codepoints → bytes); bytes pass through.
 */
export declare function stdoutAsBytes(result: {
    stdout: string;
    stdoutKind?: OutputKind;
    stdoutEncoding?: "binary";
}): ByteString;
/**
 * Build an `ExecResult`-shaped object whose stdout is decoded text. Sets
 * `stdoutKind: "text"` so the pipe knows to UTF-8 encode it on handoff
 * and redirects know to write it as UTF-8. Use for command authors that
 * decode their input and emit Unicode text — they no longer have to
 * manually re-encode for downstream byte consumers.
 */
export declare function textOutput(data: string): {
    stdout: string;
    stdoutKind: "text";
};
/**
 * Build an `ExecResult`-shaped object whose stdout is a latin1 byte view.
 * Sets both `stdoutKind: "bytes"` (new contract) and `stdoutEncoding:
 * "binary"` (legacy alias) so older code paths keep working through the
 * migration. Use for command authors that emit raw bytes (cat, gzip,
 * tar, base64 -d, ...).
 */
export declare function bytesOutput(data: ByteString): {
    stdout: string;
    stdoutKind: "bytes";
    stdoutEncoding: "binary";
};
/**
 * Coerce a command's stderr to a `ByteString` using `stderrKind`. Mirrors
 * `stdoutAsBytes` but reads the stderr-side tag. Defaults to byte-shape
 * (most commands hand-build stderr from ASCII literals).
 */
export declare function stderrAsBytes(result: {
    stderr: string;
    stderrKind?: OutputKind;
}): ByteString;
/**
 * Append one command's output to a multi-statement accumulator while
 * preserving shape. Each side is byte-encoded via its own kind tag, then
 * concatenated as bytes. Used by statement groups, subshells, control-flow
 * blocks, and anywhere a sequence of commands feeds a single redirect.
 *
 * The returned accumulator is byte-shape (`stdoutKind: "bytes"`); the
 * downstream consumer (redirection / pipe) treats it as a verbatim byte
 * buffer regardless of what the individual statements produced.
 */
export declare function appendExecResultBytes(acc: {
    stdout: string;
    stderr: string;
}, result: {
    stdout: string;
    stderr: string;
    stdoutKind?: OutputKind;
    stderrKind?: OutputKind;
    stdoutEncoding?: "binary";
}): {
    stdout: string;
    stderr: string;
};
export {};
