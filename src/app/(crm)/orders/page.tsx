import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("orders");

export default function Page() {
  return <PlannedModulePage id="orders" />;
}
