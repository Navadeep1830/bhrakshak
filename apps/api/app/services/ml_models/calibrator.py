"""Bundle-portable monotone grid calibrator.

Lives in the API's package tree (not ml/) because the pickle that carries it
is unpickled inside the API process, and the deployed API image mounts only
`apps/api/app`. A class pickled from ml.models.* would fail to unpickle there
-- the same failure mode as the __main__-pickled artifact this replaces.

Pure numpy: importing it never pulls the training stack.
"""

from __future__ import annotations

import numpy as np


class PicklableCalibrator:
    """Monotone piecewise-linear map from raw model score to probability.

    Captured from fit_calibrator()'s closure at export time (isotonic and
    Platt-on-rank are both monotone, so interpolating their outputs on the
    calibration grid is exact at every observed score and linearly
    interpolated in between).

    The legacy name `_PicklableCalibrator` is kept as an alias because older
    exports reference it.
    """

    def __init__(self, xs, ys):
        self.xs = np.asarray(xs, dtype=float)
        self.ys = np.asarray(ys, dtype=float)

    def predict(self, x):
        return np.interp(np.asarray(x, dtype=float), self.xs, self.ys)


# Legacy alias: exports pickled before the rename reference this name.
_PicklableCalibrator = PicklableCalibrator