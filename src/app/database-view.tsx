"use client";

import { Database, HardDrive, RefreshCw, Search, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import type { DatabaseCluster } from "@/lib/server-data";

export default function DatabaseView({ databases, onRefresh }: { databases: DatabaseCluster[]; onRefresh: () => void }) {
  const [query, setQuery] = useState("");
  const filteredDatabases = databases.filter((database) =>
    `${database.name} ${database.version} ${database.owner}`.toLowerCase().includes(query.toLowerCase()),
  );

  return <>
    <section className="page-heading database-heading">
      <div><div className="eyebrow neutral"><Database size={13} /> Databázový server</div><h1>Databáze</h1><p>Živé PostgreSQL clustery z tohoto serveru.</p></div>
      <div className="heading-actions"><button className="secondary-button" onClick={onRefresh}><RefreshCw size={17} /> Obnovit</button></div>
    </section>

    <section className="database-stats" aria-label="Přehled databázového serveru">
      <article className="panel"><span className="database-stat-icon"><Database size={18} /></span><div><small>Clustery</small><strong>{databases.length}</strong><span>nalezeno přes pg_lsclusters</span></div></article>
      <article className="panel"><span className="database-stat-icon"><ShieldCheck size={18} /></span><div><small>Online</small><strong>{databases.filter((database) => database.status === "Online").length}</strong><span>aktivní clustery</span></div></article>
      <article className="panel"><span className="database-stat-icon"><HardDrive size={18} /></span><div><small>Úložiště</small><strong>{databases[0]?.size ?? "Nezjištěno"}</strong><span>první nalezený cluster</span></div></article>
      <article className="panel"><span className="database-stat-icon"><UserRound size={18} /></span><div><small>Vlastníci</small><strong>{new Set(databases.map((database) => database.owner)).size}</strong><span>systémové účty</span></div></article>
    </section>

    <section className="panel database-panel">
      <div className="panel-header management-header"><div><h2>PostgreSQL clustery</h2><p>Read-only data z operačního systému</p></div></div>
      <div className="domain-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat cluster..." aria-label="Hledat cluster" /></div></div>
      <div className="domain-table-wrap"><table className="domain-table database-table"><thead><tr><th>Cluster</th><th>Verze</th><th>Port</th><th>Vlastník</th><th>Velikost</th><th>Stav</th></tr></thead><tbody>
        {filteredDatabases.map((database) => <tr key={`${database.version}-${database.name}`}>
          <td><span className="database-engine">P</span><span className="database-name"><strong>{database.name}</strong><small>PostgreSQL</small></span></td>
          <td><span className="engine-label">PostgreSQL</span><small className="version-label">v{database.version}</small></td>
          <td className="mono">{database.port}</td><td>{database.owner}</td><td className="mono">{database.size}</td>
          <td><span className={database.status === "Online" ? "table-status success" : "table-status pending"}><i /> {database.status}</span></td>
        </tr>)}
      </tbody></table>{filteredDatabases.length === 0 && <div className="empty-state">Nebyl nalezen žádný PostgreSQL cluster.</div>}</div>
    </section>
  </>;
}
