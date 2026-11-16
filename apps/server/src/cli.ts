#!/usr/bin/env node
import { runCommand } from "./commands.js"

try {
  process.exitCode = await runCommand(process.argv.slice(2), process.env)
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
