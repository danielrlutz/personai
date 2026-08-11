"use client";

import { useEffect, useState } from "react";
import { Briefcase } from "lucide-react";
import { apiGet, apiPostBlob, apiUpload, type PendingConfirmation } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProfileNameLimits } from "@/lib/use-profile-name-limits";
import { validateProfileNameClient } from "@/lib/profile-name-limits";

type ArchiveBlobOption = {
  path: string;
  size: number;
  name: string;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Export / import a password-sealed .pao suitcase (new profile on import confirm). */
export function SealedSuitcaseCard() {
  const nameLimits = useProfileNameLimits();
  const [exportPassword, setExportPassword] = useState("");
  const [exportConfirm, setExportConfirm] = useState("");
  const [includeArchive, setIncludeArchive] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [importName, setImportName] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

  const [blobCount, setBlobCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<{ blobs: ArchiveBlobOption[] }>("/suitcase/archive-blobs", {
          silent: true,
        });
        if (!cancelled) setBlobCount(data.blobs.length);
      } catch {
        if (!cancelled) setBlobCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runExport = async () => {
    if (exportPassword.length < 8) {
      setExportNote("Export password must be at least 8 characters.");
      return;
    }
    if (exportPassword !== exportConfirm) {
      setExportNote("Export passwords do not match.");
      return;
    }
    setExportBusy(true);
    setExportNote(null);
    try {
      const { blob, filename } = await apiPostBlob("/suitcase/export", {
        password: exportPassword,
        includeArchive,
      });
      downloadBlob(blob, filename || "profile.pao");
      setExportPassword("");
      setExportConfirm("");
      setExportNote(
        includeArchive
          ? "Sealed suitcase downloaded (database + local archive)."
          : "Sealed suitcase downloaded (database only).",
      );
    } catch (err) {
      setExportNote(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  };

  const runImport = async () => {
    if (!importFile) {
      setImportNote("Choose a .pao suitcase file first.");
      return;
    }
    if (importPassword.length < 8) {
      setImportNote("Suitcase password must be at least 8 characters.");
      return;
    }
    if (importName.trim()) {
      const nameError = validateProfileNameClient(importName, nameLimits);
      if (nameError) {
        setImportNote(nameError);
        return;
      }
    }
    setImportBusy(true);
    setImportNote(null);
    try {
      const form = new FormData();
      form.append("file", importFile);
      form.append("password", importPassword);
      if (importName.trim()) form.append("profileName", importName.trim());
      const result = await apiUpload<{
        staged: { stagingId: string; profileName: string; fileCount: number };
        confirmation: PendingConfirmation;
      }>("/suitcase/import", form);
      setImportFile(null);
      setImportPassword("");
      setImportName("");
      setImportNote(
        `Staged "${result.staged.profileName}" (${result.staged.fileCount} files). Approve the confirm gate to create a new sealed profile — your current session stays put.`,
      );
    } catch (err) {
      setImportNote(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Briefcase className="h-4 w-4 text-primary" />
          Sealed suitcase
        </CardTitle>
        <CardDescription>
          Export this unlocked profile as a password-sealed <code>.pao</code> file, or import a
          suitcase into a <strong>new</strong> sealed profile (confirm gate; session does not switch).
          {blobCount != null ? ` Local archive files available: ${blobCount}.` : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-medium">Export</p>
          <Input
            type="password"
            autoComplete="new-password"
            value={exportPassword}
            onChange={(e) => setExportPassword(e.target.value)}
            placeholder="Export password (min 8)"
          />
          <Input
            type="password"
            autoComplete="new-password"
            value={exportConfirm}
            onChange={(e) => setExportConfirm(e.target.value)}
            placeholder="Confirm export password"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={includeArchive}
              onChange={(e) => setIncludeArchive(e.target.checked)}
              className="rounded border"
            />
            Include local archive files (max 400 MiB / 5000 files)
          </label>
          <Button type="button" onClick={runExport} disabled={exportBusy}>
            {exportBusy ? "Sealing..." : "Download sealed suitcase"}
          </Button>
          {exportNote ? <p className="text-sm text-muted-foreground">{exportNote}</p> : null}
        </div>

        <div className="space-y-3 border-t border-border/60 pt-4">
          <p className="text-sm font-medium">Import</p>
          <Input
            type="file"
            accept=".pao,application/octet-stream"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
          />
          <Input
            type="password"
            autoComplete="off"
            value={importPassword}
            onChange={(e) => setImportPassword(e.target.value)}
            placeholder="Suitcase password"
          />
          <Input
            type="text"
            value={importName}
            onChange={(e) => setImportName(e.target.value.slice(0, nameLimits.maxLength))}
            placeholder="New profile name (optional)"
            maxLength={nameLimits.maxLength}
          />
          <Button type="button" variant="secondary" onClick={runImport} disabled={importBusy}>
            {importBusy ? "Staging..." : "Stage import (confirm next)"}
          </Button>
          {importNote ? <p className="text-sm text-muted-foreground">{importNote}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
