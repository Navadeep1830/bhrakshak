PY := python3

.PHONY: data features train-susceptibility train-hazard backtest all clean

data: ## Build offline-safe synthetic datasets + fixtures (real downloads optional)
	$(PY) -m ml.ingest.dem --synthetic
	$(PY) -m ml.ingest.inventory --synthetic
	$(PY) -m ml.ingest.weather --synthetic

features:
	$(PY) -m ml.features.terrain --from-synthetic

train-susceptibility:
	$(PY) -m ml.models.susceptibility

train-hazard:
	$(PY) -m ml.models.hazard

backtest:
	$(PY) -m ml.models.backtest

all: data features train-susceptibility train-hazard backtest

clean:
	rm -rf ml/artifacts ml/.cache
