import { expect, it } from "vitest";
import { resolveSwfPixelsPerUnit } from "./pixel-scale.js";

it("restores the importer pixel density, independent of atlas or sequence bounds", () => {
  expect(resolveSwfPixelsPerUnit(100) * 2.5).toBe(250);
  expect(resolveSwfPixelsPerUnit(200) * 2.5).toBe(500);
  expect(resolveSwfPixelsPerUnit()).toBe(100);
});

it.each([0, -1, Infinity, NaN])("rejects invalid native density %s", (value) => {
  expect(() => resolveSwfPixelsPerUnit(value)).toThrow();
});
