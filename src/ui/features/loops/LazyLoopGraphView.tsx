import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import type { LoopDefinition } from "../../../domain/loop.js";
import { Button } from "@/shared/components/button";

type GraphModule = typeof import("./LoopGraphView");

const loadGraphModule = (): Promise<GraphModule> => import("./LoopGraphView");

// Error boundaries must be classes; this is the one semantic exception to arrow syntax.
class GraphErrorBoundary extends Component<
  { onRetry: () => void; onUseBoard: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="m-6 rounded-lg border bg-card p-4 text-sm">
        <p>The graph view could not be loaded. Your draft is unchanged.</p>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              this.setState({ failed: false });
              this.props.onRetry();
            }}
          >
            Retry
          </Button>
          <Button variant="ghost" onClick={this.props.onUseBoard}>
            Use the Board
          </Button>
        </div>
      </div>
    );
  }
}

/** Loads the graph view as a separate chunk; a failed load can be retried or abandoned. */
export const LazyLoopGraphView = ({
  loop,
  onUseBoard,
  load = loadGraphModule,
}: {
  loop: LoopDefinition;
  onUseBoard: () => void;
  load?: () => Promise<GraphModule>;
}) => {
  // A rejected lazy component stays rejected, so each retry builds a fresh one.
  const [View, setView] = useState(() => lazy(load));
  return (
    <GraphErrorBoundary onRetry={() => setView(() => lazy(load))} onUseBoard={onUseBoard}>
      <Suspense
        fallback={
          <output className="block p-6 text-sm text-muted-foreground">Loading graph view…</output>
        }
      >
        <View loop={loop} />
      </Suspense>
    </GraphErrorBoundary>
  );
};
