"use client";

import { ChevronDown, ChevronRight, LoaderCircle, RefreshCw, TableProperties } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import type { RowValue, TableInfo } from "@/lib/database-types";

function displayValue(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

function StoredRows({ database, table }: { database: string; table: TableInfo }) {
  const [rows, setRows] = useState<RowValue[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ database, table: table.name, offset: "0" });
      const response = await fetch(`/api/database-editor?${query}`, { cache: "no-store" });
      const body = await response.json() as { rows?: RowValue[]; total?: number; message?: string };
      if (!response.ok) throw new Error(body.message ?? "Uložená data se nepodařilo načíst.");
      setRows(body.rows ?? []);
      setTotal(body.total ?? 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Uložená data se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }

  const loadInitialRows = useEffectEvent(loadRows);
  useEffect(() => { void Promise.resolve().then(() => loadInitialRows()); }, [database, table.name]);

  if (loading) return <div className="database-rows-state"><LoaderCircle className="spin" size={13} /> Načítám uložená data...</div>;
  if (error) return <div className="database-rows-state error"><span>{error}</span><button type="button" onClick={() => void loadRows()} aria-label={`Znovu načíst data tabulky ${table.name}`}><RefreshCw size={13} /></button></div>;
  if (rows.length === 0) return <div className="database-rows-state">Tabulka neobsahuje žádná uložená data.</div>;

  return <div className="database-rows">
    <div className="database-rows-heading"><span>Uložená data · {total} {total === 1 ? "záznam" : total < 5 ? "záznamy" : "záznamů"}</span><span>Zobrazeno prvních {rows.length}</span></div>
    <div className="database-rows-scroll"><table><thead><tr>{table.columns.map((column) => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.__rowId}>{table.columns.map((column) => <td key={column.name}>{displayValue(row[column.name])}</td>)}</tr>)}</tbody></table></div>
  </div>;
}

export default function DatabaseStructure({ database }: { database: string }) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [expandedTable, setExpandedTable] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadStructure() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/database-editor?database=${encodeURIComponent(database)}`, { cache: "no-store" });
      const body = await response.json() as { tables?: TableInfo[]; message?: string };
      if (!response.ok) throw new Error(body.message ?? "Strukturu databáze se nepodařilo načíst.");
      setTables(body.tables ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Strukturu databáze se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }

  const loadInitialStructure = useEffectEvent(loadStructure);
  useEffect(() => { void Promise.resolve().then(() => loadInitialStructure()); }, [database]);

  if (loading) return <div className="database-structure-state"><LoaderCircle className="spin" size={14} /> Načítám strukturu...</div>;
  if (error) return <div className="database-structure-state error"><span>{error}</span><button type="button" onClick={() => void loadStructure()} aria-label={`Znovu načíst strukturu databáze ${database}`}><RefreshCw size={13} /></button></div>;
  if (tables.length === 0) return <div className="database-structure-state">Databáze neobsahuje žádné tabulky.</div>;

  return <div className="database-structure">
    <div className="database-structure-heading"><span>{tables.length} {tables.length === 1 ? "tabulka" : tables.length < 5 ? "tabulky" : "tabulek"}</span><button type="button" onClick={() => void loadStructure()} aria-label={`Obnovit strukturu databáze ${database}`} title="Obnovit strukturu"><RefreshCw size={13} /></button></div>
    {tables.map((table) => {
      const expanded = expandedTable === table.name;
      return <div className="database-structure-table" key={table.name}>
        <button type="button" className="database-structure-toggle" onClick={() => setExpandedTable(expanded ? "" : table.name)} aria-expanded={expanded}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <TableProperties size={14} />
          <strong>{table.name}</strong>
          <span>{table.columns.length} sloupců · {table.rowCount.toLocaleString("cs-CZ")} řádků · {table.size}</span>
        </button>
        {expanded && <><div className="database-column-list">{table.columns.map((column) => <div key={column.name}><strong>{column.name}</strong><code>{column.type}</code><span>{column.primaryKey ? "PK" : column.nullable ? "NULL" : "NOT NULL"}</span></div>)}</div><StoredRows database={database} table={table} /></>}
      </div>;
    })}
  </div>;
}
