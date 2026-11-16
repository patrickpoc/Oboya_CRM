import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("integrations");

export default function Page() {
  return <PlannedModulePage id="integrations" />;
}
