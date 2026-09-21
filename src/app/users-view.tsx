"use client";

import {
  Ban, Check, KeyRound, RefreshCw, Search, ShieldCheck,
  TerminalSquare, Trash2, UserCheck, UserPlus, Users, X,
} from "lucide-react";
import { FormEvent, useState } from "react";

type ServerUser = {
  username: string;
  role: "Administrátor" | "Vývojář" | "Pouze čtení";
  shell: string;
  sshKeys: number;
  status: "Aktivní" | "Blokovaný";
};

const initialUsers: ServerUser[] = [
  { username: "root", role: "Administrátor", shell: "/bin/bash", sshKeys: 2, status: "Aktivní" },
];

export default function UsersView({ notify }: { notify: (message: string) => void }) {
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const filteredUsers = users.filter((user) =>
    `${user.username} ${user.role}`.toLowerCase().includes(query.toLowerCase()),
  );

  function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "").trim().toLowerCase();
    const role = String(form.get("role")) as ServerUser["role"];
    if (!username) return;
    if (users.some((user) => user.username === username)) {
      notify(`Uživatel ${username} již existuje`);
      return;
    }
    setUsers((current) => [...current, { username, role, shell: "/bin/bash", sshKeys: 0, status: "Aktivní" }]);
    setCreateOpen(false);
    notify(`Uživatel ${username} byl vytvořen`);
  }

  function toggleUser(username: string) {
    setUsers((current) => current.map((user) => user.username === username
      ? { ...user, status: user.status === "Aktivní" ? "Blokovaný" : "Aktivní" }
      : user));
    const user = users.find((entry) => entry.username === username);
    notify(`Uživatel ${username} byl ${user?.status === "Aktivní" ? "zablokován" : "aktivován"}`);
  }

  function deleteUser() {
    if (!userToDelete) return;
    setUsers((current) => current.filter((user) => user.username !== userToDelete));
    notify(`Uživatel ${userToDelete} byl odstraněn`);
    setUserToDelete(null);
  }

  return <>
    <section className="page-heading users-heading">
      <div><div className="eyebrow neutral"><Users size={13} /> Přístupy k serveru</div><h1>Uživatelé</h1><p>Správa systémových účtů, rolí a SSH přístupů.</p></div>
      <div className="heading-actions"><button className="secondary-button" onClick={() => notify("Seznam uživatelů byl aktualizován")}><RefreshCw size={17} /> Obnovit</button><button className="primary-button" onClick={() => setCreateOpen(true)}><UserPlus size={17} /> Přidat uživatele</button></div>
    </section>

    <section className="database-stats" aria-label="Přehled uživatelských účtů">
      <article className="panel"><span className="database-stat-icon"><Users size={18} /></span><div><small>Uživatelské účty</small><strong>{users.length}</strong><span>se shell přístupem</span></div></article>
      <article className="panel"><span className="database-stat-icon"><ShieldCheck size={18} /></span><div><small>Administrátoři</small><strong>{users.filter((user) => user.role === "Administrátor").length}</strong><span>plný přístup</span></div></article>
      <article className="panel"><span className="database-stat-icon"><KeyRound size={18} /></span><div><small>SSH klíče</small><strong>{users.reduce((total, user) => total + user.sshKeys, 0)}</strong><span>aktivní veřejné klíče</span></div></article>
      <article className="panel"><span className="database-stat-icon"><UserCheck size={18} /></span><div><small>Aktivní účty</small><strong>{users.filter((user) => user.status === "Aktivní").length}</strong><span>přístup povolen</span></div></article>
    </section>

    <section className="panel database-panel users-panel">
      <div className="panel-header management-header"><div><h2>Systémoví uživatelé</h2><p>Účty s interaktivním přístupem k serveru</p></div><div className="quick-actions"><button onClick={() => notify("Otevírám správu SSH klíčů")}><KeyRound size={16} /> SSH klíče</button></div></div>
      <div className="domain-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat uživatele..." aria-label="Hledat uživatele" /></div></div>
      <div className="domain-table-wrap"><table className="domain-table user-table"><thead><tr><th>Uživatel</th><th>Role</th><th>Shell</th><th>SSH klíče</th><th>Stav</th><th><span className="sr-only">Akce</span></th></tr></thead><tbody>
        {filteredUsers.map((user) => <tr key={user.username}>
          <td><span className="user-avatar">{user.username.slice(0, 2).toUpperCase()}</span><span className="domain-name"><strong>{user.username}</strong><small>{user.username === "root" ? "systémový účet" : "spravovaný účet"}</small></span></td>
          <td><span className="role-label"><ShieldCheck size={13} /> {user.role}</span></td>
          <td className="mono">{user.shell}</td><td>{user.sshKeys}</td>
          <td><span className={user.status === "Aktivní" ? "table-status success" : "table-status blocked"}><i /> {user.status}</span></td>
          <td><span className="row-actions"><button className="row-action" onClick={() => notify(`Otevírám SSH klíče uživatele ${user.username}`)} aria-label={`Spravovat SSH klíče uživatele ${user.username}`} title="SSH klíče"><KeyRound size={16} /></button><button className="row-action" disabled={user.username === "root"} onClick={() => toggleUser(user.username)} aria-label={user.username === "root" ? "Účet root nelze zablokovat" : `${user.status === "Aktivní" ? "Zablokovat" : "Aktivovat"} uživatele ${user.username}`} title={user.username === "root" ? "Root účet je chráněný" : user.status === "Aktivní" ? "Zablokovat" : "Aktivovat"}>{user.status === "Aktivní" ? <Ban size={16} /> : <UserCheck size={16} />}</button>{user.username !== "root" && <button className="row-action delete" onClick={() => setUserToDelete(user.username)} aria-label={`Odstranit uživatele ${user.username}`} title="Odstranit uživatele"><Trash2 size={16} /></button>}</span></td>
        </tr>)}
      </tbody></table>{filteredUsers.length === 0 && <div className="empty-state">Žádný uživatel neodpovídá hledání.</div>}</div>
    </section>

    {createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="user-modal-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><UserPlus size={21} /></div><button className="modal-close" onClick={() => setCreateOpen(false)} aria-label="Zavřít"><X size={19} /></button><h2 id="user-modal-title">Přidat uživatele</h2><p>Vytvořte systémový účet s přístupem k tomuto serveru.</p><form className="user-form" onSubmit={createUser}><label htmlFor="username">Uživatelské jméno</label><input id="username" name="username" pattern="[a-z_][a-z0-9_-]*" placeholder="např. deploy" autoFocus required /><label htmlFor="user-role">Role</label><select id="user-role" name="role" defaultValue="Vývojář"><option>Administrátor</option><option>Vývojář</option><option>Pouze čtení</option></select><div className="credential-note"><TerminalSquare size={17} /><span>Účet bude vytvořen se shellem <strong>/bin/bash</strong>. SSH klíč lze přidat po vytvoření.</span></div><div className="modal-actions"><button type="button" onClick={() => setCreateOpen(false)}>Zrušit</button><button type="submit" className="primary-button"><Check size={16} /> Přidat uživatele</button></div></form></div></div>}
    {userToDelete && <div className="modal-backdrop" role="presentation" onMouseDown={() => setUserToDelete(null)}><div className="modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="user-delete-title" aria-describedby="user-delete-description" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon danger"><Trash2 size={21} /></div><button className="modal-close" onClick={() => setUserToDelete(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="user-delete-title">Odstranit uživatele?</h2><p id="user-delete-description">Uživatel <strong>{userToDelete}</strong> ztratí přístup k serveru. Tuto akci nelze vrátit zpět.</p><div className="modal-actions"><button type="button" onClick={() => setUserToDelete(null)}>Zrušit</button><button type="button" className="danger-button" onClick={deleteUser}>Odstranit uživatele</button></div></div></div>}
  </>;
}