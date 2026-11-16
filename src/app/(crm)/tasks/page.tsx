import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MyTasks } from "@/components/crm/activities/MyTasks";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { activityConfig } from "@/lib/crm/objects/activity";
import type { ListQuery } from "@/lib/crm/objects/types";
import { list } from "@/lib/crm/repositories/object-repository";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("activities.myTasks");
  return { title: t("title") };
}

const base: ListQuery = { view: "mine", q: "", filters: {}, sort: "due_at", dir: "asc", page: 0, pageSize: 500 };

/**
 * My tasks: the current user's open tasks and recently completed ones. The
 * sections (overdue / today / …) are computed in the browser with the
 * viewer's timezone (lib/crm/activities/due.ts).
 */
export default async function TasksPage() {
  const { supabase, user, can } = await requireCrmAuth();
  if (!can(activityConfig.module, "view")) return <AccessDenied />;
  const ctx = { userId: user.id };

  const [open, done] = await Promise.all([
    list(supabase, activityConfig, { ...base, filters: { type: ["task"], status: ["open"] } }, ctx),
    list(
      supabase,
      activityConfig,
      { ...base, filters: { type: ["task"], status: ["done"] }, sort: "completed_at", dir: "desc", pageSize: 100 },
      ctx
    ),
  ]).catch((error) => {
    console.error("my tasks failed:", error);
    return [null, null] as const;
  });

  return <MyTasks open={open?.rows ?? null} done={done?.rows ?? []} />;
}
