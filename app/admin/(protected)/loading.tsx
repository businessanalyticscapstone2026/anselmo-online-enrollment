export default function AdminDashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading administration page…</span>

      <div className="space-y-2">
        <div className="h-3 w-36 animate-pulse rounded bg-emerald-200/70" />
        <div className="h-8 w-64 max-w-full animate-pulse rounded-lg bg-emerald-200/70" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-emerald-200/50" />
      </div>

      <div className="h-16 animate-pulse rounded-xl border border-emerald-200 bg-emerald-100/70" />
      <div className="h-96 animate-pulse rounded-2xl border border-emerald-200 bg-emerald-100/60" />
    </div>
  );
}
