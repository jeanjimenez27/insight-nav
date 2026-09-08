import { Users } from "lucide-react";

export default function Home() {
  return (
    <div className="h-full grid place-items-center p-10">
      <div className="text-center max-w-md space-y-3">
        <div className="mx-auto h-12 w-12 rounded-lg bg-muted grid place-items-center">
          <Users className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Pick or create a client</h1>
        <p className="text-muted-foreground text-sm">
          Use the sidebar to add a new client, then upload a CSV or Excel file to generate an AI-powered business analysis.
        </p>
      </div>
    </div>
  );
}
