import { describe, expect, it } from 'vitest';

import { AssetUploadQueue, MAX_PARALLEL_ASSET_UPLOADS } from './assetUpload';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('AssetUploadQueue', () => {
  it('keeps at most three uploads active per editor tab', async () => {
    const queue = new AssetUploadQueue();
    const gates = Array.from({ length: 5 }, () => deferred());
    const started: number[] = [];

    gates.forEach((gate, index) => {
      queue.enqueue({
        id: `upload-${index}`,
        run: async () => {
          started.push(index);
          await gate.promise;
        },
      });
    });

    await Promise.resolve();
    expect(MAX_PARALLEL_ASSET_UPLOADS).toBe(3);
    expect(started).toEqual([0, 1, 2]);
    expect(queue.activeCount).toBe(3);
    expect(queue.pendingCount).toBe(2);

    gates[0]!.resolve();
    await flushPromises();
    expect(started).toEqual([0, 1, 2, 3]);
    expect(queue.activeCount).toBe(3);

    gates[1]!.resolve();
    gates[2]!.resolve();
    await flushPromises();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(queue.activeCount).toBe(2);

    gates[3]!.resolve();
    gates[4]!.resolve();
    await flushPromises();
    await flushPromises();
    expect(queue.activeCount).toBe(0);
  });

  it('cancels queued uploads before they consume a concurrency slot', async () => {
    const queue = new AssetUploadQueue(1);
    const gate = deferred();
    let secondStarted = false;

    queue.enqueue({ id: 'first', run: () => gate.promise });
    queue.enqueue({
      id: 'second',
      run: async () => {
        secondStarted = true;
      },
    });
    queue.cancel('second');

    await Promise.resolve();
    expect(secondStarted).toBe(false);
    gate.resolve();
    await flushPromises();
    expect(queue.activeCount).toBe(0);
  });
});
