import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("cases");

export default function Page() {
  return <PlannedModulePage id="cases" />;
}
