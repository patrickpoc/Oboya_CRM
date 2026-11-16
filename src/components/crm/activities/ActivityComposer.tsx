"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApiErrorMessage } from "@/components/crm/record/api";
import type { CrmObject } from "@/lib/crm/objects/types";
import { cn } from "@/lib/utils";
import { TYPE_ICONS, createActivity, localInputToIso, type NewActivity } from "./activity-parts";

const TABS = ["task", "call", "meeting", "note"] as const;
type Tab = (typeof TABS)[number];

/**
 * Timeline composer: New Task / Log a Call / New Meeting / Note. Creates the
 * activity related to the record (what_object/what_id; who_contact_id on a
 * contact). Calls and notes are logged as done; tasks and meetings are open.
 */
export function ActivityComposer({
  object,
  recordId,
  onCreated,
}: {
  object: CrmObject;
  recordId: string;
  onCreated: () => void;
}) {
  const t = useTranslations("activities.composer");
  const errorMessage = useApiErrorMessage();
  const uid = useId();
  const [tab, setTab] = useState<Tab>("task");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const isNote = tab === "note";
  const hasDue = tab === "task" || tab === "meeting";
  const canSubmit = isNote ? body.trim() !== "" : subject.trim() !== "";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    const firstLine = body.trim().split("\n")[0].slice(0, 120);
    const values: NewActivity = {
      type: tab,
      subject: isNote ? firstLine || t("noteSubject") : subject.trim(),
      body: body.trim() || null,
      due_at: hasDue ? localInputToIso(due) : null,
      status: hasDue ? "open" : "done",
      priority: "normal",
      what_object: object,
      what_id: recordId,
      ...(object === "contact" ? { who_contact_id: recordId } : {}),
    };
    setBusy(true);
    try {
      await createActivity(values);
      toast.success(t(`created.${tab}`));
      setSubject("");
      setBody("");
      setDue("");
      onCreated();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-border/60 bg-oboya-soft-white/50 p-2">
      <div role="tablist" aria-label={t("label")} className="grid grid-cols-4 gap-1">
        {TABS.map((value) => {
          const Icon = TYPE_ICONS[value];
          const active = tab === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(value)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[11px] font-medium leading-tight transition-colors",
                active ? "bg-white text-oboya-blue shadow-sm ring-1 ring-border/70" : "text-muted-foreground hover:text-oboya-blue-dark"
              )}
            >
              <Icon className="size-3.5" />
              {t(`tabs.${value}`)}
            </button>
          );
        })}
      </div>
      {isNote ? null : (
        <div className="space-y-1">
          <Label htmlFor={`${uid}-subject`} className="sr-only">
            {t("subject")}
          </Label>
          <Input
            id={`${uid}-subject`}
            value={subject}
            maxLength={300}
            placeholder={t(`subjectPlaceholder.${tab}`)}
            onChange={(e) => setSubject(e.target.value)}
            className="bg-white"
          />
        </div>
      )}
      <Label htmlFor={`${uid}-body`} className="sr-only">
        {t("body")}
      </Label>
      <Textarea
        id={`${uid}-body`}
        value={body}
        rows={isNote ? 3 : 2}
        maxLength={10000}
        placeholder={t(isNote ? "notePlaceholder" : "bodyPlaceholder")}
        onChange={(e) => setBody(e.target.value)}
        className="bg-white"
      />
      <div className="flex flex-wrap items-end justify-between gap-2">
        {hasDue ? (
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={`${uid}-due`} className="text-[11px] text-muted-foreground">
              {t(tab === "meeting" ? "when" : "due")}
            </Label>
            <Input
              id={`${uid}-due`}
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="bg-white"
            />
          </div>
        ) : (
          <span />
        )}
        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit || busy}
          className="rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90"
        >
          {busy ? t("saving") : t(`submit.${tab}`)}
        </Button>
      </div>
    </form>
  );
}
