import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function FactoryEmptyState({
  kind,
  onCreate,
  onTemplate,
}: {
  kind: "runs" | "loops";
  onCreate: () => void;
  onTemplate: () => void;
}) {
  return (
    <Card className="mt-7 flex min-h-80 flex-col items-center justify-center border-dashed bg-white/60 px-6 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-xl bg-teal-50 text-2xl text-teal-700">
        {kind === "runs" ? "▷" : "∞"}
      </div>
      <h2 className="mt-4 text-xl font-semibold">
        {kind === "runs" ? "No runs yet" : "No user loops yet"}
      </h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        {kind === "runs"
          ? "Create a loop for this project or start from an optional template. Demo runs never enter your history."
          : "Create an empty loop or choose an optional starter template."}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={onCreate}>Create loop</Button>
        <Button variant="outline" onClick={onTemplate}>
          Use starter template
        </Button>
      </div>
    </Card>
  );
}
