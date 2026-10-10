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
        <p>
          The graph view could not be loaded. Your draft is unchanged. If Retry keeps failing, save
          the draft and reload the page.
        </p>
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

type GraphView = ReturnType<typeof lazy<GraphModule["default"]>>;

// One lazy component per loader, kept across Board/Graph toggles so a loaded view renders
// without the loading fallback. Only a retry after a failure replaces it, because a rejected
// lazy component stays rejected.
const views = new WeakMap<() => Promise<GraphModule>, GraphView>();

const viewFor = (load: () => Promise<GraphModule>): GraphView => {
  const existing = views.get(load);
  if (existing) return existing;
  const created = lazy(load);
  views.set(load, created);
  return created;
};

/** Loads the graph view as a separate chunk; a failed load can be retried or abandoned. */
export const LazyLoopGraphView = ({
  loop,
  onUseBoard,
  onRetry,
  load = loadGraphModule,
}: {
  loop: LoopDefinition;
  onUseBoard: () => void;
  /** Called synchronously when Retry is pressed, so the caller can place focus. */
  onRetry?: () => void;
  load?: () => Promise<GraphModule>;
}) => {
  const [View, setView] = useState(() => viewFor(load));
  return (
    <GraphErrorBoundary
      onRetry={() => {
        views.delete(load);
        setView(() => viewFor(load));
        onRetry?.();
      }}
      onUseBoard={onUseBoard}
    >
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
