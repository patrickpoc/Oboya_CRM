import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("reports");

export default function Page() {
  return <PlannedModulePage id="reports" />;
}
