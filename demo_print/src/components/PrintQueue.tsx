import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrintJob, sortJobs, updateJob } from "@/lib/store";
import { ListOrdered, Play, CheckCircle2, Clock } from "lucide-react";

interface Props {
  jobs: PrintJob[];
  priorityMode: string;
  onJobsChange: () => void;
}

function statusBadge(status: PrintJob["status"]) {
  switch (status) {
    case "Queued":
      return <Badge variant="secondary" className="text-xs">Queued</Badge>;
    case "In process":
      return <Badge className="bg-in-progress text-in-progress-foreground text-xs">In Progress</Badge>;
    case "Completed":
      return <Badge className="bg-success text-success-foreground text-xs">Completed</Badge>;
  }
}

export default function PrintQueue({ jobs, priorityMode, onJobsChange }: Props) {
  const sorted = sortJobs(jobs, priorityMode);

  const startJob = (id: number) => {
    updateJob(id, { status: "In process", startedAt: Date.now() });
    onJobsChange();
  };

  const completeJob = (id: number) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    const completedAt = Date.now();
    updateJob(id, {
      status: "Completed",
      completedAt,
      actualSeconds: job.startedAt ? Math.round((completedAt - job.startedAt) / 1000) : null,
    });
    onJobsChange();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListOrdered className="h-5 w-5 text-primary" />
          Print Queue
          <Badge variant="outline" className="ml-auto">{sorted.length} jobs</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">No jobs in the queue</p>
        ) : (
          <div className="space-y-2">
            {sorted.map((job) => (
              <div key={job.id} className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/30">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{job.teacher}</span>
                    {statusBadge(job.status)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{job.pages * job.copies} pages</span>
                    {job.scheduledFor && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(job.scheduledFor).toLocaleString()}
                      </span>
                    )}
                    <span>Est: {job.estimatedSeconds}s</span>
                    {job.actualSeconds != null && <span>Actual: {job.actualSeconds}s</span>}
                  </div>
                </div>
                <div className="ml-3 shrink-0">
                  {job.status === "Queued" && (
                    <Button size="sm" onClick={() => startJob(job.id)}>
                      <Play className="mr-1 h-3 w-3" /> Start
                    </Button>
                  )}
                  {job.status === "In process" && (
                    <Button size="sm" variant="outline" className="border-success text-success" onClick={() => completeJob(job.id)}>
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Complete
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
