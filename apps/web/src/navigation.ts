/** Leaves the app for another address, such as GitHub's sign-in page. */
export function leaveApp(url: string): void {
  window.location.assign(url)
}
