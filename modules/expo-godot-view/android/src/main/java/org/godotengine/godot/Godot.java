/*************************************************************************/
/*  Godot.java — VENDORED AND PATCHED for the airgapp embed.             */
/*************************************************************************/
/* Upstream: godot-src (tag 3.2.2-stable)                                */
/*   platform/android/java/lib/src/org/godotengine/godot/Godot.java      */
/*                                                                       */
/* Upstream declares:                                                    */
/*   public abstract class Godot extends FragmentActivity                */
/*            implements SensorEventListener, IDownloaderClient          */
/* i.e. the engine OWNS the Activity and the whole screen. We embed the  */
/* renderer inside a React Native view tree, so it cannot. This is the   */
/* direct analogue of what GodotHost.mm does on iOS: keep the engine's   */
/* expectations, drop the app-ownership.                                 */
/*                                                                       */
/* WHY ContextWrapper: GodotView extends GLSurfaceView and calls         */
/* `super(activity)`, so this class must BE a Context. Wrapping the host */
/* Activity satisfies that and inherits getAssets/getFilesDir/           */
/* getPackageName/getSystemService/getContentResolver/startActivity for  */
/* free; only genuinely Activity-scoped calls are forwarded by hand.     */
/*                                                                       */
/* WHY THE CLASS NAME AND PACKAGE ARE LOAD-BEARING:                      */
/* java_godot_wrapper.cpp:44 does                                        */
/*   FindClass("org/godotengine/godot/Godot")                            */
/* and then GetMethodID for 17 exact signatures, PLUS getClassLoader     */
/* resolved lazily at java_godot_wrapper.cpp:93 — 18 in total. Renaming  */
/* dropping any of those 17 methods, breaks the native bridge at         */
/* runtime with no compile-time warning. They are marked @Keep below.    */
/*                                                                       */
/* PATCH SUMMARY vs upstream:                                            */
/*  - not an Activity; wraps one (see above)                             */
/*  - the Google Play APK-expansion downloader is removed entirely       */
/*    (IDownloaderClient, GodotDownloaderService, obb handling). We load */
/*    the pack with `--main-pack`, exactly like the iOS embed, so the    */
/*    expansion path was dead weight pulling in an external dependency.  */
/*  - onVideoInit() builds the view tree but does NOT call               */
/*    setContentView(); the host attaches `containerLayout` itself.      */
/*  - getCommandLine() returns the host-supplied argv instead of reading */
/*    the exporter's `assets/_cl_`.                                      */
/*  - restart() is a no-op (upstream restarts the process via            */
/*    GodotInstrumentation, which would take the whole RN app down).     */
/*  - lifecycle entry points are plain public methods the host drives.   */
/*************************************************************************/

package org.godotengine.godot;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.ConfigurationInfo;
import android.app.ActivityManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Vibrator;
import android.provider.Settings.Secure;
import android.view.Surface;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import android.view.LayoutInflater;
import android.os.Bundle;

import androidx.annotation.Keep;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import org.godotengine.godot.input.GodotEditText;
import org.godotengine.godot.plugin.GodotPlugin;
import org.godotengine.godot.plugin.GodotPluginRegistry;
import org.godotengine.godot.utils.GodotNetUtils;
import org.godotengine.godot.utils.PermissionsUtil;
import org.godotengine.godot.xr.XRMode;

public class Godot extends Fragment implements SensorEventListener {
	private static final String TAG = "Godot";

	/** The engine's view tree, built by onVideoInit and returned from onCreateView. */
	public FrameLayout containerLayout;
	public GodotView mView;

	public static GodotIO io;
	public static GodotNetUtils netUtils;

	/** argv handed in by the host, e.g. {"airgapp", "--main-pack", "/abs/path/airgapp.pck"}. */
	private String[] commandLine = new String[0];

	private final XRMode xrMode = XRMode.REGULAR;
	private final boolean use32Bits = false;
	private final boolean useDebugOpengl = false;

	private ClipboardManager mClipboard;
	private GodotPluginRegistry pluginRegistry;
	private SensorManager mSensorManager;
	private boolean activityResumed = false;
	private boolean godotInitialized = false;

