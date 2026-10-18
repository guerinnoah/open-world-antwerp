let done = 0, total = 0;
let report: (fraction: number) => void = () => {};

/** weight: roughly the download's size in 100 kB over the wire. */
export function track<T>(load: Promise<T>, weight = 1): Promise<T> {
  total += weight;
  return load.finally(() => {
    done += weight;
    report(done / total);
  });
}

export function onLoadProgress(listener: (fraction: number) => void) {
  report = listener;
}
