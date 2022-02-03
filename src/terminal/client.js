const net = require("net");
const prompts = require("prompts");
const readline = require("readline");
const host = "127.0.0.1";
const port = 5364;

const socket = new net.Socket();

let [_1, _2, protocol, address] = process.argv;

socket.connect(port, host, async () => {
  // first message contains available devices
  socket.once("data", async (data) => {
    const availableDevices = JSON.parse(data.toString());
    if (!protocol || !address) ({ protocol, address } = await prompt(availableDevices));
    startClient(protocol, address);
  });
});

async function startClient(protocol, address) {
  // let the server know which device we want to listen to
  socket.write(JSON.stringify({ address, protocol }));
  process.stdin.setRawMode(true);
  process.stdin.resume(); // prompt stops input
  console.clear() // clear prompt message

  // send stdin to keypress events
  readline.emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", async (str, key) => {
    socket.write(Buffer.from(key.sequence));
    if (key.name === "k" && key.ctrl) process.exit(0);
    if (key.name === "x" && key.ctrl) process.exit(0);
  });

  // send Ctrl+B for friendly REPL
  socket.write("\x02");

  // proxy data from the device to the terminal
  socket.on("data", (data) => process.stdout.write(data));
}

/**
 * if no device is specified, ask the user and then connect
 * @param {ProtocolAndAddress[]} availableDevices
 */
async function prompt(availableDevices) {
  const { connection } = await prompts.prompt({
    type: "select",
    name: "connection",
    message: "pick a connection",
    choices: availableDevices.map((ad) => ({ title: `${ad.protocol}://${ad.address}`, value: ad })),
  });
  return connection;
}
