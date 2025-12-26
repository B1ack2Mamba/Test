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

export type AnyTest = ForcedPairTestV1 | PairSplitTestV1;
