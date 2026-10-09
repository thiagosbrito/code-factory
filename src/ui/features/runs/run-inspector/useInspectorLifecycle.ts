import { useEffect, type RefObject } from "react";
import type { RunScope } from "../run-view-model";

/**
 * Focus the close button on open, close on Escape unless the retry dialog is open, and report a
 * scope that no longer exists in the run as its nearest valid one.
 */
export const useInspectorLifecycle = ({
  closeRef,
  retryOpen,
  scope,
  requestedScope,
  onClose,
  onScopeChange,
}: {
  closeRef: RefObject<HTMLButtonElement | null>;
  retryOpen: boolean;
  scope: RunScope;
  requestedScope: RunScope;
  onClose: () => void;
  onScopeChange: (scope: RunScope) => void;
}) => {
  useEffect(() => {
    closeRef.current?.focus();
  }, [closeRef]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !retryOpen) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose, retryOpen]);
  useEffect(() => {
    if (scope === requestedScope) return;
    onScopeChange(scope);
  }, [scope, requestedScope, onScopeChange]);
};
