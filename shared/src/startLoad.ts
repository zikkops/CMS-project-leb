/**
 * Starts a page's loader from an effect, on the next microtask.
 *
 * A loader sets state as its answers arrive, and usually sets a "loading" flag
 * first. Called straight from an effect's body, React counts every one of
 * those as a setState made synchronously inside the effect, which renders the
 * component again before the browser has painted the first one
 * (react-hooks/set-state-in-effect). Started on the next microtask the loader
 * runs exactly as it did, one tick later, and its state changes are ordinary
 * updates from outside the render.
 *
 *   useEffect(() => { startLoad(load) }, [])
 *
 * Only for starting loads. State that follows from props or other state is
 * worked out while rendering instead (see useKeyed.ts).
 */
export function startLoad(load: () => unknown): void {
  queueMicrotask(() => { void load() })
}
