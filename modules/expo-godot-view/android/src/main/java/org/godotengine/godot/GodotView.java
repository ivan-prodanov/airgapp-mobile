/*************************************************************************/
/*  GodotView.java                                                       */
/*************************************************************************/
/*                       This file is part of:                           */
/*                           GODOT ENGINE                                */
/*                      https://godotengine.org                          */
/*************************************************************************/
/* Copyright (c) 2007-2020 Juan Linietsky, Ariel Manzur.                 */
/* Copyright (c) 2014-2020 Godot Engine contributors (cf. AUTHORS.md).   */
/*                                                                       */
/* Permission is hereby granted, free of charge, to any person obtaining */
/* a copy of this software and associated documentation files (the       */
/* "Software"), to deal in the Software without restriction, including   */
/* without limitation the rights to use, copy, modify, merge, publish,   */
/* distribute, sublicense, and/or sell copies of the Software, and to    */
/* permit persons to whom the Software is furnished to do so, subject to */
/* the following conditions:                                             */
/*                                                                       */
/* The above copyright notice and this permission notice shall be        */
/* included in all copies or substantial portions of the Software.       */
/*                                                                       */
/* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,       */
/* EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF    */
/* MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.*/
/* IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY  */
/* CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,  */
/* TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE     */
/* SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.                */
/*************************************************************************/

package org.godotengine.godot;

import org.godotengine.godot.input.GodotGestureHandler;
import org.godotengine.godot.input.GodotInputHandler;
import org.godotengine.godot.utils.GLUtils;
import org.godotengine.godot.xr.XRMode;
import org.godotengine.godot.xr.ovr.OvrConfigChooser;
import org.godotengine.godot.xr.ovr.OvrContextFactory;
import org.godotengine.godot.xr.ovr.OvrWindowSurfaceFactory;
import org.godotengine.godot.xr.regular.RegularConfigChooser;
import org.godotengine.godot.xr.regular.RegularContextFactory;
import org.godotengine.godot.xr.regular.RegularFallbackConfigChooser;

import android.annotation.SuppressLint;
import android.graphics.PixelFormat;
import android.opengl.GLSurfaceView;
import android.view.GestureDetector;
import android.view.KeyEvent;
import android.view.MotionEvent;

/**
 * A simple GLSurfaceView sub-class that demonstrate how to perform
 * OpenGL ES 2.0 rendering into a GL Surface. Note the following important
 * details:
 *
 * - The class must use a custom context factory to enable 2.0 rendering.
 *   See ContextFactory class definition below.
 *
 * - The class must use a custom EGLConfigChooser to be able to select
 *   an EGLConfig that supports 2.0. This is done by providing a config
 *   specification to eglChooseConfig() that has the attribute
 *   EGL10.ELG_RENDERABLE_TYPE containing the EGL_OPENGL_ES2_BIT flag
 *   set. See ConfigChooser class definition below.
 *
 * - The class must select the surface's format, then choose an EGLConfig
 *   that matches it exactly (with regards to red/green/blue/alpha channels
 *   bit depths). Failure to do so would result in an EGL_BAD_MATCH error.
 */
public class GodotView extends GLSurfaceView {

	private static String TAG = GodotView.class.getSimpleName();

	private final Godot activity;
	private final GodotInputHandler inputHandler;
	private final GestureDetector detector;
	private final GodotRenderer godotRenderer;

	public GodotView(Godot activity, XRMode xrMode, boolean p_use_gl3, boolean p_use_32_bits, boolean p_use_debug_opengl) {
		// PATCHED: Godot is a Fragment in this embed, not a Context — take the hosting Context.
		super(activity.requireContext());
		GLUtils.use_gl3 = p_use_gl3;
		GLUtils.use_32 = p_use_32_bits;
		GLUtils.use_debug_opengl = p_use_debug_opengl;

		this.activity = activity;
		this.inputHandler = new GodotInputHandler(this);
		this.detector = new GestureDetector(activity.requireContext(), new GodotGestureHandler(this));
		this.godotRenderer = new GodotRenderer();
		init(xrMode, false, 16, 0);
	}

