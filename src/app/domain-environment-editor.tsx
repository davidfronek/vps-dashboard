"use client";

import { KeyRound, Plus, Trash2 } from "lucide-react";
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

  async function saveVariable() {
    const key = name.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      setError("Název musí začínat písmenem nebo podtržítkem.");
      return;
    }
    if (!await request("POST", key, value)) return;
    setKeys((current) => [...new Set([...current, key])].sort((left, right) => left.localeCompare(right)));
    setName("");
    setValue("");
    onSaved(`Proměnná ${key} byla uložena`);
  }

  async function deleteVariable(key: string) {
    if (!await request("DELETE", key)) return;
    setKeys((current) => current.filter((item) => item !== key));
    onSaved(`Proměnná ${key} byla odstraněna`);
  }

  return <section className="environment-editor" aria-labelledby="environment-title">
    <div className="environment-heading"><span className="server-icon"><KeyRound size={16} /></span><div><strong id="environment-title">Proměnné prostředí</strong><small>Hodnoty zůstávají skryté a změna restartuje aplikaci.</small></div></div>
    {keys.length > 0 && <ul className="environment-list">{keys.map((key) => <li key={key}><code>{key}</code><span>Nastaveno</span><button type="button" disabled={busy} onClick={() => deleteVariable(key)} aria-label={`Odstranit proměnnou ${key}`} title="Odstranit"><Trash2 size={14} /></button></li>)}</ul>}
    <div className="environment-fields">
      <label htmlFor="environment-name">Název</label>
      <input id="environment-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="DATABASE_URL" autoComplete="off" />
      <label htmlFor="environment-value">Nová hodnota</label>
      <input id="environment-value" type="password" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="new-password" />
      <button type="button" className="environment-add" disabled={busy || !name.trim()} onClick={saveVariable} aria-label="Uložit proměnnou" title="Uložit"><Plus size={16} /></button>
    </div>
    {error && <p className="environment-error" role="alert">{error}</p>}
  </section>;
}
