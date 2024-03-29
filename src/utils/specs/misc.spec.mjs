import { dirname } from "path";
import { fileURLToPath } from "url";
import {
  arrayToRegexStr,
  cherryPick,
  createIsIncluded,
  createThrottledFunction,
  onResolveAll,
  getDifference,
  getNearestParent,
  getNearestPymakrConfig,
  getRelativeFromNearestParent,
  getRelativeFromNearestParentPosix,
  mapEnumsToQuickPick,
  objToSerializedEntries,
  once,
  serializedEntriesToObj,
  serializeKeyValuePairs,
  waitFor,
  createQueue,
} from "../misc.js";

const wait = (time) => new Promise((resolve) => setTimeout(resolve, time));
const __dirname = dirname(fileURLToPath(import.meta.url));

test("once functions can only be called once", () => {
  let counter = 0;
  const callme = once(() => counter++);

  callme();
  assert.equal(counter, 1);
  callme();
  assert.equal(counter, 1);
});

test("once functions can use context", () => {
  const context = { counter: 0 };
  const callme = once(function () {
    this.counter++;
  }, context);

  callme();
  assert.equal(context.counter, 1);
  callme();
  assert.equal(context.counter, 1);
});

test("getDifference returns difference", () => {
  const result = getDifference([1, 2, 3, 4, 5], [4, 5, 6, 7, 8]);
  assert.deepEqual(result, [
    [1, 2, 3],
    [6, 7, 8],
  ]);
});

test("mapEnumsToQuickPick", () => {
  const enums = ["f", "b", "b"];
  const descriptions = ["foo", "bar", "baz"];
  const result = enums.map(mapEnumsToQuickPick(descriptions));
  assert.deepEqual(result, [
    { label: "f", description: "foo" },
    { label: "b", description: "bar" },
    { label: "b", description: "baz" },
  ]);
});

test("cherryPick", () => {
  const obj = { foo: "foo", bar: "bar", baz: "baz" };
  const cherryPicked = cherryPick(obj, ["foo", "bar"]);
  assert.deepEqual(cherryPicked, { foo: "foo", bar: "bar" });
});

test("getNearestParent + relative", () => {
  // use different test paths on windows / linux
  if (process.platform === "win32") {
    const parents = ["c:\\some\\folder\\path", "c:\\some\\folder", "c:\\some"];
    const child = "c:\\some\\folder\\child\\path";

    assert.equal(getNearestParent(parents)(child), "c:\\some\\folder");
    assert.equal(getRelativeFromNearestParent(parents)(child), "child\\path");
    assert.equal(getRelativeFromNearestParentPosix(parents)(child), "child/path");
  } else {
    const parents = ["/some/folder/path", "/some/folder", "/some"];
    const child = "/some/folder/child/path";

    assert.equal(getNearestParent(parents)(child), "/some/folder");
    assert.equal(getRelativeFromNearestParent(parents)(child), "child/path");
  }
});

test("getNearestPymakrConfig", () => {
  const path = `${__dirname}/_sampleProject/folder/subfolder/foo`;
  const result = getNearestPymakrConfig(path);
  assert.equal(result.name, "sample-project");
});

test("arrayToRegexStr", () => {
  assert.equal(arrayToRegexStr(["foo", "bar"]), "(foo)|(bar)");
});

test("serializeKeyValuePairs", () => {
  const obj = {
    foo: "foo",
    bar: "test",
    baz: 123,
  };

  const result = serializeKeyValuePairs(obj);
  assert.equal(result, "foo=foo\r\nbar=test\r\nbaz=123");
});

test("createIsIncluded", () => {
  const target1 = { name: "include-me" };
  const target2 = { name: "exclude-me sometimes" };
  const target3 = { name: "exclude-me everytime", someField: "exclude-me" };

  const items = [target1, target2, target3];

  test("no exclude includes everything", () => {
    const result = items.filter(createIsIncluded([".*"], [], serializeKeyValuePairs));
    assert.deepEqual(result, items);
  });

  test("vague excludes excludes all matches", () => {
    const result = items.filter(createIsIncluded([".*"], ["exclude-me"], serializeKeyValuePairs));
    assert.deepEqual(result, [items[0]]);
  });

  test("specific excludes excludes only specific matches", () => {
    const result = items.filter(createIsIncluded([".*"], ["someField=exclude-me"], serializeKeyValuePairs));
    assert.deepEqual(result, [items[0], items[1]]);
  });
});

