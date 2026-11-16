export { classifySesError, createSesSender } from "./ses.js"
export type { SesClient, SesOptions } from "./ses.js"
export { classifySmtpError, createSmtpSender } from "./smtp.js"
export type { SmtpOptions } from "./smtp.js"
export { formatFrom } from "./sender.js"
export type {
  EmailFrom,
  EmailMessage,
  EmailSender,
  SendResult,
} from "./sender.js"
