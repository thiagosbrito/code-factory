import { Card } from "@/shared/components/card";
import type { Screen } from "./FactorySidebar";

export const DemoPlaceholder = ({ screen }: { screen: Screen }) => (
  <Card className="mt-7 p-8">
    <h2 className="text-lg font-semibold">Sample {screen}</h2>
    <p className="mt-2 text-sm text-muted-foreground">
      Explore the layout without creating project history.
    </p>
  </Card>
);
