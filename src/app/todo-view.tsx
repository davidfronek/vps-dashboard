"use client";

import { Check, CheckSquare2, Circle, ClipboardList, Pencil, Plus, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { TodoItem, TodoPriority } from "@/lib/todo-types";

const priorityLabels: Record<TodoPriority, string> = { high: "Vysoká", medium: "Střední", low: "Nízká" };

type TodoDraft = { title: string; description: string; priority: TodoPriority };
const emptyDraft: TodoDraft = { title: "", description: "", priority: "medium" };

export default function TodoView({ notify }: { notify: (message: string) => void }) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<TodoItem | null | undefined>(undefined);
  const [draft, setDraft] = useState<TodoDraft>(emptyDraft);

  async function loadTodos() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/todos", { cache: "no-store" });
      const result = await response.json().catch(() => null) as { todos?: TodoItem[]; message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? "Úkoly se nepodařilo načíst.");
      setTodos(result?.todos ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Spojení se serverem selhalo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/todos", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as { todos?: TodoItem[]; message?: string } | null;
        if (!response.ok) throw new Error(result?.message ?? "Úkoly se nepodařilo načíst.");
        if (active) setTodos(result?.todos ?? []);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Spojení se serverem selhalo.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function mutate(method: "POST" | "PATCH" | "DELETE", body: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/todos", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? "Změnu se nepodařilo uložit.");
      await loadTodos();
      return true;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Spojení se serverem selhalo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setDraft(emptyDraft);
    setEditing(null);
  }

  function openEdit(todo: TodoItem) {
    setDraft({ title: todo.title, description: todo.description, priority: todo.priority });
    setEditing(todo);
  }

  async function saveTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const succeeded = editing
      ? await mutate("PATCH", { ...editing, ...draft })
      : await mutate("POST", draft);
    if (succeeded) {
      notify(editing ? "Úkol byl upraven" : "Úkol byl vytvořen");
      setEditing(undefined);
    }
  }

  async function toggleTodo(todo: TodoItem) {
    if (await mutate("PATCH", { ...todo, completed: !todo.completed })) notify(todo.completed ? "Úkol byl znovu otevřen" : "Úkol byl dokončen");
  }

  async function deleteTodo(todo: TodoItem) {
    if (await mutate("DELETE", { id: todo.id })) notify("Úkol byl odstraněn");
  }

  const openTodos = todos.filter((todo) => !todo.completed).sort((left, right) => ({ high: 0, medium: 1, low: 2 })[left.priority] - ({ high: 0, medium: 1, low: 2 })[right.priority]);
  const completedTodos = todos.filter((todo) => todo.completed).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  function todoRow(todo: TodoItem) {
    return <li className={todo.completed ? "todo-item completed" : "todo-item"} key={todo.id}>
      <button type="button" className="todo-check" disabled={busy} onClick={() => toggleTodo(todo)} aria-label={todo.completed ? `Znovu otevřít ${todo.title}` : `Dokončit ${todo.title}`}>{todo.completed ? <CheckSquare2 size={19} /> : <Circle size={19} />}</button>
      <div className="todo-copy"><div><strong>{todo.title}</strong><span className={`todo-priority ${todo.priority}`}>{priorityLabels[todo.priority]}</span></div>{todo.description && <p>{todo.description}</p>}<small>Upraveno {new Date(todo.updatedAt).toLocaleString("cs-CZ")}</small></div>
      <div className="todo-actions"><button type="button" disabled={busy} onClick={() => openEdit(todo)} aria-label={`Upravit ${todo.title}`} title="Upravit"><Pencil size={15} /></button><button type="button" className="delete" disabled={busy} onClick={() => deleteTodo(todo)} aria-label={`Odstranit ${todo.title}`} title="Odstranit"><Trash2 size={15} /></button></div>
    </li>;
  }

  return <>
    <section className="page-heading todo-heading"><div><div className="eyebrow neutral"><ClipboardList size={13} /> Osobní agenda administrátora</div><h1>Úkoly</h1><p>Plánujte práci na serveru a udržujte dokončené položky po ruce.</p></div><div className="heading-actions"><button className="primary-button" onClick={openCreate}><Plus size={17} /> Nový úkol</button></div></section>
    <section className="todo-summary" aria-label="Souhrn úkolů"><div><strong>{openTodos.length}</strong><span>Otevřených</span></div><div><strong>{openTodos.filter((todo) => todo.priority === "high").length}</strong><span>Vysoká priorita</span></div><div><strong>{completedTodos.length}</strong><span>Dokončených</span></div></section>
    {error && <div className="todo-error" role="alert">{error}</div>}
    <div className="todo-columns">
      <section className="panel todo-panel"><div className="panel-header"><div><h2>Nové úkoly</h2><p>Seřazeno podle priority</p></div><span className="todo-count">{openTodos.length}</span></div>{loading ? <div className="todo-empty">Načítám úkoly…</div> : openTodos.length ? <ul className="todo-list">{openTodos.map(todoRow)}</ul> : <div className="todo-empty"><Check size={20} /><span>Žádné otevřené úkoly</span></div>}</section>
      <section className="panel todo-panel completed-panel"><div className="panel-header"><div><h2>Hotové úkoly</h2><p>Dokončenou práci lze znovu otevřít</p></div><span className="todo-count">{completedTodos.length}</span></div>{loading ? <div className="todo-empty">Načítám úkoly…</div> : completedTodos.length ? <ul className="todo-list">{completedTodos.map(todoRow)}</ul> : <div className="todo-empty"><ClipboardList size={20} /><span>Zatím nic dokončeného</span></div>}</section>
    </div>
    {editing !== undefined && <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditing(undefined)}><div className="modal todo-modal" role="dialog" aria-modal="true" aria-labelledby="todo-modal-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><ClipboardList size={21} /></div><button className="modal-close" onClick={() => setEditing(undefined)} aria-label="Zavřít"><X size={19} /></button><h2 id="todo-modal-title">{editing ? "Upravit úkol" : "Nový úkol"}</h2><p>{editing ? "Změňte zadání nebo prioritu úkolu." : "Přidejte další položku do své pracovní agendy."}</p><form className="todo-form" onSubmit={saveTodo}><label htmlFor="todo-title">Název</label><input id="todo-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} maxLength={200} autoFocus required /><label htmlFor="todo-description">Poznámka</label><textarea id="todo-description" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} maxLength={2000} rows={4} /><label htmlFor="todo-priority">Priorita</label><select id="todo-priority" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as TodoPriority }))}><option value="high">Vysoká</option><option value="medium">Střední</option><option value="low">Nízká</option></select><div className="modal-actions"><button type="button" onClick={() => setEditing(undefined)}>Zrušit</button><button type="submit" className="primary-button" disabled={busy}><Check size={16} /> {editing ? "Uložit změny" : "Vytvořit úkol"}</button></div></form></div></div>}
  </>;
}
