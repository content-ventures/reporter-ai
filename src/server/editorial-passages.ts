import 'server-only';

/** Two independent source passages at a time; preserve source order and drain failures.
 * Writing stays sequential because every section depends on the preceding text. */
export async function mapEditorialPassages<T>(passages: readonly string[], task: (passage: string, index: number) => Promise<T>): Promise<T[]> {
  const output: T[] = [];
  for (let start = 0; start < passages.length; start += 2) {
    const batch = await Promise.allSettled(passages.slice(start, start + 2).map((passage, offset) => task(passage, start + offset)));
    const failure = batch.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    output.push(...batch.map(result => (result as PromiseFulfilledResult<T>).value));
  }
  return output;
}
