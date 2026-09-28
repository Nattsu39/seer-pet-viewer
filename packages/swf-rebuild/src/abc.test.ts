import { describe, expect, it } from "vitest";
import { patchFrameRegistrations } from "./abc.js";
import { stubFixture } from "./abc-fixture.js";

describe("ABC frame registration patch", () => {
  it("changes only the located constructor operands without shifting any bytes", () => {
    const { abc, operandOffsets } = stubFixture();
    const output = patchFrameRegistrations(abc, [
      { className: "Example", frames: [0, 67, 91] },
    ]);
    expect(output.length).toBe(abc.length);
    expect(operandOffsets.map((offset) => output[offset])).toEqual([0, 67, 91]);
    const differences = [...output.keys()].filter(
      (index) => output[index] !== abc[index],
    );
    expect(differences).toEqual(operandOffsets.slice(1));
    expect(operandOffsets.map((offset) => abc[offset])).toEqual([0, 1, 2]);
  });

  it("rejects missing classes, changed opcodes and out-of-range frame operands", () => {
    const { abc, operandOffsets } = stubFixture();
    expect(() =>
      patchFrameRegistrations(abc, [
        { className: "Missing", frames: [0, 1, 2] },
      ]),
    ).toThrow("Not all");
    expect(() =>
      patchFrameRegistrations(abc, [
        { className: "Example", frames: [0, 32768, 32769] },
      ]),
    ).toThrow("0..32767");
    abc[operandOffsets[1] - 1] = 0x25;
    expect(() =>
      patchFrameRegistrations(abc, [
        { className: "Example", frames: [0, 67, 91] },
      ]),
    ).toThrow("Unexpected constructor");
  });

  it("promotes frame indices above 127 to pushshort and rebuilds code_length", () => {
    const { abc, operandOffsets } = stubFixture();
    const output = patchFrameRegistrations(abc, [
      { className: "Example", frames: [0, 138, 183] },
    ]);
    const lengthOffset = operandOffsets[0] - 9;
    expect(output[lengthOffset]).toBe(abc[lengthOffset] + 2);
    expect(output.length).toBe(abc.length + 2);
    expect([
      ...output.subarray(operandOffsets[1] - 1, operandOffsets[1] + 2),
    ]).toEqual([0x25, 0x8a, 1]);
    expect([
      ...output.subarray(operandOffsets[2], operandOffsets[2] + 3),
    ]).toEqual([0x25, 0xb7, 1]);
    expect(output.subarray(0, lengthOffset)).toEqual(
      abc.subarray(0, lengthOffset),
    );
    expect(output.subarray(-6)).toEqual(abc.subarray(-6));
  });
});
