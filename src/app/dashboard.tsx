"use client";

import {
  Activity, Bell, Check, ChevronDown, Cloud, Copy, Cpu, Database,
  Ellipsis, GitBranch, Globe2, HardDrive, LayoutDashboard, MemoryStick, Menu, Plus, Power,
  LogOut, RefreshCw, Search, Server, Settings, ShieldCheck, TerminalSquare, Trash2, Users, X, Zap,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DatabaseView from "./database-view";
import UsersView from "./users-view";
import AdminJobProgress, { runAdminJob } from "./admin-job-progress";
import { logout } from "./auth-actions";
import type { AdminJob } from "@/lib/admin-job-types";
import type { ServerSnapshot } from "@/lib/server-data";

type Domain = Omit<ServerSnapshot["domains"][number], "ssl" | "status"> & {
  name: string;
  target: string;
  ssl: ServerSnapshot["domains"][number]["ssl"] | "Čeká";
  status: ServerSnapshot["domains"][number]["status"] | "Ověřování";
  deployment?: {
    repository: string;
    branch: string;
    port: number;
  };
};
type DomainGroup = Domain & { key: string; names: string[] };
type DomainSettings = Pick<DomainGroup, "key" | "name" | "names" | "automaticSsl" | "forceHttps" | "wwwRedirect" | "ssl" | "deployment">;

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
    return {
      ...primary,
      key,
      names: entries.map((domain) => domain.name),
      wwwRedirect: entries.some((domain) => domain.name.startsWith("www.") && domain.wwwRedirect),
      deployment: entries.find((domain) => domain.deployment)?.deployment,
    };
  });
}

function getAvailableDeploymentPort(domains: Domain[]) {
  const usedPorts = new Set(domains.flatMap((domain) => domain.deployment ? [domain.deployment.port] : []));
  let port = 3001;
  while (usedPorts.has(port) && port < 65535) port += 1;
  return port;
}

const navigation: { label: string; icon: LucideIcon; badge?: boolean }[] = [
  { label: "Přehled", icon: LayoutDashboard }, { label: "Domény", icon: Globe2, badge: true },
  { label: "Databáze", icon: Database }, { label: "Uživatelé", icon: Users },
  { label: "Zabezpečení", icon: ShieldCheck }, { label: "Nastavení", icon: Settings },
];

const metricIcons = [Cpu, MemoryStick, HardDrive, Activity];
const serviceIcons = [Server, Globe2, Database, Activity];

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
            <label><span>Název serveru</span><small>Zobrazuje se v administraci a upozorněních.</small><input name="serverName" defaultValue="Onremote.cz" /></label>
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

