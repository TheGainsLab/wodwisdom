// GENERATED FILE — do not edit by hand.
// Source of truth: src/data/knowledge/chart-templates.json
// Regenerate with: node scripts/sync-ingestion-prompt.mjs
// shape tokens: 'string' | 'number' | 'any' (key present); a nested array
// means every element matches the inner shape; shape null = not validated.

export interface ChartTemplateSpec {
  shape: Record<string, unknown> | null;
  shape_text: string;
}

export const CHART_TEMPLATES: Record<string, ChartTemplateSpec> = {
  "before_after_bars": {
    "shape": {
      "label": "string",
      "before": "any",
      "after": "any"
    },
    "shape_text": "{label, before, after}"
  },
  "grouped_change_bars": {
    "shape": {
      "group": "string",
      "values": [
        {
          "label": "string",
          "value": "any"
        }
      ]
    },
    "shape_text": "{group, values: [{label, value}]} — one item per group, even for single-group studies"
  },
  "values_by_condition": {
    "shape": {
      "label": "string",
      "values": [
        {
          "condition": "string",
          "value": "any"
        }
      ]
    },
    "shape_text": "{label, values: [{condition, value}]}"
  },
  "stacked_share": {
    "shape": {
      "label": "string",
      "parts": [
        {
          "name": "string",
          "value": "number"
        }
      ]
    },
    "shape_text": "{label, parts: [{name, value}]}"
  },
  "population_card": {
    "shape": {
      "n": "any"
    },
    "shape_text": "{n, sex_split, age, status, other}"
  },
  "concept_curve": {
    "shape": null,
    "shape_text": ""
  }
};
