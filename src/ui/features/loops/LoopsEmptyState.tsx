import { Button } from "@/shared/components/button";
import { Card } from "@/shared/components/card";

export const LoopsEmptyState = ({ onCreate }: { onCreate: () => void }) => (
  <Card className="mt-6 flex min-h-72 flex-col items-center justify-center border-dashed bg-card/60 p-8 text-center">
    <div className="text-4xl text-teal-700">∞</div>
    <h3 className="mt-3 text-xl font-semibold">No user loops yet</h3>
    <p className="mt-2 max-w-md text-sm text-muted-foreground">
      Create an empty draft, choose a starter, or import a canonical loop document.
    </p>
    <Button className="mt-4" onClick={onCreate}>
      Create empty loop
    </Button>
  </Card>
);
