import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("forecasting");

export default function Page() {
  return <PlannedModulePage id="forecasting" />;
}
