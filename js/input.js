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

  function handleOrientation(event) {
    if (event.gamma === null) return;
    const clamped = Math.max(-TILT_CLAMP_DEGREES, Math.min(TILT_CLAMP_DEGREES, event.gamma));
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
    else if (keys.left === false && keys.right === false && !listening) {
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
