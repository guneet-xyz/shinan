#!/usr/bin/env node
import { errorFrames, errorSummary } from "@shinan/db"

import { runCommand } from "./commands.js"
import { SettingsError } from "./settings-error.js"

try {
  process.exitCode = await runCommand(process.argv.slice(2), process.env)
} catch (error) {
  // A wrong setting is explained; anything else is logged by name, code and
  // stack frames only, since a database error's message can quote values
  // (architecture §10.3).
  if (error instanceof SettingsError) {
    console.error(error.message)
  } else {
    console.error(`Failed: ${errorSummary(error)}\n${errorFrames(error)}`)
  }
  process.exitCode = 1
}
