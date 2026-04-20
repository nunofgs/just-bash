import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Bash } from "../../../Bash.js";
import { getRequestBodyBytes } from "./request-body-test-helpers.js";

const originalFetch = global.fetch;
const expectedJson = '{"body":"é"}';
const expectedBytes = new TextEncoder().encode(expectedJson);

let recordedBodies: Map<string, Uint8Array>;

const mockFetch = vi.fn(
  async (url: string | URL | Request, options?: RequestInit) => {
    const urlString =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;

    if (urlString === "https://api.example.com/payload") {
      return new Response(expectedBytes, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (options?.body) {
      recordedBodies.set(urlString, getRequestBodyBytes(options.body));
    }

    return new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
);

beforeAll(() => {
  global.fetch = mockFetch as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe("curl UTF-8 request bodies", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    recordedBodies = new Map();
  });

  it("sends source literals as UTF-8 bytes", async () => {
    const env = new Bash({
      network: {
        allowedUrlPrefixes: ["https://api.example.com"],
        allowedMethods: ["POST"],
      },
    });

    const result = await env.exec(
      `curl -d '{"body":"é"}' https://api.example.com/literal`,
    );

    expect(result.exitCode).toBe(0);
    expect(recordedBodies.get("https://api.example.com/literal")).toEqual(
      expectedBytes,
    );
  });

  it("keeps literals and command substitution byte-identical", async () => {
    const env = new Bash({
      network: {
        allowedUrlPrefixes: ["https://api.example.com"],
        allowedMethods: ["GET", "POST"],
      },
    });

    const result = await env.exec(`
      curl -d '{"body":"é"}' https://api.example.com/literal > /dev/null
      payload=$(curl https://api.example.com/payload)
      curl -d "$payload" https://api.example.com/substitution
    `);

    expect(result.exitCode).toBe(0);
    expect(recordedBodies.get("https://api.example.com/literal")).toEqual(
      expectedBytes,
    );
    expect(recordedBodies.get("https://api.example.com/substitution")).toEqual(
      expectedBytes,
    );
  });
});
