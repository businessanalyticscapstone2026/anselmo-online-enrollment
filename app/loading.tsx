export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#eaf5ec] text-[#06281b] animate-fade-in">
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-4 border-emerald-200" />
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-emerald-700" />
        <span className="h-2.5 w-2.5 animate-pulse-soft rounded-full bg-yellow-400" />
      </div>
      <p className="text-sm font-semibold text-emerald-800">Loading…</p>
    </div>
  );
}
