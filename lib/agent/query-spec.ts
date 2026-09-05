export type QueryIntent =
  | "comparison"
  | "ranking"
  | "explanation"
  | "feedback_diagnosis"
  | "anomaly"
  | "correlation"
  | "target_check"
  | "vendor_sla_diagnosis";

export type MetricId = "ota" | "feedback_experience" | "sev1_alerts" | "ev_delay_relationship";
export type EntityDimension = "fleet" | "business_unit" | "office" | "vendor" | "driver" | "feedback_dimension" | "operational_lane";
export type BenchmarkType = "prior_period" | "historical_trend" | "sla" | "peer" | "historical_distribution" | "controlled" | "none";

export type QueryWindow = {
  label: string;
  currentStart: string;
  currentEnd: string;
  comparisonStart?: string;
  comparisonEnd?: string;
};

export type QuerySpec = {
  question: string;
  intent: QueryIntent;
  metric: MetricId;
  entityType: EntityDimension;
  entityFilter?: { dimension: EntityDimension; value: string };
  groupBy: EntityDimension[];
  window: QueryWindow;
  comparison: {
    enabled: boolean;
    type: BenchmarkType;
    direction?: "versus" | "lowest" | "highest" | "change";
  };
  superlative?: "worst" | "best" | "highest" | "lowest";
  controls: EntityDimension[];
};

const DATASET_END = "2026-07-31";

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

function symmetricWindow(days: number, end = DATASET_END): QueryWindow {
  const currentStart = addDays(end, -(days - 1));
  const comparisonEnd = addDays(currentStart, -1);
  return {
    label: `last ${days} days versus previous ${days} days`,
    currentStart,
    currentEnd: end,
    comparisonStart: addDays(comparisonEnd, -(days - 1)),
    comparisonEnd,
  };
}

function fullDatasetWindow(): QueryWindow {
  return { label: "available May–July 2026 data", currentStart: "2026-05-01", currentEnd: DATASET_END };
}

export function classifyQuery(question: string): QuerySpec | null {
  const q = question.trim();
  const lower = q.toLowerCase();

  const daysMatch = lower.match(/last\s+(7|14)\s+days?/);
  const days = daysMatch ? Number(daysMatch[1]) : 14;
  if (/\bota\b/.test(lower) && /business\s+unit/.test(lower) && /(change|versus|vs\.?|before)/.test(lower)) {
    return {
      question: q,
      intent: "comparison",
      metric: "ota",
      entityType: "business_unit",
      groupBy: ["business_unit"],
      window: symmetricWindow(days),
      comparison: { enabled: true, type: "prior_period", direction: "change" },
      controls: [],
    };
  }

  if (/\b(worst|lowest)\b/.test(lower) && /\boffice\b/.test(lower) && /\bota\b/.test(lower)) {
    return {
      question: q,
      intent: "ranking",
      metric: "ota",
      entityType: "office",
      groupBy: ["office"],
      window: fullDatasetWindow(),
      comparison: { enabled: true, type: "peer", direction: "lowest" },
      superlative: "worst",
      controls: [],
    };
  }

  if (/\b(worst|lowest)\b/.test(lower) && /\bdriver\b/.test(lower) && /(on[- ]?time|\bota\b)/.test(lower)) {
    return {
      question: q,
      intent: "ranking",
      metric: "ota",
      entityType: "driver",
      groupBy: ["driver"],
      window: fullDatasetWindow(),
      comparison: { enabled: true, type: "peer", direction: "lowest" },
      superlative: "worst",
      controls: [],
    };
  }

  const vendorWhy = lower.match(/why\s+(?:is|does|did)\s+(.+?travel)\b[\s\S]*?(?:sla|ota|on[- ]?time|low|poor)/);
  if (vendorWhy) {
    return {
      question: q,
      intent: "explanation",
      metric: "ota",
      entityType: "vendor",
      entityFilter: { dimension: "vendor", value: vendorWhy[1].trim() },
      groupBy: ["vendor"],
      window: {
        label: "latest 30 days versus previous 30 days",
        currentStart: "2026-07-02",
        currentEnd: DATASET_END,
        comparisonStart: "2026-06-02",
        comparisonEnd: "2026-07-01",
      },
      comparison: { enabled: true, type: "prior_period", direction: "change" },
      controls: [],
    };
  }

  const officeDrop = lower.match(/why\s+did\s+(.+?)\s+(?:office\s+)?ota\s+(?:drop|decline|fall)/);
  if (officeDrop) {
    const office = officeDrop[1].replace(/\boffice\b/g, "").trim();
    return {
      question: q,
      intent: "explanation",
      metric: "ota",
      entityType: "office",
      entityFilter: { dimension: "office", value: office },
      groupBy: ["office"],
      window: {
        label: "latest 30 days versus previous 30 days",
        currentStart: "2026-07-02",
        currentEnd: DATASET_END,
        comparisonStart: "2026-06-02",
        comparisonEnd: "2026-07-01",
      },
      comparison: { enabled: true, type: "prior_period", direction: "change" },
      controls: [],
    };
  }

  if (/feedback|employee experience/.test(lower) && /july/.test(lower)) {
    return {
      question: q,
      intent: "feedback_diagnosis",
      metric: "feedback_experience",
      entityType: "feedback_dimension",
      groupBy: ["feedback_dimension", "office"],
      window: { label: "July 2026", currentStart: "2026-07-01", currentEnd: DATASET_END },
      comparison: { enabled: true, type: "peer", direction: "lowest" },
      controls: [],
    };
  }

  if (/sev[- ]?1/.test(lower) && /(unusual|high|spike)/.test(lower)) {
    return {
      question: q,
      intent: "anomaly",
      metric: "sev1_alerts",
      entityType: "business_unit",
      groupBy: ["business_unit"],
      window: { label: "latest five complete days", currentStart: "2026-07-27", currentEnd: DATASET_END },
      comparison: { enabled: true, type: "historical_distribution", direction: "versus" },
      controls: [],
    };
  }

  if (/\bev\b|electric vehicle|electric cab/.test(lower) && /delay/.test(lower) && /(correspond|correlat|relationship|associated)/.test(lower)) {
    return {
      question: q,
      intent: "correlation",
      metric: "ev_delay_relationship",
      entityType: "operational_lane",
      groupBy: ["office", "vendor"],
      window: fullDatasetWindow(),
      comparison: { enabled: true, type: "controlled", direction: "versus" },
      controls: ["office"],
    };
  }

  if (/\bvendors?\b/.test(lower) && /\bota\b/.test(lower) && /(?:\bsla\b|90%)/.test(lower)
    && /(recent|deteriorat|consisten|performer|below)/.test(lower)) {
    return {
      question: q,
      intent: "vendor_sla_diagnosis",
      metric: "ota",
      entityType: "vendor",
      groupBy: ["vendor"],
      window: { label: "May–July 2026 monthly trend", currentStart: "2026-05-01", currentEnd: DATASET_END },
      comparison: { enabled: true, type: "historical_trend", direction: "lowest" },
      superlative: "worst",
      controls: [],
    };
  }

  if (/\bota\b/.test(lower) && /(meeting|meet|target|sla)/.test(lower)) {
    return {
      question: q,
      intent: "target_check",
      metric: "ota",
      entityType: "fleet",
      groupBy: [],
      window: fullDatasetWindow(),
      comparison: { enabled: true, type: "sla", direction: "versus" },
      controls: [],
    };
  }

  return null;
}
