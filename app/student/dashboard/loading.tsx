export default function StudentDashboardLoading() {
  return (
    <div
      className="mx-auto w-full max-w-5xl space-y-6 px-4 py-10"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading student dashboard…</span>

      <div className="space-y-2">
        <div className="h-3 w-32 animate-pulse rounded bg-emerald-200/70" />
        <div className="h-8 w-64 max-w-full animate-pulse rounded-lg bg-emerald-200/70" />
      </div>

      <div className="h-40 animate-pulse rounded-2xl border border-emerald-200 bg-emerald-100/70" />

      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-28 animate-pulse rounded-2xl border border-emerald-200 bg-emerald-100/60"
          />
        ))}
      </div>
    </div>
  );
}
