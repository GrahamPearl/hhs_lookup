import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminSettings, createJob } from "@/lib/store";
import { Printer } from "lucide-react";

interface Props {
  settings: AdminSettings;
  onJobCreated: () => void;
}

export default function NewJobForm({ settings, onJobCreated }: Props) {
  const [teacher, setTeacher] = useState("");
  const [pages, setPages] = useState(0);
  const [copies, setCopies] = useState(1);
  const [printType, setPrintType] = useState<"normal" | "twoinone">("normal");
  const [sides, setSides] = useState<"single" | "double">("single");
  const [scheduledFor, setScheduledFor] = useState("");

  const effectivePages = (() => {
    let p = pages;
    if (printType === "twoinone") p = Math.ceil(p / 2);
    if (sides === "double") p = Math.ceil(p / 2);
    return p * copies;
  })();

  const estimatedSeconds = settings.loadTime + settings.checkTime + effectivePages * settings.timePerPage;

  const handleSubmit = () => {
    if (!teacher) return;
    createJob({
      teacher,
      pages,
      copies,
      printType,
      sides,
      scheduledFor: scheduledFor ? new Date(scheduledFor).getTime() : null,
      estimatedSeconds,
    });
    setPages(0);
    setCopies(1);
    setScheduledFor("");
    onJobCreated();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Printer className="h-5 w-5 text-primary" />
          New Print Request
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium">Requesting teacher</label>
          {settings.teachers.length > 0 ? (
            <Select value={teacher} onValueChange={setTeacher}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select teacher" />
              </SelectTrigger>
              <SelectContent>
                {settings.teachers.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input placeholder="Enter teacher name" value={teacher} onChange={(e) => setTeacher(e.target.value)} className="mt-1" />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Original pages</label>
            <Input type="number" value={pages || ""} onChange={(e) => setPages(Number(e.target.value))} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Copies</label>
            <Input type="number" value={copies} onChange={(e) => setCopies(Number(e.target.value))} className="mt-1" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Print type</label>
            <Select value={printType} onValueChange={(v) => setPrintType(v as "normal" | "twoinone")}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="twoinone">Two-in-One</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Sides</label>
            <Select value={sides} onValueChange={(v) => setSides(v as "single" | "double")}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single-sided</SelectItem>
                <SelectItem value="double">Double-sided</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Required by</label>
          <Input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} className="mt-1" />
        </div>

        <div className="rounded-md bg-accent/50 px-3 py-2 text-sm">
          Effective pages: <strong>{effectivePages}</strong> · Estimated: <strong>{estimatedSeconds}s</strong>
        </div>

        <Button className="w-full" onClick={handleSubmit} disabled={!teacher || pages <= 0}>
          Queue Print Job
        </Button>
      </CardContent>
    </Card>
  );
}
