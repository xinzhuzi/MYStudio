import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[AppErrorBoundary] Renderer error:", error, errorInfo.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div
        className="flex min-h-screen w-screen items-center justify-center bg-[#17191c] px-6 text-[#f4f7f8]"
        style={{ background: "#17191c" }}
      >
        <div className="w-full max-w-2xl rounded-lg border border-white/10 bg-[#202429]/95 p-6 shadow-2xl shadow-black/40">
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">
            Renderer Recovery
          </div>
          <h1 className="text-xl font-semibold">界面加载异常</h1>
          <p className="mt-3 text-sm leading-6 text-white/70">
            当前页面渲染时出现错误，系统已拦截白屏。可以先重新加载界面；如果反复出现，请把下方错误信息用于定位。
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-md border border-white/10 bg-black/35 p-3 text-xs leading-5 text-white/70">
            {this.state.error.message || String(this.state.error)}
          </pre>
          <button
            type="button"
            className="mt-5 rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
