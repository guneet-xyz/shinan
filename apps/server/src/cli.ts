#!/usr/bin/env node
const args = process.argv.slice(2)

if (args.length === 1 && args[0] === "health") {
  // Container health checks run this every 30 seconds: load only what it
  // needs.
  const { checkHealth } = await import("./health.js")
  process.exitCode = await checkHealth(process.env)
} else {
  const { createLimitedLog, errorFrames, errorSummary } =
    await import("@shinan/db")
  const { runCommand } = await import("./commands.js")
  const { SettingsError } = await import("./settings-error.js")
  // Errors nothing caught are logged by name, code and stack frames only,
  // like any other (architecture §10.3): Node.js would print the message,
  // which can quote a query's values. A stray rejected promise is logged
  // and the process keeps serving, at most once a minute per error; an
  // uncaught exception leaves the process in an unknown state, so it ends
  // and the container restarts it.
  const log = createLimitedLog()
  process.on("unhandledRejection", (reason) => {
    log(`Unhandled rejection: ${errorSummary(reason)}\n${errorFrames(reason)}`)
  })
  process.on("uncaughtException", (error) => {
    console.error(
      `Uncaught exception: ${errorSummary(error)}\n${errorFrames(error)}`,
    )
    process.exit(1)
  })
  try {
    process.exitCode = await runCommand(args, process.env)
  } catch (error) {
    // A wrong setting is explained; anything else is logged by name, code
    // and stack frames only, since a database error's message can quote
    // values (architecture §10.3).
    if (error instanceof SettingsError) {
      console.error(error.message)
    } else {
      console.error(`Failed: ${errorSummary(error)}\n${errorFrames(error)}`)
    }
    process.exitCode = 1
  }
}
