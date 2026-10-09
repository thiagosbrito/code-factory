import { starterTemplates, type StarterId } from "../../../domain/starter-templates.js";
import { Button } from "@/shared/components/button";
import { Card } from "@/shared/components/card";

export const StarterPicker = ({ onChoose }: { onChoose: (starter: StarterId) => void }) => (
  <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Starter templates">
    {starterTemplates.map((starter) => (
      <Card key={starter.id} className="p-4">
        <h3 className="font-semibold">{starter.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{starter.description}</p>
        <Button className="mt-3" onClick={() => onChoose(starter.id)}>
          Create draft
        </Button>
      </Card>
    ))}
  </div>
);
