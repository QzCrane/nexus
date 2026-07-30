import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { Registry } from '../src/shared/registry';

describe('Registry', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
  });

  it('tracks and disposes a cleanup function', () => {
    let called = false;
    registry.track(() => { called = true; });
    registry.dispose();
    expect(called).toBe(true);
  });

  it('tracks and disposes an object with dispose method', () => {
    let called = false;
    registry.track({ dispose: () => { called = true; } });
    registry.dispose();
    expect(called).toBe(true);
  });

  it('disposes in LIFO order', () => {
    const order: number[] = [];
    registry.track(() => order.push(1));
    registry.track(() => order.push(2));
    registry.track(() => order.push(3));
    registry.dispose();
    expect(order).toEqual([3, 2, 1]);
  });

  it('calls all cleanups even if one throws', () => {
    const report = spyOn(console, 'error').mockImplementation(() => undefined);
    let secondCalled = false;
    registry.track(() => { throw new Error('cleanup failed'); });
    registry.track(() => { secondCalled = true; });
    registry.dispose();
    expect(secondCalled).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[1]).toBeInstanceOf(AggregateError);
    report.mockRestore();
  });

  it('adds and removes DOM event listener', () => {
    const div = { addEventListener: mock(), removeEventListener: mock() } as unknown as EventTarget;
    const handler = () => {};
    registry.addEventListener(div, 'click', handler);
    expect(div.addEventListener).toHaveBeenCalledWith('click', handler, undefined);
    registry.dispose();
    expect(div.removeEventListener).toHaveBeenCalledWith('click', handler, undefined);
  });

  it('does not expose a recurring interval API', () => {
    const legacyRegistry = registry as Registry & { setInterval?: unknown };
    expect(legacyRegistry.setInterval).toBeUndefined();
  });

  it('track returns the tracked item for chaining', () => {
    const fn = () => {};
    expect(registry.track(fn)).toBe(fn);

    const obj = { dispose: () => {} };
    expect(registry.track(obj)).toBe(obj);
  });
});
