import { AdvisorChat } from "@/components/advisor/AdvisorChat";

export default function AdvisorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Finance Advisor</h1>
        <p className="mt-1 text-muted-foreground">
          AI-powered CFO and counsel for Swiss freelancers.
        </p>
      </div>
      <AdvisorChat />
    </div>
  );
}
