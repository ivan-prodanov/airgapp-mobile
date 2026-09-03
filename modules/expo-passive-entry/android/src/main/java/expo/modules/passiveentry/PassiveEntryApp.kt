package expo.modules.passiveentry

import android.app.Activity
import android.app.Application
import android.os.Bundle
import expo.modules.core.interfaces.ApplicationLifecycleListener

/**
 * The launch-time hook — what PassiveEntryAppDelegate.swift is on iOS. Builds the runtime with the
 * application context (so a service- or receiver-started process has one before any React context
 * exists) and registers the activity-visibility callbacks that make the single-writer gate honest.
 *
 * It deliberately does NOT start the foreground service: Application.onCreate in a process started
 * by a broadcast or alarm is not an exempt trigger on Android 12+, but the receiver's own onReceive
 * is — so PassiveEntryReceiver/PassiveEntryBootReceiver call startIfConfigured themselves.
 */
class PassiveEntryApp : ApplicationLifecycleListener {
  override fun onCreate(application: Application) {
    val rt = PassiveEntryRuntime.ensure(application)
    application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(activity: Activity) = rt.onActivityStarted()
      override fun onActivityStopped(activity: Activity) = rt.onActivityStopped()
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
      override fun onActivityResumed(activity: Activity) {}
      override fun onActivityPaused(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {}
    })
    rt.log.log("application created: mode=${rt.mode} armed=${rt.store.vin != null}")
  }
}