	/**
	 * FRAGMENT, not an Activity and not a ContextWrapper.
	 *
	 * Upstream 3.2.2 declares `Godot extends FragmentActivity`. The official Tesla app ships the
	 * SAME engine binary (libgodot_android.so reports 3.2.2.stable.custom against our
	 * 3.2.2.stable.official) with the Java layer patched so `Godot` is a Fragment — they backported
	 * the 3.2.3+ refactor, and `com.tesla.godot.TMGodot extends Godot` is added with
	 * `supportFragmentManager.add(tMGodot, "godot_fragment")`.
	 *
	 * That shape is load-bearing for an embed. A Fragment owns its view independently of the React
	 * Native view tree, so navigating away and back does not tear the surface down. As a
	 * ContextWrapper whose view RN detached and re-attached, the engine kept drawing into a stale
	 * compositing layer that was never shown — the car silently vanished (see docs/android-parity.md).
	 */
	public Godot() {
		super();
	}

	public void setCommandLine(String[] argv) {
		this.commandLine = argv != null ? argv : new String[0];
	}

	// ── Context / Activity delegators ───────────────────────────────────────────────
	// Being a Fragment, this class is no longer a Context, but GodotIO, GodotNetUtils,
	// PermissionsUtil and GodotView all treat it as one. Delegating keeps every one of those call
	// sites byte-identical to upstream, which keeps the vendor diff small.

	public Context getApplicationContext() {
		return requireContext().getApplicationContext();
	}

	public android.content.pm.PackageManager getPackageManager() {
		return requireContext().getPackageManager();
	}

	public String getPackageName() {
		return requireContext().getPackageName();
	}

	public Object getSystemService(String name) {
		return requireContext().getSystemService(name);
	}

	public android.content.ContentResolver getContentResolver() {
		return requireContext().getContentResolver();
	}

	public android.content.res.AssetManager getAssets() {
		return requireContext().getAssets();
	}

	public java.io.File getFilesDir() {
		return requireContext().getFilesDir();
	}

	/**
	 * The EIGHTEENTH JNI-bound method, and the one the 17-method init list does not mention.
	 *
	 * java_godot_wrapper.cpp:93 resolves `getClassLoader` LAZILY (not in the init block), and
	 * GodotLib.setup() calls it while loading modules. ContextWrapper supplied it for free;
	 * Fragment does not, so the Fragment port aborted the GL thread on first setup with
	 * `NoSuchMethodError: no non-static method Godot.getClassLoader()`.
	 */
	public ClassLoader getClassLoader() {
		return requireContext().getClassLoader();
	}

	public int checkSelfPermission(String permission) {
		return androidx.core.content.ContextCompat.checkSelfPermission(requireContext(), permission);
	}

	public void runOnUiThread(Runnable action) {
		requireActivity().runOnUiThread(action);
	}

	/**
	 * PATCHED: no-op. Godot's project settings declare a landscape orientation, and upstream — which
	 * owns the Activity — happily applies it. In the embed that rotated the ENTIRE React Native app
	 * to landscape (observed 2026-08-21: mRotation=ROTATION_90 right after the engine booted).
	 * Orientation is the host app's decision (app.json declares portrait); the engine only gets to
	 * render into the surface it is given.
	 */
	public void setRequestedOrientation(int orientation) {
		android.util.Log.i(TAG, "engine asked for orientation " + orientation + " — ignored; the host owns orientation");
	}

	// requestPermissions(String[], int) is inherited from Fragment and does exactly what the
	// engine's callers expect — no delegator needed (and overriding it is a compile error).

	public android.view.Window getWindow() {
		return requireActivity().getWindow();
	}

	// ── lifecycle, driven by the host (GodotHost.kt) ───────────────────────────────

	@Override
	public void onCreate(@Nullable Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		mClipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
		pluginRegistry = GodotPluginRegistry.initializePluginRegistry(this);
	}

