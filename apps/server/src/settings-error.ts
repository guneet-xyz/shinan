/**
 * A setting is missing or wrong. Its message names the setting and never
 * includes a secret's value, so the CLI prints it in full.
 */
export class SettingsError extends Error {
  override name = "SettingsError"
}
