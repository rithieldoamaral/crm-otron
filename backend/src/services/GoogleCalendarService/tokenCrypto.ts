/**
 * tokenCrypto — encriptação AES-256-CBC para tokens OAuth2.
 *
 * Why: access/refresh tokens do Google são credenciais equivalentes a senha.
 * Se vazarem do DB (backup, dump, read-replica comprometida), um atacante
 * acessa o Google Calendar dos usuários. Encriptamos at-rest com AES-256-CBC.
 *
 * Design:
 * - Salt aleatório por token: scrypt(CALENDAR_TOKEN_SECRET, salt) → derived key.
 *   Impede ataques de pré-computação (rainbow tables) sobre a secret.
 * - IV aleatório por encrypt: obrigatório para AES-CBC — reutilizar IV vaza
 *   informação sobre o plaintext.
 * - Formato serializado: `salt:iv:ciphertext` (todos em hex).
 *
 * How to apply: encryptToken(plaintext) antes de salvar no DB,
 * decryptToken(ciphertext) antes de usar.
 */

import * as crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 16;

function getSecret(): string {
  const secret = process.env.CALENDAR_TOKEN_SECRET;
  if (!secret) {
    // Falha explícita — nunca queremos derivar chave de string vazia
    throw new Error("CALENDAR_TOKEN_SECRET env var is required for token encryption");
  }
  return secret;
}

function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(getSecret(), salt, KEY_LENGTH);
}

export function encryptToken(plaintext: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${salt.toString("hex")}:${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid token ciphertext format (expected salt:iv:ciphertext)");
  }
  const [saltHex, ivHex, encHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const key = deriveKey(salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