export default function Dashboard({ adminUsername, snapshot: initialSnapshot }: { adminUsername: string; snapshot: ServerSnapshot }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [activeSection, setActiveSection] = useState("Přehled");
  const domains: Domain[] = snapshot.domains;
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [newDomainName, setNewDomainName] = useState("");
  const [githubDeploy, setGithubDeploy] = useState(false);
  const [githubRepository, setGithubRepository] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [deploymentPort, setDeploymentPort] = useState(() => getAvailableDeploymentPort(initialSnapshot.domains));
  const [domainToDelete, setDomainToDelete] = useState<string | null>(null);
  const [domainSettings, setDomainSettings] = useState<DomainSettings | null>(null);
  const [editGithubDeploy, setEditGithubDeploy] = useState(false);
  const [editGithubRepository, setEditGithubRepository] = useState("");
  const [editGithubBranch, setEditGithubBranch] = useState("main");
  const [editDeploymentPort, setEditDeploymentPort] = useState(3001);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [adminJob, setAdminJob] = useState<AdminJob | null>(null);
  const jobRunning = useRef(false);
  const pendingOperation = adminJob?.status === "queued" || adminJob?.status === "running";
  const groupedDomains = groupDomains(domains);
  const filteredDomains = groupedDomains.filter((domain) => domain.names.some((name) => name.toLowerCase().includes(query.toLowerCase())));
  const domainForDeletion = groupedDomains.find((domain) => domain.key === domainToDelete);

  useEffect(() => {
    let active = true;
    async function refreshSnapshot() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/server-snapshot", { cache: "no-store" });
        if (!response.ok) return;
        const nextSnapshot = await response.json() as ServerSnapshot;
        if (active) setSnapshot(nextSnapshot);
      } catch {}
    }
    const interval = window.setInterval(refreshSnapshot, 2_000);
    void refreshSnapshot();
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function executeJob(title: string, request: Parameters<typeof runAdminJob>[0]) {
    if (jobRunning.current) return false;
    jobRunning.current = true;
    setAdminJob({ id: "", status: "queued", title, message: "", steps: [] });
    try {
      const result = await runAdminJob(request, setAdminJob);
      if (result.status === "succeeded") router.refresh();
      return result.status === "succeeded";
    } catch (error) {
      setAdminJob({ id: "", status: "failed", title, message: error instanceof Error ? error.message : "Spojení se serverem selhalo.", steps: [] });
      return false;
    } finally {
      jobRunning.current = false;
    }
  }

  function openDomainSettings(domain: DomainSettings) {
    setDomainSettings(domain);
    setEditGithubDeploy(Boolean(domain.deployment));
    setEditGithubRepository(domain.deployment?.repository ?? "");
    setEditGithubBranch(domain.deployment?.branch ?? "main");
    setEditDeploymentPort(domain.deployment?.port ?? 3001);
  }

  function openNewDomain() {
    setDeploymentPort(getAvailableDeploymentPort(domains));
    setModalOpen(true);
  }

  async function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("domain") ?? "").trim();
    if (!name) return;
    const wwwRedirect = name.split(".").length === 2 ? "1" : "0";
    const succeeded = await executeJob(githubDeploy ? `Nasazení aplikace ${name}` : `Konfigurace domény ${name}`, {
      operation: githubDeploy ? "domain-deploy" : "domain-upsert",
      arguments: githubDeploy
        ? [name, githubRepository, githubBranch, String(deploymentPort), "1", wwwRedirect, "1"]
        : [name, "1", wwwRedirect, "1"],
    });
    if (succeeded) {
      setModalOpen(false);
      setNewDomainName("");
      setGithubDeploy(false);
      setGithubRepository("");
      setGithubBranch("main");
      setDeploymentPort(getAvailableDeploymentPort(domains));
    }
  }

  async function saveDomainSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!domainSettings) return;
    const flags = [domainSettings.forceHttps ? "1" : "0", domainSettings.wwwRedirect ? "1" : "0", domainSettings.automaticSsl ? "1" : "0"];
    const succeeded = await executeJob(editGithubDeploy ? `Nasazení aplikace ${domainSettings.name}` : `Konfigurace domény ${domainSettings.name}`, {
      operation: editGithubDeploy ? "domain-deploy" : "domain-upsert",
      arguments: editGithubDeploy
        ? [domainSettings.name, editGithubRepository, editGithubBranch, String(editDeploymentPort), ...flags]
        : [domainSettings.name, ...flags],
    });
    if (succeeded) setDomainSettings(null);
  }

  async function renewCertificate() {
    if (!domainSettings) return;
    await executeJob(`Obnova SSL certifikátu ${domainSettings.name}`, { operation: "domain-renew", arguments: [domainSettings.name] });
  }

  async function deleteDomain() {
    if (!domainToDelete) return;
    const succeeded = await executeJob(`Odstranění domény ${domainToDelete}`, { operation: "domain-delete", arguments: [domainToDelete] });
    if (succeeded) setDomainToDelete(null);
  }

  return (
    <div className={pendingOperation ? "dashboard-shell operation-pending" : "dashboard-shell"} aria-busy={pendingOperation}>
      <aside className={menuOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand"><span className="brand-mark"><Cloud size={20} /></span><span>Správa <span>VPS</span></span><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Zavřít navigaci"><X size={20} /></button></div>
        <div className="server-switcher"><span className="server-icon"><Server size={18} /></span><span><strong>Onremote.cz</strong><small>Debian VPS · KVM</small></span><ChevronDown size={16} /></div>
        <nav aria-label="Hlavní navigace"><p className="nav-label">Správa serveru</p>
          {navigation.map(({ label, icon: Icon, badge }) => <button className={activeSection === label ? "nav-item active" : "nav-item"} key={label} onClick={() => { setActiveSection(label); setMenuOpen(false); if (!['Přehled', 'Databáze', 'Uživatelé', 'Nastavení'].includes(label)) notify(`Sekce ${label} je připravena`); }}><Icon size={18} /><span>{label}</span>{badge && <small>{groupedDomains.length}</small>}</button>)}
        </nav>
        <div className="profile"><span className="avatar">{adminUsername.slice(0, 2).toUpperCase()}</span><span><strong>{adminUsername}</strong><small>Administrátor</small></span><form action={logout}><button type="submit" aria-label="Odhlásit se" title="Odhlásit se"><LogOut size={17} /></button></form></div>
      </aside>
      {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="Zavřít navigaci" />}

      <main className="workspace">
        <header className="topbar"><button className="icon-button menu-button" onClick={() => setMenuOpen(true)} aria-label="Otevřít navigaci"><Menu size={20} /></button><div className="breadcrumbs"><span>Servery</span><b>/</b><strong>Onremote.cz</strong></div><div className="top-actions"><button className="icon-button" aria-label="Oznámení" title="Oznámení"><Bell size={19} /><i /></button><button className="terminal-button" onClick={() => notify("SSH: root@46.28.108.112")}><TerminalSquare size={17} /> Terminál</button></div></header>
        <div className="page-content">
          {activeSection === "Nastavení" ? <SettingsView notify={notify} /> : activeSection === "Databáze" ? <DatabaseView databases={snapshot.databases} onRefresh={() => router.refresh()} runJob={executeJob} /> : activeSection === "Uživatelé" ? <UsersView users={snapshot.users} onRefresh={() => router.refresh()} runJob={executeJob} /> : <>
          <section className="page-heading"><div><div className={snapshot.services.every((service) => service.state !== "Nedostupné") ? "eyebrow neutral" : "eyebrow issue"}><span className={snapshot.services.every((service) => service.state !== "Nedostupné") ? "status-dot" : "status-dot issue"} /> {snapshot.services.every((service) => service.state !== "Nedostupné") ? "Všechny sledované služby jsou dostupné" : "Některá služba vyžaduje pozornost"}</div><h1>Onremote.cz</h1><p>Živý stav z {new Date(snapshot.collectedAt).toLocaleString("cs-CZ")}.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => router.refresh()}><RefreshCw size={17} /> Obnovit</button><button className="primary-button" onClick={openNewDomain}><Plus size={17} /> Přidat doménu</button></div></section>
          <section className="metrics-grid" aria-label="Využití serveru">{snapshot.metrics.map(({ label, value, detail, tone, usagePercent }, index) => { const Icon = metricIcons[index]; const circumference = 2 * Math.PI * 30; const utilizationTone = usagePercent === undefined ? "" : usagePercent <= 30 ? "low" : usagePercent <= 75 ? "medium" : "high"; return <article className="metric-card" key={label}><span className={`metric-icon ${tone}`}><Icon size={19} /></span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>{usagePercent !== undefined && <div className={`utilization-chart ${utilizationTone}`} role="img" aria-label={`${label}: ${usagePercent} %`}><svg viewBox="0 0 72 72" aria-hidden="true"><circle className="utilization-track" cx="36" cy="36" r="30" /><circle className="utilization-value" cx="36" cy="36" r="30" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - usagePercent / 100)} /></svg><span>{usagePercent}<small>%</small></span></div>}</article>; })}</section>

          <div className="overview-grid">
            <section className="panel performance-panel">
              <div className="panel-header"><div><h2>Stav služeb</h2><p>Aktuální stav systemd</p></div><span className="audit-time">{new Date(snapshot.collectedAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</span></div>
              <div className="service-list">
                {snapshot.services.map((service, index) => { const Icon = serviceIcons[index]; return <div className={service.state === "Nedostupné" ? "service-problem" : undefined} key={service.name}><span className="service-icon"><Icon size={17} /></span><div><strong>{service.name}</strong><small>{service.detail}</small></div><span className="service-state">{service.state}</span></div>; })}
              </div>
            </section>
            <section className="panel server-info"><div className="panel-header"><div><h2>Informace o serveru</h2><p>Konfigurace a síťové údaje</p></div><span className="online-pill">Online</span></div><dl><div><dt>IPv4 adresa</dt><dd>{snapshot.server.ipAddress} <button onClick={() => { navigator.clipboard?.writeText(snapshot.server.ipAddress); notify("IP adresa zkopírována"); }} aria-label="Kopírovat IP adresu"><Copy size={14} /></button></dd></div><div><dt>Operační systém</dt><dd>{snapshot.server.operatingSystem}</dd></div><div><dt>Virtualizace</dt><dd>{snapshot.server.virtualization}</dd></div><div><dt>Doba provozu</dt><dd>{snapshot.server.uptime}</dd></div><div><dt>Hostname</dt><dd>{snapshot.server.hostname}</dd></div><div><dt>Kernel</dt><dd>{snapshot.server.kernel}</dd></div></dl></section>
          </div>

          <section className="panel management-panel">
            <div className="panel-header management-header"><div><h2>Správa serveru</h2><p>Domény, DNS a rychlé systémové akce</p></div><div className="quick-actions"><button onClick={() => notify("Záloha byla naplánována")}><Database size={16} /> Vytvořit zálohu</button><button onClick={() => notify("Restart serveru byl naplánován")}><Power size={16} /> Restartovat</button></div></div>
            <div className="domain-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat doménu..." aria-label="Hledat doménu" /></div><button className="add-domain-compact" onClick={openNewDomain}><Plus size={16} /> Nová doména</button></div>
            <div className="domain-table-wrap"><table className="domain-table"><thead><tr><th>Doména</th><th>Cíl</th><th>SSL certifikát</th><th>Stav</th><th><span className="sr-only">Akce</span></th></tr></thead><tbody>{filteredDomains.map((domain) => <tr key={domain.key}><td><span className="domain-favicon"><Globe2 size={15} /></span><span className="domain-name"><strong>{domain.name}</strong>{domain.names.length > 1 && <small>včetně {domain.names.filter((name) => name !== domain.name).join(", ")}</small>}{domain.deployment && <small className="deployment-source"><GitBranch size={10} /> {domain.deployment.repository.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")} · {domain.deployment.branch}</small>}</span></td><td className="mono">{domain.target}</td><td><span className={domain.ssl === "Aktivní" ? "table-status success" : "table-status pending"}><ShieldCheck size={14} /> {domain.ssl}</span></td><td><span className={domain.status === "Online" ? "table-status success" : "table-status pending"}><i /> {domain.status}</span></td><td><span className="row-actions"><button className="row-action" onClick={() => openDomainSettings(domain)} aria-label={`Nastavení domény ${domain.name}`} title="Nastavení"><Ellipsis size={18} /></button><button className="row-action delete" disabled={domain.key === "onremote.cz"} onClick={() => setDomainToDelete(domain.key)} aria-label={domain.key === "onremote.cz" ? "Správcovskou doménu nelze odebrat" : `Odebrat doménu ${domain.name}`} title={domain.key === "onremote.cz" ? "Správcovská doména je chráněná" : "Odebrat doménu"}><Trash2 size={16} /></button></span></td></tr>)}</tbody></table>{filteredDomains.length === 0 && <div className="empty-state">Žádná doména neodpovídá hledání.</div>}</div>
          </section>
          </>}
          <footer><span>Správa VPS · Onremote.cz</span><span><a href="#">Stav služeb</a><a href="#">Dokumentace</a><a href="#">Podpora</a></span></footer>
        </div>
      </main>

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}><div className="modal deploy-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><Globe2 size={21} /></div><button className="modal-close" onClick={() => setModalOpen(false)} aria-label="Zavřít"><X size={19} /></button><h2 id="modal-title">Přidat novou doménu</h2><p>Nasměrujte doménu na tento server a volitelně ji propojte s GitHub repozitářem.</p><form onSubmit={addDomain}><label htmlFor="domain">Název domény nebo subdomény</label><input id="domain" name="domain" type="text" placeholder="např. app.mujweb.cz" pattern="[a-zA-Z0-9](?:[a-zA-Z0-9.\-]*[a-zA-Z0-9])?" value={newDomainName} onChange={(event) => setNewDomainName(event.target.value)} autoFocus required /><div className="dns-note"><Zap size={17} /><span>DNS A záznam nastavte na <strong>46.28.108.112</strong></span></div><div className="deploy-toggle"><div><strong><GitBranch size={16} /> Nasazovat z GitHubu</strong><small>Repozitář se připraví k prvnímu nasazení na lokální port.</small></div><Toggle checked={githubDeploy} onChange={() => setGithubDeploy((value) => !value)} label="Nasazovat z GitHubu" /></div>{githubDeploy && <div className="deploy-fields"><label htmlFor="github-repository">HTTPS adresa repozitáře</label><input id="github-repository" type="url" value={githubRepository} onChange={(event) => setGithubRepository(event.target.value)} placeholder="https://github.com/uzivatel/repozitar.git" pattern="https://github\.com/.+/.+(?:\.git)?" required /><small className="field-help">Pro soukromý repozitář nastavte deploy key přímo na serveru. Token se zde neukládá.</small><div className="deploy-grid"><label htmlFor="github-branch"><span>Větev</span><input id="github-branch" value={githubBranch} onChange={(event) => setGithubBranch(event.target.value)} pattern="[A-Za-z0-9._/\-]+" required /></label><label htmlFor="deployment-port"><span>Lokální port</span><input id="deployment-port" type="number" min="1024" max="65535" value={deploymentPort} onChange={(event) => setDeploymentPort(Number(event.target.value))} required /></label></div></div>}<div className="modal-actions"><button type="button" onClick={() => setModalOpen(false)}>Zrušit</button><button type="submit" className="primary-button">Přidat doménu</button></div></form></div></div>}
      {domainSettings && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDomainSettings(null)}><div className="modal domain-settings-modal" role="dialog" aria-modal="true" aria-labelledby="domain-settings-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon"><Settings size={21} /></div><button className="modal-close" onClick={() => setDomainSettings(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="domain-settings-title">Nastavení domény</h2><p>{domainSettings.names.join(" · ")}</p><form className="domain-settings-form" onSubmit={saveDomainSettings}><div className="deploy-toggle"><div><strong><GitBranch size={16} /> Nasazovat z GitHubu</strong><small>Repozitář lze připojit nebo změnit i u existující domény.</small></div><Toggle checked={editGithubDeploy} onChange={() => setEditGithubDeploy((value) => !value)} label="Nasazovat z GitHubu" /></div>{editGithubDeploy ? <div className="deploy-fields"><label htmlFor="edit-github-repository">HTTPS adresa repozitáře</label><input id="edit-github-repository" type="url" value={editGithubRepository} onChange={(event) => setEditGithubRepository(event.target.value)} placeholder="https://github.com/uzivatel/repozitar.git" pattern="https://github\.com/.+/.+(?:\.git)?" required /><div className="deploy-grid"><label htmlFor="edit-github-branch"><span>Větev</span><input id="edit-github-branch" value={editGithubBranch} onChange={(event) => setEditGithubBranch(event.target.value)} pattern="[A-Za-z0-9._/\-]+" required /></label><label htmlFor="edit-deployment-port"><span>Lokální port</span><input id="edit-deployment-port" type="number" min="1024" max="65535" value={editDeploymentPort} onChange={(event) => setEditDeploymentPort(Number(event.target.value))} required /></label></div></div> : <><label htmlFor="domain-target">Cílová adresa</label><input id="domain-target" name="target" defaultValue={groupedDomains.find((domain) => domain.key === domainSettings.key)?.target} placeholder="127.0.0.1:3000" required /><small className="field-help">IP adresa nebo lokální upstream včetně portu.</small></>}<div className="domain-setting-row"><div><strong>Automatické SSL</strong><small>Vystavit a obnovovat certifikát přes Let&apos;s Encrypt.</small></div><Toggle checked={domainSettings.automaticSsl} onChange={() => setDomainSettings((current) => current ? { ...current, automaticSsl: !current.automaticSsl } : current)} label="Automatické SSL" /></div><div className="domain-setting-row"><div><strong>Vynutit HTTPS</strong><small>Přesměrovat všechny HTTP požadavky na HTTPS.</small></div><Toggle checked={domainSettings.forceHttps} onChange={() => setDomainSettings((current) => current ? { ...current, forceHttps: !current.forceHttps } : current)} label="Vynutit HTTPS" /></div>{domainSettings.names.length > 1 && <div className="domain-setting-row"><div><strong>Přesměrovat www</strong><small>Směrovat www variantu na hlavní doménu.</small></div><Toggle checked={domainSettings.wwwRedirect} onChange={() => setDomainSettings((current) => current ? { ...current, wwwRedirect: !current.wwwRedirect } : current)} label="Přesměrovat www" /></div>}<div className="certificate-card"><span className="server-icon"><ShieldCheck size={17} /></span><div><strong>SSL certifikát</strong><small>{domainSettings.ssl === "Aktivní" ? `Aktivní pro ${domainSettings.names.length} ${domainSettings.names.length === 1 ? "hostname" : "hostnames"}` : "Čeká na ověření DNS"}</small></div><button type="button" onClick={renewCertificate}>Obnovit</button></div><div className="modal-actions"><button type="button" onClick={() => setDomainSettings(null)}>Zrušit</button><button type="submit" className="primary-button"><Check size={16} /> Uložit změny</button></div></form></div></div>}
      {domainForDeletion && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDomainToDelete(null)}><div className="modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" onMouseDown={(event) => event.stopPropagation()}><div className="modal-icon danger"><Trash2 size={21} /></div><button className="modal-close" onClick={() => setDomainToDelete(null)} aria-label="Zavřít"><X size={19} /></button><h2 id="delete-title">Odstranit doménu a aplikaci?</h2><p id="delete-description">Doména <strong>{domainForDeletion.names.join(" a ")}</strong>, její systemd služba, certifikát a data v <strong>/srv/apps/{domainForDeletion.key}</strong> budou trvale odstraněny.</p><div className="modal-actions"><button type="button" onClick={() => setDomainToDelete(null)}>Zrušit</button><button type="button" className="danger-button" onClick={deleteDomain}>Trvale odstranit</button></div></div></div>}
      {adminJob && <AdminJobProgress job={adminJob} onClose={() => setAdminJob(null)} />}
      {!adminJob && toast && <div className="toast" role="status" aria-live="polite"><Check size={17} /> {toast}</div>}
    </div>
  );
}