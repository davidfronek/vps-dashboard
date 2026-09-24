import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TodoItem } from "@/lib/todo-types";

const TODO_FILE = process.env.NODE_ENV === "production"
  ? "/var/lib/vps-dashboard/todos/admin.json"
  : ".data/admin-todos.json";

let writeQueue = Promise.resolve();

function isTodo(value: unknown): value is TodoItem {
  if (!value || typeof value !== "object") return false;
  const todo = value as Partial<TodoItem>;
  return typeof todo.id === "string"
    && typeof todo.title === "string"
    && typeof todo.description === "string"
    && ["low", "medium", "high"].includes(todo.priority ?? "")
    && typeof todo.completed === "boolean"
    && typeof todo.createdAt === "string"
    && typeof todo.updatedAt === "string";
}

export async function readTodos() {
  try {
    const value: unknown = JSON.parse(await readFile(TODO_FILE, "utf8"));
    return Array.isArray(value) ? value.filter(isTodo) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function updateTodos(change: (todos: TodoItem[]) => TodoItem[]) {
  const operation = writeQueue.then(async () => {
    const current = await readTodos();
    const todos = change(current);
    if (todos === current) return todos;
    await mkdir(dirname(TODO_FILE), { recursive: true });
    const temporaryFile = `${TODO_FILE}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryFile, `${JSON.stringify(todos, null, 2)}\n`, { encoding: "utf8", mode: 0o640 });
    await rename(temporaryFile, TODO_FILE);
    return todos;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
