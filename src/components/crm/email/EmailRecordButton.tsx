"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/contexts/CrmContext";

/** Entry points from a customer record to the filtered history and a prefilled composer. */
export function EmailRecordButton({
  email,
  recordId,
  recordType,
}: {
  email: string;
  recordId: string;
  recordType: "contact" | "account";
}) {
  const t = useTranslations("email");
  const router = useRouter();
  const { can } = useCrm();
  const common = { recordId, recordType };
  const history = new URLSearchParams({ ...common, email, folder: "Sent" });
  const compose = new URLSearchParams({ ...common, to: email, compose: "1" });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="rounded-full border-oboya-blue text-oboya-blue"
        onClick={() => router.push(`/email?${history}`)}
      >
        <Mail className="size-4" /> {t("record.openHistory")}
      </Button>
      {can("email", "edit") ? (
        <Button
          size="sm"
          className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
          onClick={() => router.push(`/email?${compose}`)}
        >
          <Send className="size-4" /> {t("record.compose")}
        </Button>
      ) : null}
    </>
  );
}
