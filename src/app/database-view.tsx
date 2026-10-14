"use client";

import { Database, GitBranch, Globe2, HardDrive, Plus, RefreshCw, Search, ShieldCheck, TableProperties, Trash2, UserRound, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { AdminJobRequest } from "@/lib/admin-job-types";
import type { DomainStatus, PostgreSqlDatabase } from "@/lib/server-data";
import DatabaseBrowser from "./database-browser";

type JobRunner = (title: string, request: AdminJobRequest) => Promise<boolean>;
type Application = Omit<Pick<DomainStatus, "name" | "status" | "deployment" | "databaseNames" | "environmentKeys">, "status"> & {
  status: DomainStatus["status"] | "Ověřování";
};
const DATABASE_ENV_KEYS = ["DATABASE_URL", "PGDATABASE"];

function suggestDatabaseName(domain: string) {
  const base = domain.toLowerCase().split(".").slice(0, -1).join("_").replace(/[^a-z0-9_]/g, "_");
  return (/^[a-z]/.test(base) ? base : `db_${base}`).slice(0, 60);
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => alphabet[byte % alphabet.length]).join("");
}

async function changeEnvironment(method: "POST" | "DELETE", domain: string, key: string, value?: string) {
  const response = await fetch("/api/domain-environment", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, key, value }) });
  return response.ok;
}

