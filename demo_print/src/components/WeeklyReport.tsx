import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PrintJob, isThisWeek, downloadFile, today } from "@/lib/store";
import { CalendarDays, Download } from "lucide-react";

interface Props {
  jobs: PrintJob[];
}

function formatTime(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getDayName(ts: number) {
  return new Date(ts).toLocaleDateString([], { weekday: "long" });
}

export default function WeeklyReport({ jobs }: Props) {
  const weeklyJobs = jobs.filter((j) => j.status === "Completed" && isThisWeek(j.completedAt));

  const grouped: Record<string, PrintJob[]> = {};
  weeklyJobs.forEach((job) => {
    const day = getDayName(job.completedAt!);
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(job);
  });

  const perTeacher: Record<string, number> = {};
  weeklyJobs.forEach((j) => {
    perTeacher[j.teacher] = (perTeacher[j.teacher] || 0) + j.pages * j.copies;
  });

  const saveWeeklyReport = () => {
    let output = "WEEKLY PRINT REPORT (MON–FRI)\n\n";
    output += `Completed jobs: ${weeklyJobs.length}\n\n`;
    for (const t in perTeacher) output += ` - ${t}: ${perTeacher[t]} pages\n`;
    downloadFile(output, `weekly_report_${today()}.txt`);
  };

  const saveMonthlyJson = () => downloadFile(JSON.stringify(jobs, null, 2), `jobs_monthly_${today()}.json`, "application/json");
  const saveTenWeekJson = () => downloadFile(JSON.stringify(jobs, null, 2), `jobs_10week_${today()}.json`, "application/json");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={saveWeeklyReport}>
          <Download className="mr-1 h-3 w-3" /> Weekly Report
        </Button>
        <Button variant="outline" size="sm" onClick={saveMonthlyJson}>
          <Download className="mr-1 h-3 w-3" /> Monthly JSON
        </Button>
        <Button variant="outline" size="sm" onClick={saveTenWeekJson}>
          <Download className="mr-1 h-3 w-3" /> 10-Week JSON
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="h-5 w-5 text-primary" />
            Weekly Calendar View
          </CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(grouped).length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">No completed jobs this week</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped).map(([day, dayJobs]) => (
                <div key={day}>
                  <h3 className="mb-2 font-semibold text-sm text-primary">{day}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-4">Teacher</th>
                          <th className="pb-2 pr-4">Start</th>
                          <th className="pb-2 pr-4">End</th>
                          <th className="pb-2">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dayJobs.map((job) => (
                          <tr key={job.id} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">{job.teacher}</td>
                            <td className="py-2 pr-4">{formatTime(job.startedAt)}</td>
                            <td className="py-2 pr-4">{formatTime(job.completedAt)}</td>
                            <td className="py-2">{job.actualSeconds ?? "—"}s</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {Object.keys(perTeacher).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Weekly Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">Completed jobs: <strong className="text-foreground">{weeklyJobs.length}</strong></p>
              {Object.entries(perTeacher).map(([teacher, pages]) => (
                <p key={teacher}>{teacher}: <strong>{pages}</strong> pages</p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
