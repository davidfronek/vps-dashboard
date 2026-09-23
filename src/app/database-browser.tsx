"use client";

import { ChevronLeft, ChevronRight, Columns3, Database, LoaderCircle, Pencil, Plus, RefreshCw, Rows3, TableProperties, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useEffectEvent, useState } from "react";

type ColumnInfo = { name: string; type: string; nullable: boolean; primaryKey: boolean; editable: boolean };
type TableInfo = { name: string; estimatedRows: number; size: string; columns: ColumnInfo[] };
type RowValue = Record<string, unknown> & { __rowId: string };

const columnTypes = [
  ["bigserial", "Automatické ID"], ["text", "Text"], ["varchar", "Krátký text"], ["integer", "Celé číslo"],
  ["bigint", "Velké celé číslo"], ["boolean", "Ano / ne"], ["date", "Datum"], ["timestamptz", "Datum a čas"],
  ["jsonb", "JSON"], ["uuid", "UUID"],
];

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers });
  const body = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "Databázová operace selhala.");
  return body;
}

function displayValue(value: unknown) {
  if (value === null) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function formValue(column: ColumnInfo, value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  const numeric = /^(?:smallint|integer|bigint|decimal|numeric|real|double precision)(?:\(|$)/.test(column.type);
  return numeric && /^[+-]?\d+,\d+(?:[eE][+-]?\d+)?$/.test(text) ? text.replace(",", ".") : text;
}

export default function DatabaseBrowser({ database, onClose }: { database: string; onClose: () => void }) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [rows, setRows] = useState<RowValue[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"table" | "column" | "row" | null>(null);
  const [editingRow, setEditingRow] = useState<RowValue | null>(null);
  const table = tables.find((item) => item.name === selectedTable);

  async function loadTables(preferredTable?: string) {
    setLoading(true);
    setError("");
    try {
      const result = await request<{ tables: TableInfo[] }>(`/api/database-editor?database=${encodeURIComponent(database)}`);
      setTables(result.tables);
      const nextTable = preferredTable && result.tables.some((item) => item.name === preferredTable)
        ? preferredTable
        : selectedTable && result.tables.some((item) => item.name === selectedTable) ? selectedTable : result.tables[0]?.name ?? "";
      setSelectedTable(nextTable);
      if (!nextTable) {
        setRows([]);
        setTotal(0);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Databázi se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRows(tableName = selectedTable, nextOffset = offset) {
    if (!tableName) return;
    setLoading(true);
    setError("");
    try {
      const result = await request<{ rows: RowValue[]; total: number }>(`/api/database-editor?database=${encodeURIComponent(database)}&table=${encodeURIComponent(tableName)}&offset=${nextOffset}`);
      setRows(result.rows);
      setTotal(result.total);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Záznamy se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }

  const loadInitialTables = useEffectEvent(() => loadTables());
  const loadSelectedRows = useEffectEvent((tableName: string, nextOffset: number) => loadRows(tableName, nextOffset));

  useEffect(() => { void Promise.resolve().then(() => loadInitialTables()); }, [database]);
  useEffect(() => { if (selectedTable) void Promise.resolve().then(() => loadSelectedRows(selectedTable, offset)); }, [selectedTable, offset]);

  async function mutate(label: string, method: string, body: Record<string, unknown>, after: () => Promise<void>) {
    setOperation(label);
    setError("");
    try {
      await request<{ ok: true }>("/api/database-editor", { method, body: JSON.stringify({ database, ...body }) });
      await after();
      setDialog(null);
      setEditingRow(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Operace selhala.");
    } finally {
      setOperation("");
    }
  }

  function selectTable(name: string) {
    setOffset(0);
    setSelectedTable(name);
  }

  function createTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("table") ?? "");
    const column = String(data.get("column") ?? "");
    const type = String(data.get("type") ?? "text");
    void mutate("Vytvářím tabulku", "POST", { operation: "create-table", table: name, columns: [{ name: column, type, nullable: false, primaryKey: type === "bigserial" }] }, async () => { setOffset(0); await loadTables(name); });
  }

  function addColumn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void mutate("Přidávám sloupec", "POST", { operation: "add-column", table: selectedTable, column: { name: String(data.get("name") ?? ""), type: String(data.get("type") ?? "text"), nullable: data.get("nullable") === "on" } }, async () => { await loadTables(selectedTable); });
  }

  function saveRow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!table) return;
    const data = new FormData(event.currentTarget);
    const values = Object.fromEntries(table.columns.filter((column) => column.editable).map((column) => [column.name, data.get(column.name) === "__NULL__" ? null : formValue(column, data.get(column.name))]));
    const method = editingRow ? "PATCH" : "POST";
    const body = { operation: editingRow ? "update-row" : "insert-row", table: selectedTable, rowId: editingRow?.__rowId, values };
    void mutate(editingRow ? "Ukládám změny záznamu" : "Vkládám nový záznam", method, body, async () => { await loadRows(); });
  }

  function deleteTable() {
    if (!window.confirm(`Trvale odstranit tabulku ${selectedTable} včetně všech dat?`)) return;
    void mutate("Odstraňuji tabulku", "DELETE", { operation: "drop-table", table: selectedTable }, async () => { setSelectedTable(""); await loadTables(); });
  }

  function deleteRow(row: RowValue) {
    if (!window.confirm("Trvale odstranit tento záznam?")) return;
    void mutate("Odstraňuji záznam", "DELETE", { operation: "delete-row", table: selectedTable, rowId: row.__rowId }, async () => { await loadRows(); });
  }

  return <div className="database-browser-backdrop"><section className="database-browser" role="dialog" aria-modal="true" aria-label={`Správa databáze ${database}`}>
    <header className="database-browser-header"><div><Database size={20} /><span><small>PostgreSQL databáze</small><strong>{database}</strong></span></div><div>{operation && <span className="database-operation"><LoaderCircle className="spin" size={15} /> {operation}</span>}<button className="icon-button" onClick={onClose} aria-label="Zavřít správu databáze"><X size={19} /></button></div></header>
    <div className="database-browser-body">
      <aside className="database-object-nav"><div className="database-object-title"><span>Tabulky</span><button onClick={() => setDialog("table")} title="Vytvořit tabulku" aria-label="Vytvořit tabulku"><Plus size={16} /></button></div>{tables.map((item) => <button key={item.name} className={selectedTable === item.name ? "active" : ""} onClick={() => selectTable(item.name)}><TableProperties size={16} /><span><strong>{item.name}</strong><small>{item.estimatedRows} řádků · {item.size}</small></span></button>)}{!loading && tables.length === 0 && <p>Zatím žádné tabulky.</p>}</aside>
      <main className="database-workspace">
        <div className="database-workspace-toolbar"><div>{table ? <><h2>{table.name}</h2><span>{table.columns.length} sloupců · {total} záznamů</span></> : <><h2>Prázdná databáze</h2><span>Vytvořte první tabulku.</span></>}</div><div>{table && <><button className="secondary-button" onClick={() => setDialog("column")}><Columns3 size={16} /> Přidat sloupec</button><button className="secondary-button" onClick={() => { setEditingRow(null); setDialog("row"); }}><Plus size={16} /> Nový záznam</button><button className="row-action danger" onClick={deleteTable} title="Odstranit tabulku" aria-label="Odstranit tabulku"><Trash2 size={16} /></button></>}<button className="row-action" onClick={() => { void loadTables(selectedTable); void loadRows(); }} title="Obnovit"><RefreshCw size={16} /></button></div></div>
        {error && <div className="database-error">{error}</div>}
        {table && <div className="database-schema-strip">{table.columns.map((column) => <span key={column.name}><strong>{column.name}</strong><small>{column.type}{column.primaryKey ? " · PK" : column.nullable ? " · NULL" : ""}</small></span>)}</div>}
        <div className="database-records-wrap">{loading && <div className="database-loading"><LoaderCircle className="spin" size={22} /> Načítám data...</div>}{!loading && table && <table className="database-records"><thead><tr>{table.columns.map((column) => <th key={column.name}>{column.name}</th>)}<th><span className="sr-only">Akce</span></th></tr></thead><tbody>{rows.map((row) => <tr key={row.__rowId}>{table.columns.map((column) => <td key={column.name} className={row[column.name] === null ? "null-value" : ""}>{displayValue(row[column.name])}</td>)}<td><span className="row-actions"><button className="row-action" onClick={() => { setEditingRow(row); setDialog("row"); }} title="Upravit záznam"><Pencil size={14} /></button><button className="row-action danger" onClick={() => deleteRow(row)} title="Odstranit záznam"><Trash2 size={14} /></button></span></td></tr>)}{rows.length === 0 && <tr><td colSpan={table.columns.length + 1} className="database-empty"><Rows3 size={20} /> Tabulka zatím neobsahuje žádné záznamy.</td></tr>}</tbody></table>}</div>
        {table && <footer className="database-pagination"><span>{total === 0 ? "0" : `${offset + 1}–${Math.min(offset + 50, total)}`} z {total}</span><div><button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 50))} aria-label="Předchozí stránka"><ChevronLeft size={16} /></button><button disabled={offset + 50 >= total || loading} onClick={() => setOffset(offset + 50)} aria-label="Další stránka"><ChevronRight size={16} /></button></div></footer>}
      </main>
    </div>
    {dialog === "table" && <EditorDialog title="Nová tabulka" onClose={() => setDialog(null)}><form onSubmit={createTable}><label>Název tabulky<input name="table" pattern="[a-z][a-z0-9_]{0,62}" required autoFocus /></label><label>První sloupec<input name="column" defaultValue="id" pattern="[a-z][a-z0-9_]{0,62}" required /></label><label>Datový typ<select name="type" defaultValue="bigserial">{columnTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="primary-button" disabled={Boolean(operation)}>Vytvořit tabulku</button></form></EditorDialog>}
    {dialog === "column" && <EditorDialog title={`Přidat sloupec do ${selectedTable}`} onClose={() => setDialog(null)}><form onSubmit={addColumn}><label>Název sloupce<input name="name" pattern="[a-z][a-z0-9_]{0,62}" required autoFocus /></label><label>Datový typ<select name="type">{columnTypes.filter(([value]) => value !== "bigserial").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="database-checkbox"><input name="nullable" type="checkbox" defaultChecked /> Povolit hodnotu NULL</label><button className="primary-button" disabled={Boolean(operation)}>Přidat sloupec</button></form></EditorDialog>}
    {dialog === "row" && table && <EditorDialog title={editingRow ? "Upravit záznam" : "Nový záznam"} onClose={() => { setDialog(null); setEditingRow(null); }}><form onSubmit={saveRow}>{table.columns.filter((column) => column.editable).map((column) => <label key={column.name}>{column.name}<small>{column.type}</small>{column.type === "boolean" ? <select name={column.name} defaultValue={displayValue(editingRow?.[column.name] ?? false)}><option value="true">true</option><option value="false">false</option>{column.nullable && <option value="__NULL__">NULL</option>}</select> : <input name={column.name} defaultValue={editingRow?.[column.name] === null ? "" : displayValue(editingRow?.[column.name] ?? "")} placeholder={column.nullable ? "Prázdné = NULL" : ""} required={!column.nullable && column.type !== "bigint"} />}</label>)}<button className="primary-button" disabled={Boolean(operation)}>{editingRow ? "Uložit změny" : "Vložit záznam"}</button></form></EditorDialog>}
  </section></div>;
}

function EditorDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="database-editor-dialog-backdrop" onMouseDown={onClose}><section className="database-editor-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><h3>{title}</h3><button onClick={onClose} aria-label="Zavřít"><X size={17} /></button></header>{children}</section></div>;
}