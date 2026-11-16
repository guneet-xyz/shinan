import { Navigate, Route, Routes } from "react-router"

import { ErrorBoundary } from "./components/ErrorBoundary"
import { AppShell } from "./components/Layout"
import { Account } from "./pages/Account"
import { Home } from "./pages/Home"
import { NotFound } from "./pages/NotFound"
import { SignIn } from "./pages/SignIn"
import { General } from "./pages/workspace/General"
import { Invitations } from "./pages/workspace/Invitations"
import { Members } from "./pages/workspace/Members"
import { SecurityLog } from "./pages/workspace/SecurityLog"
import {
  SettingsLayout,
  WorkspaceLayout,
} from "./pages/workspace/WorkspaceLayout"
import { RequireSignIn } from "./session"

/**
 * The app's pages. Only the sign-in page is shown without sign-in; every
 * other address, including unknown ones, needs it first (identity §10).
 */
export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="sign-in" element={<SignIn />} />
        <Route element={<RequireSignIn />}>
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
            <Route path="account" element={<Account />} />
            <Route path="w/:workspaceId" element={<WorkspaceLayout />}>
              <Route index element={<Navigate to="settings" replace />} />
              <Route path="settings" element={<SettingsLayout />}>
                <Route index element={<Navigate to="general" replace />} />
                <Route path="general" element={<General />} />
                <Route path="members" element={<Members />} />
                <Route path="invitations" element={<Invitations />} />
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
