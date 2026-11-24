import { describe, expect, it } from "vite-plus/test";
import { normalizeJobLink } from "./job-link";

describe("normalizeJobLink", () => {
  it.each([
    [
      "Quelle: https://www.career.tu-darmstadt.de/tu-darmstadt/job/58396",
      "https://www.career.tu-darmstadt.de/tu-darmstadt/job/58396",
    ],
    ["  QUELLE:\u00a0https://jobs.example.org/42  ", "https://jobs.example.org/42"],
    ["https://jobs.example.org/42?lang=de#apply", "https://jobs.example.org/42?lang=de#apply"],
    ["  http://jobs.example.org/42  ", "http://jobs.example.org/42"],
  ])("accepts a single job link from %s", (input, expected) => {
    expect(normalizeJobLink(input)).toBe(expected);
  });

  it.each([
    "Quelle:",
    "Quelle: keine URL",
    "Quelle: Quelle: https://jobs.example.org/42",
    "www.jobs.example.org/42",
    "javascript:alert(1)",
    "ftp://jobs.example.org/42",
    "https:jobs.example.org/42",
    "https://",
    "https://jobs.example.org:invalid/42",
    "https://jobs.example.org/42 https://other.example.org/17",
    "https://jobs.example.org/42 zusätzlicher Text",
    "",
    "   ",
  ])("rejects an incomplete, unsupported or ambiguous input: %s", (input) => {
    expect(normalizeJobLink(input)).toBeNull();
  });
});
