export function RouteError() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-title font-bold">Let’s reconnect</h1>
      <p className="text-ink-2">This screen couldn’t load. Check your connection and reload to get the latest Flat Quest.</p>
      <button className="pressable bg-ink min-h-12 rounded-2xl px-6 font-semibold text-white" onClick={() => window.location.reload()}>Reload Flat Quest</button>
    </main>
  )
}
