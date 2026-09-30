import { redirect } from "next/navigation";
import DatabaseEditorWindow from "./database-editor-window";
import { getSession } from "@/lib/auth";
import { getServerSnapshot } from "@/lib/server-data";

export default async function DatabaseEditorPage({ searchParams }: { searchParams: Promise<{ database?: string }> }) {
  if (!await getSession()) redirect("/login");

  const database = (await searchParams).database ?? "";
  const managedDatabase = getServerSnapshot().databases.find((item) => item.name === database && item.managed);
  if (!managedDatabase) redirect("/");

  return <DatabaseEditorWindow database={managedDatabase.name} />;
}