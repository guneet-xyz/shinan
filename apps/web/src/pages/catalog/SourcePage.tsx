import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router"

import { Button } from "@/components/ui/button"

import { isApiError, useApi, useResource } from "../../api"
import { ErrorMessage, Loading } from "../../components/status"
import { NotFound } from "../NotFound"
import { entityPath, listLinkClass } from "./format"
import { TitleText, VisibleText } from "./VisibleText"

/**
 * View source (product brief on #169): a page's file as it is on `main`,
 * the text agents read and write, with hidden characters marked and a Copy
 * button for the text exactly as it is.
 */
export function SourcePage() {
  const api = useApi()
  const workspaceId = useParams().workspaceId!
  const id = useParams()["*"] ?? ""
  const answer = useResource(`catalog-source:${workspaceId}:${id}`, () =>
    api.catalogSource(workspaceId, id),
  )
  const [copied, setCopied] = useState(false)

  if (answer.error) {
    if (isApiError(answer.error, "not-found")) return <NotFound />
    return <ErrorMessage error={answer.error} />
  }
  if (!answer.data) return <Loading />
  const { source, title } = answer.data
  const text = source.text
  const copy = () => {
    if (text === null) return
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
          Source of <TitleText title={title} id={id} />
        </h1>
        <p className="text-sm text-muted-foreground">
          <code className="font-mono wrap-anywhere">
            <VisibleText text={source.path} oneLine />
          </code>
          , as it is in the catalog. Back to{" "}
          <Link to={entityPath(workspaceId, id)} className={listLinkClass}>
            the page
          </Link>
          .
        </p>
      </header>
      {text === null ? (
        <p className="text-sm">
          This file is too large to show here. An agent can read it from the
          catalog's repository.
        </p>
      ) : (
        <>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <CopyIcon aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="rounded-lg border bg-muted p-3 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap sm:text-sm">
            <code>
              <VisibleText text={text} />
            </code>
          </pre>
        </>
      )}
    </div>
  )
}
