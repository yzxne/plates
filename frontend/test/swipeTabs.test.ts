import { describe, expect, it } from 'vitest';
import { swipeTarget } from '../src/swipeTabs';

describe('swipe between tabs', () => {
  it('moves one tab per clear sideways swipe, without wrapping', () => {
    expect(swipeTarget('today', -120, 10, 300)).toBe('progress');
    expect(swipeTarget('progress', -120, 10, 300)).toBe('train');
    expect(swipeTarget('train', -120, 10, 300)).toBeNull();
    expect(swipeTarget('progress', 120, -5, 300)).toBe('today');
    expect(swipeTarget('today', 120, 0, 300)).toBeNull();
  });
  it('ignores short, slow or mostly-vertical moves (scrolling)', () => {
    expect(swipeTarget('today', -60, 0, 300)).toBeNull();
    expect(swipeTarget('today', -120, 70, 300)).toBeNull();
    expect(swipeTarget('today', -120, 0, 1200)).toBeNull();
  });
});
