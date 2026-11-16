import { PlannedModulePage, plannedModuleMetadata } from "@/components/crm/roadmap/PlannedModulePage";

export const generateMetadata = () => plannedModuleMetadata("products");

export default function Page() {
  return <PlannedModulePage id="products" />;
}
