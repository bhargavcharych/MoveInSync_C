import type { EntityDimension, MetricId, QuerySpec } from "./query-spec";

export type MetricMetadata = {
  sourceTable: string;
  entityType: string;
  definition: string;
  denominator: string;
  sampleDefinition: string;
  unit: string;
  dimensions: EntityDimension[];
};

export const METRICS: Record<MetricId, MetricMetadata> = {
  ota: {
    sourceTable: "rides (via v_trip_facts)",
    entityType: "completed trip",
    definition: "Share of trips ending no more than 15 minutes after planned end",
    denominator: "Trips with planned and actual end timestamps",
    sampleDefinition: "One row per (business_unit, trip_id)",
    unit: "percent",
    dimensions: ["fleet", "business_unit", "office", "vendor"],
  },
  feedback_experience: {
    sourceTable: "feedback joined to rides on (business_unit, trip_id)",
    entityType: "employee trip-leg rating",
    definition: "Average non-zero rating; low-rating share is the share with any fully-rated core dimension at 1 or 2",
    denominator: "Non-zero responses for the selected dimension",
    sampleDefinition: "One feedback row per employee trip leg; zero means unrated",
    unit: "rating / percent",
    dimensions: ["feedback_dimension", "office", "business_unit", "vendor"],
  },
  sev1_alerts: {
    sourceTable: "alerts",
    entityType: "alert event and affected trip",
    definition: "Sev-1 alert rows; affected trips are counted distinctly by composite trip key",
    denominator: "All ride trips in the same window for anomaly-rate benchmarking",
    sampleDefinition: "Alert rows may repeat within a (business_unit, trip_id)",
    unit: "alert rows / distinct trips / percent of trips",
    dimensions: ["fleet", "business_unit", "office", "vendor"],
  },
  ev_delay_relationship: {
    sourceTable: "rides",
    entityType: "office-vendor operational lane",
    definition: "Pearson correlation between EV share and late-arrival share across lanes; office fixed effects are tested with within-office residuals",
    denominator: "Office-vendor lanes with at least 50 trips and non-degenerate EV share",
    sampleDefinition: "One aggregate per office and vendor",
    unit: "correlation coefficient",
    dimensions: ["operational_lane", "office", "vendor"],
  },
};

export type SemanticValidation = { valid: true } | { valid: false; reason: string };

export function validateQuerySpec(spec: QuerySpec): SemanticValidation {
  const metadata = METRICS[spec.metric];
  const requested = new Set<EntityDimension>([spec.entityType, ...spec.groupBy, ...spec.controls]);
  for (const dimension of requested) {
    if (!metadata.dimensions.includes(dimension)) {
      if (spec.metric === "ota" && dimension === "driver") {
        return { valid: false, reason: "The available data does not provide a reliable driver-level OTA dimension. Driver ratings measure feedback, not on-time performance, so they cannot be substituted." };
      }
      return { valid: false, reason: `${metadata.definition} is not available by ${dimension.replaceAll("_", " ")} in this dataset.` };
    }
  }
  if (spec.comparison.enabled && spec.comparison.type === "prior_period") {
    const w = spec.window;
    if (!w.comparisonStart || !w.comparisonEnd) return { valid: false, reason: "The requested prior-period comparison has no comparison window." };
    const length = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
    if (length(w.currentStart, w.currentEnd) !== length(w.comparisonStart, w.comparisonEnd)) {
      return { valid: false, reason: "The current and comparison windows are not symmetric." };
    }
  }
  return { valid: true };
}

