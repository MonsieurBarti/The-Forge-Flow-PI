import { InMemoryWorktreeAdapter } from "./in-memory-worktree.adapter";
import { runWorktreeContractTests } from "./worktree.contract.spec";

runWorktreeContractTests("InMemoryWorktreeAdapter", () => new InMemoryWorktreeAdapter());
