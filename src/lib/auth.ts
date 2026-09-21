import "server-only";

import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "vps_admin_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;

type SessionPayload = {
  username: string;
  expiresAt: number;
};

function getAuthConfig() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const secret = process.env.AUTH_SECRET;

  if (!username || !passwordHash?.startsWith("scrypt:") || !secret || secret.length < 32) return null;
  return { username, passwordHash, secret };
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftDigest = createHmac("sha256", "credential-comparison").update(left).digest();
  const rightDigest = createHmac("sha256", "credential-comparison").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function readSession(token: string | undefined, secret: string): SessionPayload | null {
  if (!token) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature || !safeEqual(signature, sign(encodedPayload, secret))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.username || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isAuthConfigured() {
  return getAuthConfig() !== null;
}

export function verifyCredentials(username: string, password: string) {
  const config = getAuthConfig();
  if (!config) return false;

  const [, saltHex, hashHex] = config.passwordHash.split(":");
  if (!saltHex || !hashHex) return false;

  try {
    const expectedHash = Buffer.from(hashHex, "hex");
    const suppliedHash = scryptSync(password, Buffer.from(saltHex, "hex"), expectedHash.length);
    return safeEqual(username, config.username) && timingSafeEqual(suppliedHash, expectedHash);
  } catch {
    return false;
  }
}

export async function createSession(username: string) {
  const config = getAuthConfig();
  if (!config) throw new Error("Authentication is not configured");

  const payload: SessionPayload = { username, expiresAt: Date.now() + SESSION_DURATION_SECONDS * 1000 };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${encodedPayload}.${sign(encodedPayload, config.secret)}`;

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_DURATION_SECONDS,
    path: "/",
    priority: "high",
  });
}

export async function getSession() {
  const config = getAuthConfig();
  if (!config) return null;
  return readSession((await cookies()).get(SESSION_COOKIE)?.value, config.secret);
}

export async function deleteSession() {
  (await cookies()).delete(SESSION_COOKIE);
}