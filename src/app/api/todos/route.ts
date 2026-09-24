import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { readTodos, updateTodos } from "@/lib/todo-store";
import type { TodoPriority } from "@/lib/todo-types";

const PRIORITIES = new Set<TodoPriority>(["low", "medium", "high"]);

type TodoRequest = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  completed?: unknown;
};

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

async function authorize(request: NextRequest, mutation = false) {
  if (!await getSession()) return NextResponse.json({ message: "Relace vypršela." }, { status: 401 });
  if (mutation && !sameOrigin(request)) return NextResponse.json({ message: "Neplatný původ požadavku." }, { status: 403 });
  return null;
}

function validText(value: unknown, maximum: number, required = false): value is string {
  return typeof value === "string" && value.length <= maximum && (!required || value.trim().length > 0);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/.test(value);
}

export async function GET(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ todos: await readTodos() });
  } catch (error) {
    console.error("Failed to read todos", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Úkoly se nepodařilo načíst." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await authorize(request, true);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as TodoRequest | null;
  if (!body || !validText(body.title, 200, true) || !validText(body.description, 2000) || !PRIORITIES.has(body.priority as TodoPriority)) {
    return NextResponse.json({ message: "Neplatné údaje úkolu." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const todo = { id: randomUUID(), title: body.title.trim(), description: body.description.trim(), priority: body.priority as TodoPriority, completed: false, createdAt: now, updatedAt: now };
  try {
    await updateTodos((todos) => [todo, ...todos]);
    return NextResponse.json({ todo }, { status: 201 });
  } catch (error) {
    console.error("Failed to create todo", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Úkol se nepodařilo uložit." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await authorize(request, true);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as TodoRequest | null;
  if (!body || !validId(body.id) || !validText(body.title, 200, true) || !validText(body.description, 2000) || !PRIORITIES.has(body.priority as TodoPriority) || typeof body.completed !== "boolean") {
    return NextResponse.json({ message: "Neplatné údaje úkolu." }, { status: 400 });
  }
  const { id, completed } = body;
  const title = body.title.trim();
  const description = body.description.trim();
  const priority = body.priority as TodoPriority;
  let found = false;
  try {
    const todos = await updateTodos((current) => {
      const next = current.map((todo) => {
        if (todo.id !== id) return todo;
        found = true;
        return { ...todo, title, description, priority, completed, updatedAt: new Date().toISOString() };
      });
      return found ? next : current;
    });
    if (!found) return NextResponse.json({ message: "Úkol nebyl nalezen." }, { status: 404 });
    return NextResponse.json({ todo: todos.find((todo) => todo.id === id) });
  } catch (error) {
    console.error("Failed to update todo", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Úkol se nepodařilo upravit." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await authorize(request, true);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as TodoRequest | null;
  if (!body || !validId(body.id)) return NextResponse.json({ message: "Neplatný úkol." }, { status: 400 });
  let found = false;
  try {
    await updateTodos((todos) => {
      const next = todos.filter((todo) => {
        if (todo.id !== body.id) return true;
        found = true;
        return false;
      });
      return found ? next : todos;
    });
    if (!found) return NextResponse.json({ message: "Úkol nebyl nalezen." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete todo", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Úkol se nepodařilo odstranit." }, { status: 500 });
  }
}
