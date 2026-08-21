package local.airgapp.mobile

import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

/**
 * The ACTION_SEND target — Android's answer to the iOS Share Extension's popup.
 *
 * Sharing a place into airgapp IS the decision, so a share must not open the app. It used to: the
 * intent-filter lived on MainActivity, which meant forwarding one coordinate booted the whole app
 * (Godot engine included) and dumped the user on the Location screen they had not asked for.
 *
 * This activity renders ONE React component, "shareSheet" (registered in index.js), over a
 * transparent window. It shares MainActivity's React host and JS context — same process, one
 * bundle — which is why the sheet can drive the app's real BLE stack directly. iOS cannot do this:
 * its extension is a separate process, hence the embedded JSC engine and the Swift transport layer.
 *
 * Manifest notes that matter: `taskAffinity=""` keeps it out of the app's task, so dismissing it
 * returns the user to whatever they shared from rather than to airgapp, and `excludeFromRecents`
 * keeps a transient sheet out of the recents list. Together they are what make this read as a
 * system share sheet instead of a second copy of the app.
 *
 * NO SplashScreenManager here, unlike MainActivity: a splash on a share sheet would be a
 * full-screen flash of the app's launch screen over the app the user is actually in.
 */
class ShareActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // null, matching MainActivity: React Native restores its own state, and handing back a saved
    // Bundle makes the delegate try to restore a view hierarchy that no longer exists.
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "shareSheet"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      object : DefaultReactActivityDelegate(
        this,
        mainComponentName,
        fabricEnabled
      ) {}
    )
  }
}