	/**
	 * Boots the engine and hands back its view.
	 *
	 * GodotLib.initialize calls back into onVideoInit on this same thread, which is what actually
	 * builds containerLayout — so the engine must come up before we can return a view.
	 */
	@Override
	@Nullable
	public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
			@Nullable Bundle savedInstanceState) {
		if (!godotInitialized) {
			initializeGodot();
		}
		return containerLayout;
	}

	private void initializeGodot() {
		io = new GodotIO(this);
		io.unique_id = Secure.getString(getContentResolver(), Secure.ANDROID_ID);
		GodotLib.io = io;
		netUtils = new GodotNetUtils(this);

		mSensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
		registerSensor(Sensor.TYPE_ACCELEROMETER);
		registerSensor(Sensor.TYPE_GRAVITY);
		registerSensor(Sensor.TYPE_MAGNETIC_FIELD);
		registerSensor(Sensor.TYPE_GYROSCOPE);

		// `false` = no APK expansion; the pack arrives via --main-pack.
		GodotLib.initialize(this, getAssets(), false);
		godotInitialized = true;
	}

	private void registerSensor(int type) {
		Sensor s = mSensorManager.getDefaultSensor(type);
		if (s != null) {
			mSensorManager.registerListener(this, s, SensorManager.SENSOR_DELAY_GAME);
		}
	}

	@Override
	public void onResume() {
		super.onResume();
		activityResumed = true;
		if (mView != null) mView.onResume();
		for (GodotPlugin plugin : pluginRegistry.getAllPlugins()) plugin.onMainResume();
	}

	@Override
	public void onPause() {
		super.onPause();
		activityResumed = false;
		if (mView != null) mView.onPause();
		for (GodotPlugin plugin : pluginRegistry.getAllPlugins()) plugin.onMainPause();
	}

	@Override
	public void onDestroy() {
		super.onDestroy();
		if (pluginRegistry != null) {
			for (GodotPlugin plugin : pluginRegistry.getAllPlugins()) plugin.onMainDestroy();
		}
		if (mSensorManager != null) mSensorManager.unregisterListener(this);
		if (godotInitialized) GodotLib.ondestroy(this);
	}

	public boolean isGodotInitialized() {
		return godotInitialized;
	}

	// ── the 18 methods java_godot_wrapper.cpp binds by name ────────────────────────
	// Signatures are load-bearing. @Keep stops R8 stripping them: nothing in Java calls
	// most of these, so a minifying build would otherwise consider them unreachable.

	/**
	 * Called by java_godot_lib_jni.cpp to build the GLSurfaceView.
	 *
	 * PATCHED: upstream ends with setContentView(layout) because it owns the screen. Here the
	 * layout is stored for the host to attach into the RN view tree instead.
	 */
	@Keep
	private void onVideoInit() {
		final boolean useGl3 = getGLESVersionCode() >= 0x00030000;

		containerLayout = new FrameLayout(requireContext());
		containerLayout.setLayoutParams(new FrameLayout.LayoutParams(
				ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

		GodotEditText edittext = new GodotEditText(requireContext());
		edittext.setLayoutParams(new ViewGroup.LayoutParams(
				ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
		containerLayout.addView(edittext);

		mView = new GodotView(this, xrMode, useGl3, use32Bits, useDebugOpengl);
		containerLayout.addView(mView, new FrameLayout.LayoutParams(
				ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
		edittext.setView(mView);
		io.setEdit(edittext);

		// NO setZOrderMediaOverlay CALL HERE — deliberately, and it is load-bearing.
		//
		// This is what made the car vanish after navigating to another route and back. React Native
		// detaches and re-attaches this view tree on navigation. setZOrderMediaOverlay() is only
		// honoured while the surface's window attachment is being established, so a re-attached
		// surface keeps the compositing layer it was given the first time — a stale one. The engine
		// goes on stepping frames into a layer nobody composites, which is exactly what was measured:
		// onDrawFrame kept running, the view came back VISIBLE at 1080x2340, and the screen showed
		// nothing (2026-08-21).
		//
		// The official Tesla app runs this same engine (3.2.2.stable.custom vs our .official) with the
		// same RN embed and never calls it — not in its Godot.java, not in its GodotView.init(). Their
		// TMGodotViewManager hands the fragment's FrameLayout straight to RN as the view instance and
		// lets it be re-parented freely. Without the flag the surface is a plain punch-through below
		// the window, whose hole is re-cut on every draw pass, so re-attaching costs nothing.

		// GodotLib.setup MUST run on the GL thread (see GodotLib.java's own doc comment), and the
		// plugins MUST be registered AFTER it completes — that call is what actually publishes
		// AndroidGodotInterface as an engine singleton. Skip it and
		// `Engine.has_singleton("AndroidGodotInterface")` is false in MobileComm.gd and the whole
		// RN<->Godot bridge is silently dead, with the scene still rendering perfectly.
		final String[] argv = commandLine;
		mView.queueEvent(() -> {
			GodotLib.setup(argv);
			for (GodotPlugin plugin : pluginRegistry.getAllPlugins()) {
				plugin.onRegisterPluginWithGodotNative();
			}
			setKeepScreenOn("True".equals(
					GodotLib.getGlobal("display/window/energy_saving/keep_screen_on")));
		});

		for (GodotPlugin plugin : pluginRegistry.getAllPlugins()) {
			View pluginView = plugin.onMainCreate(requireActivity());
			if (pluginView != null) containerLayout.addView(pluginView);
		}
	}

	/** PATCHED: no-op. Upstream restarts the process, which would kill the whole RN app. */
	@Keep
	public void restart() {
		android.util.Log.w(TAG, "restart() requested by the engine — ignored in the embed");
	}

	@Keep
	private void forceQuit() {
		android.util.Log.w(TAG, "forceQuit() requested by the engine — ignored in the embed");
	}

	@Keep
	public void setKeepScreenOn(final boolean enabled) {
		runOnUiThread(() -> {
			if (enabled) {
				getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
			} else {
				getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
			}
		});
	}

	@Keep
	public void alert(final String message, final String title) {
		android.util.Log.w(TAG, "godot alert [" + title + "] " + message);
	}

	@Keep
	public int getGLESVersionCode() {
		ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
		ConfigurationInfo deviceInfo = am.getDeviceConfigurationInfo();
		return deviceInfo.reqGlEsVersion;
	}

	@Keep
	public String getClipboard() {
		String copiedText = "";
		if (mClipboard != null && mClipboard.getPrimaryClip() != null
				&& mClipboard.getPrimaryClip().getItemCount() > 0) {
			ClipData.Item item = mClipboard.getPrimaryClip().getItemAt(0);
			copiedText = item.getText() == null ? "" : item.getText().toString();
		}
		return copiedText;
	}

	@Keep
	public void setClipboard(String text) {
		if (mClipboard == null) return;
		mClipboard.setPrimaryClip(ClipData.newPlainText(text, text));
	}

	@Keep
	public boolean requestPermission(String name) {
		return PermissionsUtil.requestPermission(name, this);
	}

	@Keep
	public boolean requestPermissions() {
		return PermissionsUtil.requestManifestPermissions(this);
	}

	@Keep
	public String[] getGrantedPermissions() {
		return PermissionsUtil.getGrantedPermissions(this);
	}

	@Keep
	public void initInputDevices() {
		if (mView != null) mView.initInputDevices();
	}

	@Keep
	private Surface getSurface() {
		return mView.getHolder().getSurface();
	}

	@Keep
	private boolean isActivityResumed() {
		return activityResumed;
	}

	@Keep
	private void vibrate(int durationMs) {
		if (durationMs <= 0) return;
		Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
		if (v == null || !v.hasVibrator()) return;
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			v.vibrate(android.os.VibrationEffect.createOneShot(
					durationMs, android.os.VibrationEffect.DEFAULT_AMPLITUDE));
		} else {
			//noinspection deprecation
			v.vibrate(durationMs);
		}
	}

	@Keep
	private String getInputFallbackMapping() {
		return xrMode.inputFallbackMapping;
	}

	@Keep
	protected void onGodotMainLoopStarted() {
		for (GodotPlugin plugin : pluginRegistry.getAllPlugins()) plugin.onGodotMainLoopStarted();
	}

	/** PATCHED: the host argv (`--main-pack …`), not the exporter's `assets/_cl_`. */
	@Keep
	protected String[] getCommandLine() {
		return commandLine;
	}

	// ── input + threading, used by GodotView / GodotInputHandler ───────────────────

	/** Ported verbatim from upstream Godot.java — packs pointers into the int[] GodotLib.touch wants. */
	public boolean gotTouchEvent(final android.view.MotionEvent event) {
		final int evcount = event.getPointerCount();
		if (evcount == 0) return true;
		if (mView == null) return true;

		final int[] arr = new int[evcount * 3];
		for (int i = 0; i < evcount; i++) {
			arr[i * 3 + 0] = event.getPointerId(i);
			arr[i * 3 + 1] = (int) event.getX(i);
			arr[i * 3 + 2] = (int) event.getY(i);
		}
		final int pointerIdx = event.getPointerId(event.getActionIndex());
		final int action = event.getAction() & android.view.MotionEvent.ACTION_MASK;

		mView.queueEvent(() -> {
			switch (action) {
				case android.view.MotionEvent.ACTION_DOWN:
					GodotLib.touch(0, 0, evcount, arr);
					break;
				case android.view.MotionEvent.ACTION_MOVE:
					GodotLib.touch(1, 0, evcount, arr);
					break;
				case android.view.MotionEvent.ACTION_POINTER_UP:
					GodotLib.touch(4, pointerIdx, evcount, arr);
					break;
				case android.view.MotionEvent.ACTION_POINTER_DOWN:
					GodotLib.touch(3, pointerIdx, evcount, arr);
					break;
				case android.view.MotionEvent.ACTION_CANCEL:
				case android.view.MotionEvent.ACTION_UP:
					GodotLib.touch(2, 0, evcount, arr);
					break;
				default:
					break;
			}
		});
		return true;
	}

	/**
	 * PATCHED: forward Back to the host Activity.
	 *
	 * GodotInputHandler.onKeyDown intercepts KEYCODE_BACK, calls this, and returns TRUE — it
	 * consumes the event so a game can handle Back itself. Combined with GodotView's
	 * setFocusableInTouchMode(true), the focused engine surface swallows every Back press before
	 * React Native's BackHandler can see it, and upstream's "let the game decide" default means
	 * nothing happens at all. On device that read as the back gesture being dead on
	 * Controls/Climate (reported 2026-08-21).
	 *
	 * The engine has no navigation of its own in this embed — the host owns it — so hand the press
	 * straight back to the Activity, where ReactActivity dispatches it to the JS BackHandler and
	 * useAndroidBack pops the pushed card. No recursion: the Activity's dispatch never re-enters
	 * the engine's input handler.
	 */
	public void onBackPressed() {
		for (GodotPlugin plugin : pluginRegistry.getAllPlugins()) {
			if (plugin.onMainBackPressed()) return;
		}
		final android.app.Activity host = requireActivity();
		host.runOnUiThread(() -> {
			//noinspection deprecation
			host.onBackPressed();
		});
	}

	public final void runOnRenderThread(@NonNull Runnable action) {
		if (mView != null) mView.queueEvent(action);
	}

	// ── sensors ────────────────────────────────────────────────────────────────────

	@Override
	public void onSensorChanged(SensorEvent event) {
		if (mView == null) return;
		final float[] v = event.values;
		switch (event.sensor.getType()) {
			case Sensor.TYPE_ACCELEROMETER:
				runOnRenderThread(() -> GodotLib.accelerometer(-v[0], -v[1], -v[2]));
				break;
			case Sensor.TYPE_GRAVITY:
				runOnRenderThread(() -> GodotLib.gravity(-v[0], -v[1], -v[2]));
				break;
			case Sensor.TYPE_MAGNETIC_FIELD:
				runOnRenderThread(() -> GodotLib.magnetometer(-v[0], -v[1], -v[2]));
				break;
			case Sensor.TYPE_GYROSCOPE:
				runOnRenderThread(() -> GodotLib.gyroscope(v[0], v[1], v[2]));
				break;
			default:
				break;
		}
	}

	@Override
	public final void onAccuracyChanged(Sensor sensor, int accuracy) {
		// Not used by the engine.
	}
}
