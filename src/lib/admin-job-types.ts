export type AdminOperation =
  | "domain-upsert"
  | "domain-deploy"
  | "domain-renew"
  | "domain-delete"
  | "user-create"
  | "user-update"
  | "user-delete"
  | "database-create"
  | "database-delete";

export type AdminJobRequest = {
  operation: AdminOperation;
  arguments: string[];
};

export type AdminJobStep = {
  state: "done" | "running" | "failed";
  label: string;
};

export type AdminJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  title: string;
  message: string;
  steps: AdminJobStep[];
};