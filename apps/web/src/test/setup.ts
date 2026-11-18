import { cleanup, configure } from "@testing-library/react"
import { afterEach } from "vitest"

// `findBy…` and `waitFor` wait 5 s rather than Testing Library's 1 s, times
// SHINAN_TEST_TIMEOUT_SCALE (set by vitest.config.ts), so a busy machine does
// not fail them (#131); a page that never shows still fails within the test's
// timeout.
configure({
  asyncUtilTimeout: 5000 * Number(process.env.SHINAN_TEST_TIMEOUT_SCALE ?? 1),
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})
