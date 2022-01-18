
const storeOptions = {
  onSub: (x) => void 0,
  onUnsub: (x) => void 0,
  onFirstSub: (x) => void 0,
  onLastUnsub: (x) => void 0,
};

/**
 * @template T
 * @param {T} initialValue
 * @param {Partial<storeOptions<T>>=} options
 * @returns {Writable<T>}
 */
const writable = (initialValue, options) => {
  let _value = initialValue;
  const listeners = [];
  const _options = { ...storeOptions, ...options };

  const store = {
    get: () => _value,
    /** @param {T} value */
    set: (value) => {
      _value = value;
      listeners.forEach((listener) => listener(_value));
    },
    update: (callback) => store.set(callback(_value)),
    /**
     * @param {function(T)} listener
     */
    subscribe: (listener) => {
      if (!listeners.length) _options.onFirstSub(store);
      _options.onSub(store);
      listeners.push(listener);

      const unsub = () => {
        const index = listeners.indexOf(listener);
        listeners.splice(index, 1);
        if (!listeners) _options.onLastUnsub(store);
        _options.onUnsub(store);
      };
      return unsub;
    },
  };
  return store;
};


/**
 * @template {Readable<any>[]} V
 * @template T
 * @param {[...V]} stores
 * @param {function(StoreValues<V>):T} callback
 * @returns {Readable<T>}
 */
const derived = (stores, callback) => {
  const unsubs = [];
  const storeValues = /** @type {StoreValues<V>} */ (stores.map((store) => store.get()));
  const listeners = [];
  let value;
  const emit = () => {
    value = callback(storeValues);
    listeners.forEach((listener) => listener(value));
  };
  stores.forEach((store, index) => {
    // subscribe to changes
    const unsub = store.subscribe((_value) => {
      storeValues[index] = _value;
      emit();
    });
    unsubs.push(unsub);
  });
  emit();
  return {
    get: () => value,
    /**
     *
     * @param {function(value)} listener
     * @returns
     */
    subscribe: (listener) => {
      listeners.push(listener);
      const unsub = () => {
        const index = listeners.indexOf(listener);
        listeners.splice(index, 1);
      };
      return unsub;
    },
  };
};

/**
 * Similar to derived, but callback expects a store to be returned
 * @template {Readable<any>[]} V
 * @template {Readable<any>} T
 * @param {[...V]} stores
 * @param {function(StoreValues<V>):T} callback
 * @return {{
 *   subscribe: (arg0: (arg0: StoreValue<T>) => void) => Unsubscribe
 *   get: () => StoreValue<T>
 * }}
 */
const chainDerived = (stores, callback) => {
  const nestedStore = derived(stores, callback);
  let unsubNested = () => void 0;
  const { set, subscribe: _subscribe, get } = writable(nestedStore.get().get());

  const unsub = nestedStore.subscribe((value) => {
    unsubNested(); // unsub previous subscription
    set(value.get());
    unsubNested = value.subscribe(set);
  });

  const subscribe = (listener) => {
    const _unsub = _subscribe(listener);
    return () => {
      _unsub();
      unsub();
      unsubNested();
    };
  };

  return { subscribe, get };
};

module.exports = { writable, derived, chainDerived };