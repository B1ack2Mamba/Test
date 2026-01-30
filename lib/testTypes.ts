// NOTE:
// - Negotiation test uses tags A–E.
// - Motivation cards test uses factors A,B,C,D,E,F,H,I.

export type Tag = "A" | "B" | "C" | "D" | "E";

export type MotivationFactor = "A" | "B" | "C" | "D" | "E" | "F" | "H" | "I";

export type ForcedPairOption = {
  tag: Tag;
  text: string;
};

export type ForcedPairQuestion = {
  order: number;
  options: [ForcedPairOption, ForcedPairOption];
};

export type TestScoring = {
  tags: Tag[];
  tag_to_style: Record<Tag, string>;
  thresholds_percent: {
    strong_gte: number;
    weak_lte: number;
  };
};

export type ForcedPairTestV1 = {
  slug: string;
  title: string;
  description?: string;
  type: "forced_pair_v1" | "forced_pair";
  /** Optional pricing info (paywall). */
  pricing?: {
    /** Price to unlock interpretation (RUB). If absent, fallback to DB price_rub. */
    interpretation_rub?: number;
    /** Price for detailed summary (RUB). Defaults to 49 if used. */
    details_rub?: number;
  };
  /** If true, there's a paid interpretation stored in Supabase (table public.test_interpretations). */
  has_interpretation?: boolean;
  questions: ForcedPairQuestion[];
  scoring: TestScoring;
};

// ===================== Motivation cards (0..5 split per pair) =====================

export type PairSplitOption = {
  factor: MotivationFactor;
  text: string;
};

export type PairSplitQuestion = {
  order: number;
  left: PairSplitOption;
  right: PairSplitOption;
  /** How many points are distributed per pair (usually 5). */
  maxPoints: number;
};

export type PairSplitScoring = {
  factors: MotivationFactor[];
  factor_to_name: Record<MotivationFactor, string>;
  groups?: {
    hygiene?: MotivationFactor[];
    motivators?: MotivationFactor[];
  };
  /** Level thresholds on a normalized 0..35 scale. */
  thresholds_norm35?: {
    low_max: number;
    mid_max: number;
  };
};

export type PairSplitTestV1 = {
  slug: string;
  title: string;
  description?: string;
  type: "pair_split_v1" | "pair_sum5_v1";
  pricing?: {
    interpretation_rub?: number;
    details_rub?: number;
  };
  has_interpretation?: boolean;
  questions: PairSplitQuestion[];
  scoring: PairSplitScoring;
};

// ===================== Color types / Structogram (Green/Red/Blue) =====================

export type ABC = "A" | "B" | "C";

export type ColorTypesChoiceQuestion = {
  order: 1 | 2;
  kind: "choice_abc";
  prompt: string;
  options: Record<ABC, string>;
};

export type ColorTypesRankQuestion = {
  order: 3 | 4;
  kind: "rank_abc";
  prompt: string;
  options: Record<ABC, string>;
};

export type ColorTypesPick3Question = {
  order: 5 | 6;
  kind: "pick3_6";
  prompt: string;
  options: Record<"1" | "2" | "3" | "4" | "5" | "6", string>;
  /** How many options must be picked. Defaults to 3. */
  pick: number;
};

export type ColorTypesQuestion = ColorTypesChoiceQuestion | ColorTypesRankQuestion | ColorTypesPick3Question;

export type ColorTypesScoring = {
  /** Base constant (12 in the original key). */
  base: number;
  /** Per-question matrix giving +/- contribution to parameters a (green) and b (red). */
  matrix: {
    q1: Record<ABC, { a: number; b: number }>;
    q2: Record<ABC, { a: number; b: number }>;
    q3: Record<string, { a: number; b: number }>;
    q4: Record<string, { a: number; b: number }>;
    q5: Record<string, { a: number; b: number }>;
    q6: Record<string, { a: number; b: number }>;
  };
  labels?: {
    green?: string;
    red?: string;
    blue?: string;
  };
};

export type ColorTypesTestV1 = {
  slug: string;
  title: string;
  description?: string;
  type: "color_types_v1";
  pricing?: {
    interpretation_rub?: number;
    details_rub?: number;
  };
  has_interpretation?: boolean;
  questions: ColorTypesQuestion[];
  scoring: ColorTypesScoring;
};

// ===================== USK (Уровень субъективного контроля) =====================

export type USKScale = "IO" | "ID" | "IN" | "IS" | "IP" | "IM" | "IZ";

export type USKQuestion = {
  order: number;
  text: string;
};

export type USKScoring = {
  scales: USKScale[];
  scale_to_name: Record<USKScale, string>;
  /** Items that add with sign (+) vs add with inverted sign (-). 1-based question indices. */
  keys: Record<USKScale, { plus: number[]; minus: number[] }>;
  /** Raw -> sten conversion. */
  stens: Record<USKScale, { min: number; max: number; sten: number }[]>;
};

export type USKTestV1 = {
  slug: string;
  title: string;
  description?: string;
  type: "usk_v1";
  pricing?: {
    interpretation_rub?: number;
    details_rub?: number;
  };
  has_interpretation?: boolean;
  questions: USKQuestion[];
  scoring: USKScoring;
};

export type AnyTest = ForcedPairTestV1 | PairSplitTestV1 | ColorTypesTestV1 | USKTestV1;
