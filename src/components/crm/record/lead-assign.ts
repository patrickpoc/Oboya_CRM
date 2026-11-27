import { toast } from "sonner";
import { apiFetch } from "./api";

/**
 * After the rules moved a lead to `ownerId`: when that is not the viewer, check the
 * lead is still visible (RLS). Returns true when the viewer lost access, after
 * toasting who owns it; the caller then navigates to /leads instead of the record.
 */
export async function lostAccessAfterAssign(
  leadId: string,
  ownerId: string,
  viewerId: string,
  ownerName: string | undefined,
  message: (name: string | undefined) => string
): Promise<boolean> {
  if (ownerId === viewerId) return false;
  try {
    await apiFetch(`/api/crm/objects/lead/${leadId}`, { quiet: true });
    return false;
  } catch (error) {
    if ((error as { status?: number }).status !== 404) return false;
    toast.info(message(ownerName));
    return true;
  }
}
