/**
 * The byte-shape pipeline contract: every internal value flowing through
 * the shell — pipes, variables, redirects, command args — carries bytes as
 * a latin1-shaped JS string (`charCodeAt(i)` is the i-th byte). Host JS
 * Unicode crosses the boundary at `Bash.exec` / env / stdin / `InitialFiles`
 * and is encoded once; decode happens once at `Bash.exec` return.
 *
 * These tests pin the invariant. Failures here mean a boundary inside the
 * shell stopped treating values as bytes — typically a `string` method
 * applied to data that's actually a byte buffer.
 */
import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import { defineCommand } from "./custom-commands.js";

describe("byte-shape pipeline — $(cat) → variable → consumer", () => {
  it("multi-byte UTF-8 survives $(cat) into a variable verbatim", async () => {
    // 16 bytes: "before " + em-dash UTF-8 (e2 80 94) + " after".
    const bytes = new Uint8Array([
      0x62, 0x65, 0x66, 0x6f, 0x72, 0x65, 0x20, 0xe2, 0x80, 0x94, 0x20, 0x61,
      0x66, 0x74, 0x65, 0x72,
    ]);
    const env = new Bash({ files: { "/a": bytes } });
    const r = await env.exec(`
      V=$(cat /a)
      printf '%s' "$V" | wc -c
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("16");
  });

  it("variable expansion forwards bytes to base64 unchanged", async () => {
    const env = new Bash({
      files: { "/a": new Uint8Array([0xe2, 0x80, 0x94]) },
    });
    const r = await env.exec(`
      V=$(cat /a)
      printf '%s' "$V" | base64
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("4oCU"); // base64 of e2 80 94
  });

  it("non-UTF-8 binary bytes survive $(cat) round-trip", async () => {
    const env = new Bash({
      files: { "/a": new Uint8Array([0x80, 0xff, 0x00, 0x90]) },
    });
    const r = await env.exec(`
      V=$(cat /a)
      printf '%s' "$V" | wc -c
    `);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("4");
  });
});

describe("byte-shape pipeline — redirects round-trip bytes", () => {
  it("$(cat) → variable → printf > file produces identical bytes", async () => {
    const bytes = new Uint8Array([
      0x62, 0x65, 0x66, 0x6f, 0x72, 0x65, 0x20, 0xe2, 0x80, 0x94, 0x20, 0x61,
      0x66, 0x74, 0x65, 0x72,
    ]);
    const env = new Bash({ files: { "/a": bytes } });
    await env.exec(`
      V=$(cat /a)
      printf '%s' "$V" > /b
    `);
    const a = await env.fs.readFileBuffer("/a");
    const b = await env.fs.readFileBuffer("/b");
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it("tee writes binary input verbatim to file", async () => {
    const env = new Bash({
      files: { "/a": new Uint8Array([0xe2, 0x80, 0x94]) },
    });
    await env.exec("cat /a | tee /b > /dev/null");
    const a = await env.fs.readFileBuffer("/a");
    const b = await env.fs.readFileBuffer("/b");
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});

describe("byte-shape pipeline — host text ingress still works", () => {
  it("`echo café > /out` writes valid UTF-8", async () => {
    const env = new Bash();
    await env.exec("echo café > /out");
    const out = await env.fs.readFileBuffer("/out");
    // "café\n" UTF-8: c=63, a=61, f=66, é=c3 a9, \n=0a
    expect(Array.from(out)).toEqual([0x63, 0x61, 0x66, 0xc3, 0xa9, 0x0a]);
  });

  it("sed substitution on multi-byte input preserves bytes through redirect", async () => {
    const env = new Bash();
    await env.exec("echo 'Ü Ö ß' | sed 's/ß/ss/' > /out");
    const out = await env.fs.readFileBuffer("/out");
    // "Ü Ö ss\n": Ü=c3 9c, space=20, Ö=c3 96, space=20, s=73, s=73, \n=0a
    expect(Array.from(out)).toEqual([
      0xc3, 0x9c, 0x20, 0xc3, 0x96, 0x20, 0x73, 0x73, 0x0a,
    ]);
  });

  it("heredoc with non-ASCII body pipes UTF-8 bytes to wc -c", async () => {
    const env = new Bash();
    const r = await env.exec(`
wc -c <<EOF
Ü
EOF
`);
    expect(r.exitCode).toBe(0);
    // Ü = 2 bytes, \n = 1 byte → 3
    expect(r.stdout.trim()).toBe("3");
  });
});

describe("byte-shape pipeline — multibyte filenames through display commands", () => {
  it("`ls` emits a multibyte filename unchanged through a redirect", async () => {
    // Files are created through the shell: argv goes through ingress
    // normalization, so the on-disk key is byte-shape "caf\xc3\xa9.txt".
    const env = new Bash();
    await env.exec(`touch /tmp/café.txt && ls /tmp > /out`);
    const out = await env.fs.readFileBuffer("/out");
    // Expect "café.txt\n": c a f c3 a9 . t x t \n
    expect(Array.from(out)).toEqual([
      0x63, 0x61, 0x66, 0xc3, 0xa9, 0x2e, 0x74, 0x78, 0x74, 0x0a,
    ]);
  });

  it("`find` preserves multibyte filename bytes through a redirect", async () => {
    const env = new Bash();
    await env.exec(`touch /tmp/Ü.txt && find /tmp -name '*.txt' > /out`);
    const out = await env.fs.readFileBuffer("/out");
    // "/tmp/Ü.txt\n": / t m p / c3 9c . t x t \n
    expect(Array.from(out)).toEqual([
      0x2f, 0x74, 0x6d, 0x70, 0x2f, 0xc3, 0x9c, 0x2e, 0x74, 0x78, 0x74, 0x0a,
    ]);
  });

  it("`ls` piped through `wc -c` counts the right byte length", async () => {
    const env = new Bash();
    const r = await env.exec(`touch /tmp/é && ls /tmp | wc -c`);
    expect(r.exitCode).toBe(0);
    // "é\n" is 3 bytes (c3 a9 0a).
    expect(r.stdout.trim()).toBe("3");
  });
});

describe("byte-shape pipeline — combined stdout+stderr redirects", () => {
  it("`2>&1` merges shape-safely when the upstream tags `stdoutKind: text`", async () => {
    // A custom command that hand-builds real Unicode text on stdout
    // (codepoint > 0xFF). Without shape-aware merging, the `2>&1` path
    // would mis-tag the merged buffer and downstream redirects would
    // either truncate or double-encode.
    const env = new Bash();
    env.registerCommand(
      defineCommand("emit_text", async () => ({
        stdout: "—\n",
        stderr: "ERR\n",
        exitCode: 0,
        stdoutKind: "text",
      })),
    );
    await env.exec(`emit_text 2>&1 > /out`);
    const out = await env.fs.readFileBuffer("/out");
    // The contract we're pinning: each half is byte-encoded via its own
    // shape tag before concatenating. The text-tagged stdout half becomes
    // UTF-8 bytes (e2 80 94 0a); the byte-shape stderr half ("ERR\n")
    // passes through verbatim (45 52 52 0a). The merged buffer is valid
    // UTF-8 throughout — no double encoding, no truncation.
    expect(Array.from(out)).toEqual([
      0xe2, 0x80, 0x94, 0x0a, 0x45, 0x52, 0x52, 0x0a,
    ]);
  });

  it("`&>` writes both halves without mojibake when stdout is text-tagged", async () => {
    const env = new Bash();
    env.registerCommand(
      defineCommand("emit_text", async () => ({
        stdout: "stdout—\n",
        stderr: "stderr—\n",
        exitCode: 0,
        stdoutKind: "text",
        stderrKind: "text",
      })),
    );
    await env.exec(`emit_text &> /out`);
    const out = await env.fs.readFileBuffer("/out");
    // stdout half: "stdout—\n" → 73 74 64 6f 75 74 e2 80 94 0a
    // stderr half: "stderr—\n" → 73 74 64 65 72 72 e2 80 94 0a
    expect(Array.from(out)).toEqual([
      0x73, 0x74, 0x64, 0x6f, 0x75, 0x74, 0xe2, 0x80, 0x94, 0x0a, 0x73, 0x74,
      0x64, 0x65, 0x72, 0x72, 0xe2, 0x80, 0x94, 0x0a,
    ]);
  });

  it("`|&` pipe preserves byte-shape stderr without re-encoding", async () => {
    // The legacy `|&` path always UTF-8-encoded stderr, which double-
    // encoded any command that hand-built stderr from byte-shape strings.
    // The fix uses `stderrAsBytes`, which respects the tag — so a default
    // (untagged, byte-shape) stderr passes through unchanged.
    const env = new Bash();
    env.registerCommand(
      defineCommand("emit_byte_stderr", async () => ({
        stdout: "",
        // Byte-shape stderr: each char IS a byte. 0xe2 0x80 0x94 = "—".
        stderr: String.fromCharCode(0xe2, 0x80, 0x94, 0x0a),
        exitCode: 0,
      })),
    );
    const r = await env.exec(`emit_byte_stderr |& wc -c`);
    expect(r.exitCode).toBe(0);
    // 4 bytes: e2 80 94 0a
    expect(r.stdout.trim()).toBe("4");
  });
});

describe("byte-shape pipeline — custom command shape contract", () => {
  const env = new Bash();
  env.registerCommand(
    defineCommand("emit_text", async () => ({
      stdout: "—\n",
      stderr: "",
      exitCode: 0,
      stdoutKind: "text",
    })),
  );

  it("text-tagged stdout encodes to UTF-8 across a redirect", async () => {
    await env.exec(`emit_text > /a`);
    const a = await env.fs.readFileBuffer("/a");
    expect(Array.from(a)).toEqual([0xe2, 0x80, 0x94, 0x0a]);
  });

  it("text-tagged stdout encodes to UTF-8 across `$()` substitution", async () => {
    const r = await env.exec(`V=$(emit_text); printf '%s' "$V" | wc -c`);
    expect(r.exitCode).toBe(0);
    // "—" UTF-8 = 3 bytes. Substitution strips trailing newlines.
    expect(r.stdout.trim()).toBe("3");
  });

  it("text-tagged stdout encodes to UTF-8 across a pipe to wc -c", async () => {
    const r = await env.exec(`emit_text | wc -c`);
    expect(r.exitCode).toBe(0);
    // "—\n" UTF-8 = 4 bytes.
    expect(r.stdout.trim()).toBe("4");
  });
});
