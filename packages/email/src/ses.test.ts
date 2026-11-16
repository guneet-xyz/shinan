import {
  MessageRejected,
  SendEmailCommand,
  SESv2ServiceException,
  TooManyRequestsException,
} from "@aws-sdk/client-sesv2"
import type { SendEmailCommandOutput } from "@aws-sdk/client-sesv2"
import { describe, expect, it, vi } from "vitest"

import { classifySesError, createSesSender } from "./ses.js"
import type { SesClient } from "./ses.js"

const metadata = (httpStatusCode: number) => ({ httpStatusCode })

function mockClient(result: () => Promise<Partial<SendEmailCommandOutput>>) {
  const send = vi.fn<(command: SendEmailCommand) => Promise<unknown>>(result)
  const destroy = vi.fn()
  const client = { send, destroy } as unknown as SesClient
  return { client, send, destroy }
}

const message = {
  to: "person@example.com",
  subject: "Sign in to Shinan",
  text: "Open the link",
  html: "<p>Open the link</p>",
}

describe("createSesSender", () => {
  it("sends one message through the SES v2 SendEmail API", async () => {
    const { client, send } = mockClient(() =>
      Promise.resolve({ MessageId: "ses-message-1", $metadata: {} }),
    )
    const sender = createSesSender({
      from: { address: "shinan@guneet.dev", name: "Shinan" },
      region: "us-east-1",
      configurationSet: "guneet-dev",
      client,
    })

    await expect(sender.send(message)).resolves.toEqual({
      ok: true,
      messageId: "ses-message-1",
    })

    expect(send).toHaveBeenCalledOnce()
    const command = send.mock.calls[0]![0]
    expect(command).toBeInstanceOf(SendEmailCommand)
    expect(command.input).toEqual({
      FromEmailAddress: '"Shinan" <shinan@guneet.dev>',
      Destination: { ToAddresses: ["person@example.com"] },
      ConfigurationSetName: "guneet-dev",
      Content: {
        Simple: {
          Subject: { Data: "Sign in to Shinan", Charset: "UTF-8" },
          Body: {
            Text: { Data: "Open the link", Charset: "UTF-8" },
            Html: { Data: "<p>Open the link</p>", Charset: "UTF-8" },
          },
        },
      },
    })
  })

  it("leaves out what is not configured", async () => {
    const { client, send } = mockClient(() =>
      Promise.resolve({ $metadata: {} }),
    )
    const sender = createSesSender({
      from: { address: "shinan@guneet.dev" },
      region: "us-east-1",
      client,
    })

    await expect(
      sender.send({ to: "a@example.com", subject: "S", text: "T" }),
    ).resolves.toEqual({ ok: true, messageId: null })

    const input = send.mock.calls[0]![0].input
    expect(input.FromEmailAddress).toBe("shinan@guneet.dev")
    expect(input).not.toHaveProperty("ConfigurationSetName")
    expect(input.Content?.Simple?.Body).not.toHaveProperty("Html")
  })

  it("reports throttling as temporary", async () => {
    const { client } = mockClient(() =>
      Promise.reject(
        new TooManyRequestsException({
          message: "Maximum sending rate exceeded.",
          $metadata: metadata(429),
        }),
      ),
    )
    const sender = createSesSender({
      from: { address: "shinan@guneet.dev" },
      region: "us-east-1",
      client,
    })

    await expect(sender.send(message)).resolves.toEqual({
      ok: false,
      temporary: true,
      code: "TooManyRequestsException",
    })
  })

  it("reports a rejected message as permanent, without its text", async () => {
    const { client } = mockClient(() =>
      Promise.reject(
        new MessageRejected({
          message: "Email address is not verified: person@example.com",
          $metadata: metadata(400),
        }),
      ),
    )
    const sender = createSesSender({
      from: { address: "shinan@guneet.dev" },
      region: "us-east-1",
      client,
    })

    const result = await sender.send(message)
    expect(result).toEqual({
      ok: false,
      temporary: false,
      code: "MessageRejected",
    })
    expect(JSON.stringify(result)).not.toContain("person@example.com")
  })

  it("destroys the client on close", async () => {
    const { client, destroy } = mockClient(() =>
      Promise.resolve({ $metadata: {} }),
    )
    const sender = createSesSender({
      from: { address: "shinan@guneet.dev" },
      region: "us-east-1",
      client,
    })
    await sender.close()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it("builds a real client without contacting AWS", async () => {
    const sender = createSesSender({
      from: { address: "shinan@guneet.dev" },
      region: "us-east-1",
      credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" },
    })
    await sender.close()
  })
})

describe("classifySesError", () => {
  const serviceError = (name: string, status: number, fault = "client") =>
    new SESv2ServiceException({
      name,
      $fault: fault as "client" | "server",
      $metadata: metadata(status),
      message: "details that are not stored",
    })

  it.each([
    ["TooManyRequestsException", 429, "client"],
    ["LimitExceededException", 400, "client"],
    ["InternalServiceErrorException", 500, "server"],
    ["SomethingNew", 503, "server"],
  ])("treats %s (%i) as temporary", (name, status, fault) => {
    expect(classifySesError(serviceError(name, status, fault))).toEqual({
      temporary: true,
      code: name,
    })
  })

  it.each([
    ["MessageRejected", 400],
    ["BadRequestException", 400],
    ["MailFromDomainNotVerifiedException", 400],
    ["AccountSuspendedException", 400],
    ["SendingPausedException", 400],
    ["NotFoundException", 404],
    ["UnrecognizedClientException", 403],
  ])("treats %s (%i) as permanent", (name, status) => {
    expect(classifySesError(serviceError(name, status))).toEqual({
      temporary: false,
      code: name,
    })
  })

  it("treats network errors and timeouts as temporary", () => {
    const reset = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    })
    reset.name = "Error"
    expect(classifySesError(reset).temporary).toBe(true)

    const timeout = new Error("Request timed out")
    timeout.name = "TimeoutError"
    expect(classifySesError(timeout)).toEqual({
      temporary: true,
      code: "TimeoutError",
    })
  })

  it("treats missing credentials as permanent", () => {
    const error = new Error("Could not load credentials from any providers")
    error.name = "CredentialsProviderError"
    expect(classifySesError(error)).toEqual({
      temporary: false,
      code: "CredentialsProviderError",
    })
  })

  it("never returns free text as the code", () => {
    expect(classifySesError("boom")).toEqual({
      temporary: true,
      code: "UnknownError",
    })
    const odd = new Error("x")
    odd.name = "Name with spaces and person@example.com"
    expect(classifySesError(odd).code).toBe("UnknownError")
  })
})
