"use client";

import {
  Check, Copy, Database, Download, Ellipsis, HardDrive, KeyRound, Plus,
  RefreshCw, Search, ShieldCheck, Trash2, Users, X,
} from "lucide-react";
import { FormEvent, useState } from "react";

type DatabaseInstance = {
  name: string;
  engine: "PostgreSQL" | "MySQL" | "Redis";
  version: string;
  size: string;
  users: number;
  status: "Online" | "Údržba";
};

const initialDatabases: DatabaseInstance[] = [
  { name: "postgres", engine: "PostgreSQL", version: "17.11", size: "7,5 MB", users: 1, status: "Online" },
];

export default function DatabaseView({ notify }: { notify: (message: string) => void }) {
  const [databases, setDatabases] = useState(initialDatabases);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [databaseToDelete, setDatabaseToDelete] = useState<string | null>(null);
  const filteredDatabases = databases.filter((database) =>
    `${database.name} ${database.engine}`.toLowerCase().includes(query.toLowerCase()),
  );

  function createDatabase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const engine = String(form.get("engine")) as DatabaseInstance["engine"];
    if (!name) return;
    const version = engine === "PostgreSQL" ? "17.11" : engine === "MySQL" ? "8.4" : "7.4";
    setDatabases((current) => [...current, { name, engine, version, size: "0 MB", users: 1, status: "Online" }]);
    setCreateOpen(false);
    notify(`Databáze ${name} byla vytvořena`);
  }

  function deleteDatabase() {
    if (!databaseToDelete) return;
    setDatabases((current) => current.filter((database) => database.name !== databaseToDelete));
    notify(`Databáze ${databaseToDelete} byla odstraněna`);
    setDatabaseToDelete(null);
  }

  return <>
    <section className="page-heading database-heading">
      <div><div className="eyebrow neutral"><Database size={13} /> Databázový server</div><h1>Databáze</h1><p>Správa instancí, přístupů a databázových záloh.</p></div>
      <div className="heading-actions"><button className="secondary-button" onClick={() => notify("Stav databází byl aktualizován")}><RefreshCw size={17} /> Obnovit</button><button className="primary-button" onClick={() => setCreateOpen(true)}><Plus size={17} /> Vytvořit databázi</button></div>
    </section>

    <section className="database-stats" aria-label="Přehled databázového serveru">
      <article className="panel"><span className="database-stat-icon"><Database size={18} /></span><div><small>Databáze</small><strong>{databases.length}</strong><span>PostgreSQL 17.11</span></div></article>
      <article className="panel"><span className="database-stat-icon"><HardDrive size={18} /></span><div><small>Využité úložiště</small><strong>7,5 MB</strong><span>výchozí databáze</span></div></article>
      <article className="panel"><span className="database-stat-icon"><Users size={18} /></span><div><small>Přihlašovací role</small><strong>1</strong><span>postgres · superuser</span></div></article>
      <article className="panel"><span className="database-stat-icon"><ShieldCheck size={18} /></span><div><small>Poslední záloha</small><strong>Nezjištěna</strong><span>audit nenalezl údaj</span></div></article>
    </section>

    <section className="panel database-panel">
      <div className="panel-header management-header"><div><h2>Databázové instance</h2><p>Lokální služby dostupné aplikacím na serveru</p></div><div className="quick-actions"><button onClick={() => notify("Záloha všech databází byla spuštěna")}><Download size={16} /> Zálohovat vše</button><button onClick={() => notify("Kontrola databází byla zahájena")}><ShieldCheck size={16} /> Zkontrolovat</button></div></div>
      <div className="domain-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat databázi..." aria-label="Hledat databázi" /></div></div>
      <div className="domain-table-wrap"><table className="domain-table database-table"><thead><tr><th>Název</th><th>Engine</th><th>Velikost</th><th>Uživatelé</th><th>Stav</th><th><span className="sr-only">Akce</span></th></tr></thead><tbody>
        {filteredDatabases.map((database) => <tr key={database.name}>
          <td><span className="database-engine">{database.engine.slice(0, 1)}</span><span className="database-name"><strong>{database.name}</strong><small>localhost:{database.engine === "PostgreSQL" ? "5432" : database.engine === "MySQL" ? "3306" : "6379"}</small></span></td>
          <td><span className="engine-label">{database.engine}</span><small className="version-label">v{database.version}</small></td>
          <td className="mono">{database.size}</td><td>{database.users}</td>
          <td><span className={database.status === "Online" ? "table-status success" : "table-status pending"}><i /> {database.status}</span></td>
          <td><span className="row-actions"><button className="row-action" onClick={() => { navigator.clipboard?.writeText(`localhost/${database.name}`); notify("Připojovací údaj byl zkopírován"); }} aria-label={`Kopírovat připojení k databázi ${database.name}`} title="Kopírovat připojení"><Copy size={15} /></button><button className="row-action" onClick={() => notify(`Otevírám správu uživatelů ${database.name}`)} aria-label={`Spravovat uživatele databáze ${database.name}`} title="Spravovat uživatele"><KeyRound size={16} /></button><button className="row-action" onClick={() => notify(`Otevírám databázi ${database.name}`)} aria-label={`Spravovat databázi ${database.name}`} title="Spravovat"><Ellipsis size={18} /></button><button className="row-action delete" onClick={() => setDatabaseToDelete(database.name)} aria-label={`Odstranit databázi ${database.name}`} title="Odstranit databázi"><Trash2 size={16} /></button></span></td>
        </tr>)}
      </tbody></table>{filteredDatabases.length === 0 && <div className="empty-state">Žádná databáze neodpovídá hledání.</div>}</div>
    </section>

    {createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="database-modal-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><Database size={21} /></div><button className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Zavřít"><X size={19} /></button><h2 id="database-modal-title">Vytvořit databázi</h2><p>Nová instance bude dostupná pouze aplikacím na tomto serveru.</p><form className="database-form" onSubmit={createDatabase}><label htmlFor="database-name">Název databáze</label><input id="database-name" name="name" pattern="[a-z0-9_]+" placeholder="např. nova_stage" autoFocus required /><label htmlFor="database-engine">Databázový engine</label><select id="database-engine" name="engine" defaultValue="PostgreSQL"><option>PostgreSQL</option></select><div className="credential-note"><KeyRound size={17} /><span>Na serveru je nainstalovaný pouze PostgreSQL 17.11.</span></div><div className="modal-actions"><button type="button" onClick={() => setCreateOpen(false)}>Zrušit</button><button type="submit" className="primary-button"><Check size={16} /> Vytvořit databázi</button></div></form></div></div>}
    {databaseToDelete && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDatabaseToDelete(null)}><div className="modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="database-delete-title" aria-describedby="database-delete-description" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon danger"><Trash2 size={21} /></div><button className="modal-close" onClick={() => setDatabaseToDelete(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="database-delete-title">Odstranit databázi?</h2><p id="database-delete-description">Databáze <strong>{databaseToDelete}</strong> a její data budou trvale odstraněny. Před pokračováním doporučujeme vytvořit zálohu.</p><div className="modal-actions"><button type="button" onClick={() => setDatabaseToDelete(null)}>Zrušit</button><button type="button" className="danger-button" onClick={deleteDatabase}>Odstranit databázi</button></div></div></div>}
  </>;
}