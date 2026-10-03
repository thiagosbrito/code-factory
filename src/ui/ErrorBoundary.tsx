import { Component, type ReactNode } from "react";
import { ErrorView } from "./ErrorView";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error)
      return (
        <ErrorView
          message={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      );
    return this.props.children;
  }
}
