"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Finance advisor folds into the unified pocket team (CFO mode). */
export default function AdvisorPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/team?specialist=cfo");
  }, [router]);

  return (
    <div className="flex h-40 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
