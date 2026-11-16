import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("automation");

export default function Page() {
  return <PlannedModulePage id="automation" />;
}
