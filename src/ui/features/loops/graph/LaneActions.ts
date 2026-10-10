import { createContext, useContext } from "react";
import type { Stage } from "../loop-editor-model";

/** What a lane header can do; provided by the Graph view because lane nodes carry only display data. */
export type LaneActions = { addStep: (stage: Stage) => void };

const LaneActionsContext = createContext<LaneActions | null>(null);

export const LaneActionsProvider = LaneActionsContext.Provider;
export const useLaneActions = (): LaneActions | null => useContext(LaneActionsContext);
