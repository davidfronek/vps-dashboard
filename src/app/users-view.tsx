"use client";

import { KeyRound, Plus, Power, RefreshCw, Search, ShieldCheck, Trash2, UserCheck, Users, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { AdminJobRequest } from "@/lib/admin-job-types";
import type { SystemUser } from "@/lib/server-data";

type JobRunner = (title: string, request: AdminJobRequest) => Promise<boolean>;

export default function UsersView({ users, onRefresh, runJob }: { users: SystemUser[]; onRefresh: () => void; runJob: JobRunner }) {
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<SystemUser | null>(null);
  const filteredUsers = users.filter((user) => `${user.username} ${user.shell} ${user.home}`.toLowerCase().includes(query.toLowerCase()));

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") ?? "").trim();
    const sshKey = String(data.get("sshKey") ?? "").trim();
    if (await runJob(`Vytvoření uživatele ${username}`, { operation: "user-create", arguments: [username, sshKey] })) setCreateOpen(false);
  }

  async function toggleUser(user: SystemUser) {
    const enable = user.status !== "Aktivní";
    await runJob(`${enable ? "Povolení" : "Zakázání"} uživatele ${user.username}`, { operation: "user-update", arguments: [user.username, enable ? "1" : "0"] });
  }

  async function confirmDelete() {
    if (!deleteUser) return;
    if (await runJob(`Odstranění uživatele ${deleteUser.username}`, { operation: "user-delete", arguments: [deleteUser.username] })) setDeleteUser(null);
  }

  return <>
    <section className="page-heading users-heading"><div><div className="eyebrow neutral"><Users size={13} /> Přístupy k serveru</div><h1>Uživatelé</h1><p>Interaktivní systémové účty načtené z /etc/passwd.</p></div><div className="heading-actions"><button className="secondary-button" onClick={onRefresh}><RefreshCw size={17} /> Obnovit</button><button className="primary-button" onClick={() => setCreateOpen(true)}><Plus size={17} /> Nový uživatel</button></div></section>
    <section className="database-stats" aria-label="Přehled uživatelských účtů"><article className="panel"><span className="database-stat-icon"><Users size={18} /></span><div><small>Uživatelské účty</small><strong>{users.length}</strong><span>UID 0 nebo alespoň 1000</span></div></article><article className="panel"><span className="database-stat-icon"><ShieldCheck size={18} /></span><div><small>Root účty</small><strong>{users.filter((user) => user.uid === 0).length}</strong><span>UID 0</span></div></article><article className="panel"><span className="database-stat-icon"><KeyRound size={18} /></span><div><small>SSH klíče</small><strong>{users.some((user) => user.sshKeys !== null) ? users.reduce((total, user) => total + (user.sshKeys ?? 0), 0) : "Nezjištěno"}</strong><span>čitelné pro službu</span></div></article><article className="panel"><span className="database-stat-icon"><UserCheck size={18} /></span><div><small>Aktivní účty</small><strong>{users.filter((user) => user.status === "Aktivní").length}</strong><span>s interaktivním shellem</span></div></article></section>
    <section className="panel database-panel users-panel"><div className="panel-header management-header"><div><h2>Systémoví uživatelé</h2><p>Účty a přístupy spravované operačním systémem</p></div></div><div className="domain-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat uživatele..." aria-label="Hledat uživatele" /></div></div><div className="domain-table-wrap"><table className="domain-table user-table"><thead><tr><th>Uživatel</th><th>UID</th><th>Domovský adresář</th><th>Shell</th><th>SSH klíče</th><th>Stav</th><th><span className="sr-only">Akce</span></th></tr></thead><tbody>{filteredUsers.map((user) => { const protectedUser = !user.managed; return <tr key={user.username}><td><span className="user-avatar">{user.username.slice(0, 2).toUpperCase()}</span><span className="domain-name"><strong>{user.username}</strong><small>{protectedUser ? "účet mimo správu dashboardu" : "spravovaný účet"}</small></span></td><td className="mono">{user.uid}</td><td className="mono">{user.home}</td><td className="mono">{user.shell}</td><td>{user.sshKeys ?? "—"}</td><td><span className={user.status === "Aktivní" ? "table-status success" : "table-status blocked"}><i /> {user.status}</span></td><td><span className="row-actions"><button className="row-action" disabled={protectedUser} onClick={() => toggleUser(user)} title={user.status === "Aktivní" ? "Zakázat přihlášení" : "Povolit přihlášení"} aria-label={`${user.status === "Aktivní" ? "Zakázat" : "Povolit"} uživatele ${user.username}`}><Power size={16} /></button><button className="row-action delete" disabled={protectedUser} onClick={() => setDeleteUser(user)} title="Odstranit" aria-label={`Odstranit uživatele ${user.username}`}><Trash2 size={16} /></button></span></td></tr>; })}</tbody></table>{filteredUsers.length === 0 && <div className="empty-state">Nebyl nalezen žádný interaktivní účet.</div>}</div></section>
    {createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="user-create-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><Users size={21} /></div><button className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Zavřít"><X size={19} /></button><h2 id="user-create-title">Nový uživatel</h2><p>Účet bude vytvořen bez hesla a přihlášení bude možné pouze vloženým SSH klíčem.</p><form className="user-form" onSubmit={createUser}><label htmlFor="username">Uživatelské jméno</label><input id="username" name="username" pattern="[a-z_][a-z0-9_-]{0,30}" required /><label htmlFor="ssh-key">Veřejný SSH klíč</label><textarea id="ssh-key" name="sshKey" rows={4} placeholder="ssh-ed25519 AAAA..." required /><div className="modal-actions"><button type="button" onClick={() => setCreateOpen(false)}>Zrušit</button><button className="primary-button" type="submit">Vytvořit uživatele</button></div></form></div></div>}
    {deleteUser && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeleteUser(null)}><div className="modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="user-delete-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon danger"><Trash2 size={21} /></div><button className="modal-close" onClick={() => setDeleteUser(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="user-delete-title">Odstranit uživatele?</h2><p>Účet <strong>{deleteUser.username}</strong> a jeho domovský adresář budou trvale odstraněny.</p><div className="modal-actions"><button onClick={() => setDeleteUser(null)}>Zrušit</button><button className="danger-button" onClick={confirmDelete}>Trvale odstranit</button></div></div></div>}
  </>;
}