"use client";

import {
  Activity, Bell, Check, ChevronDown, Cloud, Copy, Cpu, Database,
  Ellipsis, GitBranch, Globe2, HardDrive, LayoutDashboard, MemoryStick, Menu, Plus, Power,
  LogOut, RefreshCw, Search, Server, Settings, ShieldCheck, TerminalSquare, Trash2, Users, X, Zap,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, useState } from "react";
import DatabaseView from "./database-view";
import UsersView from "./users-view";
import { logout } from "./auth-actions";

type Domain = {
  name: string;
  target: string;
  ssl: "Aktivní" | "Čeká";
  status: "Online" | "Ověřování" | "Chyba 502";
  automaticSsl: boolean;
  forceHttps: boolean;
  wwwRedirect: boolean;
  deployment?: {
    repository: string;
    branch: string;
    port: number;
    autoDeploy: boolean;
  };
};
type DomainGroup = Domain & { key: string; names: string[] };
type DomainSettings = Pick<DomainGroup, "key" | "name" | "names" | "automaticSsl" | "forceHttps" | "wwwRedirect" | "ssl">;

function getDomainGroupKey(name: string) {
  const normalizedName = name.toLowerCase();
  return normalizedName.startsWith("www.") ? normalizedName.slice(4) : normalizedName;
}

function groupDomains(domains: Domain[]): DomainGroup[] {
  const groups = new Map<string, Domain[]>();

  for (const domain of domains) {
    const key = getDomainGroupKey(domain.name);
    groups.set(key, [...(groups.get(key) ?? []), domain]);
  }

  return Array.from(groups, ([key, entries]) => {
    const primary = entries.find((domain) => domain.name.toLowerCase() === key) ?? entries[0];
    return { ...primary, key, names: entries.map((domain) => domain.name) };
  });
}

const navigation: { label: string; icon: LucideIcon; badge?: boolean }[] = [
  { label: "Přehled", icon: LayoutDashboard }, { label: "Domény", icon: Globe2, badge: true },
  { label: "Databáze", icon: Database }, { label: "Uživatelé", icon: Users },
  { label: "Zabezpečení", icon: ShieldCheck }, { label: "Nastavení", icon: Settings },
];

const initialDomains: Domain[] = [
  { name: "onremote.cz", target: "127.0.0.1:3000", ssl: "Aktivní", status: "Chyba 502", automaticSsl: true, forceHttps: true, wwwRedirect: true },
  { name: "www.onremote.cz", target: "127.0.0.1:3000", ssl: "Aktivní", status: "Chyba 502", automaticSsl: true, forceHttps: true, wwwRedirect: true },
];

const metrics = [
  { label: "Vytížení CPU", value: "0 %", detail: "1 vCPU", icon: Cpu, tone: "blue" },
  { label: "Operační paměť", value: "376 MB", detail: "z 3,8 GB", icon: MemoryStick, tone: "green" },
  { label: "Kořenový disk", value: "2,0 GB", detail: "z 30 GB", icon: HardDrive, tone: "amber" },
  { label: "Doba provozu", value: "3 d 22 h", detail: "bez výpadku", icon: Activity, tone: "violet" },
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" className={checked ? "toggle enabled" : "toggle"} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}><span /></button>;
}

