/**
 * On-device LightGBM inference via JSON tree traversal.
 * The .joblib models are converted to JSON using ml/convert_to_json.py.
 * This module runs entirely on the user device — no data leaves the device.
 */

export interface LGBMModel {
  model_name: string;
  feature_names: string[];
  num_features: number;
  num_trees: number;
  trees: LGBMTree[];
}

interface LGBMTree {
  shrinkage: number;
  root: LGBMNode;
}

interface LGBMLeafNode {
  leaf_value: number;
}

interface LGBMInternalNode {
  split_feature: number;
  threshold: string | number;
  decision_type: string;
  default_left: boolean;
  missing_type: string;
  left: LGBMNode;
  right: LGBMNode;
}

type LGBMNode = LGBMLeafNode | LGBMInternalNode;

function isLeaf(node: LGBMNode): node is LGBMLeafNode {
  return 'leaf_value' in node;
}

/**
 * Traverse a single decision tree for a feature vector.
 */
function traverseTree(node: LGBMNode, features: number[]): number {
  if (isLeaf(node)) {
    return node.leaf_value;
  }
  const internalNode = node as LGBMInternalNode;
  const featureValue = features[internalNode.split_feature];
  const threshold = typeof internalNode.threshold === 'string'
    ? parseFloat(internalNode.threshold)
    : internalNode.threshold;

  // Handle NaN / missing values
  const isNaN = featureValue === null || featureValue === undefined || Number.isNaN(featureValue);
  if (isNaN) {
    return traverseTree(
      internalNode.default_left ? internalNode.left : internalNode.right,
      features
    );
  }

  // LightGBM uses '<=' threshold for decision_type '<='
  const goLeft = featureValue <= threshold;
  return traverseTree(goLeft ? internalNode.left : internalNode.right, features);
}

/**
 * Run LightGBM binary classification inference.
 * Returns probability of class 1 (malicious).
 */
export function lgbmPredict(model: LGBMModel, featureVector: number[]): number {
  if (featureVector.length !== model.num_features) {
    throw new Error(
      `Feature count mismatch: expected ${model.num_features}, got ${featureVector.length}`
    );
  }

  // Leaf values from LightGBM's `dump_model()` already include the learning
  // rate; `shrinkage` is informational. Multiplying by it again squashed every
  // score toward the first tree's base rate (e.g. ~0.65 for PDFs), which made
  // ordinary benign PDFs score just above 0.5. Verified against
  // booster.predict() by scripts/src/lgbm-parity.test.ts.
  let rawScore = 0;
  for (const tree of model.trees) {
    rawScore += traverseTree(tree.root, featureVector);
  }

  // Apply sigmoid (LightGBM binary objective uses log-loss with sigmoid)
  const probability = 1.0 / (1.0 + Math.exp(-rawScore));
  return probability;
}

/**
 * Build a feature vector in the exact order expected by the model.
 * featuresMap: { feature_name: value }
 * Returns array of numbers in model.feature_names order.
 */
export function buildFeatureVector(
  model: LGBMModel,
  featuresMap: Record<string, number>
): number[] {
  return model.feature_names.map((name) => {
    const value = featuresMap[name];
    // Fill missing values with 0 (matches training preprocessing: fillna(0))
    return value !== undefined && value !== null && !Number.isNaN(value) ? value : 0;
  });
}
