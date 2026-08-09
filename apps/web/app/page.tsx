"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { requireProfile } from "@/lib/session";

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    const profileId = requireProfile();
    router.replace(profileId ? "/dashboard/" : "/profiles/");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
