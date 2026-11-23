export default function StaffDashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading dashboard…</span>

      <div className="space-y-2">
        <div className="h-3 w-40 animate-pulse rounded bg-emerald-200/70" />
        <div className="h-8 w-72 max-w-full animate-pulse rounded-lg bg-emerald-200/70" />
        <div className="h-4 w-full max-w-2xl animate-pulse rounded bg-emerald-200/50" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-28 animate-pulse rounded-2xl border border-emerald-200 bg-emerald-100/70"
          />
        ))}
      </div>

      <div className="h-80 animate-pulse rounded-2xl border border-emerald-200 bg-emerald-100/60" />
    </div>
  );
}
