import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyImageGenerationSuccess, resetGenerationChimeForTests } from './generation-chime';

/** 最小 AudioContext 假件:只喂用到的链路,数 oscillator.start 次数当「响了几声」。 */
function installFakeAudioContext() {
  const started: number[] = [];
  const closed: number[] = [];
  class FakeAudioParam {
    value = 0;
    setValueAtTime = vi.fn();
    linearRampToValueAtTime = vi.fn();
    exponentialRampToValueAtTime = vi.fn();
  }
  class FakeGain {
    gain = new FakeAudioParam();
    connect = vi.fn(() => ({}));
  }
  class FakeOscillator {
    type = '';
    frequency = new FakeAudioParam();
    connect = vi.fn((node: unknown) => node);
    start = vi.fn(() => started.push(Date.now()));
    stop = vi.fn();
  }
  class FakeAudioContext {
    currentTime = 0;
    state = 'running';
    resume = vi.fn(() => Promise.resolve());
    close = vi.fn(() => {
      closed.push(Date.now());
      return Promise.resolve();
    });
    destination = {};
    createOscillator() {
      return new FakeOscillator();
    }
    createGain() {
      return new FakeGain();
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return { started, closed };
}

describe('generation-chime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetGenerationChimeForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetGenerationChimeForTests();
  });

  it('1s 节流窗内连响只出一声,出窗后再响', () => {
    const { started } = installFakeAudioContext();
    notifyImageGenerationSuccess();
    expect(started).toHaveLength(2); // 双分音=一次「叮」
    notifyImageGenerationSuccess();
    expect(started).toHaveLength(2); // 窗内被节流
    vi.advanceTimersByTime(1_100);
    notifyImageGenerationSuccess();
    expect(started).toHaveLength(4); // 出窗后再响一声
  });

  it('播完关闭 AudioContext,句柄不驻留', () => {
    const { closed } = installFakeAudioContext();
    notifyImageGenerationSuccess();
    expect(closed).toHaveLength(0);
    vi.advanceTimersByTime(900);
    expect(closed).toHaveLength(1);
  });

  it('无 AudioContext 环境静默不炸(生图链路不受影响)', () => {
    expect(() => notifyImageGenerationSuccess()).not.toThrow();
  });
});
