// Tilt input. Replaces the original GDevelop project's DeviceSensors extension.
//
// Uses the standard `deviceorientation` event's `gamma` value (left/right tilt,
// in degrees) rather than trying to replicate GDevelop's raw-accelerometer math —
// gamma is the normal way to read "tilt phone left/right" on the web and behaves
// consistently across iOS/Android, whereas the original had separate sign-flipped
// formulas per platform (a sign of the raw-accelerometer approach being finicky).
//
// Exposes Input.tiltX, a smoothed value roughly in [-1, 1]. Game code multiplies
// this by however much sideways force it wants — it does not read raw degrees.
const Input = (() => {
  const TILT_CLAMP_DEGREES = 30; // phone tilted this far = full strength
  const SMOOTHING = 0.15; // 0 = no smoothing, 1 = frozen

  let rawTilt = 0;
  let smoothedTilt = 0;
  let listening = false;

  // Desktop-only fallback so Stage 1 can be verified in a regular browser
  // preview before it's ever tested on a phone. Harmless on real phones —
  // nothing presses arrow keys there.
  const keys = { left: false, right: false };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') keys.left = true;
    if (e.key === 'ArrowRight') keys.right = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
  });

  // Second desktop-only fallback (Rob): mouse X position across the game area
  // maps directly to tilt, the same way gamma (an absolute angle) does for a
  // real phone — center of the game = 0, its left/right edges = -1/+1 — rather
  // than tracking drag distance from a click point. Guarded to pointerType
  // 'mouse' so it can't be triggered by touch drags on a real phone (those
  // fire pointermove with pointerType 'touch', not 'mouse').
  const gameWrapEl = document.getElementById('gameWrap');
  let mouseTilt = null; // null until the mouse actually moves — don't force tilt to 0 just because deviceorientation/keys haven't fired yet
  window.addEventListener('pointermove', (e) => {
    // document.hasFocus() guards against the browser window itself being in
    // the background — Rob: the ball kept responding to mouse movement even
    // while he was working in a different window/app entirely. A background
    // tab/window can still receive pointermove in some cases (the OS just
    // reports cursor position crossing that window's screen bounds,
    // regardless of which window is actually focused), so pointerType alone
    // wasn't enough to stop it.
    if (e.pointerType !== 'mouse' || !gameWrapEl || !document.hasFocus()) return;
    const rect = gameWrapEl.getBoundingClientRect();
    const norm = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    mouseTilt = Math.max(-1, Math.min(1, norm));
  });
  // Let it drift back to center on leaving the game area, or on the browser
  // window losing focus entirely (switching to another app/window) — same
  // spirit as the keyboard fallback centering when no arrow key is held.
  window.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') mouseTilt = null;
  });
  window.addEventListener('blur', () => { mouseTilt = null; });

  // gamma/beta from deviceorientation are DEVICE-relative, not SCREEN-relative
  // — they describe rotation around the phone's own physical axes as if it
  // were always held in its natural (portrait) orientation, regardless of how
  // the page is actually being displayed. Landscape mode (Rob) rotates the
  // physical device 90°, so "left/right tilt from the player's point of view"
  // is now what the sensor reports as beta (front/back tilt), not gamma —
  // reading gamma unconditionally, like this did before landscape existed,
  // meant real landscape tilting barely registered while tilting the phone
  // toward/away from the player (physically pitching it) did instead.
  // screen.orientation.angle (falling back to the older window.orientation
  // for older iOS Safari) says which physical rotation is currently in
  // effect, so the right raw axis — and its sign — can be picked per angle.
  function getScreenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    if (typeof window.orientation === 'number') return window.orientation;
    return 0;
  }

  function handleOrientation(event) {
    const angle = getScreenAngle();
    let tiltDeg;
    if (angle === 90) tiltDeg = -event.beta;
    else if (angle === 270 || angle === -90) tiltDeg = event.beta;
    else if (angle === 180) tiltDeg = -event.gamma;
    else tiltDeg = event.gamma;
    if (tiltDeg === null || tiltDeg === undefined) return;
    const clamped = Math.max(-TILT_CLAMP_DEGREES, Math.min(TILT_CLAMP_DEGREES, tiltDeg));
    rawTilt = clamped / TILT_CLAMP_DEGREES;
  }

  function needsPermissionPrompt() {
    return typeof DeviceOrientationEvent !== 'undefined'
      && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  // Must be called from inside a user-gesture handler (a tap), or iOS silently
  // ignores the permission request. Resolves true if we're good to read tilt
  // (permission granted, or no permission needed on this device/browser).
  async function requestPermission() {
    if (needsPermissionPrompt()) {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        if (result !== 'granted') return false;
      } catch (e) {
        return false;
      }
    }
    if (typeof DeviceOrientationEvent !== 'undefined') {
      window.addEventListener('deviceorientation', handleOrientation);
    }
    listening = true;
    return true;
  }

  function update() {
    // 0.08/frame reached full tilt in ~0.2s — fine for a real phone tilt (a
    // physical motion that's naturally gradual), way too twitchy for a key
    // that's either fully down or fully up with nothing in between (Rob:
    // arrow keys tip the ball off the platform too fast). Slowed to 0.03
    // (~0.55s to full tilt).
    if (keys.left) rawTilt = Math.max(-1, rawTilt - 0.03);
    else if (keys.right) rawTilt = Math.min(1, rawTilt + 0.03);
    // Mouse is absolute (like gamma), not ramped — it can just be assigned
    // directly whenever it's actively positioned over the game area.
    else if (mouseTilt !== null) rawTilt = mouseTilt;
    else if (!listening) {
      rawTilt *= 0.9; // let the keyboard fallback drift back to center
    }
    smoothedTilt += (rawTilt - smoothedTilt) * (1 - SMOOTHING);
  }

  return {
    get tiltX() { return smoothedTilt; },
    get isListening() { return listening; },
    requestPermission,
    update,
  };
})();
