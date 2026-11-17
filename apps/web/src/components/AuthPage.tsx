import type { ReactNode } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"

/**
 * The frame of the pages shown before sign-in (sign-in, setup, invitations):
 * one centred card, full width on a phone.
 */
export function AuthPage(props: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <main
      id="content"
      className="flex min-h-svh flex-col items-center justify-center bg-muted/40 p-4 sm:p-6"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">
            {props.title}
          </h1>
          {props.description && (
            <CardDescription>{props.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="gap-4">{props.children}</CardContent>
      </Card>
    </main>
  )
}
