"use client";

import { Check, Circle, RefreshCw, X, XCircle } from "lucide-react";
import type { AdminJob, AdminJobRequest } from "@/lib/admin-job-types";

export async function runAdminJob(request: AdminJobRequest, onUpdate: (job: AdminJob) => void) {
  const response = await fetch("/api/admin-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const started = await response.json() as { id?: string; message?: string };
  if (!response.ok || !started.id) throw new Error(started.message ?? "Operaci se nepodařilo spustit.");

  for (let attempt = 0; attempt < 900; attempt += 1) {
    const statusResponse = await fetch(`/api/admin-jobs/${started.id}`, { cache: "no-store" });
    const job = await statusResponse.json() as AdminJob;
    if (!statusResponse.ok) {
      if (statusResponse.status >= 500 && attempt < 10) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        continue;
      }
      throw new Error(job.message || "Průběh operace není dostupný.");
    }
    onUpdate(job);
    if (job.status === "succeeded" || job.status === "failed") return job;
    await new Promise((resolve) => window.setTimeout(resolve, 800));
  }
  throw new Error("Operace překročila maximální dobu čekání.");
}

export default function AdminJobProgress({ job, onClose }: { job: AdminJob; onClose: () => void }) {
  const finished = job.status === "succeeded" || job.status === "failed";
  return <aside className="job-progress" role="status" aria-live="polite" aria-atomic="false">
    <div className="job-progress-header">
      <div><small>Systémová operace</small><strong>{job.title}</strong></div>
      {finished && <button type="button" onClick={onClose} aria-label="Zavřít průběh operace"><X size={16} /></button>}
    </div>
    <ol>
      {job.steps.map((step, index) => <li className={step.state} key={`${step.label}-${index}`}>
        {step.state === "done" ? <Check size={14} /> : step.state === "failed" ? <XCircle size={14} /> : <RefreshCw className="spin" size={14} />}
        <span>{step.label}</span>
      </li>)}
      {job.steps.length === 0 && <li className={job.status === "failed" ? "failed" : "running"}><Circle size={14} /><span>{job.status === "failed" ? "Operace se nespustila." : "Čekám na spuštění na serveru..."}</span></li>}
    </ol>
    {finished && <p className={job.status}>{job.message}</p>}
  </aside>;
}