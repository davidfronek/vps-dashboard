"use client";

import { Database, HardDrive, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { AdminJobRequest } from "@/lib/admin-job-types";
import type { PostgreSqlDatabase } from "@/lib/server-data";

type JobRunner = (title: string, request: AdminJobRequest) => Promise<boolean>;

export default function DatabaseView({ databases, onRefresh, runJob }: { databases: PostgreSqlDatabase[]; onRefresh: () => void; runJob: JobRunner }) {
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteDatabase, setDeleteDatabase] = useState<PostgreSqlDatabase | null>(null);
  const filteredDatabases = databases.filter((database) => `${database.name} ${database.owner}`.toLowerCase().includes(query.toLowerCase()));

  async function createDatabase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const owner = String(data.get("owner") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (await runJob(`Vytvoření PostgreSQL databáze ${name}`, { operation: "database-create", arguments: [name, owner, password] })) setCreateOpen(false);
  }

  async function confirmDelete() {
    if (!deleteDatabase) return;
    if (await runJob(`Odstranění PostgreSQL databáze ${deleteDatabase.name}`, { operation: "database-delete", arguments: [deleteDatabase.name] })) setDeleteDatabase(null);
  }

  return <>
    <section className="page-heading database-heading"><div><div className="eyebrow neutral"><Database size={13} /> Databázový server</div><h1>PostgreSQL databáze</h1><p>Databáze v hlavním PostgreSQL clusteru připravené pro aplikace.</p></div><div className="heading-actions"><button className="secondary-button" onClick={onRefresh}><RefreshCw size={17} /> Obnovit</button><button className="primary-button" onClick={() => setCreateOpen(true)}><Plus size={17} /> Nová databáze</button></div></section>
    <section className="database-stats" aria-label="Přehled databází"><article className="panel"><span className="database-stat-icon"><Database size={18} /></span><div><small>Databáze</small><strong>{databases.length}</strong><span>v hlavním clusteru</span></div></article><article className="panel"><span className="database-stat-icon"><ShieldCheck size={18} /></span><div><small>Spravované</small><strong>{databases.filter((database) => database.managed).length}</strong><span>vytvořené dashboardem</span></div></article><article className="panel"><span className="database-stat-icon"><HardDrive size={18} /></span><div><small>Úložiště</small><strong>{databases[0]?.size ?? "0 B"}</strong><span>velikost první databáze</span></div></article><article className="panel"><span className="database-stat-icon"><UserRound size={18} /></span><div><small>Připojení</small><strong>{databases.reduce((sum, database) => sum + database.connections, 0)}</strong><span>aktivní relace</span></div></article></section>
    <section className="panel database-panel"><div className="panel-header management-header"><div><h2>Databáze</h2><p>Systémové databáze jsou chráněné proti odstranění</p></div></div><div className="domain-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat databázi..." aria-label="Hledat databázi" /></div></div><div className="domain-table-wrap"><table className="domain-table database-table"><thead><tr><th>Databáze</th><th>Vlastník</th><th>Velikost</th><th>Připojení</th><th>Správa</th><th><span className="sr-only">Akce</span></th></tr></thead><tbody>{filteredDatabases.map((database) => <tr key={database.name}><td><span className="database-engine">P</span><span className="database-name"><strong>{database.name}</strong><small>{database.managed ? "spravovaná dashboardem" : "chráněná databáze"}</small></span></td><td>{database.owner}</td><td className="mono">{database.size}</td><td className="mono">{database.connections}</td><td><span className={database.managed ? "table-status success" : "table-status pending"}><i /> {database.managed ? "Spravovaná" : "Chráněná"}</span></td><td><span className="row-actions"><button className="row-action danger" disabled={!database.managed} onClick={() => setDeleteDatabase(database)} title="Odstranit" aria-label={`Odstranit databázi ${database.name}`}><Trash2 size={15} /></button></span></td></tr>)}</tbody></table></div></section>
    {createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="database-create-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><Database size={21} /></div><button className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Zavřít"><X size={19} /></button><h2 id="database-create-title">Nová PostgreSQL databáze</h2><p>Vytvoří databázi a samostatného uživatele v hlavním clusteru.</p><form className="database-form" onSubmit={createDatabase}><label htmlFor="database-name">Název databáze</label><input id="database-name" name="name" pattern="[a-z][a-z0-9_]{0,62}" required /><label htmlFor="database-owner">Databázový uživatel</label><input id="database-owner" name="owner" pattern="[a-z][a-z0-9_]{0,62}" required /><label htmlFor="database-password">Heslo</label><input id="database-password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /><div className="modal-actions"><button type="button" onClick={() => setCreateOpen(false)}>Zrušit</button><button className="primary-button" type="submit">Vytvořit databázi</button></div></form></div></div>}
    {deleteDatabase && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeleteDatabase(null)}><div className="modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="database-delete-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon danger"><Trash2 size={21} /></div><button className="modal-close" onClick={() => setDeleteDatabase(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="database-delete-title">Odstranit PostgreSQL databázi?</h2><p>Databáze <strong>{deleteDatabase.name}</strong> včetně všech dat bude trvale odstraněna.</p><div className="modal-actions"><button onClick={() => setDeleteDatabase(null)}>Zrušit</button><button className="danger-button" onClick={confirmDelete}>Trvale odstranit</button></div></div></div>}
  </>;
}