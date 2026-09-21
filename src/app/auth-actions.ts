"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, deleteSession, isAuthConfigured, verifyCredentials } from "@/lib/auth";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; startedAt: number }>();

async function getClientKey() {
  const requestHeaders = await headers();
  return requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? requestHeaders.get("x-real-ip")
    ?? "local";
}

export async function login(formData: FormData) {
  if (!isAuthConfigured()) redirect("/login?error=configuration");

  const clientKey = await getClientKey();
  const now = Date.now();
  const previous = attempts.get(clientKey);
  const current = previous && now - previous.startedAt < WINDOW_MS ? previous : { count: 0, startedAt: now };
  if (current.count >= MAX_ATTEMPTS) redirect("/login?error=rate-limit");

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!verifyCredentials(username, password)) {
    attempts.set(clientKey, { ...current, count: current.count + 1 });
    redirect("/login?error=invalid");
  }

  attempts.delete(clientKey);
  await createSession(username);
  redirect("/");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}