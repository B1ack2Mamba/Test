export type Tag = "A" | "B" | "C" | "D" | "E";

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
  };
  /** If true, there's a paid interpretation stored in Supabase (table public.test_interpretations). */
  has_interpretation?: boolean;
  questions: ForcedPairQuestion[];
  scoring: TestScoring;
};