function SettingsView({ notify }: { notify: (message: string) => void }) {
  const [tab, setTab] = useState("Obecné");
  const [automaticUpdates, setAutomaticUpdates] = useState(false);
  const [rootLogin, setRootLogin] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(false);
  const [automaticBackups, setAutomaticBackups] = useState(false);
  const [backupInterval, setBackupInterval] = useState("daily");
  const [backupStorage, setBackupStorage] = useState("google-drive");
  const [encryptedBackups, setEncryptedBackups] = useState(true);
  const tabs = [
    { label: "Obecné", icon: Settings }, { label: "Přístup", icon: ShieldCheck },
    { label: "Upozornění", icon: Bell }, { label: "Zálohy", icon: Database },
  ];

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    notify(tab === "Zálohy" ? "Plán zálohování byl uložen" : "Nastavení bylo uloženo");
  }

  return <>
    <section className="page-heading settings-heading"><div><div className="eyebrow neutral"><Settings size={13} /> Konfigurace serveru</div><h1>Nastavení</h1><p>Spravujte systémové volby, přístup a automatizaci serveru.</p></div></section>
    <form className="settings-layout" onSubmit={saveSettings}>
      <aside className="settings-nav panel" aria-label="Kategorie nastavení">
        {tabs.map(({ label, icon: Icon }) => <button type="button" key={label} className={tab === label ? "active" : ""} onClick={() => setTab(label)}><Icon size={17} /><span>{label}</span><ChevronDown size={15} /></button>)}
      </aside>
      <section className="settings-content panel">
        {tab === "Obecné" && <>
          <div className="settings-section-header"><div><h2>Obecné nastavení</h2><p>Základní identifikace a regionální konfigurace serveru.</p></div></div>
          <div className="settings-fields">
            <label><span>Název serveru</span><small>Zobrazuje se v administraci a upozorněních.</small><input name="serverName" defaultValue="Produkční server" /></label>
            <label><span>Hostname</span><small>Systémový název používaný v síti.</small><input name="hostname" defaultValue="vm27648" /></label>
            <label><span>Časové pásmo</span><small>Ovlivňuje systémové logy a plánované úlohy.</small><select name="timezone" defaultValue="Europe/Prague"><option value="Europe/Prague">Europe/Prague (UTC+2)</option><option value="UTC">UTC</option><option value="Europe/London">Europe/London</option></select></label>
            <label><span>Jazyk systému</span><small>Výchozí jazyk systémových zpráv.</small><select name="locale" defaultValue="cs_CZ"><option value="cs_CZ">Čeština (cs_CZ)</option><option value="en_US">English (en_US)</option></select></label>
            <div className="setting-row"><div><strong>Automatické bezpečnostní aktualizace</strong><small>Instalovat kritické opravy bez ručního zásahu.</small></div><Toggle checked={automaticUpdates} onChange={() => setAutomaticUpdates((value) => !value)} label="Automatické bezpečnostní aktualizace" /></div>
          </div>
        </>}
        {tab === "Přístup" && <>
          <div className="settings-section-header"><div><h2>Přístup k serveru</h2><p>Nastavení SSH a oprávnění administrátora.</p></div><span className="secure-badge"><ShieldCheck size={14} /> Chráněno</span></div>
          <div className="settings-fields">
            <label><span>SSH port</span><small>Port pro vzdálené připojení k serveru.</small><input name="sshPort" type="number" defaultValue="22" min="1" max="65535" /></label>
            <div className="setting-row"><div><strong>Přihlášení uživatele root</strong><small>Povolit přímé přihlášení účtu root přes SSH.</small></div><Toggle checked={rootLogin} onChange={() => setRootLogin((value) => !value)} label="Přihlášení uživatele root" /></div>
            <div className="key-card"><span className="server-icon"><ShieldCheck size={17} /></span><div><strong>SSH klíče</strong><small>2 aktivní veřejné klíče</small></div><button type="button" onClick={() => notify("Otevírám správu SSH klíčů")}>Spravovat</button></div>
          </div>
        </>}
        {tab === "Upozornění" && <>
          <div className="settings-section-header"><div><h2>Upozornění</h2><p>Nastavte, kdy a kam mají chodit provozní zprávy.</p></div></div>
          <div className="settings-fields">
            <label><span>Kontaktní e-mail</span><small>Adresa pro kritická systémová upozornění.</small><input name="email" type="email" placeholder="Není nastaven" /></label>
            <div className="setting-row"><div><strong>E-mailová upozornění</strong><small>Výpadky, restartování a bezpečnostní události.</small></div><Toggle checked={emailAlerts} onChange={() => setEmailAlerts((value) => !value)} label="E-mailová upozornění" /></div>
            <label><span>Limit využití CPU</span><small>Upozornit při překročení po dobu alespoň 5 minut.</small><div className="input-suffix"><input name="cpuLimit" type="number" defaultValue="85" min="1" max="100" /><span>%</span></div></label>
          </div>
        </>}
        {tab === "Zálohy" && <>
          <div className="settings-section-header"><div><h2>Automatické zálohy</h2><p>Plán, obsah a cílové úložiště záloh serveru.</p></div><span className="online-pill">{automaticBackups ? "Nakonfigurováno" : "Neaktivní"}</span></div>
          <div className="settings-fields">
            <div className="setting-row"><div><strong>Pravidelné zálohování</strong><small>Automaticky vytvářet kompletní snímek serveru.</small></div><Toggle checked={automaticBackups} onChange={() => setAutomaticBackups((value) => !value)} label="Pravidelné zálohování" /></div>
            <label><span>Cílové úložiště</span><small>Místo, kam se budou šifrované zálohy ukládat.</small><select name="backupStorage" value={backupStorage} onChange={(event) => setBackupStorage(event.target.value)} disabled={!automaticBackups}><option value="google-drive">Google Drive</option><option value="s3">S3 kompatibilní úložiště</option><option value="sftp">Vzdálený server přes SFTP</option><option value="local">Lokální disk</option></select></label>
            <label><span>Cesta k zálohám</span><small>Složka nebo prefix použitý ve vybraném úložišti.</small><input name="backupPath" defaultValue={backupStorage === "local" ? "/var/backups/vps" : "vps-backups/production"} key={backupStorage} disabled={!automaticBackups} /></label>
            <div className="backup-connection"><span className="server-icon"><Cloud size={17} /></span><div><strong>{backupStorage === "google-drive" ? "Google Drive" : backupStorage === "s3" ? "S3 úložiště" : backupStorage === "sftp" ? "SFTP server" : "Lokální úložiště"}</strong><small>{backupStorage === "local" ? "Připraveno k použití po uložení" : "Vyžaduje připojení účtu nebo přístupové údaje"}</small></div><button type="button" disabled={!automaticBackups || backupStorage === "local"} onClick={() => notify("Připojení úložiště bude dostupné po napojení backendu")}>Připojit</button></div>
            <label><span>Interval záloh</span><small>Jak často se má vytvořit nový snímek serveru.</small><select name="backupInterval" value={backupInterval} onChange={(event) => setBackupInterval(event.target.value)} disabled={!automaticBackups}><option value="6h">Každých 6 hodin</option><option value="12h">Každých 12 hodin</option><option value="daily">Denně</option><option value="weekly">Týdně</option><option value="monthly">Měsíčně</option></select></label>
            {backupInterval === "weekly" && <label><span>Den v týdnu</span><small>Den, kdy se spustí týdenní záloha.</small><select name="backupWeekday" defaultValue="sunday" disabled={!automaticBackups}><option value="monday">Pondělí</option><option value="tuesday">Úterý</option><option value="wednesday">Středa</option><option value="thursday">Čtvrtek</option><option value="friday">Pátek</option><option value="saturday">Sobota</option><option value="sunday">Neděle</option></select></label>}
            {backupInterval === "monthly" && <label><span>Den v měsíci</span><small>Pro kratší měsíce použijeme jejich poslední den.</small><input name="backupMonthDay" type="number" defaultValue="1" min="1" max="31" disabled={!automaticBackups} /></label>}
            <label><span>{backupInterval === "6h" || backupInterval === "12h" ? "První spuštění" : "Čas zálohy"}</span><small>Zálohy probíhají v časovém pásmu serveru.</small><input name="backupTime" type="time" defaultValue="03:00" disabled={!automaticBackups} /></label>
            <label><span>Doba uchování</span><small>Starší zálohy budou automaticky odstraněny.</small><select name="retention" defaultValue="14" disabled={!automaticBackups}><option value="7">7 dní</option><option value="14">14 dní</option><option value="30">30 dní</option><option value="90">90 dní</option></select></label>
            <fieldset className="backup-scope" disabled={!automaticBackups}><legend>Obsah zálohy</legend><small>Vyberte části serveru zahrnuté do každého bodu obnovy.</small><label><input type="checkbox" name="backupScope" value="files" defaultChecked /> Soubory aplikací a webů</label><label><input type="checkbox" name="backupScope" value="databases" defaultChecked /> Databáze</label><label><input type="checkbox" name="backupScope" value="configuration" defaultChecked /> Systémová konfigurace</label></fieldset>
            <div className="setting-row"><div><strong>Šifrování záloh</strong><small>Zašifrovat data před odesláním do cílového úložiště.</small></div><Toggle checked={encryptedBackups} onChange={() => setEncryptedBackups((value) => !value)} label="Šifrování záloh" /></div>
          </div>
        </>}
        <div className="settings-save"><span>Poslední změna dnes v 10:42</span><button type="submit" className="primary-button"><Check size={16} /> Uložit změny</button></div>
      </section>
    </form>
  </>;
}

