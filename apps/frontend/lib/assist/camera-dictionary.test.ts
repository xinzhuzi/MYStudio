import { describe, expect, it } from "vitest";
import { buildCinemaPrompt } from "./camera-dictionary";

describe("camera dictionary prompt builder", () => {
  it("expands known camera, lens, focal length, and aperture tokens", () => {
    const prompt = buildCinemaPrompt(
      "rainy alley confrontation",
      "ARRI Alexa IMAX 65mm",
      "Vintage Anamorphic",
      35,
      "f/1.4",
    );

    expect(prompt).toContain("rainy alley confrontation");
    expect(prompt).toContain("ARRI Alexa 65 IMAX cinema camera");
    expect(prompt).toContain("vintage anamorphic lens at 35mm");
    expect(prompt).toContain("natural cinematic perspective");
    expect(prompt).toContain("extremely shallow depth of field");
    expect(prompt).toContain("professional photography");
  });

  it("keeps unknown camera and lens labels while omitting unknown optional effects", () => {
    const prompt = buildCinemaPrompt("", "Custom Camera", "Custom Lens", 123, "f/99");

    expect(prompt).toContain("shot on a Custom Camera");
    expect(prompt).toContain("using a Custom Lens at 123mm");
    expect(prompt).toContain("aperture f/99");
    expect(prompt).toContain("cinematic lighting");
    expect(prompt).not.toContain("undefined");
  });
});