	/**
	 * PATCHED: keep the GL thread — and with it the EGL context — alive across a detach.
	 *
	 * This is the fix for "the car disappears after navigating to another route and back", and the
	 * reason six earlier attempts in the Java layer all failed: the kill is in C++.
	 *
	 * GLSurfaceView.onDetachedFromWindow() calls mGLThread.requestExitAndWait(), which destroys the
	 * EGL context. React Native detaches this view tree on every navigation, so coming back gives
	 * the renderer a FRESH GL thread, and a fresh thread means GLSurfaceView calls
	 * onSurfaceCreated() again, and that calls GodotLib.newcontext(). In Godot 3.2.2
	 * (java_godot_lib_jni.cpp) newcontext does this when the engine is already running:
	 *
	 *     // GL context recreated because it was lost; restart app to let it reload everything
	 *     os_android->main_loop_end();
	 *     godot_java->restart(env);
	 *     step = -1; // Ensure no further steps are attempted
	 *
	 * Upstream's answer to a lost context is to RESTART THE PROCESS. We cannot: restart() is a
	 * no-op in this embed precisely because restarting would take the whole React Native app down
	 * (see Godot.java's patch summary). So the engine ends its main loop, sets step = -1 and is
	 * permanently dead — surface fine, view fine, frames "stepping", nothing drawn, and the host
	 * message queue never drained again. Measured on device: the re-attach spawns a new GL thread
	 * and logs `onSurfaceCreated -> newcontext` a second time (2026-08-21).
	 *
	 * Deliberately does NOT call super. GLSurfaceView's implementation is exactly the teardown we
	 * are avoiding, and View's own onDetachedFromWindow is a cleanup hook whose work the framework
	 * has already done in dispatchDetachedFromWindow. Skipping it leaves mDetached false, which is
	 * what we want: onAttachedToWindow then does nothing rather than starting a SECOND GL thread.
	 *
	 * The Surface itself still goes away — the SurfaceHolder callback fires normally — but that
	 * only costs the EGL *surface*. setPreserveEGLContextOnPause(true) above keeps the *context*,
	 * so re-attaching binds a new EGL surface to the live context and onSurfaceCreated is never
	 * called again. The engine never learns anything happened.
	 */
	@Override
	protected void onDetachedFromWindow() {
		// Intentionally empty — see above. Do not add a super call.
	}

	public void initInputDevices() {
		this.inputHandler.initInputDevices();
	}

	@SuppressLint("ClickableViewAccessibility")
	@Override
	public boolean onTouchEvent(MotionEvent event) {
		super.onTouchEvent(event);
		this.detector.onTouchEvent(event);
		return activity.gotTouchEvent(event);
	}

	@Override
	public boolean onKeyUp(final int keyCode, KeyEvent event) {
		return inputHandler.onKeyUp(keyCode, event) || super.onKeyUp(keyCode, event);
	}

	@Override
	public boolean onKeyDown(final int keyCode, KeyEvent event) {
		return inputHandler.onKeyDown(keyCode, event) || super.onKeyDown(keyCode, event);
	}

	@Override
	public boolean onGenericMotionEvent(MotionEvent event) {
		return inputHandler.onGenericMotionEvent(event) || super.onGenericMotionEvent(event);
	}

	private void init(XRMode xrMode, boolean translucent, int depth, int stencil) {

		setPreserveEGLContextOnPause(true);
		setFocusableInTouchMode(true);
		switch (xrMode) {

			case OVR:
				// Replace the default egl config chooser.
				setEGLConfigChooser(new OvrConfigChooser());

				// Replace the default context factory.
				setEGLContextFactory(new OvrContextFactory());

				// Replace the default window surface factory.
				setEGLWindowSurfaceFactory(new OvrWindowSurfaceFactory());
				break;

			case REGULAR:
			default:
				/* By default, GLSurfaceView() creates a RGB_565 opaque surface.
				 * If we want a translucent one, we should change the surface's
				 * format here, using PixelFormat.TRANSLUCENT for GL Surfaces
				 * is interpreted as any 32-bit surface with alpha by SurfaceFlinger.
				 */
				if (translucent) {
					this.getHolder().setFormat(PixelFormat.TRANSLUCENT);
				}

				/* Setup the context factory for 2.0 rendering.
				 * See ContextFactory class definition below
				 */
				setEGLContextFactory(new RegularContextFactory());

				/* We need to choose an EGLConfig that matches the format of
				 * our surface exactly. This is going to be done in our
				 * custom config chooser. See ConfigChooser class definition
				 * below.
				 */

				if (GLUtils.use_32) {
					setEGLConfigChooser(translucent ?
												new RegularFallbackConfigChooser(8, 8, 8, 8, 24, stencil,
														new RegularConfigChooser(8, 8, 8, 8, 16, stencil)) :
												new RegularFallbackConfigChooser(8, 8, 8, 8, 24, stencil,
														new RegularConfigChooser(5, 6, 5, 0, 16, stencil)));

				} else {
					setEGLConfigChooser(translucent ?
												new RegularConfigChooser(8, 8, 8, 8, 16, stencil) :
												new RegularConfigChooser(5, 6, 5, 0, 16, stencil));
				}
				break;
		}

		/* Set the renderer responsible for frame rendering */
		setRenderer(godotRenderer);
	}

	public void onBackPressed() {
		activity.onBackPressed();
	}

	@Override
	public void onResume() {
		super.onResume();

		queueEvent(new Runnable() {
			@Override
			public void run() {
				// Resume the renderer
				godotRenderer.onActivityResumed();
				GodotLib.focusin();
			}
		});
	}

	@Override
	public void onPause() {
		super.onPause();

		queueEvent(new Runnable() {
			@Override
			public void run() {
				GodotLib.focusout();
				// Pause the renderer
				godotRenderer.onActivityPaused();
			}
		});
	}
}
