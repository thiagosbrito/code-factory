import { useState } from "react";
import { Button } from "@/components/ui/button";

type ConnectionState = { status: "idle" | "checking" | "ready" | "failed"; message: string };

/** Temporary connection shell; approved Figma screens will replace this composition. */
export function App() {
  const [connection, setConnection] = useState<ConnectionState>({
    status: "idle",
    message: "The foundation is ready for the final prototype.",
  });
  async function checkRuntime() {
    setConnection({ status: "checking", message: "Checking local runtime…" });
    try {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error("Runtime request failed.");
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        !("status" in result) ||
        result.status !== "ready"
      )
        throw new Error("Unexpected runtime response.");
      setConnection({
        status: "ready",
        message: "Local runtime connected. Agent execution is not configured yet.",
      });
    } catch {
      setConnection({
        status: "failed",
        message: "Cannot reach the local runtime. Start it with pnpm dev.",
      });
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">Local coding factory</p>
        <h1 className="text-3xl font-semibold tracking-tight">Code Factory</h1>
      </div>
      <p className="text-muted-foreground">
        Your project starts with no loops, selected agent, or model. Setup and the loop editor will
        follow the approved prototype.
      </p>
      <output className="text-sm">{connection.message}</output>
      <Button
        className="w-fit"
        onClick={() => void checkRuntime()}
        disabled={connection.status === "checking"}
      >
        Check local runtime
      </Button>
    </main>
  );
}
