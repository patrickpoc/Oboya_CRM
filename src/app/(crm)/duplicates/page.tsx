import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("duplicates");

export default function Page() {
  return <PlannedModulePage id="duplicates" />;
}
