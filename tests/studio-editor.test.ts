import { test } from "node:test";
import assert from "node:assert/strict";
import { photoFormat, uploadedPhotoFraming, moveSelection } from "../lib/studio-editor.ts";
import {composePrompt} from "../lib/domain.ts";
import { assertAppliedStudioImageSelection } from "../lib/live/media.ts";
import { reportedBaseChargeMicroUsd } from "../lib/live/contract.ts";
import {
  parseStudioDraft,
  parseSavedStudioDraft,
} from "../lib/studio-draft.ts";

test("selection movement preserves length and clamps both boundaries including fractional media", () => {
  assert.deepEqual(moveSelection(12, 22, 6, 40), [18, 28]);
  assert.deepEqual(moveSelection(12, 22, -100, 40), [0, 10]);
  assert.deepEqual(moveSelection(12, 22, 100, 40), [30, 40]);
  for (const delta of [-100, -0.01, 0.01, 100]) {
    const [start, end] = moveSelection(1.253, 5.257, delta, 9.123);
    assert.ok(Math.abs(end - start - 4.004) < 1e-12);
    assert.ok(start >= 0 && end <= 9.123);
  }
});
test("orientation has a defined square fallback and manual format mode survives draft round-trip", () => {
  assert.equal(photoFormat(720, 1280), "9:16");
  assert.equal(photoFormat(1280, 720), "16:9");
  assert.equal(photoFormat(1000, 1000), "9:16");
  assert.equal(photoFormat(1050, 1000), "9:16");
  const draft = {
    version: 1,
    owner: "owner",
    songId: "song",
    imageId: "image",
    start: 1.25,
    end: 6.25,
    performance: "Natural",
    camera: "Static Close-Up",
    customPrompt: "",
    outputFormat: "16:9",
    formatMode: "16:9",
  };
  assert.equal(
    parseStudioDraft(JSON.parse(JSON.stringify(draft))).formatMode,
    "16:9",
  );
  assert.throws(() => parseStudioDraft({ ...draft, formatMode: "invalid" }));
});
test("integer base-rate estimates use billable units without markup or assumed fees", () => {
  for (const [seconds, cost] of [
    [10, 700000],
    [15, 1050000],
    [30, 2100000],
    [60, 4200000],
  ])
    assert.equal(reportedBaseChargeMicroUsd(seconds), cost);
  assert.equal(reportedBaseChargeMicroUsd(4.001), 280000);
  assert.equal(reportedBaseChargeMicroUsd(0.1), 70000);
  assert.equal(reportedBaseChargeMicroUsd(10 / 0.9), 770000);
  for (const value of [NaN, Infinity, -1])
    assert.throws(() => reportedBaseChargeMicroUsd(value));
});

test("incomplete drafts persist without granting paid preparation", () => {
  const draft = {
    version: 1,
    owner: "owner",
    songId: "song",
    imageId: "",
    start: 0,
    end: 5,
    performance: "Custom",
    camera: "Static Close-Up",
    customPrompt: "",
    outputFormat: "9:16",
    formatMode: "auto",
  };
  assert.deepEqual(parseSavedStudioDraft(draft), draft);
  assert.throws(() => parseStudioDraft(draft));
  assert.throws(() =>
    parseSavedStudioDraft({ ...draft, songId: "../invalid" }),
  );
});

test("Apply-saved reference is the only authorized BytePlus image for 16:9", () => {
  const draft = {
    version: 1 as const,
    owner: "staff",
    songId: "song",
    imageId: "saved-16-9",
    sourceImageId: "uploaded-16-9",
    editedImageId: "saved-16-9",
    appliedOutputFormat: "16:9" as const,
    outputFormat: "16:9" as const,
    formatMode: "16:9" as const,
    start: 0, end: 5, performance: "Natural", camera: "Static Close-Up", customPrompt: "",
  };
  const parsed = parseStudioDraft(JSON.parse(JSON.stringify(draft)));
  assert.equal(parsed.imageId, parsed.editedImageId);
  assert.equal(parsed.sourceImageId, "uploaded-16-9");
  assert.doesNotThrow(() => assertAppliedStudioImageSelection(parsed, {width: 1280, height: 720}));
  assert.throws(
    () => assertAppliedStudioImageSelection({...parsed, imageId: "uploaded-16-9"}, {width:1280,height:720}),
    /REFERENCE_APPLY_REQUIRED/,
  );
  assert.throws(
    () => assertAppliedStudioImageSelection({...parsed, outputFormat:"9:16"}, {width:1280,height:720}),
    /REFERENCE_APPLY_REQUIRED/,
  );
  assert.throws(
    () => assertAppliedStudioImageSelection(parsed, {width:720,height:1280}),
    /REFERENCE_FORMAT_MISMATCH/,
  );
  assert.throws(
    () => assertAppliedStudioImageSelection({...parsed, editedImageId:undefined}, {width:1280,height:720}),
    /REFERENCE_APPLY_REQUIRED/,
  );
  assert.throws(
    () => parseStudioDraft({...draft, editedImageId: "../stale"}),
    /Invalid Studio draft/,
  );
});

test("last successfully applied orientation is binding, regardless of original size", () => {
  const source = "original-9-16";
  const prior = {
    sourceImageId:source,
    imageId:"crop-9-16",
    editedImageId:"crop-9-16",
    appliedOutputFormat:"9:16" as const,
    outputFormat:"9:16" as const,
    formatMode:"9:16" as const,
  };
  assert.doesNotThrow(() => assertAppliedStudioImageSelection(prior,{width:720,height:1280}));
  const changed = {...prior, outputFormat:"16:9" as const,formatMode:"16:9" as const};
  assert.throws(() => assertAppliedStudioImageSelection(changed,{width:720,height:1280}),/REFERENCE_APPLY_REQUIRED/);
  const applied = {...changed, imageId:"saved-16-9",editedImageId:"saved-16-9",appliedOutputFormat:"16:9" as const};
  assert.doesNotThrow(() => assertAppliedStudioImageSelection(applied,{width:1280,height:720}));
  assert.equal(applied.imageId,"saved-16-9");
  assert.equal(applied.sourceImageId,source);
});

test("BytePlus prompt contains only the user's exact text, without defaults", () => {
  const directions = "looking angry and walk forward";
  assert.equal(composePrompt("Custom", "Static camera", directions), directions);
  assert.equal(composePrompt("Natural", "Orbit left", ""), "");
  assert.equal(composePrompt("Emotional", "Tilt down", "  "), "  ");
  const cameraQuickIdea = "looking angry and walk forward\\nCamera: Slowly orbit left around the singer.";
  assert.equal(composePrompt("Custom", "Static camera", cameraQuickIdea), cameraQuickIdea);
});

test("new landscape upload selects 16:9 automatically; a portrait selects 9:16", () => {
  assert.deepEqual(uploadedPhotoFraming(1920,1080),{outputFormat:"16:9",formatMode:"16:9"});
  assert.deepEqual(uploadedPhotoFraming(1280,720),{outputFormat:"16:9",formatMode:"16:9"});
  assert.deepEqual(uploadedPhotoFraming(720,1280),{outputFormat:"9:16",formatMode:"9:16"});
});

test("saved photo determines format while prompt retains artist motion verbatim", () => {
  const text = "looking angry and walk forward";
  const result = composePrompt("Custom", "Static camera", text);
  assert.equal(result, text);
  assert.ok(!result.includes("16:9 composition"));
  assert.ok(!result.includes("9:16 composition"));
});
