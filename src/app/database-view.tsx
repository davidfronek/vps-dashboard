"use client";

import { Database, HardDrive, Pencil, Play, Plus, RefreshCw, RotateCw, Search, ShieldCheck, Square, Trash2, UserRound, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { AdminJobRequest, AdminOperation } from "@/lib/admin-job-types";
import type { DatabaseCluster } from "@/lib/server-data";

type JobRunner = (title: string, request: AdminJobRequest) => Promise<boolean>;

export default function DatabaseView({ databases, onRefresh, runJob }: { databases: DatabaseCluster[]; onRefresh: () => void; runJob: JobRunner }) {
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editCluster, setEditCluster] = useState<DatabaseCluster | null>(null);
  const [deleteCluster, setDeleteCluster] = useState<DatabaseCluster | null>(null);
  const filteredDatabases = databases.filter((database) => `${database.name} ${database.version} ${database.owner}`.toLowerCase().includes(query.toLowerCase()));

  async function createCluster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const version = String(data.get("version") ?? "");
    const name = String(data.get("name") ?? "").trim();
    const port = String(data.get("port") ?? "");
    if (await runJob(`Vytvoření PostgreSQL clusteru ${version}/${name}`, { operation: "cluster-create", arguments: [version, name, port] })) setCreateOpen(false);
  }

  async function changeState(cluster: DatabaseCluster, action: "start" | "stop" | "restart") {
    const operation = `cluster-${action}` as AdminOperation;
    await runJob(`${action === "start" ? "Spuštění" : action === "stop" ? "Zastavení" : "Restart"} clusteru ${cluster.version}/${cluster.name}`, { operation, arguments: [cluster.version, cluster.name] });
  }

  async function updateCluster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editCluster) return;
    const port = String(new FormData(event.currentTarget).get("port") ?? "");
    if (await runJob(`Změna PostgreSQL clusteru ${editCluster.version}/${editCluster.name}`, { operation: "cluster-update", arguments: [editCluster.version, editCluster.name, port] })) setEditCluster(null);
  }

  async function confirmDelete() {
    if (!deleteCluster) return;
    if (await runJob(`Odstranění PostgreSQL clusteru ${deleteCluster.version}/${deleteCluster.name}`, { operation: "cluster-delete", arguments: [deleteCluster.version, deleteCluster.name] })) setDeleteCluster(null);
  }

  const versions = [...new Set(databases.map((database) => database.version))];
  return <>
    <section className="page-heading database-heading"><div><div className="eyebrow neutral"><Database size={13} /> Databázový server</div><h1>PostgreSQL clustery</h1><p>Živé clustery z tohoto serveru. Logické databáze se spravují uvnitř clusteru.</p></div><div className="heading-actions"><button className="secondary-button" onClick={onRefresh}><RefreshCw size={17} /> Obnovit</button><button className="primary-button" onClick={() => setCreateOpen(true)}><Plus size={17} /> Nový cluster</button></div></section>
    <section className="database-stats" aria-label="Přehled databázového serveru"><article className="panel"><span className="database-stat-icon"><Database size={18} /></span><div><small>Clustery</small><strong>{databases.length}</strong><span>nalezeno přes pg_lsclusters</span></div></article><article className="panel"><span className="database-stat-icon"><ShieldCheck size={18} /></span><div><small>Online</small><strong>{databases.filter((database) => database.status === "Online").length}</strong><span>aktivní clustery</span></div></article><article className="panel"><span className="database-stat-icon"><HardDrive size={18} /></span><div><small>Úložiště</small><strong>{databases[0]?.size ?? "Nezjištěno"}</strong><span>první nalezený cluster</span></div></article><article className="panel"><span className="database-stat-icon"><UserRound size={18} /></span><div><small>Vlastníci</small><strong>{new Set(databases.map((database) => database.owner)).size}</strong><span>systémové účty</span></div></article></section>
    <section className="panel database-panel"><div className="panel-header management-header"><div><h2>PostgreSQL clustery</h2><p>Služby spravované nástroji pg_ctlcluster</p></div></div><div className="domain-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat cluster..." aria-label="Hledat cluster" /></div></div><div className="domain-table-wrap"><table className="domain-table database-table"><thead><tr><th>Cluster</th><th>Verze</th><th>Port</th><th>Vlastník</th><th>Velikost</th><th>Stav</th><th><span className="sr-only">Akce</span></th></tr></thead><tbody>{filteredDatabases.map((database) => { const protectedCluster = !database.managed; const mainCluster = database.name === "main"; return <tr key={`${database.version}-${database.name}`}><td><span className="database-engine">P</span><span className="database-name"><strong>{database.name}</strong><small>{protectedCluster ? "cluster mimo správu dashboardu" : "spravovaný PostgreSQL cluster"}</small></span></td><td><span className="engine-label">PostgreSQL</span><small className="version-label">v{database.version}</small></td><td className="mono">{database.port}</td><td>{database.owner}</td><td className="mono">{database.size}</td><td><span className={database.status === "Online" ? "table-status success" : "table-status pending"}><i /> {database.status}</span></td><td><span className="row-actions">{database.status === "Online" ? <button className="row-action" disabled={protectedCluster} onClick={() => changeState(database, "stop")} title="Zastavit" aria-label={`Zastavit cluster ${database.name}`}><Square size={15} /></button> : <button className="row-action" disabled={protectedCluster} onClick={() => changeState(database, "start")} title="Spustit" aria-label={`Spustit cluster ${database.name}`}><Play size={15} /></button>}<button className="row-action" disabled={protectedCluster && !mainCluster} onClick={() => changeState(database, "restart")} title="Restartovat" aria-label={`Restartovat cluster ${database.name}`}><RotateCw size={15} /></button><button className="row-action" disabled={protectedCluster} onClick={() => setEditCluster(database)} title="Změnit port" aria-label={`Upravit cluster ${database.name}`}><Pencil size={15} /></button><button className="row-action delete" disabled={protectedCluster} onClick={() => setDeleteCluster(database)} title="Odstranit" aria-label={`Odstranit cluster ${database.name}`}><Trash2 size={15} /></button></span></td></tr>; })}</tbody></table>{filteredDatabases.length === 0 && <div className="empty-state">Nebyl nalezen žádný PostgreSQL cluster.</div>}</div></section>
    {createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="cluster-create-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><Database size={21} /></div><button className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Zavřít"><X size={19} /></button><h2 id="cluster-create-title">Nový PostgreSQL cluster</h2><p>Vytvoří samostatnou instanci PostgreSQL na zvoleném volném portu.</p><form className="database-form" onSubmit={createCluster}><label htmlFor="cluster-version">Nainstalovaná verze</label><select id="cluster-version" name="version" defaultValue={versions[0]} required>{versions.map((version) => <option key={version}>{version}</option>)}</select><label htmlFor="cluster-name">Název clusteru</label><input id="cluster-name" name="name" pattern="[a-z][a-z0-9_-]{0,30}" required /><label htmlFor="cluster-port">Port</label><input id="cluster-port" name="port" type="number" min="1024" max="65535" defaultValue="5433" required /><div className="modal-actions"><button type="button" onClick={() => setCreateOpen(false)}>Zrušit</button><button className="primary-button" type="submit">Vytvořit cluster</button></div></form></div></div>}
    {editCluster && <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditCluster(null)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="cluster-edit-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><Pencil size={21} /></div><button className="modal-close" onClick={() => setEditCluster(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="cluster-edit-title">Změnit port clusteru</h2><p>{editCluster.version}/{editCluster.name} bude po změně restartován.</p><form className="database-form" onSubmit={updateCluster}><label htmlFor="edit-cluster-port">Port</label><input id="edit-cluster-port" name="port" type="number" min="1024" max="65535" defaultValue={editCluster.port} required /><div className="modal-actions"><button type="button" onClick={() => setEditCluster(null)}>Zrušit</button><button className="primary-button" type="submit">Uložit a restartovat</button></div></form></div></div>}
    {deleteCluster && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeleteCluster(null)}><div className="modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="cluster-delete-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon danger"><Trash2 size={21} /></div><button className="modal-close" onClick={() => setDeleteCluster(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="cluster-delete-title">Odstranit PostgreSQL cluster?</h2><p>Cluster <strong>{deleteCluster.version}/{deleteCluster.name}</strong> včetně všech databází bude trvale odstraněn.</p><div className="modal-actions"><button onClick={() => setDeleteCluster(null)}>Zrušit</button><button className="danger-button" onClick={confirmDelete}>Trvale odstranit</button></div></div></div>}
  </>;
}