import { CrmShell } from "@/components/crm/layout/CrmShell";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const { user, permissions } = await requireCrmAuth();
  return (
    <CrmShell user={user} permissions={permissions()}>
      {children}
    </CrmShell>
  );
}
