// One queue for every multi-step change to the files table that must not
// interleave with another: file actions (src/features/files/actions.ts), the
// My Files reconcile, and folding picked rows into scanned ones
// (mergePickedDuplicates). A task starts only after the previous one has
// settled, so none of them sees another half-applied.

let tail: Promise<unknown> = Promise.resolve();

/** Runs `task` after every task queued before it has settled (resolved or rejected). */
export function exclusive<T>(task: () => Promise<T> | T): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}
