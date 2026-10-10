import { Component, createRef, lazy, Suspense, useState, type ReactNode } from "react";
import type { LoopGraphViewProps } from "./LoopGraphView";
import { Button } from "@/shared/components/button";

type GraphModule = typeof import("./LoopGraphView");

const loadGraphModule = (): Promise<GraphModule> => import("./LoopGraphView");

// Error boundaries must be classes; this is the one semantic exception to arrow syntax.
class GraphErrorBoundary extends Component<
  { onRetry: () => void; onUseBoard: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  private alert = createRef<HTMLDivElement>();
  private retried = false;
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(_previous: unknown, previousState: { failed: boolean }) {
    // A failure after Retry is announced where the user just pressed: move focus to the new alert.
    if (this.state.failed && !previousState.failed && this.retried) this.alert.current?.focus();
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        ref={this.alert}
        role="alert"
        tabIndex={-1}
        className="m-6 rounded-lg border bg-card p-4 text-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        <p>
          The graph view could not be loaded. Your draft is unchanged. Retry may not help for a
          failed download; save the draft and reload the page.
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              this.retried = true;
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
// without the loading fallback. A rejected lazy component stays rejected, so a failed load evicts
// its own entry (and Retry replaces it): the next mount imports again instead of showing a stale error.
const views = new WeakMap<() => Promise<GraphModule>, GraphView>();

const viewFor = (load: () => Promise<GraphModule>): GraphView => {
  const existing = views.get(load);
  if (existing) return existing;
  const created: GraphView = lazy(() =>
    load().catch((error: unknown) => {
      if (views.get(load) === created) views.delete(load);
      throw error;
    }),
  );
  views.set(load, created);
  return created;
};

/** Loads the graph view as a separate chunk; a failed load can be retried or abandoned. */
export const LazyLoopGraphView = ({
  loop,
  apply,
  openDrawer,
  onUseBoard,
  onRetry,
  load = loadGraphModule,
}: LoopGraphViewProps & {
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
        <View loop={loop} apply={apply} openDrawer={openDrawer} />
      </Suspense>
    </GraphErrorBoundary>
  );
};
