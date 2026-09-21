import { Cloud, KeyRound, LockKeyhole, Server } from "lucide-react";
import { redirect } from "next/navigation";
import { login } from "../auth-actions";
import { getSession, isAuthConfigured } from "@/lib/auth";

const errorMessages: Record<string, string> = {
  invalid: "Přihlašovací údaje nejsou správné.",
  "rate-limit": "Příliš mnoho pokusů. Zkuste to znovu za 15 minut.",
  configuration: "Přihlášení není nakonfigurováno na serveru.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  if (await getSession()) redirect("/");

  const { error } = await searchParams;
  const message = typeof error === "string" ? errorMessages[error] : undefined;
  const configured = isAuthConfigured();

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand"><span><Cloud size={21} /></span> Správa VPS</div>
        <div className="login-server"><span><Server size={18} /></span><div><strong>Produkční server</strong><small>46.28.108.112</small></div></div>
        <div className="login-heading"><span><LockKeyhole size={20} /></span><h1 id="login-title">Přihlášení do správy</h1><p>Zadejte účet správce serveru.</p></div>
        {message && <p className="login-error" role="alert">{message}</p>}
        {!configured && <p className="login-error" role="alert">Nastavte proměnné <code>ADMIN_USERNAME</code>, <code>ADMIN_PASSWORD_HASH</code> a <code>AUTH_SECRET</code>.</p>}
        <form action={login} className="login-form">
          <label htmlFor="login-username">Uživatelské jméno</label>
          <input id="login-username" name="username" autoComplete="username" autoCapitalize="none" required disabled={!configured} />
          <label htmlFor="login-password">Heslo</label>
          <div className="login-password"><KeyRound size={17} /><input id="login-password" name="password" type="password" autoComplete="current-password" required disabled={!configured} /></div>
          <button type="submit" disabled={!configured}>Přihlásit se</button>
        </form>
        <p className="login-security"><LockKeyhole size={13} aria-hidden="true" /> Relace je chráněná a automaticky vyprší za 8 hodin.</p>
      </section>
    </main>
  );
}