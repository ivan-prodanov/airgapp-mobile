// Where a PUSHED (not bundled) SQLite database lives on each platform.
//
// expo-sqlite's `defaultDatabaseDirectory` is a `SQLite` subdirectory of the app's
// private storage — `<container>/Documents/SQLite` on iOS, `<filesDir>/SQLite` on
// Android. We deliberately open chargers.db one level ABOVE that, in the parent, so the
// deploy scripts can push into a directory that always exists rather than having to
// create `SQLite/` first.
//
// Pulled out of chargerSource.ts so the derivation is node-testable: it is a string
// transform that decides whether a 36 MB push lands where the app looks, and getting it
// wrong fails SILENTLY (chargerSource catches and degrades to "no chargers", which reads
// as an empty map rather than an error).
export function pushedDbDir(defaultDatabaseDirectory: string | undefined): string | undefined {
  return defaultDatabaseDirectory?.replace(/\/SQLite\/?$/, '');
}
