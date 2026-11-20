import { hasHidden, visibleParts } from "./visible"

/**
 * Text written by agents, with each hidden character as its marker
 * (`⟨U+202E⟩`, see `visible`). Hovering a marker shows the character's
 * name; screen readers hear "hidden character: right-to-left override"
 * instead of the marker. Text with none is rendered as it is.
 */
export function VisibleText(props: { text: string; oneLine?: boolean }) {
  const parts = visibleParts(props.text, { oneLine: props.oneLine })
  if (parts.every((p) => typeof p === "string")) return props.text
  return parts.map((part, i) =>
    typeof part === "string" ? (
      part
    ) : (
      <span
        key={i}
        title={part.name}
        className="rounded-sm bg-amber-100 px-0.5 font-mono text-[0.85em] text-amber-950 dark:bg-amber-950 dark:text-amber-50"
      >
        <span aria-hidden="true">{part.marker}</span>
        <span className="sr-only"> (hidden character: {part.name}) </span>
      </span>
    ),
  )
}

/** A page's title, or its ID when it has none, as `VisibleText`. */
export function TitleText(props: { title: string | null; id: string }) {
  return <VisibleText text={props.title ?? props.id} oneLine />
}

/**
 * One line under a page's title when it or its summary has hidden
 * characters, saying what the markers are (product reviews of #190, #192).
 */
export function HiddenNote(props: { title: string; summary?: string | null }) {
  const inSummary =
    props.summary != null && hasHidden(props.summary, { oneLine: true })
  if (!inSummary && !hasHidden(props.title, { oneLine: true })) return null
  return (
    <p className="text-sm text-muted-foreground">
      {inSummary ? "This page's title or summary" : "This title"} has hidden
      characters, shown as ⟨U+…⟩: they can make text read as something else.
    </p>
  )
}
