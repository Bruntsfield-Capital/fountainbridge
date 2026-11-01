import { toneColor } from '@/lib/status';
import { Mark } from './Mark';

/**
 * "The factory hasn't reported since 10:42. These may be out of date.", above a list of the
 * factory's cards while the planning box is quiet (FB-278). Nothing when it is reporting.
 */
export function FactoryQuiet({ line, testId }: { line: string | null; testId: string }) {
  if (!line) return null;
  return (
    <p className="card" data-testid={testId} role="status"
       style={{ borderColor: toneColor('attention'), color: toneColor('attention'), fontSize: 'var(--fs-body-sm)', padding: '0.5rem 0.75rem', maxWidth: 'var(--content-narrow)' }}>
      <Mark tone="attention" />{line}
    </p>
  );
}
