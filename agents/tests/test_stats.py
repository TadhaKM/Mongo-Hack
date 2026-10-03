from rentcheck_agents import stats


def test_median_and_quantile():
    assert stats.median([3, 1, 2]) == 2
    assert stats.quantile([1, 2, 3, 4], 0.5) == 2.5
    assert stats.quantile([], 0.5) is None


def test_weighted_median_uses_weights():
    assert stats.weighted_median([(1000, 1), (2000, 10), (3000, 1)]) == 2000
    assert stats.weighted_median([(1000, 10), (2000, 1)]) == 1000
    assert stats.weighted_median([]) is None


def test_iqr_filter_drops_outlier():
    kept, out = stats.iqr_filter([2000, 2010, 1990, 2020, 5000])
    assert out == [5000] and 5000 not in kept


def test_pct_change_and_bands():
    assert round(stats.pct_change(2200, 2000), 1) == 10.0
    assert stats.pct_change(1, 0) is None
    assert stats.delta_band(3) == "in line with"
    assert stats.delta_band(10) == "above"
    assert stats.delta_band(-20) == "well below"


def test_percentile_rank():
    assert stats.percentile_rank(3, [1, 2, 3, 4, 5]) == 50.0
