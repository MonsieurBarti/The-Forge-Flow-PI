import { InMemoryJournalRepository } from "./in-memory-journal.repository";
import { runJournalContractTests } from "./journal-repository.contract.spec";

runJournalContractTests("InMemoryJournalRepository", () => new InMemoryJournalRepository());
