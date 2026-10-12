import { Request } from "express";
import { CryptoKey, importJWK, jwtVerify } from "jose";
import { base64urlToUuid } from "../core/Base64";
import { ApiConfig, issuerFor } from "./Config";
import { SigningKey } from "./Keys";

// Under a Dark Star: who a request's Bearer token names
// (docs/DarkStar-Accounts.md §4.3). Verified the way the game server
// verifies it (jwt.ts): EdDSA, our key, issuer and audience pinned. Shared
// by /users/@me and the leaderboard's own-row lookup; a request without a
// usable token is simply anonymous, never an error.

export class BearerVerifier {
  private publicKey: Promise<CryptoKey | Uint8Array> | null = null;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    private readonly key: SigningKey,
    config: ApiConfig,
  ) {
    this.issuer = issuerFor(config);
    this.audience = config.domain;
  }

  // The account ID (the game's persistentID) behind the request's token, or
  // null when there is no valid one.
  async accountId(req: Request): Promise<string | null> {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      return null;
    }
    const token = header.slice("Bearer ".length).trim();
    if (token === "") return null;
    try {
      this.publicKey ??= importJWK(this.key.publicJwk, "EdDSA");
      const { payload } = await jwtVerify(token, await this.publicKey, {
        algorithms: ["EdDSA"],
        issuer: this.issuer,
        audience: this.audience,
      });
      if (typeof payload.sub !== "string") return null;
      return base64urlToUuid(payload.sub) || null;
    } catch {
      return null;
    }
  }
}
