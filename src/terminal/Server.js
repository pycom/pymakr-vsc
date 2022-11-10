const { createServer } = require("net");
const vscode = require("vscode");

/**
 * This is the terminal server. It's mounted as a singleton at `pymakr.server`.
 * It handles all client terminal connections.
 */
class Server {
  /**
   * @param {PyMakr} pymakr
   */
  constructor(pymakr) {
    this.pymakr = pymakr;
    this.log = pymakr.log.createChild("terminal server");
    // creates a new server for each new client
    this.server = createServer((socket) => {
      /** @type {ProtocolAndAddress[]} */
      const availableDevices = pymakr.devicesStore
        .get()
        .map((device) => ({ protocol: device.protocol, address: device.address }));

      //send available devices to client
      socket.write(JSON.stringify(availableDevices));

      //listen for client to return protocol and address
      socket.once("data", (data) => {
        const { protocol, address } = JSON.parse(data.toString());

        const device = this.pymakr.devicesStore
          .get()
          .find((_device) => _device.protocol === protocol && _device.address === address);

        // rename terminal name for this instance
        vscode.commands.executeCommand("workbench.action.terminal.renameWithArg", { name: device.displayName });

        // listen to keystrokes from client
        socket.on("data", (data) => {
          this.log.debug("received", data.toString(), data[0]);
          if (device.protocol === "ws") {
            // Terminal data should be sent as string for WS protocol
            // As it is specified in webrepl README Terminal Protocol
            device.adapter.sendData(data.toString());
          } else {
            device.adapter.sendData(data);
          }
          // make sure device data is sent to the last active terminal
          device.__onTerminalDataExclusive = (data) => socket.write(data);
        });

        socket.on("error", (err) => {
          // @ts-ignore err does have .code prop
          if (err.code !== "ECONNRESET") throw err;
          else this.log.debug("client disconnected");
        });
      });
    }).listen(this.pymakr.terminalPort);
    this.log.debug("Listening on port: ", this.pymakr.terminalPort);
  }
}

module.exports = { Server };
