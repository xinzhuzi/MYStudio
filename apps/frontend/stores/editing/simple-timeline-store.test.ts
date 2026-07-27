// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { formatTime, useSimpleTimelineStore, type TimelineClip } from "./simple-timeline-store";

const clip = (id: string, duration: number): TimelineClip => ({
  id,
  mediaId: `media-${id}`,
  name: id,
  url: `https://${id}.example/video.mp4`,
  duration,
  startTime: 0,
});

describe("simple timeline playback and ordering boundaries", () => {
  beforeEach(() => {
    useSimpleTimelineStore.setState({
      clips: [clip("first", 4), clip("second", 8)],
      isPlaying: false,
      currentTime: 0,
      totalDuration: 12,
      activeClipId: null,
    });
  });

  it("clamps setCurrentTime to the timeline range and resolves the active clip from the clamped value", () => {
    useSimpleTimelineStore.getState().setCurrentTime(-2);
    expect(useSimpleTimelineStore.getState()).toMatchObject({ currentTime: 0, activeClipId: "first" });

    useSimpleTimelineStore.getState().setCurrentTime(6);
    expect(useSimpleTimelineStore.getState()).toMatchObject({ currentTime: 6, activeClipId: "second" });

    useSimpleTimelineStore.getState().setCurrentTime(20);
    expect(useSimpleTimelineStore.getState()).toMatchObject({ currentTime: 12, activeClipId: null });
  });

  it("maps non-finite seeks to zero and respects exact clip boundaries", () => {
    useSimpleTimelineStore.getState().setCurrentTime(4);
    expect(useSimpleTimelineStore.getState().activeClipId).toBe("second");
    expect(useSimpleTimelineStore.getState().getClipAtTime(4)?.id).toBe("second");
    expect(useSimpleTimelineStore.getState().getClipAtTime(12)).toBeNull();

    useSimpleTimelineStore.getState().seek(Number.NaN);
    expect(useSimpleTimelineStore.getState().currentTime).toBe(0);
    expect(useSimpleTimelineStore.getState().getClipAtTime(Number.NaN)).toBeNull();

    useSimpleTimelineStore.setState({ totalDuration: Number.NaN });
    useSimpleTimelineStore.getState().seek(2);
    expect(useSimpleTimelineStore.getState().currentTime).toBe(0);
  });

  it("keeps zero-duration clips valid without selecting them at their boundary", () => {
    useSimpleTimelineStore.setState({
      clips: [clip("zero", 0), { ...clip("second", 8), startTime: 0 }],
      totalDuration: 8,
    });

    useSimpleTimelineStore.getState().setCurrentTime(0);
    expect(useSimpleTimelineStore.getState()).toMatchObject({ currentTime: 0, activeClipId: "second" });
  });

  it("rejects non-finite clip durations without changing the timeline", () => {
    const before = useSimpleTimelineStore.getState().clips;

    for (const duration of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      useSimpleTimelineStore.getState().addClip({
        mediaId: `media-${duration}`,
        name: "invalid",
        url: "https://invalid.example/video.mp4",
        duration,
      });
    }

    expect(useSimpleTimelineStore.getState().clips).toBe(before);
    expect(useSimpleTimelineStore.getState().totalDuration).toBe(12);
  });

  it("ignores reorder requests whose source or destination index is outside the clip list", () => {
    const before = useSimpleTimelineStore.getState().clips;

    expect(() => useSimpleTimelineStore.getState().reorderClips(-1, 0)).not.toThrow();
    expect(() => useSimpleTimelineStore.getState().reorderClips(0, 2)).not.toThrow();
    expect(useSimpleTimelineStore.getState().clips).toEqual(before);

    expect(() => useSimpleTimelineStore.getState().reorderClips(Number.NaN, 0)).not.toThrow();
    expect(() => useSimpleTimelineStore.getState().reorderClips(0, Number.POSITIVE_INFINITY)).not.toThrow();
    expect(() => useSimpleTimelineStore.getState().reorderClips(0.5, 1)).not.toThrow();
    expect(useSimpleTimelineStore.getState().clips).toEqual(before);
  });

  it("recalculates start times for a valid reorder", () => {
    useSimpleTimelineStore.getState().reorderClips(0, 1);

    expect(useSimpleTimelineStore.getState().clips).toEqual([
      { ...clip("second", 8), startTime: 0 },
      { ...clip("first", 4), startTime: 8 },
    ]);
    expect(useSimpleTimelineStore.getState().totalDuration).toBe(12);
  });

  it("formats non-finite and negative display values as zero", () => {
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatTime(-1)).toBe("0:00");
  });
});
