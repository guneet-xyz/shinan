// node slowproxy.mjs <listen port> <target port> [bytes a second]: a TCP
// proxy that passes the server's bytes to the client at most that fast, to
// hold one answer open through Caddy for minutes.
import net from "node:net"

const [listen, target, rate = 50000] = process.argv.slice(2).map(Number)
net
  .createServer((client) => {
    const server = net.connect(target, "127.0.0.1")
    client.pipe(server)
    const queue = []
    let ended = false
    server.on("data", (chunk) => {
      queue.push(chunk)
      server.pause()
    })
    server.on("end", () => (ended = true))
    const tick = setInterval(() => {
      let budget = rate / 10
      while (budget > 0 && queue.length > 0) {
        const chunk = queue[0]
        if (chunk.length <= budget) {
          client.write(chunk)
          budget -= chunk.length
          queue.shift()
        } else {
          client.write(chunk.subarray(0, budget))
          queue[0] = chunk.subarray(budget)
          budget = 0
        }
      }
      if (queue.length === 0) {
        if (ended) {
          clearInterval(tick)
          client.end()
        } else server.resume()
      }
    }, 100)
    const close = () => {
      clearInterval(tick)
      server.destroy()
      client.destroy()
    }
    client.on("error", close)
    server.on("error", close)
    client.on("close", close)
  })
  .listen(listen, "127.0.0.1")