export default function DatabaseView({ databases, applications, onRefresh, runJob, notify }: { databases: PostgreSqlDatabase[]; applications: Application[]; onRefresh: () => void; runJob: JobRunner; notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [attachApplication, setAttachApplication] = useState<Application | null>(null);
  const [attachPassword, setAttachPassword] = useState("");
  const [detach, setDetach] = useState<{ application: Application; database: PostgreSqlDatabase } | null>(null);
  const [deleteDatabase, setDeleteDatabase] = useState<PostgreSqlDatabase | null>(null);
  const [managedDatabase, setManagedDatabase] = useState("");
  const filteredDatabases = databases.filter((database) => `${database.name} ${database.owner}`.toLowerCase().includes(query.toLowerCase()));

  async function createDatabase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const owner = String(data.get("owner") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (await runJob(`Vytvoření PostgreSQL databáze ${name}`, { operation: "database-create", arguments: [name, owner, password] })) setCreateOpen(false);
  }

  async function attachDatabase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!attachApplication) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const owner = String(data.get("owner") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (!await runJob(`Vytvoření PostgreSQL databáze ${name}`, { operation: "database-create", arguments: [name, owner, password] })) return;
    const url = `postgresql://${encodeURIComponent(owner)}:${encodeURIComponent(password)}@127.0.0.1:5432/${encodeURIComponent(name)}`;
    const linked = await changeEnvironment("POST", attachApplication.name, "DATABASE_URL", url);
    notify(linked ? `Databáze ${name} je připojena k ${attachApplication.name}` : "Databáze byla vytvořena, ale proměnnou DATABASE_URL se nepodařilo uložit");
    setAttachApplication(null);
    onRefresh();
  }

  async function confirmDetach() {
    if (!detach) return;
    const { application, database } = detach;
    if (database.managed && !await runJob(`Odstranění PostgreSQL databáze ${database.name}`, { operation: "database-delete", arguments: [database.name] })) return;
    const results = await Promise.all(DATABASE_ENV_KEYS.filter((key) => application.environmentKeys.includes(key)).map((key) => changeEnvironment("DELETE", application.name, key)));
    if (results.includes(false)) notify("Databázi se nepodařilo zcela odpojit od aplikace");
    setDetach(null);
    onRefresh();
  }

  async function confirmDelete() {
    if (!deleteDatabase) return;
    if (await runJob(`Odstranění PostgreSQL databáze ${deleteDatabase.name}`, { operation: "database-delete", arguments: [deleteDatabase.name] })) setDeleteDatabase(null);
  }

  return <>
    <section className="page-heading database-heading"><div><div className="eyebrow neutral"><Database size={13} /> Databázový server</div><h1>PostgreSQL databáze</h1><p>Databáze v hlavním PostgreSQL clusteru připravené pro aplikace.</p></div><div className="heading-actions"><button className="secondary-button" onClick={onRefresh}><RefreshCw size={17} /> Obnovit</button><button className="primary-button" onClick={() => setCreateOpen(true)}><Plus size={17} /> Nová databáze</button></div></section>
    <section className="database-stats" aria-label="Přehled databází"><article className="panel"><span className="database-stat-icon"><Database size={18} /></span><div><small>Databáze</small><strong>{databases.length}</strong><span>v hlavním clusteru</span></div></article><article className="panel"><span className="database-stat-icon"><ShieldCheck size={18} /></span><div><small>Spravované</small><strong>{databases.filter((database) => database.managed).length}</strong><span>vytvořené dashboardem</span></div></article><article className="panel"><span className="database-stat-icon"><HardDrive size={18} /></span><div><small>Úložiště</small><strong>{databases[0]?.size ?? "0 B"}</strong><span>velikost první databáze</span></div></article><article className="panel"><span className="database-stat-icon"><UserRound size={18} /></span><div><small>Připojení</small><strong>{databases.reduce((sum, database) => sum + database.connections, 0)}</strong><span>aktivní relace</span></div></article></section>
    <section className="panel application-databases"><div className="panel-header"><div><h2>Aplikace a databáze</h2><p>Aktuální vazby z proměnných prostředí nasazených aplikací</p></div><span className="online-pill">{applications.length} aplikací</span></div><div className="application-database-list">{applications.map((application) => {
      const connectedDatabases = application.databaseNames.map((name) => databases.find((database) => database.name === name) ?? { name, owner: "Neznámý", size: "Nedostupná", connections: 0, records: 0, managed: false });
      return <article className="application-database-row" key={application.name}><header><span className="application-database-icon"><Globe2 size={17} /></span><div><strong>{application.name}</strong><small><GitBranch size={11} /> {application.deployment?.repository.replace(/^https:\/github\.com\//, "").replace(/\.git$/, "")} · {application.deployment?.branch}</small></div><span className={application.status === "Online" ? "table-status success" : "table-status pending"}><i /> {application.status}</span>{connectedDatabases.length === 0 && <button type="button" className="secondary-button" onClick={() => { setAttachPassword(generatePassword()); setAttachApplication(application); }}><Plus size={15} /> Přidat databázi</button>}</header><div className="application-database-items">{connectedDatabases.length > 0 ? connectedDatabases.map((database) => <section className="application-database-entry" key={database.name}><div className="application-database-summary"><span className="database-engine">P</span><span><strong>{database.name}</strong><small>{database.owner} · {database.size}</small></span><span className="application-database-connections">{database.records.toLocaleString("cs-CZ")} záznamů</span><span className="application-database-connections">{database.connections} spojení</span>{database.managed && <button type="button" className="row-action" onClick={() => setManagedDatabase(database.name)} title={`Spravovat databázi ${database.name}`} aria-label={`Spravovat databázi ${database.name}`}><TableProperties size={15} /></button>}<button type="button" className="row-action danger" onClick={() => setDetach({ application, database })} title={database.managed ? `Odebrat databázi ${database.name}` : `Odpojit databázi ${database.name}`} aria-label={`Odebrat databázi ${database.name} z aplikace ${application.name}`}><Trash2 size={15} /></button></div></section>) : <p>V prostředí aplikace není nastavená PostgreSQL databáze.</p>}</div></article>;
    })}</div></section>
    <section className="panel database-panel"><div className="panel-header management-header"><div><h2>Databáze</h2><p>Systémové databáze jsou chráněné proti odstranění</p></div></div><div className="domain-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat databázi..." aria-label="Hledat databázi" /></div></div><div className="domain-table-wrap"><table className="domain-table database-table"><thead><tr><th>Databáze</th><th>Vlastník</th><th>Velikost</th><th>Záznamy</th><th>Připojení</th><th>Správa</th><th><span className="sr-only">Akce</span></th></tr></thead><tbody>{filteredDatabases.map((database) => <tr key={database.name}><td><span className="database-engine">P</span><span className="database-name"><strong>{database.name}</strong><small>{database.managed ? "spravovaná dashboardem" : "chráněná databáze"}</small></span></td><td>{database.owner}</td><td className="mono">{database.size}</td><td className="mono">{database.records.toLocaleString("cs-CZ")}</td><td className="mono">{database.connections}</td><td><span className={database.managed ? "table-status success" : "table-status pending"}><i /> {database.managed ? "Spravovaná" : "Chráněná"}</span></td><td><span className="row-actions"><button className="row-action" disabled={!database.managed} onClick={() => setManagedDatabase(database.name)} title="Spravovat tabulky a záznamy" aria-label={`Spravovat databázi ${database.name}`}><TableProperties size={15} /></button><button className="row-action danger" disabled={!database.managed} onClick={() => setDeleteDatabase(database)} title="Odstranit" aria-label={`Odstranit databázi ${database.name}`}><Trash2 size={15} /></button></span></td></tr>)}</tbody></table></div></section>
    {managedDatabase && <DatabaseBrowser database={managedDatabase} onClose={() => setManagedDatabase("")} />}
    {createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="database-create-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><Database size={21} /></div><button className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Zavřít"><X size={19} /></button><h2 id="database-create-title">Nová PostgreSQL databáze</h2><p>Vytvoří databázi a samostatného uživatele v hlavním clusteru.</p><form className="database-form" onSubmit={createDatabase}><label htmlFor="database-name">Název databáze</label><input id="database-name" name="name" pattern="[a-z][a-z0-9_]{0,62}" required /><label htmlFor="database-owner">Databázový uživatel</label><input id="database-owner" name="owner" pattern="[a-z][a-z0-9_]{0,62}" required /><label htmlFor="database-password">Heslo</label><input id="database-password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /><div className="modal-actions"><button type="button" onClick={() => setCreateOpen(false)}>Zrušit</button><button className="primary-button" type="submit">Vytvořit databázi</button></div></form></div></div>}
    {attachApplication && <div className="modal-backdrop" role="presentation" onMouseDown={() => setAttachApplication(null)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="database-attach-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><Database size={21} /></div><button className="modal-close" onClick={() => setAttachApplication(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="database-attach-title">Přidat databázi k {attachApplication.name}</h2><p>Vytvoří PostgreSQL databázi a uživatele a uloží <strong>DATABASE_URL</strong> do prostředí aplikace. Aplikace se poté restartuje.</p><form className="database-form" onSubmit={attachDatabase}><label htmlFor="attach-database-name">Název databáze</label><input id="attach-database-name" name="name" defaultValue={suggestDatabaseName(attachApplication.name)} pattern="[a-z][a-z0-9_]{0,62}" required /><label htmlFor="attach-database-owner">Databázový uživatel</label><input id="attach-database-owner" name="owner" defaultValue={suggestDatabaseName(attachApplication.name)} pattern="[a-z][a-z0-9_]{0,62}" required /><label htmlFor="attach-database-password">Heslo</label><input id="attach-database-password" name="password" value={attachPassword} onChange={(event) => setAttachPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="off" required /><div className="modal-actions"><button type="button" onClick={() => setAttachApplication(null)}>Zrušit</button><button className="primary-button" type="submit">Vytvořit a připojit</button></div></form></div></div>}
    {detach && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDetach(null)}><div className="modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="database-detach-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon danger"><Trash2 size={21} /></div><button className="modal-close" onClick={() => setDetach(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="database-detach-title">{detach.database.managed ? "Odebrat databázi?" : "Odpojit databázi?"}</h2><p>{detach.database.managed ? <>Databáze <strong>{detach.database.name}</strong> včetně všech dat bude trvale odstraněna a odebrána z prostředí aplikace {detach.application.name}.</> : <>Databáze <strong>{detach.database.name}</strong> je chráněná, bude pouze odebrána z prostředí aplikace {detach.application.name}.</>}</p><div className="modal-actions"><button onClick={() => setDetach(null)}>Zrušit</button><button className="danger-button" onClick={confirmDetach}>{detach.database.managed ? "Trvale odstranit" : "Odpojit"}</button></div></div></div>}
    {deleteDatabase && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeleteDatabase(null)}><div className="modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="database-delete-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon danger"><Trash2 size={21} /></div><button className="modal-close" onClick={() => setDeleteDatabase(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="database-delete-title">Odstranit PostgreSQL databázi?</h2><p>Databáze <strong>{deleteDatabase.name}</strong> včetně všech dat bude trvale odstraněna.</p><div className="modal-actions"><button onClick={() => setDeleteDatabase(null)}>Zrušit</button><button className="danger-button" onClick={confirmDelete}>Trvale odstranit</button></div></div></div>}
  </>;
}