import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Role = "requester" | "admin" | "weekly-report";

interface Props {
  role: Role;
  onChange: (role: Role) => void;
}

export default function RoleSelector({ role, onChange }: Props) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-muted-foreground">Role</label>
      <Select value={role} onValueChange={(v) => onChange(v as Role)}>
        <SelectTrigger className="w-[220px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="requester">Requesting Teacher</SelectItem>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="weekly-report">Weekly Report</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
