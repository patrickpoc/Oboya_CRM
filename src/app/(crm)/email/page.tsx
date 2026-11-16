import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("email");

export default function Page() {
  return <PlannedModulePage id="email" />;
}
