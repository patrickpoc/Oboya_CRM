import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("campaigns");

export default function Page() {
  return <PlannedModulePage id="campaigns" />;
}
