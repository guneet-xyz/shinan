// node sign-in.mjs <email> [setup token]: signs in and keeps the session.
import { browser } from "./web.mjs"

const [email, setupToken] = process.argv.slice(2)
const b = browser()
const status = await b.signIn(email, setupToken || undefined)
b.save()
console.log(`signed in as ${email}: ${status}`)
