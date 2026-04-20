const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function toUint8Array(body: BodyInit | null | undefined): Uint8Array {
  if (!body) {
    return new Uint8Array();
  }
  if (typeof body === "string") {
    return textEncoder.encode(body);
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new Error(`Unsupported request body type: ${typeof body}`);
}

export function getRequestBodyBytes(
  body: BodyInit | null | undefined,
): Uint8Array {
  return toUint8Array(body);
}

export function getRequestBodyText(body: BodyInit | null | undefined): string {
  return textDecoder.decode(toUint8Array(body));
}
