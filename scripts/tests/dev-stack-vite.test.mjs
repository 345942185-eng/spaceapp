import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createServer as createViteServer } from "vite";
import WebSocket, { WebSocketServer } from "ws";

test("the source web server proxies readiness and a real terminal WebSocket to the selected API", async () => {
  const api = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, path: request.url }));
  });
  const sockets = new WebSocketServer({ server: api });
  sockets.on("connection", socket => socket.on("message", data => socket.send(data.toString())));
  api.listen(0, "127.0.0.1"); await once(api, "listening");
  const previous = process.env.SPACE_API_ORIGIN;
  process.env.SPACE_API_ORIGIN = `http://127.0.0.1:${api.address().port}`;
  let web;
  let terminal;
  try {
    web = await createViteServer({
      root: new URL("../../apps/web", import.meta.url).pathname,
      configFile: new URL("../../apps/web/vite.config.ts", import.meta.url).pathname,
      server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error"
    });
    await web.listen();
    const origin = `http://127.0.0.1:${web.httpServer.address().port}`;
    assert.deepEqual(await (await fetch(`${origin}/readyz`)).json(), { ok: true, path: "/readyz" });
    terminal = new WebSocket(`${origin.replace("http:", "ws:")}/api/panes/test/cli/terminal`);
    await once(terminal, "open", { signal: AbortSignal.timeout(10_000) });
    const received = once(terminal, "message", { signal: AbortSignal.timeout(10_000) });
    terminal.send("terminal transport");
    assert.equal((await received)[0].toString(), "terminal transport");
  } finally {
    terminal?.terminate();
    for (const socket of sockets.clients) socket.terminate();
    await web?.close();
    await new Promise(resolve => sockets.close(resolve));
    await new Promise(resolve => api.close(resolve));
    if (previous === undefined) delete process.env.SPACE_API_ORIGIN;
    else process.env.SPACE_API_ORIGIN = previous;
  }
});
