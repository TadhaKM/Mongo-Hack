// Rental-trend model "trend-v1". Every threshold is here and stored with every result via `model`.
export const TREND_V1 = {
  version: "trend-v1",

  // Series collection (MongoDB time-series). See docs/mongodb-timeseries.md.
  series: {
    collection: "rental_observation_series",
    timeseries: {
      timeField: "observedAt",
      metaField: "meta",
      // Custom bucketing (MongoDB 6.3+): one bucket spans up to a year, because a series
      // (measure x source x type x bedrooms x LEA) receives roughly 5-100 observations a month.
      bucketMaxSpanSeconds: 31536000,
      bucketRoundingSeconds: 31536000,
    },
  },

  // unit -> how far back "year-on-year" is, in units; default window length
  units: {
    month: { lag: 12, defaultPeriods: 24, maxPeriods: 120 },
    quarter: { lag: 4, defaultPeriods: 8, maxPeriods: 40 },
    year: { lag: 1, defaultPeriods: 4, maxPeriods: 10 },
  },

  minPerBucket: 5,            // a period with fewer observations publishes no statistics (n is still reported)
  directionPct: 2,            // |latest YoY| below this is "flat"
  radiusLadderM: [1000, 2000, 4000],   // radius scope: smallest radius with enough sufficient periods
  minSufficientPeriods: 6,    // ladder stops when the best series has this many sufficient periods
  status: { insufficientBelow: 3, limitedBelow: 6 },   // by the best series' sufficient periods
  maxSeriesEvidence: 6,
};
