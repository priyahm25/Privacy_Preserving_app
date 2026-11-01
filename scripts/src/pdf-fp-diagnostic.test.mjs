import test from "node:test";
import assert from "node:assert/strict";
import { buildDiagnostic } from "./pdf-fp-diagnostic.mjs";
import { lgbmPredict } from "../../artifacts/securesphere/lib/scanning/lgbmInference.ts";

const featureNames = [
  "file_size", "metadata_size", "page_count", "title_chars", "encrypted",
  "embedded_file_count", "image_count", "object_count", "endstream_count",
  "stream_count", "xref_count", "trailer_count", "startxref_count", "objstm_count",
  "js_count", "javascript_count", "aa_count", "openaction_count", "acroform_count",
  "jbig2decode_count", "richmedia_count", "launch_count", "xfa_count", "colors_count",
];
const model = {
  num_features: 24,
  feature_names: featureNames,
  trees: [{
    shrinkage: 1,
    root: {
      split_feature: 0,
      threshold: 0,
      decision_type: "<=",
      default_left: true,
      missing_type: "None",
      left: { leaf_value: -1 },
      right: { leaf_value: 1 },
    },
  }],
};

test("diagnostic reports aggregate differences without sample identifiers", () => {
  const makeRow = (prediction) => {
    const features = Object.fromEntries(featureNames.map((name) => [name, 0]));
    features.file_size = prediction === "MALICIOUS" ? 1 : 0;
    features.metadata_size = 44;
    const vector = featureNames.map((name) => features[name]);
    return {
      file_id: `private-sample-${prediction}`,
      status: "evaluated",
      prediction,
      features,
      probability: lgbmPredict(model, vector),
    };
  };
  const report = buildDiagnostic({
    threshold: 0.5,
    featureNames,
    rows: [...Array.from({ length: 5 }, () => makeRow("MALICIOUS")), ...Array.from({ length: 9 }, () => makeRow("SAFE"))],
  }, model);
  assert.match(report, /5 MALICIOUS/);
  assert.match(report, /9 SAFE/);
  assert.match(report, /acroform_count/);
  assert.match(report, /colors_count/);
  assert.match(report, /No per-row comparison field means no matched reference comparison was recorded/);
  assert.doesNotMatch(report, /private-sample/);
});
