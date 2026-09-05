export type Persona = "transport_manager" | "facilities_head" | "line_manager";

export type DashboardFilters = {
  persona: Persona;
  businessUnit?: string;
  office?: string;
  month?: string;
  vendor?: string;
};

export type Metric = {
  key: string;
  label: string;
  value: number;
  format: "percent" | "number" | "currency" | "decimal";
  delta?: number | null;
  target?: number | null;
  direction?: "up" | "down" | "neutral";
  hint: string;
};

export type UiBlock =
  | { type: "metrics"; title: string; items: Array<{ label: string; value: string; tone?: string }> }
  | { type: "bars"; title: string; items: Array<{ label: string; value: number; suffix?: string }> }
  | { type: "table"; title: string; columns: string[]; rows: string[][] };

export type ChatMessage = { role: "user" | "assistant"; content: string; blocks?: UiBlock[] };
