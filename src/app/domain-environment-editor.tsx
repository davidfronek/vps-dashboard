"use client";

import { Check, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

type Props = {
  domain: string;
  initialKeys: string[];
  onSaved: (message: string) => void;
};

export default function DomainEnvironmentEditor({ domain, initialKeys, onSaved }: Props) {
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function request(method: "POST" | "DELETE", key: string, nextValue?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/domain-environment", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, key, value: nextValue }),
      });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? "Změnu se nepodařilo uložit.");
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Spojení se serverem selhalo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startEditing(key: string) {
    setEditing(key);
    setName(key);
    setValue("");
    setError("");
    document.getElementById("environment-value")?.focus();
  }

  function cancelEditing() {
    setEditing(null);
    setName("");
    setValue("");
    setError("");
  }

  async function saveVariable() {
    const key = (editing ?? name).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      setError("Název musí začínat písmenem nebo podtržítkem.");
      return;
    }
    if (editing && !value) {
      setError("Zadej novou hodnotu proměnné.");
      return;
    }
    if (!await request("POST", key, value)) return;
    setKeys((current) => [...new Set([...current, key])].sort((left, right) => left.localeCompare(right)));
    setEditing(null);
    setName("");
    setValue("");
    onSaved(`Proměnná ${key} byla ${editing ? "aktualizována" : "uložena"}`);
  }

  async function deleteVariable(key: string) {
    if (!await request("DELETE", key)) return;
    setKeys((current) => current.filter((item) => item !== key));
    if (editing === key) cancelEditing();
    onSaved(`Proměnná ${key} byla odstraněna`);
  }

  return <section className="environment-editor" aria-labelledby="environment-title">
    <div className="environment-heading"><span className="server-icon"><KeyRound size={16} /></span><div><strong id="environment-title">Proměnné prostředí</strong><small>Hodnoty zůstávají skryté a změna restartuje aplikaci.</small></div></div>
    {keys.length > 0 && <ul className="environment-list">{keys.map((key) => <li key={key} className={editing === key ? "editing" : undefined}><code>{key}</code><span>Nastaveno</span><div className="environment-actions"><button type="button" disabled={busy} onClick={() => startEditing(key)} aria-label={`Upravit proměnnou ${key}`} title="Upravit hodnotu"><Pencil size={14} /></button><button type="button" disabled={busy} onClick={() => deleteVariable(key)} aria-label={`Odstranit proměnnou ${key}`} title="Odstranit"><Trash2 size={14} /></button></div></li>)}</ul>}
    <form className="environment-fields" onSubmit={(event) => { event.preventDefault(); void saveVariable(); }}>
      <label className="environment-field" htmlFor="environment-name"><span>{editing ? "Upravovaná proměnná" : "Název"}{editing && <button type="button" className="environment-cancel" onClick={cancelEditing}><X size={11} /> Zrušit</button>}</span><input id="environment-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="DATABASE_URL" autoComplete="off" spellCheck={false} readOnly={editing !== null} /></label>
      <label className="environment-field" htmlFor="environment-value"><span>Nová hodnota</span><input id="environment-value" type="password" value={value} onChange={(event) => setValue(event.target.value)} placeholder="••••••••" autoComplete="new-password" /></label>
      <button type="submit" className="environment-add" disabled={busy || !(editing ?? name).trim()} aria-label={editing ? "Aktualizovat proměnnou" : "Uložit proměnnou"} title={editing ? "Aktualizovat" : "Uložit"}>{editing ? <Check size={16} /> : <Plus size={16} />}</button>
    </form>
    {error && <p className="environment-error" role="alert">{error}</p>}
  </section>;
}
