import { createHash, createHmac } from "crypto";

// Under a Dark Star: the smallest client for Cloudflare R2 the nightly backup
// needs (docs/DarkStar-Accounts.md §10, B6). R2 speaks the S3 API, signed
// with AWS Signature Version 4; three calls (put, get, list) are a few dozen
// lines of node:crypto, so no SDK joins the dependencies.

export interface R2Config {
  // The Cloudflare account ID: the endpoint is <accountId>.r2.cloudflarestorage.com.
  accountId: string;
  // An R2 API token's S3 credentials, scoped to the one bucket. Secret.
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export type Fetch = typeof fetch;

export interface SignInput {
  method: string;
  host: string;
  // The path as sent, already URI-encoded.
  path: string;
  query: Record<string, string>;
  // Headers to sign besides host (names lower-case).
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  // YYYYMMDD'T'HHMMSS'Z'
  amzDate: string;
}

const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

// RFC 3986 encoding as SigV4 wants it: unreserved characters stay, "/"
// stays in paths, everything else is %XX.
export function uriEncode(value: string, keepSlash: boolean): string {
  return Array.from(Buffer.from(value, "utf8"))
    .map((byte) => {
      const ch = String.fromCharCode(byte);
      if (/[A-Za-z0-9\-._~]/.test(ch) || (keepSlash && ch === "/")) return ch;
      return "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    })
    .join("");
}

export function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k, false)}=${uriEncode(query[k], false)}`)
    .join("&");
}

// The Authorization header value for a request (AWS SigV4, header form).
export function signV4(input: SignInput): string {
  const headers: Record<string, string> = { host: input.host };
  for (const [name, value] of Object.entries(input.headers)) {
    headers[name.toLowerCase()] = value.trim();
  }
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery(input.query),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const day = input.amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, day);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");
  return (
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
}

export function amzDateFor(now: number): string {
  return new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
}

export class R2Client {
  constructor(
    private readonly config: R2Config,
    private readonly fetchImpl: Fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  private host(): string {
    return `${this.config.accountId}.r2.cloudflarestorage.com`;
  }

  private async send(
    method: "GET" | "PUT",
    key: string | null,
    query: Record<string, string>,
    body?: Uint8Array<ArrayBuffer>,
  ): Promise<Response> {
    const host = this.host();
    const path =
      "/" +
      uriEncode(this.config.bucket, false) +
      (key === null ? "" : "/" + uriEncode(key, true));
    const payloadHash = sha256Hex(body ?? new Uint8Array());
    const amzDate = amzDateFor(this.clock());
    const signed = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    const authorization = signV4({
      method,
      host,
      path,
      query,
      headers: signed,
      payloadHash,
      region: "auto",
      service: "s3",
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      amzDate,
    });
    const qs = canonicalQuery(query);
    const url = `https://${host}${path}${qs === "" ? "" : "?" + qs}`;
    const response = await this.fetchImpl(url, {
      method,
      headers: { ...signed, authorization },
      body,
    });
    if (!response.ok) {
      // R2's error bodies are short XML naming the code; nothing secret.
      const text = (await response.text()).slice(0, 300);
      throw new Error(
        `R2 ${method} ${key ?? "(list)"}: ${response.status} ${text}`,
      );
    }
    return response;
  }

  async put(key: string, body: Uint8Array<ArrayBuffer>): Promise<void> {
    await this.send("PUT", key, {}, body);
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.send("GET", key, {});
    return Buffer.from(await response.arrayBuffer());
  }

  // Every key under the prefix (one page of up to 1000 is plenty: the
  // bucket keeps 30 nights of two files).
  async list(prefix: string): Promise<string[]> {
    const response = await this.send("GET", null, {
      "list-type": "2",
      prefix,
    });
    const xml = await response.text();
    return Array.from(xml.matchAll(/<Key>([^<]*)<\/Key>/g), (m) =>
      m[1]
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&"),
    );
  }
}
