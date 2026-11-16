import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("approvals");

export default function Page() {
  return <PlannedModulePage id="approvals" />;
}
