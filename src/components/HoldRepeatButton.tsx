import { useEffect, useRef } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

// A Pressable that fires `onStep` once on press, then — while held — keeps firing at an accelerating
// cadence until release (the Tesla steppers' "press-and-hold to keep changing" behaviour). `onStep` is
// read through a ref so a hold always calls the latest closure (the value it reads must itself come from
// a ref/functional source, or repeated steps would re-read a stale value between renders).
export function HoldRepeatButton({
  onStep,
  disabled,
  hitSlop,
  style,
  children,
}: {
  onStep: () => void;
  disabled?: boolean;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  // Never leave a repeat timer running if the button unmounts mid-hold (sheet closed, value edited away).
  useEffect(() => stop, []);

  const start = () => {
    if (disabled) return;
    onStepRef.current();
    let delay = 380; // pause before auto-repeat kicks in, then ramp up
    const tick = () => {
      onStepRef.current();
      delay = Math.max(45, delay * 0.82);
      timer.current = setTimeout(tick, delay);
    };
    timer.current = setTimeout(tick, delay);
  };

  return (
    <Pressable onPressIn={start} onPressOut={stop} disabled={disabled} hitSlop={hitSlop} style={style}>
      {children}
    </Pressable>
  );
}
