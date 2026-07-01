import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorLocation?: string;
}

/**
 * Global ErrorBoundary — catches runtime React crashes,
 * logs them, and renders a fallback UI instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Extract component name from stack if possible
    const componentMatch = errorInfo.componentStack?.match(/at\s+([A-Z][a-zA-Z0-9]+)/);
    const errorLocation = componentMatch ? componentMatch[1] : "Unknown Component";
    
    this.setState({ errorInfo, errorLocation });
    // Log to console for debugging
    console.error(`[ErrorBoundary] Uncaught error in ${errorLocation}:`, error);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, errorLocation: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-lg w-full rounded-xl border border-red-500/30 bg-red-500/5 p-8 text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-6 h-6 text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
            <h2 className="text-lg font-bold text-foreground">
              Something went wrong {this.state.errorLocation ? `in ${this.state.errorLocation}` : ""}
            </h2>
            <p className="text-base text-muted-foreground leading-relaxed">
              An unexpected error occurred. This has been
              logged for investigation.
            </p>
            {this.state.error && (
              <details className="text-left">
                <summary className="text-xs text-red-400 cursor-pointer hover:underline">
                  Error details
                </summary>
                <pre className="mt-2 p-3 rounded-md bg-muted/50 border border-border/50 text-xs text-red-700 dark:text-red-400 overflow-auto max-h-48 whitespace-pre-wrap">
                  {this.state.error.message}
                  {this.state.errorInfo?.componentStack && (
                    <>
                      {"\n\nComponent Stack:"}
                      {this.state.errorInfo.componentStack}
                    </>
                  )}
                </pre>
              </details>
            )}
            <button
              onClick={this.handleReset}
              className="mt-2 px-6 py-2.5 text-base font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
