import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("data-import");

export default function Page() {
  return <PlannedModulePage id="data-import" />;
}
