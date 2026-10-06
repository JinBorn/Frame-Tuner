const test = require("node:test");
const assert = require("node:assert/strict");
const { createLatestTask, mapConcurrent, createResourceCache } = require("./animation_tuner/public/workbench_state");
const { advancePlaybackClock } = require("./animation_tuner/public/timing_modes");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("a slow animation cannot overwrite the last requested selection", async () => {
  const selection = createLatestTask();
  const slow = deferred();
  const commits = [];
  const a = selection.run(() => slow.promise, (context) => commits.push(context));
  const b = selection.run(async () => ({ group: "B", images: ["B.png"], owner: "B-owner" }), (context) => commits.push(context));
  assert.equal(await b, true);
  slow.resolve({ group: "A", images: ["A.png"], owner: "A-owner" });
  assert.equal(await a, false);
  assert.deepEqual(commits, [{ group: "B", images: ["B.png"], owner: "B-owner" }]);
});

test("obsolete failures are ignored, active failures are reported, and retry succeeds", async () => {
  const selection = createLatestTask();
  const slow = deferred();
  const errors = [];
  const old = selection.run(() => slow.promise, () => assert.fail("stale commit"), (error) => errors.push(error.message));
  await selection.run(async () => "current", () => {});
  slow.reject(new Error("old error"));
  assert.equal(await old, false);
  assert.equal(await selection.run(async () => { throw new Error("missing frame"); }, () => assert.fail(), (error) => errors.push(error.message)), false);
  assert.deepEqual(errors, ["missing frame"]);
  assert.equal(await selection.run(async () => "retry", () => {}), true);
});

test("reset invalidates a pending selection and stops its remaining image work", async () => {
  const selection = createLatestTask();
  const active = deferred();
  const requests = [];
  const pending = selection.run((isCurrent) => mapConcurrent([0, 1, 2, 3], async (index) => {
    requests.push(index);
    await active.promise;
    return index;
  }, 2, isCurrent), () => assert.fail("reset must prevent commit"));
  selection.invalidate();
  active.resolve();
  assert.equal(await pending, false);
  assert.deepEqual(requests, [0, 1]);
});

test("image work never exceeds its concurrency limit and preserves frame order", async () => {
  const releases = Array.from({ length: 6 }, deferred);
  let count = 0;
  let peak = 0;
  const pending = mapConcurrent([0, 1, 2, 3, 4, 5], async (index) => {
    count += 1;
    peak = Math.max(peak, count);
    await releases[index].promise;
    count -= 1;
    return `image-${index}`;
  }, 2);
  assert.equal(peak, 2);
  releases.forEach((release) => release.resolve());
  assert.deepEqual(await pending, ["image-0", "image-1", "image-2", "image-3", "image-4", "image-5"]);
  assert.equal(peak, 2);
});

test("a failed image is retried and simultaneous requests share one load", async () => {
  let requests = 0;
  const cache = createResourceCache({ key: (value) => value, load: async (value) => {
    requests += 1;
    if (requests === 1) throw new Error("offline");
    return { value };
  } });
  const first = cache.get("image");
  assert.equal(cache.get("image"), first);
  await assert.rejects(first, /offline/);
  assert.equal(cache.peek("image"), null);
  assert.deepEqual(await cache.get("image"), { value: "image" });
  assert.equal(requests, 2);
});

test("late images from a departed project never repopulate the cache", async () => {
  const old = deferred();
  let requests = 0;
  const cache = createResourceCache({ key: (value) => value, size: () => 16, load: () => ++requests === 1 ? old.promise : { project: "new" } });
  const oldRequest = cache.get("same-path.png");
  await Promise.resolve();
  cache.clear();
  const current = await cache.get("same-path.png");
  old.resolve({ project: "old" });
  await oldRequest;
  assert.deepEqual(current, { project: "new" });
  assert.deepEqual(cache.peek("same-path.png"), { project: "new" });
  assert.equal(cache.stats().bytes, 16);
});

test("background images obey entry and byte limits without evicting active attachments", async () => {
  const cache = createResourceCache({ key: (value) => value, load: async (value) => ({ value }), size: () => 16, maxEntries: 3, maxBytes: 32 });
  cache.pin(["attachment"]);
  await cache.get("attachment");
  for (let index = 0; index < 30; index += 1) await cache.get(`background-${index}`);
  assert.deepEqual(cache.peek("attachment"), { value: "attachment" });
  assert.equal(cache.stats().entries, 2);
  assert.equal(cache.stats().bytes, 32);
  cache.clear();
  assert.deepEqual(cache.stats(), { entries: 0, bytes: 0, pinned: 0 });
});

test("40ms frames at 60Hz retain exact elapsed time over ten seconds", () => {
  let boundary = 0;
  let frames = 0;
  for (let tick = 1; tick <= 600; tick += 1) {
    const result = advancePlaybackClock(tick * 1000 / 60, boundary, () => 40, () => { frames += 1; });
    boundary = result.time;
  }
  assert.equal(frames, 250);
  assert.equal(boundary, 10000);
});

test("mixed durations and skipped disabled frames survive a display stall", () => {
  const frames = [{ duration: 25 }, { duration: 999, disabled: true }, { duration: 75 }, { duration: 40 }];
  let index = 0;
  const visits = [];
  const result = advancePlaybackClock(350, 0, () => frames[index].duration, () => {
    do { index = (index + 1) % frames.length; } while (frames[index].disabled);
    visits.push(index);
  });
  assert.equal(index, 2);
  assert.equal(result.time, 305);
  assert.equal(350 - result.time, 45);
  assert.deepEqual(visits, [2, 3, 0, 2, 3, 0, 2]);
});

test("an async animation boundary preserves time owed to the following animation", () => {
  let switching = false;
  const first = advancePlaybackClock(150, 0, () => 40, () => { switching = true; }, () => !switching);
  assert.deepEqual(first, { time: 40, steps: 1 });
  const second = advancePlaybackClock(150, first.time, () => 30, () => {});
  assert.deepEqual(second, { time: 130, steps: 3 });
});
