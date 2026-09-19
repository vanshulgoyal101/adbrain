export default function Loading() {
  return (
    <div role="status" aria-label="Loading workspace" className="min-h-[60vh] w-full">
      <span className="sr-only">Loading workspace...</span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="h-3 w-24 rounded bg-slate-100" />
        <div className="mt-3 h-8 w-48 max-w-full rounded bg-slate-200" />
        <div className="mt-3 h-4 w-96 max-w-full rounded bg-slate-100" />
        <div className="mt-7 flex gap-3 border-y border-slate-200 py-4">
          <div className="h-10 min-w-0 flex-1 rounded bg-slate-100" />
          <div className="h-10 w-24 shrink-0 rounded bg-slate-200" />
        </div>
        <div className="divide-y divide-slate-100">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-4 py-5">
              <div className="h-12 w-12 shrink-0 rounded bg-slate-100" />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="h-4 w-2/3 rounded bg-slate-100" />
                <div className="h-3 w-1/3 rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
