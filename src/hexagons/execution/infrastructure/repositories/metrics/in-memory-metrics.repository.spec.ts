import { InMemoryMetricsRepository } from "./in-memory-metrics.repository";
import { runMetricsContractTests } from "./metrics-repository.contract.spec";

runMetricsContractTests("InMemoryMetricsRepository", () => new InMemoryMetricsRepository());
