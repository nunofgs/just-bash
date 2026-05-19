import { describe, expect, it } from "vitest";
import { bytesFromHostText } from "./encoding.js";

describe("bytesFromHostText", () => {
  it("leaves pure ASCII unchanged", () => {
    expect(bytesFromHostText("hello world")).toBe("hello world");
  });

  it("leaves empty string unchanged", () => {
    expect(bytesFromHostText("")).toBe("");
  });

  it("UTF-8 encodes a real Unicode codepoint > 0xFF", () => {
    // Em-dash U+2014 → e2 80 94
    expect(bytesFromHostText("a—b")).toBe("aâb");
  });

  it("UTF-8 encodes a latin1 codepoint in source (é = U+00E9 → c3 a9)", () => {
    expect(bytesFromHostText("é")).toBe("Ã©");
  });

  it("UTF-8 encodes German umlauts", () => {
    // Ü Ö ß → c3 9c 20 c3 96 20 c3 9f
    expect(bytesFromHostText("Ü Ö ß")).toBe(
      "Ã Ã Ã",
    );
  });

  it("is idempotent for valid UTF-8 byte buffers (em-dash)", () => {
    const once = bytesFromHostText("a—b");
    expect(bytesFromHostText(once)).toBe(once);
  });

  it("is idempotent for valid UTF-8 byte buffers (German umlauts)", () => {
    const once = bytesFromHostText("Ü Ö ß");
    expect(bytesFromHostText(once)).toBe(once);
  });

  it("encodes a lone 0xFF as host text (not a valid UTF-8 byte buffer)", () => {
    // A latin1 ambiguity case: the input is the single JS char `ÿ`
    // (codepoint U+00FF). Could be (a) host text the caller typed,
    // (b) a byte-shape buffer holding the single byte 0xFF. The detection
    // rule decodes the buffer as strict UTF-8: 0xFF is never a valid
    // UTF-8 lead byte, so decode fails and the input is treated as host
    // text. U+00FF UTF-8 encodes to c3 bf, packed as latin1 → "Ã¿".
    //
    // The byte-shape interpretation (single byte 0xFF) is unreachable
    // through this entry point: callers who hold raw bytes use
    // `unsafeBytesFromLatin1` directly. `bytesFromHostText` is for host
    // string ingress, where treating ambiguity as text is the safer
    // default (a downstream decode either succeeds or surfaces the
    // problem at the boundary).
    expect(bytesFromHostText("ÿ")).toBe("Ã¿");
  });
});
