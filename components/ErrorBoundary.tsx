import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong. Please try again later.";
      let isFirestoreError = false;

      try {
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.operationType && parsed.authInfo) {
            isFirestoreError = true;
            errorMessage = `Database Error: ${parsed.error}. Operation: ${parsed.operationType} on ${parsed.path || 'unknown path'}.`;
          }
        }
      } catch (e) {
        // Not a JSON error message, use default
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl p-10 text-center animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 mx-auto mb-8 shadow-inner">
              <AlertTriangle size={40} />
            </div>
            <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight mb-4">Application Error</h1>
            <p className="text-sm text-slate-500 font-medium leading-relaxed mb-10">
              {errorMessage}
            </p>
            <button
              onClick={this.handleReset}
              className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 active:scale-95 transition-all"
            >
              <RefreshCcw size={18} />
              Reload Application
            </button>
            {isFirestoreError && (
              <p className="mt-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Security rules or permissions may be blocking this action.
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
