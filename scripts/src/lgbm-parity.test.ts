import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lgbmPredict, type LGBMModel } from "../../artifacts/securesphere/lib/scanning/lgbmInference.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/lgbm-parity.json", import.meta.url), "utf8")) as {
  models: Record<string, { x: number[]; p: number }[]>;
};

for (const [name, rows] of Object.entries(fixture.models)) {
  test(`${name} model: on-device inference matches LightGBM booster.predict()`, () => {
    const model = JSON.parse(readFileSync(new URL(`../../artifacts/securesphere/assets/models/${name}.json`, import.meta.url), "utf8")) as LGBMModel;
    for (const { x, p } of rows) {
      const js = lgbmPredict(model, x);
      assert.ok(Math.abs(js - p) < 1e-9, `${name}: expected ${p}, got ${js}`);
    }
  });
}
