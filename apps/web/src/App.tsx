import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router"

import { ErrorBoundary } from "./components/ErrorBoundary"
import { AppShell } from "./components/Layout"
import { Loading } from "./components/status"
import { Account } from "./pages/Account"
import { AgentSetup } from "./pages/AgentSetup"
import { EmailChangePage } from "./pages/EmailChange"
import { GitHubEmail } from "./pages/GitHubEmail"
import { Home } from "./pages/Home"
import { Installation } from "./pages/Installation"
import { InvitationPage } from "./pages/Invitation"
import { NotFound } from "./pages/NotFound"
import { Setup } from "./pages/Setup"
import { SignIn } from "./pages/SignIn"
import { SignInLink } from "./pages/SignInLink"
import { Agents } from "./pages/workspace/Agents"
import { General } from "./pages/workspace/General"
import { Invitations } from "./pages/workspace/Invitations"
import { Members } from "./pages/workspace/Members"
import { SecurityLog } from "./pages/workspace/SecurityLog"
import {
  SettingsLayout,
  WorkspaceLayout,
} from "./pages/workspace/WorkspaceLayout"
import { YourAgents } from "./pages/YourAgents"
import { RequireSignIn } from "./session"

// The wiki, with its Markdown renderer, loads only on wiki pages.
const WikiRoutes = lazy(() => import("./pages/wiki/WikiRoutes"))

/**
 * The app's pages. Only the sign-in pages (including the confirm page of an
 * emailed sign-in link), the first-start setup page and the
 * invitation acceptance page (which shows nothing but the installation's
 * name before sign-in) are shown without sign-in; every other address,
 * including unknown ones, needs it first (identity §10).
 */
export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="sign-in" element={<SignIn />} />
        <Route path="sign-in/github" element={<GitHubEmail />} />
        <Route path="sign-in/link" element={<SignInLink />} />
        <Route path="setup" element={<Setup />} />
        <Route path="invitation" element={<InvitationPage />} />
        <Route path="email-change" element={<EmailChangePage />} />
        <Route element={<RequireSignIn />}>
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
            <Route path="account" element={<Account />} />
            <Route path="account/agents" element={<YourAgents />} />
            <Route path="account/agents/setup" element={<AgentSetup />} />
            <Route path="installation" element={<Installation />} />
            <Route path="w/:workspaceId" element={<WorkspaceLayout />}>
              {/* The wiki opens a workspace until the Now screen exists (M3). */}
              <Route index element={<Navigate to="wiki" replace />} />
              <Route
                path="wiki/*"
                element={
                  <Suspense fallback={<Loading />}>
                    <WikiRoutes />
                  </Suspense>
                }
              />
              <Route path="settings" element={<SettingsLayout />}>
                <Route index element={<Navigate to="general" replace />} />
                <Route path="general" element={<General />} />
                <Route path="members" element={<Members />} />
                <Route path="invitations" element={<Invitations />} />
                <Route path="agents" element={<Agents />} />
                <Route path="security-log" element={<SecurityLog />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}
