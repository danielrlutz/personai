"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";

interface ApiLoadErrorProps {
  message?: string;
  onRetry?: () => void;
}

export function ApiLoadError({ message = "Request failed", onRetry }: ApiLoadErrorProps) {
  return (
    <EmptyState
      icon={AlertCircle}
      title="Couldn't load data"
      description={message}
      className="py-10"
      action={
        onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    />
  );
}
