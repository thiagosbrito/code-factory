import { useId, useState, type RefObject } from "react";
import type { RunWorkspace } from "../../../../domain/run-branch.js";
import { Button } from "@/shared/components/button";

type Checkout = NonNullable<RunWorkspace["checkout"]>;

/** Switch the project checkout back to the branch an in-project run started from. */
export const ReturnToBranchAction = ({
  checkout,
  previous,
  connected,
  busy,
  headingRef,
  onReturn,
  announce,
}: {
  checkout: Checkout;
  previous: string;
  connected: boolean;
  busy: boolean;
  headingRef: RefObject<HTMLElement | null>;
  onReturn: () => Promise<string | null>;
  announce: (message: string) => void;
}) => {
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState("");
  const helpId = useId();
  return (
    <div>
      <Button
        variant="outline"
        disabled={Boolean(checkout.returnBlocker) || !connected || busy || returning}
        aria-describedby={checkout.returnBlocker || error ? helpId : undefined}
        onClick={() => {
          setReturning(true);
          setError("");
          void onReturn().then((failure) => {
            setReturning(false);
            if (failure) setError(failure);
            else {
              announce(`Switched the project back to ${previous}.`);
              // The button unmounts once the checkout leaves the run branch.
              headingRef.current?.focus();
            }
          });
        }}
      >
        {returning ? "Switching…" : `Back to ${previous}`}
      </Button>
      {(error || checkout.returnBlocker) && (
        <p
          id={helpId}
          role={error ? "alert" : undefined}
          className={`mt-1 text-xs ${error ? "text-red-700" : "text-muted-foreground"}`}
        >
          {error || checkout.returnBlocker}
        </p>
      )}
    </div>
  );
};
