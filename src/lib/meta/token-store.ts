import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const KEY_ID = "meta-token-v1";
const FORMAT_VERSION = "v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedMetaToken {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyId: string;
  formatVersion: string;
}

/** Convert the base64 representation used by application code to Postgres bytea text. */
export function toPostgresBytea(value: string): string {
  return `\\x${Buffer.from(value, "base64").toString("hex")}`;
}

/** Convert Postgres bytea text back to the base64 representation used by decryptMetaToken. */
export function fromPostgresBytea(value: string): string {
  if (!value.startsWith("\\x")) return value;
  return Buffer.from(value.slice(2), "hex").toString("base64");
}

function encryptionKey(): Buffer {
  const encoded = getEnv().META_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Meta token encryption is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("Meta token encryption key must decode to 32 bytes.");
  }
  return key;
}

function additionalData(tokenId: string, businessId: string): Buffer {
  return Buffer.from(`${FORMAT_VERSION}:${tokenId}:${businessId}`, "utf8");
}

export function encryptMetaToken(
  plaintext: string,
  context: { tokenId: string; businessId: string },
): EncryptedMetaToken {
  if (!plaintext) throw new Error("Meta token cannot be empty.");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), nonce);
  cipher.setAAD(additionalData(context.tokenId, context.businessId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  if (authTag.length !== TAG_BYTES) throw new Error("Unexpected token auth tag length.");
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: authTag.toString("base64"),
    keyId: KEY_ID,
    formatVersion: FORMAT_VERSION,
  };
}

export function decryptMetaToken(
  encrypted: EncryptedMetaToken,
  context: { tokenId: string; businessId: string },
): string {
  if (encrypted.keyId !== KEY_ID || encrypted.formatVersion !== FORMAT_VERSION) {
    throw new Error("Unsupported Meta token encryption format.");
  }
  const nonce = Buffer.from(encrypted.nonce, "base64");
  const authTag = Buffer.from(encrypted.authTag, "base64");
  if (nonce.length !== NONCE_BYTES || authTag.length !== TAG_BYTES) {
    throw new Error("Invalid Meta token encryption metadata.");
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), nonce);
  decipher.setAAD(additionalData(context.tokenId, context.businessId));
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}