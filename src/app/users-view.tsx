"use client";

import { KeyRound, RefreshCw, Search, ShieldCheck, UserCheck, Users } from "lucide-react";
import { useState } from "react";
import type { SystemUser } from "@/lib/server-data";

export default function UsersView({ users, onRefresh }: { users: SystemUser[]; onRefresh: () => void }) {
  const [query, setQuery] = useState("");
  const filteredUsers = users.filter((user) =>
    `${user.username} ${user.shell} ${user.home}`.toLowerCase().includes(query.toLowerCase()),
  );

  return <>
    <section className="page-heading users-heading">
      <div><div className="eyebrow neutral"><Users size={13} /> Přístupy k serveru</div><h1>Uživatelé</h1><p>Interaktivní systémové účty načtené z /etc/passwd.</p></div>
      <div className="heading-actions"><button className="secondary-button" onClick={onRefresh}><RefreshCw size={17} /> Obnovit</button></div>
    </section>

    <section className="database-stats" aria-label="Přehled uživatelských účtů">
      <article className="panel"><span className="database-stat-icon"><Users size={18} /></span><div><small>Uživatelské účty</small><strong>{users.length}</strong><span>UID 0 nebo alespoň 1000</span></div></article>
      <article className="panel"><span className="database-stat-icon"><ShieldCheck size={18} /></span><div><small>Root účty</small><strong>{users.filter((user) => user.uid === 0).length}</strong><span>UID 0</span></div></article>
      <article className="panel"><span className="database-stat-icon"><KeyRound size={18} /></span><div><small>SSH klíče</small><strong>{users.some((user) => user.sshKeys !== null) ? users.reduce((total, user) => total + (user.sshKeys ?? 0), 0) : "Nezjištěno"}</strong><span>čitelné pro službu</span></div></article>
      <article className="panel"><span className="database-stat-icon"><UserCheck size={18} /></span><div><small>Aktivní účty</small><strong>{users.filter((user) => user.status === "Aktivní").length}</strong><span>s interaktivním shellem</span></div></article>
    </section>

    <section className="panel database-panel users-panel">
      <div className="panel-header management-header"><div><h2>Systémoví uživatelé</h2><p>Read-only data z operačního systému</p></div></div>
      <div className="domain-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat uživatele..." aria-label="Hledat uživatele" /></div></div>
      <div className="domain-table-wrap"><table className="domain-table user-table"><thead><tr><th>Uživatel</th><th>UID</th><th>Domovský adresář</th><th>Shell</th><th>SSH klíče</th><th>Stav</th></tr></thead><tbody>
        {filteredUsers.map((user) => <tr key={user.username}>
          <td><span className="user-avatar">{user.username.slice(0, 2).toUpperCase()}</span><span className="domain-name"><strong>{user.username}</strong><small>{user.uid === 0 ? "root účet" : "systémový účet"}</small></span></td>
          <td className="mono">{user.uid}</td><td className="mono">{user.home}</td><td className="mono">{user.shell}</td><td>{user.sshKeys ?? "—"}</td>
          <td><span className={user.status === "Aktivní" ? "table-status success" : "table-status blocked"}><i /> {user.status}</span></td>
        </tr>)}
      </tbody></table>{filteredUsers.length === 0 && <div className="empty-state">Nebyl nalezen žádný interaktivní účet.</div>}</div>
    </section>
  </>;
}