test("createThrottledFunction", async () => {
  const getRandom = () => Math.random();
  const throttledRandom = createThrottledFunction(getRandom);
  const call1 = throttledRandom();
  const call2 = throttledRandom();
  const call3 = throttledRandom();
  const [r1, r2, r3] = await Promise.all([call1, call2, call3]);
  assert.equal(r1, r2);
  assert.equal(r2, r3);
});

test("serialized entries", () => {
  const obj = { foo: "FOO", bar: "BAR" };
  const entries = ["foo=FOO", "bar=BAR"];

  assert.deepEqual(objToSerializedEntries(obj), entries);
  assert.deepEqual(serializedEntriesToObj(entries), obj);
});

test("waitFor", () => {
  const fallbackAction = () => "fallback";
  test("can use adequate literal allowance", async () => {
    const resolvesIn50 = new Promise((resolve) => setTimeout(() => resolve("primary"), 50));
    const result = await waitFor(resolvesIn50, 100, fallbackAction);
    assert.equal(result, "primary");
  });
  test("can use inadequate literal allowance", async () => {
    const resolvesIn100 = new Promise((resolve) => setTimeout(() => resolve("primary"), 100));
    const result = await waitFor(resolvesIn100, 50, fallbackAction);
    assert.equal(result, "fallback");
  });
  test("can use adequate promise allowance", async () => {
    const resolvesIn50 = new Promise((resolve) => setTimeout(() => resolve("primary"), 50));
    const promiseAllowance = new Promise((resolve) => setTimeout(resolve, 100));
    const result = await waitFor(resolvesIn50, promiseAllowance, fallbackAction);
    assert.equal(result, "primary");
  });
  test("can use inadequate promise allowance", async () => {
    const resolvesIn100 = new Promise((resolve) => setTimeout(() => resolve("primary"), 100));
    const promiseAllowance = new Promise((resolve) => setTimeout(resolve, 50));
    const result = await waitFor(resolvesIn100, promiseAllowance, fallbackAction);
    assert.equal(result, "fallback");
  });
  test("triggering literal fallback throws error", async () => {
    const resolvesIn100 = new Promise((resolve) => setTimeout(() => resolve("primary"), 100));
    let error;
    try {
      await waitFor(resolvesIn100, 50, "im an error");
    } catch (err) {
      error = err;
    }
    assert.equal(error, "im an error");
  });
});

test("onResolveAll", () => {
  let counter = 0;
  let callbackTriggerCount = 0; // how many times was the callback executed
  let result = null;
  const callback = () => {
    result = counter;
    callbackTriggerCount++;
  };
  const dynamicPromises = onResolveAll(callback);

  const createPromise = (callback, time) =>
    new Promise((resolve) =>
      setTimeout(() => {
        callback();
        resolve(false);
      }, time)
    );

  test("should only run callback when the last added promise is resolved", async () => {
    dynamicPromises.push(createPromise(() => counter++, 50));
    dynamicPromises.push(createPromise(() => counter++, 100));
    dynamicPromises.push(createPromise(() => counter++, 150));
    dynamicPromises.push(createPromise(() => counter++, 200));

    await wait(150);
    assert.equal(callbackTriggerCount, 0);
    assert.equal(result, null);
    await wait(50);
    assert.equal(callbackTriggerCount, 1);
    assert.equal(result, 4);
  });

  test("reactivates after idle when new promises are added", async () => {
    dynamicPromises.push(createPromise(() => counter++, 50));
    dynamicPromises.push(createPromise(() => counter++, 100));
    dynamicPromises.push(createPromise(() => counter++, 150));
    dynamicPromises.push(createPromise(() => counter++, 200));

    await wait(150);
    assert.equal(callbackTriggerCount, 1);
    assert.equal(result, 4);
    await wait(50);
    assert.equal(callbackTriggerCount, 2);
    assert.equal(result, 8);
  });

  test("createQueue runs entries in order", async () => {
    let number = 1;
    const queue = createQueue();
    const log = [];

    const doStuff = async () => {
      const myNumber = number++;
      log.push(`awaiting ${myNumber}`);
      const imDone = await queue();
      log.push(`started ${myNumber}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      log.push(`finished ${myNumber}`);
      imDone();
    };

    await Promise.all([doStuff(), doStuff(), doStuff()]);
    assert.deepEqual(log, [
      "awaiting 1",
      "awaiting 2",
      "awaiting 3",
      "started 1",
      "finished 1",
      "started 2",
      "finished 2",
      "started 3",
      "finished 3",
    ]);
  });
});
