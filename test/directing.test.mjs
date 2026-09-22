// composeDirection is the pure sentence-builder behind the direction chips + note row: it
// must run with no DOM, so these tests exercise it straight from plain Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHIPS, composeDirection } from "../public/directing.js";

test("empty input gives an empty string", () => {
  assert.equal(composeDirection([], ""), "");
  assert.equal(composeDirection([], undefined), "");
  assert.equal(composeDirection(undefined, undefined), "");
});

test("chips only joins active phrases in CHIPS order, no note appended", () => {
  assert.equal(composeDirection(["darker"], ""), "darker");
  assert.equal(composeDirection(["darker", "warmer"], ""), "darker, warmer colours");
});

test("note only, with no chips active", () => {
  assert.equal(composeDirection([], "rain outside"), "rain outside");
  assert.equal(composeDirection([], "  rain outside  "), "rain outside");
});

test("chips and note combine with the note last, separated by an em dash", () => {
  assert.equal(composeDirection(["darker"], "rain outside"), "darker — rain outside");
});

test("CHIPS order is respected regardless of the order ids are passed in", () => {
  const forward = composeDirection(["darker", "slower", "emptier"], "");
  const reversed = composeDirection(["emptier", "slower", "darker"], "");
  assert.equal(forward, reversed);
  assert.equal(forward, "darker, slower, calmer, emptier, more space");
});

test("unknown ids are ignored", () => {
  assert.equal(composeDirection(["darker", "not-a-real-chip"], ""), "darker");
  assert.equal(composeDirection(["nope"], ""), "");
});

test("whitespace in the note is collapsed and trimmed", () => {
  assert.equal(composeDirection([], "rain   outside\n\tsomewhere"), "rain outside somewhere");
  assert.equal(composeDirection(["darker"], "   loud   room   "), "darker — loud room");
});

test("the combined direction is capped at 200 characters", () => {
  const longNote = "x".repeat(300);
  const result = composeDirection(["darker", "slower", "emptier", "warmer", "break"], longNote);
  assert.equal(result.length, 200);
  assert.ok(result.startsWith("darker, slower, calmer, emptier, more space, warmer colours, break it, make it harsh — xxx"));
});

test("every chip id used elsewhere matches a CHIPS entry (sanity check on the fixture itself)", () => {
  const ids = CHIPS.map((chip) => chip.id);
  assert.deepEqual(ids, ["darker", "slower", "emptier", "warmer", "break"]);
});
