import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminSettings as Settings, loadJobs, saveSettings, clearAllJobs, downloadFile, today, createJob } from "@/lib/store";
import { Upload, Trash2, Download, Settings as SettingsIcon } from "lucide-react";

interface Props {
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
  onJobsChange: () => void;
}

export default function AdminSettingsPanel({ settings, onSettingsChange, onJobsChange }: Props) {
  const teacherFileRef = useRef<HTMLInputElement>(null);
  const todoFileRef = useRef<HTMLInputElement>(null);

  const update = (partial: Partial<Settings>) => {
    const next = { ...settings, ...partial };
    saveSettings(next);
    onSettingsChange(next);
  };

  const handleTeacherFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const teachers = (reader.result as string).split(/\r?\n/).filter(Boolean);
      update({ teachers });
    };
    reader.readAsText(file);
  };

  const handleTodoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      (reader.result as string)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => {
          try {
            const data = JSON.parse(line);
            const pages = data.pages ?? data.originalPages ?? data.totalPrintedPages ?? 0;
            const copies = data.copies ?? 1;
            createJob({
              teacher: data.teacher || "Unknown",
              pages: Number(pages),
              copies: Number(copies),
              printType: data.printType || "normal",
              sides: data.sides || "single",
              scheduledFor: data.scheduledFor ? new Date(data.scheduledFor).getTime() : null,
              estimatedSeconds: data.estimatedSeconds || 0,
              status: data.status,
              requestedAt: data.requestedAt ? new Date(data.requestedAt).getTime() : undefined,
              startedAt: data.startedAt ? new Date(data.startedAt).getTime() : null,
              completedAt: data.completedAt ? new Date(data.completedAt).getTime() : null,
              actualSeconds: data.actualSeconds ?? null,
            });
          } catch {}
        });
      onJobsChange();
    };
    reader.readAsText(file);
  };

  const saveTodo = () => {
    const jobs = loadJobs().filter((j) => j.status !== "Completed");
    downloadFile(jobs.map((j) => JSON.stringify(j)).join("\n"), `todo_${today()}.txt`);
  };

  const saveCompleted = () => {
    const jobs = loadJobs().filter((j) => j.status === "Completed");
    downloadFile(jobs.map((j) => JSON.stringify(j)).join("\n"), `completed_${today()}.txt`);
  };

  const handleClearQueue = () => {
    clearAllJobs();
    onJobsChange();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <SettingsIcon className="h-5 w-5 text-primary" />
          Admin Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Load teacher list (.txt)</label>
            <input ref={teacherFileRef} type="file" accept=".txt" onChange={handleTeacherFile} className="hidden" />
            <Button variant="outline" className="mt-1 w-full" onClick={() => teacherFileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Upload Teachers
            </Button>
          </div>
          <div>
            <label className="text-sm font-medium">Load unfinished jobs (.txt)</label>
            <input ref={todoFileRef} type="file" accept=".txt" onChange={handleTodoFile} className="hidden" />
            <Button variant="outline" className="mt-1 w-full" onClick={() => todoFileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Import Jobs
            </Button>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Queue prioritisation</label>
          <Select value={settings.priorityMode} onValueChange={(v) => update({ priorityMode: v as Settings["priorityMode"] })}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fifo">First-in, first-out</SelectItem>
              <SelectItem value="due">Earliest due time</SelectItem>
              <SelectItem value="size">Smallest job first</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-medium">Time/page (s)</label>
            <Input type="number" value={settings.timePerPage} onChange={(e) => update({ timePerPage: Number(e.target.value) })} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Load time (s)</label>
            <Input type="number" value={settings.loadTime} onChange={(e) => update({ loadTime: Number(e.target.value) })} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Check time (s)</label>
            <Input type="number" value={settings.checkTime} onChange={(e) => update({ checkTime: Number(e.target.value) })} className="mt-1" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={saveTodo}>
            <Download className="mr-1 h-3 w-3" /> Save Unfinished
          </Button>
          <Button variant="outline" size="sm" onClick={saveCompleted}>
            <Download className="mr-1 h-3 w-3" /> Save Completed
          </Button>
          <Button variant="destructive" size="sm" onClick={handleClearQueue}>
            <Trash2 className="mr-1 h-3 w-3" /> Clear Queue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
