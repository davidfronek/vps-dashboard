"use client";

import DatabaseBrowser from "../database-browser";

export default function DatabaseEditorWindow({ database }: { database: string }) {
  return <DatabaseBrowser database={database} onClose={() => window.close()} />;
}