import { useState, useCallback } from "react";
import RoleSelector from "@/components/RoleSelector";
import AdminSettingsPanel from "@/components/AdminSettings";
import NewJobForm from "@/components/NewJobForm";
import PrintQueue from "@/components/PrintQueue";
import WeeklyReport from "@/components/WeeklyReport";
import { loadJobs, loadSettings, AdminSettings } from "@/lib/store";
import { Printer } from "lucide-react";

type Role = "requester" | "admin" | "weekly-report";

export default function Index() {
  const [role, setRole] = useState<Role>("requester");
  const [settings, setSettings] = useState<AdminSettings>(loadSettings);
  const [jobs, setJobs] = useState(loadJobs);
  const [, setTick] = useState(0);

  const refresh = useCallback(() => {
    setJobs(loadJobs());
    setTick((t) => t + 1);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Printer className="h-6 w-6 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">Print Queue</h1>
          </div>
          <RoleSelector role={role} onChange={setRole} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {role === "admin" && (
          <AdminSettingsPanel settings={settings} onSettingsChange={setSettings} onJobsChange={refresh} />
        )}

        {role !== "weekly-report" && (
          <>
            <NewJobForm settings={settings} onJobCreated={refresh} />
            <PrintQueue jobs={jobs} priorityMode={settings.priorityMode} onJobsChange={refresh} />
          </>
        )}

        {role === "weekly-report" && <WeeklyReport jobs={jobs} />}
      </main>
    </div>
  );
}