export default function Dashboard({ adminUsername }: { adminUsername: string }) {
  const [activeSection, setActiveSection] = useState("Přehled");
  const [domains, setDomains] = useState(initialDomains);
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newDomainName, setNewDomainName] = useState("");
  const [githubDeploy, setGithubDeploy] = useState(false);
  const [githubRepository, setGithubRepository] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [deploymentPort, setDeploymentPort] = useState(3000);
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [domainToDelete, setDomainToDelete] = useState<string | null>(null);
  const [domainSettings, setDomainSettings] = useState<DomainSettings | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const groupedDomains = groupDomains(domains);
  const filteredDomains = groupedDomains.filter((domain) => domain.names.some((name) => name.toLowerCase().includes(query.toLowerCase())));
  const domainForDeletion = groupedDomains.find((domain) => domain.key === domainToDelete);
  const deploymentCommand = `sudo bash ./scripts/deploy-from-github.sh ${newDomainName || "domena.cz"} ${githubRepository || "https://github.com/uzivatel/repozitar.git"} ${githubBranch || "main"} ${deploymentPort}`;

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("domain") ?? "").trim();
    if (!name) return;
    const deployment = githubDeploy ? { repository: githubRepository.trim(), branch: githubBranch.trim(), port: deploymentPort, autoDeploy } : undefined;
    setDomains((current) => [...current, { name, target: githubDeploy ? `127.0.0.1:${deploymentPort}` : "46.28.108.112", ssl: "Čeká", status: "Ověřování", automaticSsl: true, forceHttps: false, wwwRedirect: false, deployment }]);
    setModalOpen(false);
    setNewDomainName("");
    setGithubDeploy(false);
    setGithubRepository("");
    setGithubBranch("main");
    setDeploymentPort(3000);
    setAutoDeploy(true);
    notify(githubDeploy ? `Doména ${name} byla přidána s GitHub deploymentem` : `Doména ${name} byla přidána`);
  }

  function saveDomainSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!domainSettings) return;
    const target = String(new FormData(event.currentTarget).get("target") ?? "").trim();
    if (!target) return;
    setDomains((current) => current.map((domain) => getDomainGroupKey(domain.name) === domainSettings.key
      ? { ...domain, target, automaticSsl: domainSettings.automaticSsl, forceHttps: domainSettings.forceHttps, wwwRedirect: domainSettings.wwwRedirect }
      : domain));
    notify(`Nastavení domény ${domainSettings.name} bylo uloženo`);
    setDomainSettings(null);
  }

  function renewCertificate() {
    if (!domainSettings) return;
    setDomains((current) => current.map((domain) => getDomainGroupKey(domain.name) === domainSettings.key ? { ...domain, ssl: "Čeká" } : domain));
    setDomainSettings((current) => current ? { ...current, ssl: "Čeká" } : current);
    notify(`Obnovení certifikátu pro ${domainSettings.name} bylo zahájeno`);
  }

  function deleteDomain() {
    if (!domainToDelete) return;
    setDomains((current) => current.filter((domain) => getDomainGroupKey(domain.name) !== domainToDelete));
    notify(`Doména ${domainToDelete} byla odebrána`);
    setDomainToDelete(null);
  }

  return (
    <div className="dashboard-shell">
      <aside className={menuOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand"><span className="brand-mark"><Cloud size={20} /></span><span>Správa <span>VPS</span></span><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Zavřít navigaci"><X size={20} /></button></div>
        <div className="server-switcher"><span className="server-icon"><Server size={18} /></span><span><strong>Produkční server</strong><small>Debian VPS · KVM</small></span><ChevronDown size={16} /></div>
        <nav aria-label="Hlavní navigace"><p className="nav-label">Správa serveru</p>
          {navigation.map(({ label, icon: Icon, badge }) => <button className={activeSection === label ? "nav-item active" : "nav-item"} key={label} onClick={() => { setActiveSection(label); setMenuOpen(false); if (!['Přehled', 'Databáze', 'Uživatelé', 'Nastavení'].includes(label)) notify(`Sekce ${label} je připravena`); }}><Icon size={18} /><span>{label}</span>{badge && <small>{groupedDomains.length}</small>}</button>)}
        </nav>
        <div className="profile"><span className="avatar">{adminUsername.slice(0, 2).toUpperCase()}</span><span><strong>{adminUsername}</strong><small>Administrátor</small></span><form action={logout}><button type="submit" aria-label="Odhlásit se" title="Odhlásit se"><LogOut size={17} /></button></form></div>
      </aside>
      {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="Zavřít navigaci" />}

      <main className="workspace">
        <header className="topbar"><button className="icon-button menu-button" onClick={() => setMenuOpen(true)} aria-label="Otevřít navigaci"><Menu size={20} /></button><div className="breadcrumbs"><span>Servery</span><b>/</b><strong>Produkční server</strong></div><div className="top-actions"><button className="icon-button" aria-label="Oznámení" title="Oznámení"><Bell size={19} /><i /></button><button className="terminal-button" onClick={() => notify("SSH: root@46.28.108.112")}><TerminalSquare size={17} /> Terminál</button></div></header>
        <div className="page-content">
          {activeSection === "Nastavení" ? <SettingsView notify={notify} /> : activeSection === "Databáze" ? <DatabaseView notify={notify} /> : activeSection === "Uživatelé" ? <UsersView notify={notify} /> : <>
          <section className="page-heading"><div><div className="eyebrow issue"><span className="status-dot issue" /> Webová aplikace vrací chybu 502</div><h1>Produkční server</h1><p>Stav VPS z auditu 21. 9. 2026 v 15:22.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => notify("Zobrazen je poslední audit z 15:22")}><RefreshCw size={17} /> Obnovit</button><button className="primary-button" onClick={() => setModalOpen(true)}><Plus size={17} /> Přidat doménu</button></div></section>
          <section className="metrics-grid" aria-label="Využití serveru">{metrics.map(({ label, value, detail, icon: Icon, tone }) => <article className="metric-card" key={label}><span className={`metric-icon ${tone}`}><Icon size={19} /></span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>)}</section>

          <div className="overview-grid">
            <section className="panel performance-panel">
              <div className="panel-header"><div><h2>Stav služeb</h2><p>Výsledek posledního read-only auditu</p></div><span className="audit-time">15:22</span></div>
              <div className="service-list">
                <div><span className="service-icon"><Server size={17} /></span><div><strong>Systémové služby</strong><small>Žádné selhané systemd jednotky</small></div><span className="service-state">V pořádku</span></div>
                <div><span className="service-icon"><Globe2 size={17} /></span><div><strong>Nginx</strong><small>Porty 80 a 443 · konfigurace platná</small></div><span className="service-state">Online</span></div>
                <div><span className="service-icon"><Database size={17} /></span><div><strong>PostgreSQL 17.11</strong><small>Naslouchá pouze lokálně na portu 5432</small></div><span className="service-state">Online</span></div>
                <div className="service-problem"><span className="service-icon"><Activity size={17} /></span><div><strong>Next.js aplikace</strong><small>Na upstream portu 3000 neběží žádný proces</small></div><span className="service-state">Chyba 502</span></div>
              </div>
            </section>
            <section className="panel server-info"><div className="panel-header"><div><h2>Informace o serveru</h2><p>Konfigurace a síťové údaje</p></div><span className="online-pill">Online</span></div><dl><div><dt>IPv4 adresa</dt><dd>46.28.108.112 <button onClick={() => { navigator.clipboard?.writeText("46.28.108.112"); notify("IP adresa zkopírována"); }} aria-label="Kopírovat IP adresu"><Copy size={14} /></button></dd></div><div><dt>Operační systém</dt><dd>Debian 13 (trixie)</dd></div><div><dt>Virtualizace</dt><dd>KVM · x86-64</dd></div><div><dt>Doba provozu</dt><dd>3 dny, 22 hodin</dd></div><div><dt>Hostname</dt><dd>vm27648</dd></div><div><dt>Poslední záloha</dt><dd>Nezjištěno</dd></div></dl><button className="details-link" onClick={() => notify("Kernel 6.12.107+deb13-amd64")}>Zobrazit konfiguraci <span>→</span></button></section>
          </div>

          <section className="panel management-panel">
            <div className="panel-header management-header"><div><h2>Správa serveru</h2><p>Domény, DNS a rychlé systémové akce</p></div><div className="quick-actions"><button onClick={() => notify("Záloha byla naplánována")}><Database size={16} /> Vytvořit zálohu</button><button onClick={() => notify("Restart serveru byl naplánován")}><Power size={16} /> Restartovat</button></div></div>
            <div className="domain-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat doménu..." aria-label="Hledat doménu" /></div><button className="add-domain-compact" onClick={() => setModalOpen(true)}><Plus size={16} /> Nová doména</button></div>
            <div className="domain-table-wrap"><table className="domain-table"><thead><tr><th>Doména</th><th>Cíl</th><th>SSL certifikát</th><th>Stav</th><th><span className="sr-only">Akce</span></th></tr></thead><tbody>{filteredDomains.map((domain) => <tr key={domain.key}><td><span className="domain-favicon"><Globe2 size={15} /></span><span className="domain-name"><strong>{domain.name}</strong>{domain.names.length > 1 && <small>včetně {domain.names.filter((name) => name !== domain.name).join(", ")}</small>}{domain.deployment && <small className="deployment-source"><GitBranch size={10} /> {domain.deployment.repository.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")} · {domain.deployment.branch}</small>}</span></td><td className="mono">{domain.target}</td><td><span className={domain.ssl === "Aktivní" ? "table-status success" : "table-status pending"}><ShieldCheck size={14} /> {domain.ssl}</span></td><td><span className={domain.status === "Online" ? "table-status success" : "table-status pending"}><i /> {domain.status}</span></td><td><span className="row-actions"><button className="row-action" onClick={() => setDomainSettings(domain)} aria-label={`Nastavení domény ${domain.name}`} title="Nastavení"><Ellipsis size={18} /></button><button className="row-action delete" onClick={() => setDomainToDelete(domain.key)} aria-label={`Odebrat doménu ${domain.name}`} title="Odebrat doménu"><Trash2 size={16} /></button></span></td></tr>)}</tbody></table>{filteredDomains.length === 0 && <div className="empty-state">Žádná doména neodpovídá hledání.</div>}</div>
          </section>
          </>}
          <footer><span>Správa VPS · Produkční server</span><span><a href="#">Stav služeb</a><a href="#">Dokumentace</a><a href="#">Podpora</a></span></footer>
        </div>
      </main>

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}><div className="modal deploy-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><Globe2 size={21} /></div><button className="modal-close" onClick={() => setModalOpen(false)} aria-label="Zavřít"><X size={19} /></button><h2 id="modal-title">Přidat novou doménu</h2><p>Nasměrujte doménu na tento server a volitelně ji propojte s GitHub repozitářem.</p><form onSubmit={addDomain}><label htmlFor="domain">Název domény nebo subdomény</label><input id="domain" name="domain" type="text" placeholder="např. app.mujweb.cz" pattern="[a-zA-Z0-9](?:[a-zA-Z0-9.\-]*[a-zA-Z0-9])?" value={newDomainName} onChange={(event) => setNewDomainName(event.target.value)} autoFocus required /><div className="dns-note"><Zap size={17} /><span>DNS A záznam nastavte na <strong>46.28.108.112</strong></span></div><div className="deploy-toggle"><div><strong><GitBranch size={16} /> Nasazovat z GitHubu</strong><small>Repozitář se připraví k prvnímu nasazení na lokální port.</small></div><Toggle checked={githubDeploy} onChange={() => setGithubDeploy((value) => !value)} label="Nasazovat z GitHubu" /></div>{githubDeploy && <div className="deploy-fields"><label htmlFor="github-repository">HTTPS adresa repozitáře</label><input id="github-repository" type="url" value={githubRepository} onChange={(event) => setGithubRepository(event.target.value)} placeholder="https://github.com/uzivatel/repozitar.git" pattern="https://github\.com/.+/.+(?:\.git)?" required /><small className="field-help">Pro soukromý repozitář nastavte deploy key přímo na serveru. Token se zde neukládá.</small><div className="deploy-grid"><label htmlFor="github-branch"><span>Větev</span><input id="github-branch" value={githubBranch} onChange={(event) => setGithubBranch(event.target.value)} pattern="[A-Za-z0-9._/\-]+" required /></label><label htmlFor="deployment-port"><span>Lokální port</span><input id="deployment-port" type="number" min="1024" max="65535" value={deploymentPort} onChange={(event) => setDeploymentPort(Number(event.target.value))} required /></label></div><label className="checkbox-row"><input type="checkbox" checked={autoDeploy} onChange={(event) => setAutoDeploy(event.target.checked)} /> Po napojení webhooku automaticky nasazovat změny</label><div className="deploy-command"><span>Příkaz pro první nasazení</span><code>{deploymentCommand}</code><button type="button" onClick={() => { navigator.clipboard?.writeText(deploymentCommand); notify("Deploy příkaz zkopírován"); }}><Copy size={14} /> Kopírovat</button></div></div>}<div className="modal-actions"><button type="button" onClick={() => setModalOpen(false)}>Zrušit</button><button type="submit" className="primary-button">Přidat doménu</button></div></form></div></div>}
      {domainSettings && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDomainSettings(null)}><div className="modal domain-settings-modal" role="dialog" aria-modal="true" aria-labelledby="domain-settings-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><Settings size={21} /></div><button className="modal-close" onClick={() => setDomainSettings(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="domain-settings-title">Nastavení domény</h2><p>{domainSettings.names.join(" · ")}</p><form className="domain-settings-form" onSubmit={saveDomainSettings}><label htmlFor="domain-target">Cílová adresa</label><input id="domain-target" name="target" defaultValue={groupedDomains.find((domain) => domain.key === domainSettings.key)?.target} placeholder="127.0.0.1:3000" required /><small className="field-help">IP adresa nebo lokální upstream včetně portu.</small><div className="domain-setting-row"><div><strong>Automatické SSL</strong><small>Vystavit a obnovovat certifikát přes Let&apos;s Encrypt.</small></div><Toggle checked={domainSettings.automaticSsl} onChange={() => setDomainSettings((current) => current ? { ...current, automaticSsl: !current.automaticSsl } : current)} label="Automatické SSL" /></div><div className="domain-setting-row"><div><strong>Vynutit HTTPS</strong><small>Přesměrovat všechny HTTP požadavky na HTTPS.</small></div><Toggle checked={domainSettings.forceHttps} onChange={() => setDomainSettings((current) => current ? { ...current, forceHttps: !current.forceHttps } : current)} label="Vynutit HTTPS" /></div>{domainSettings.names.length > 1 && <div className="domain-setting-row"><div><strong>Přesměrovat www</strong><small>Směrovat www variantu na hlavní doménu.</small></div><Toggle checked={domainSettings.wwwRedirect} onChange={() => setDomainSettings((current) => current ? { ...current, wwwRedirect: !current.wwwRedirect } : current)} label="Přesměrovat www" /></div>}<div className="certificate-card"><span className="server-icon"><ShieldCheck size={17} /></span><div><strong>SSL certifikát</strong><small>{domainSettings.ssl === "Aktivní" ? `Aktivní pro ${domainSettings.names.length} ${domainSettings.names.length === 1 ? "hostname" : "hostnames"}` : "Čeká na ověření DNS"}</small></div><button type="button" onClick={renewCertificate}>Obnovit</button></div><div className="modal-actions"><button type="button" onClick={() => setDomainSettings(null)}>Zrušit</button><button type="submit" className="primary-button"><Check size={16} /> Uložit změny</button></div></form></div></div>}
      {domainForDeletion && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDomainToDelete(null)}><div className="modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon danger"><Trash2 size={21} /></div><button className="modal-close" onClick={() => setDomainToDelete(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="delete-title">Odebrat doménu?</h2><p id="delete-description">Doména <strong>{domainForDeletion.names.join(" a ")}</strong> bude odebrána ze serveru. Tuto akci nelze vrátit zpět.</p><div className="modal-actions"><button type="button" onClick={() => setDomainToDelete(null)}>Zrušit</button><button type="button" className="danger-button" onClick={deleteDomain}>Odebrat doménu</button></div></div></div>}
      {toast && <div className="toast"><Check size={17} /> {toast}</div>}
    </div>
  );
}