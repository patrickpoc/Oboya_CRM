import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("ai-assistant");

export default function Page() {
  return <PlannedModulePage id="ai-assistant" />;
}
