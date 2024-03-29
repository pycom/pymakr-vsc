test("stress test", async () => {
  const device = pymakr.devicesStore.get()[0];

  test("5x (re)connect", async () => {
    let error;
    try {
      const count = 5;
      for (let i = 0; i <= count; i++) {
        await device.connect();
        assert(device.connected.get(), 'should be connected');
        await device.disconnect();
        assert(!device.connected.get(), 'should not be connected');
      }
    } catch (err) {
      error = err;
    }
    assert(!error, error);
  });
});
