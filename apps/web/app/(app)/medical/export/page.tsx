import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ExportBuilder } from "@/components/medical/ExportBuilder";
import { Button } from "@/components/ui/button";

export default function MedicalExportPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/medical">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Export Report</h1>
          <p className="mt-1 text-muted-foreground">Generate a PDF for your healthcare provider.</p>
        </div>
      </div>
      <ExportBuilder />
    </div>
  );
}
