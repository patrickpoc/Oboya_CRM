"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/contexts/CrmContext";

/** Record-page shortcut that opens the case list with a prefilled new-case drawer. */
export function CaseRecordButton({
  recordId,
  recordType,
}: {
  recordId: string;
  recordType: "contact" | "account";
}) {
  const t = useTranslations("cases");
  const router = useRouter();
  const { can } = useCrm();
  if (!can("cases", "create")) return null;
  const params = new URLSearchParams({
    create: "1",
    [recordType === "account" ? "accountId" : "contactId"]: recordId,
  });
  return (
    <Button
      size="sm"
      variant="outline"
      className="rounded-full border-oboya-blue text-oboya-blue"
      onClick={() => router.push(`/cases?${params}`)}
    >
      <LifeBuoy className="size-4" /> {t("record.create")}
    </Button>
  );
}
