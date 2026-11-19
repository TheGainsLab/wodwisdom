import { useEffect, useRef } from 'react';
import { trackVisitor } from '../visitorEvents';

/** Count a calculator as used once per page visit, when a result has stayed
 *  put for a moment (so half-typed numbers are not counted). */
export function useCalculatorUsed(calculator: string, band: string | null): void {
  const sent = useRef(false);
  useEffect(() => {
    if (band == null || sent.current) return;
    const t = setTimeout(() => {
      sent.current = true;
      trackVisitor('calculator_used', { calculator, result: band });
    }, 1500);
    return () => clearTimeout(t);
  }, [calculator, band]);
}
