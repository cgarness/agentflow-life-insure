import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import UnderwritingPage from '../UnderwritingPage';
import { mountUnderwriting } from '../ui/mount';
import { freshCase, freshSchedule } from '../types';
import { underwritingSchema, scheduleSchema } from '../schema';

vi.mock('../ui/mount', () => ({ mountUnderwriting: vi.fn(() => vi.fn()) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('isolated underwriting React host', () => {
  it('mounts with the real Zod case and schedule validators', () => {
    render(<UnderwritingPage />);
    const options = vi.mocked(mountUnderwriting).mock.calls[0]![1]!;
    expect(() => options.validateCase!(freshCase())).toThrow();
    expect(() => options.validateSchedule!(freshSchedule())).toThrow();
    expect(document.title).toBe('Underwriting | FFL Agent');
  });
  it('clears the view on unmount and restores the previous title', () => {
    document.title = 'Existing title';
    const { unmount } = render(<UnderwritingPage />);
    const dispose = vi.mocked(mountUnderwriting).mock.results[0]!.value;
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(document.title).toBe('Existing title');
  });
  it('clears sensitive state on pagehide and starts a blank session on pageshow', () => {
    const { unmount } = render(<UnderwritingPage />);
    const firstDispose = vi.mocked(mountUnderwriting).mock.results[0]!.value;
    window.dispatchEvent(new Event('pagehide'));
    expect(firstDispose).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pageshow'));
    expect(mountUnderwriting).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('pageshow'));
    expect(mountUnderwriting).toHaveBeenCalledTimes(2);
    const secondDispose = vi.mocked(mountUnderwriting).mock.results[1]!.value;
    unmount();
    expect(secondDispose).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pageshow'));
    expect(mountUnderwriting).toHaveBeenCalledTimes(2);
  });
  it('rejects unknown root properties rather than accepting client identifiers', () => {
    expect(underwritingSchema.safeParse({ ...freshCase(), clientName: 'Synthetic' }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...freshSchedule(), secret: 'Synthetic' }).success).toBe(false);
  });
});
