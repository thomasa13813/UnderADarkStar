import { randomUUID } from "crypto";
import fs from "fs";
import { exportJWK, generateKeyPair, importJWK, JWK, SignJWT } from "jose";
import path from "path";

// Under a Dark Star: the account API's token signing key
// (docs/DarkStar-Accounts.md §4.3). An Ed25519 pair, generated once and kept
// beside the database; the public half is served as the JWKS the game server
// fetches (ServerEnv.jwkPublicKey) and checked against with EdDSA (jwt.ts).
// Losing the file invalidates every token in flight and every refresh
// cookie, so it is in the nightly backup with the database (§10).

export const SIGNING_KEY_FILE = "signing-key.json";

export interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  // The public key as served: kty OKP, crv Ed25519, alg EdDSA, x.
  publicJwk: JWK;
}

interface StoredKey {
  kid: string;
  // The private JWK (kty, crv, x, d).
  jwk: JWK;
}

export async function loadOrCreateSigningKey(
  dataDir: string,
): Promise<SigningKey> {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, SIGNING_KEY_FILE);
  let stored: StoredKey;
  if (fs.existsSync(file)) {
    stored = JSON.parse(fs.readFileSync(file, "utf8")) as StoredKey;
  } else {
    const { privateKey } = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    stored = { kid: randomUUID(), jwk: await exportJWK(privateKey) };
    fs.writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
  }
  const privateKey = await importJWK(stored.jwk, "EdDSA");
  if (privateKey instanceof Uint8Array) {
    // importJWK hands back raw bytes only for symmetric (oct) keys.
    throw new Error(`${file} does not hold an asymmetric key`);
  }
  const publicPart: JWK = { ...stored.jwk };
  delete publicPart.d;
  return {
    kid: stored.kid,
    privateKey,
    publicJwk: {
      ...publicPart,
      kty: "OKP",
      crv: "Ed25519",
      alg: "EdDSA",
      use: "sig",
      kid: stored.kid,
    },
  };
}

// The /.well-known/jwks.json document: one key, in the shape the game
// server's JwksSchema requires (ServerEnv.jwkPublicKey).
export function jwksDocument(key: SigningKey): { keys: JWK[] } {
  return { keys: [key.publicJwk] };
}

export interface TokenClaims {
  // The account's id, base64url-encoded as TokenPayloadSchema expects.
  sub: string;
  role?: string;
  provider?: string;
}

// Signs the short-lived access token the game server and the client accept
// (TokenPayloadSchema): EdDSA, issuer, audience, jti, iat, exp.
export async function signToken(
  key: SigningKey,
  claims: TokenClaims,
  opts: { issuer: string; audience: string; ttlSeconds: number },
): Promise<string> {
  const jwt = new SignJWT({ role: claims.role, provider: claims.provider })
    .setProtectedHeader({ alg: "EdDSA", kid: key.kid })
    .setSubject(claims.sub)
    .setJti(randomUUID())
    .setIssuedAt()
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
    .setExpirationTime(`${opts.ttlSeconds}s`);
  return jwt.sign(key.privateKey);
}
