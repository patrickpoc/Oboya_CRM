import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";

/**
 * Clears app_metadata.must_change_password after the user changed their
 * password. app_metadata is only writable with the service role.
 */
export async function clearMustChangePassword(userId: string): Promise<void> {
  const admin = createServiceClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) throw new Error("Auth user not found");
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...data.user.app_metadata, must_change_password: false },
  });
  if (updateError) throw new Error(updateError.message);
}
