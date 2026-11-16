import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("quotes");

export default function Page() {
  return <PlannedModulePage id="quotes" />;
}
