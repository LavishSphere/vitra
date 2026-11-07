import { describe, expect, it } from "vitest";
import { aspectOptions } from "./options.ts";
import { stepIndex } from "./listbox.ts";

describe("listbox keyboard", () => {
  const labels = () => aspectOptions().map((o) => o.label);

  it("walks aspect labels from All to Efficacy to Safety", () => {
    const names = labels();
    let i = names.indexOf("All aspects");
    i = stepIndex(i, "ArrowDown", names.length)!;
    expect(names[i]).toBe("Efficacy");
    i = stepIndex(i, "ArrowDown", names.length)!;
    expect(names[i]).toBe("Safety");
    i = stepIndex(i, "ArrowUp", names.length)!;
    expect(names[i]).toBe("Efficacy");
    expect(stepIndex(0, "Home", names.length)).toBe(0);
    expect(stepIndex(1, "End", names.length)).toBe(names.length - 1);
  });

  it("stays on the last label instead of wrapping", () => {
    const n = labels().length;
    expect(stepIndex(n - 1, "ArrowDown", n)).toBe(n - 1);
    expect(stepIndex(0, "ArrowUp", n)).toBe(0);
  });
});
