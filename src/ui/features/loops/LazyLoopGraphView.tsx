import {
  Component,
  createRef,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LoopGraphViewProps } from "./LoopGraphView";
import { Button } from "@/shared/components/button";

type GraphModule = typeof import("./LoopGraphView");

const loadGraphModule = (): Promise<GraphModule> => import("./LoopGraphView");

// Error boundaries must be classes; this is the one semantic exception to arrow syntax.
class GraphErrorBoundary extends Component<
  {
    onRetry: () => void;
    onUseBoard: () => void;
    /** True once, if the failure now shown follows a Retry press. */
    consumeRetry: () => boolean;
    children: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };
  private alert = createRef<HTMLDivElement>();
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(_previous: unknown, previousState: { failed: boolean }) {
    // A failure after Retry is announced where the user just pressed: move focus to the new alert.
    if (this.state.failed && !previousState.failed && this.props.consumeRetry())
      this.alert.current?.focus();
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
          The graph view could not be loaded. Your draft is unchanged. Try again; if it keeps
          failing, save the draft and reload the page.
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

/** Mounts only once everything in its Suspense boundary, the graph view included, has loaded. */
const Loaded = ({ onLoaded }: { onLoaded: () => void }) => {
  useEffect(onLoaded, [onLoaded]);
  return null;
};

/** Loads the graph view as a separate chunk; a failed load can be retried or abandoned. */
export const LazyLoopGraphView = ({
  loop,
  apply,
  openDrawer,
  stepFacts,
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
  // Set by Retry, cleared when a failure uses it or the view has actually loaded, so a later
  // unrelated render error never takes focus.
  const retrying = useRef(false);
  return (
    <GraphErrorBoundary
      onRetry={() => {
        views.delete(load);
        retrying.current = true;
        setView(() => viewFor(load));
        onRetry?.();
      }}
      consumeRetry={() => {
        const pending = retrying.current;
        retrying.current = false;
        return pending;
      }}
      onUseBoard={onUseBoard}
    >
      <Suspense
        fallback={
          <output className="block p-6 text-sm text-muted-foreground">Loading graph view…</output>
        }
      >
        <View
          loop={loop}
          apply={apply}
          openDrawer={openDrawer}
          {...(stepFacts ? { stepFacts } : {})}
        />
        <Loaded
          onLoaded={() => {
            retrying.current = false;
          }}
        />
      </Suspense>
    </GraphErrorBoundary>
  );
};
