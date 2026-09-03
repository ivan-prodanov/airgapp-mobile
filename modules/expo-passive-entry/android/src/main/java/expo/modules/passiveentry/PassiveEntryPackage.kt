package expo.modules.passiveentry

import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** Discovered by expo-modules-autolinking (a `*Package.kt` importing `Package`); registers the app-create hook. */
class PassiveEntryPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(PassiveEntryApp())
}
