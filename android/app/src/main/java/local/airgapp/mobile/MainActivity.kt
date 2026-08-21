package local.airgapp.mobile
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
   * Root Back SUSPENDS the app; it never destroys the Activity.
   *
   * Two reasons, and the second is load-bearing:
   *
   * 1. Parity. On iOS the equivalent gesture backgrounds the app — it does not tear it down. A
   *    non-root Back still pops the navigation stack; only Back at the root reaches here.
   *
   * 2. The Godot engine cannot survive Activity recreation. Godot 3.2 responds to a lost GL
   *    context by ending its main loop and restarting the process (java_godot_lib_jni.cpp's
   *    newcontext), and restart() is a no-op in this embed because restarting would take React
   *    Native down with it — so the engine ends up permanently dead, with step = -1. Destroying
   *    the Activity destroys the window, the surface and the fragment's view, and the relaunched
   *    app came back with no car at all (measured 2026-08-21). Keeping the Activity alive keeps
   *    the GL thread and its EGL context alive, which is the same thing that makes navigation
   *    survivable (see GodotView.onDetachedFromWindow).
   *
   * The Expo template shipped this only for SDK <= R, on the reasoning that Android S+ "does more
   * than moveTaskToBack". For a root activity on SDK 36 what it does is FINISH it, which is
   * exactly what we cannot afford.
   *
   * moveTaskToBack(false) returns false when this is not the root of its task; the default
   * implementation then finishes the activity as normal.
   */
  override fun invokeDefaultOnBackPressed() {
      if (!moveTaskToBack(false)) {
          super.invokeDefaultOnBackPressed()
      }
  }
}
