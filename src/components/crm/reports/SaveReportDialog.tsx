"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/components/crm/common/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  REPORTS_API,
  type FolderDto,
  type FolderListResponse,
  type ReportCreateRequest,
  type ReportResponse,
} from "@/lib/crm/reports/api-contract";
import type { ReportDefinition } from "@/lib/crm/reports/definition";

export type SavedReportMeta = { id: string; name: string; description: string; folderId: string | null };

const fieldClass = "h-9 w-full rounded-md border border-input bg-white px-2 text-sm text-oboya-blue-dark";

/** Name, folder and description. Save updates the open report; Save as new always creates one. */
export function SaveReportDialog({
  open,
  onOpenChange,
  definition,
  report,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: ReportDefinition;
  report: SavedReportMeta | null;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("reports.builder.save");
  const [name, setName] = useState(report?.name ?? "");
  const [description, setDescription] = useState(report?.description ?? "");
  const [folderId, setFolderId] = useState(report?.folderId ?? "");
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    apiFetch<FolderListResponse>(REPORTS_API.folders, { signal: controller.signal, quiet: true })
      .then((r) => setFolders(r.folders.filter((f) => f.canEdit || f.id === report?.folderId)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [open, report?.folderId]);

  const save = async (asNew: boolean) => {
    if (!name.trim()) return setError(t("nameRequired"));
    setBusy(true);
    setError(null);
    const body: ReportCreateRequest = { name: name.trim(), description: description.trim(), folderId: folderId || null, definition };
    try {
      const update = report && !asNew;
      const res = await apiFetch<ReportResponse>(update ? REPORTS_API.report(report.id) : REPORTS_API.reports, {
        method: update ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      onSaved(res.report.id);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? t("forbidden") : t("failed"));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription className="sr-only">{t("title")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="report-name">{t("name")}</Label>
            <Input id="report-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(error) || undefined} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-folder">{t("folder")}</Label>
            <select id="report-folder" className={fieldClass} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">{t("noFolder")}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-description">{t("description")}</Label>
            <Textarea id="report-description" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-oboya-orange">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" className="rounded-full" disabled={busy} onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            {report ? (
              <Button type="button" variant="outline" className="rounded-full" disabled={busy} onClick={() => void save(true)}>
                {t("saveAs")}
              </Button>
            ) : null}
            <Button type="submit" className="rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90" disabled={busy}>
              {busy ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
