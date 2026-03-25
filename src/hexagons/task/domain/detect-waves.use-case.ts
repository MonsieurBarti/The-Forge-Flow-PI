import { err, ok, type Result } from "@kernel";
import { CyclicDependencyError } from "./errors/cyclic-dependency.error";
import { WaveDetectionPort } from "./ports/wave-detection.port";
import type { TaskDependencyInput, Wave } from "./wave.schemas";

export class DetectWavesUseCase extends WaveDetectionPort {
  detectWaves(tasks: readonly TaskDependencyInput[]): Result<Wave[], CyclicDependencyError> {
    if (tasks.length === 0) {
      return ok([]);
    }

    const taskIds = new Set(tasks.map((t) => t.id));

    const dependents = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const id of taskIds) {
      dependents.set(id, []);
      inDegree.set(id, 0);
    }

    const blockedByFiltered = new Map<string, string[]>();
    for (const task of tasks) {
      const known = task.blockedBy.filter((dep) => taskIds.has(dep));
      blockedByFiltered.set(task.id, known);
      inDegree.set(task.id, known.length);
      for (const dep of known) {
        const existing = dependents.get(dep) ?? [];
        existing.push(task.id);
        dependents.set(dep, existing);
      }
    }

    const waves: Wave[] = [];
    let queue = [...taskIds].filter((id) => (inDegree.get(id) ?? 0) === 0).sort();
    let processed = 0;

    while (queue.length > 0) {
      waves.push({ index: waves.length, taskIds: [...queue].sort() });
      processed += queue.length;

      const nextQueue: string[] = [];
      for (const id of queue) {
        for (const dependent of dependents.get(id) ?? []) {
          const newDegree = (inDegree.get(dependent) ?? 1) - 1;
          inDegree.set(dependent, newDegree);
          if (newDegree === 0) {
            nextQueue.push(dependent);
          }
        }
      }
      queue = nextQueue.sort();
    }

    if (processed < taskIds.size) {
      const remaining = new Set([...taskIds].filter((id) => (inDegree.get(id) ?? 0) > 0));
      const cyclePath = this.findCyclePath(remaining, blockedByFiltered);
      return err(new CyclicDependencyError(cyclePath));
    }

    return ok(waves);
  }

  private findCyclePath(remaining: Set<string>, blockedBy: Map<string, string[]>): string[] {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const parent = new Map<string, string>();

    for (const startNode of [...remaining].sort()) {
      if (visited.has(startNode)) continue;

      const stack: string[] = [startNode];
      while (stack.length > 0) {
        const node = stack[stack.length - 1];

        if (node === undefined) break;

        if (!visited.has(node)) {
          visited.add(node);
          inStack.add(node);
        }

        const deps = (blockedBy.get(node) ?? []).filter((d) => remaining.has(d));
        let pushed = false;

        for (const dep of deps.sort()) {
          if (!visited.has(dep)) {
            parent.set(dep, node);
            stack.push(dep);
            pushed = true;
            break;
          }
          if (inStack.has(dep)) {
            const path: string[] = [dep, node];
            let current: string | undefined = node;
            while (current !== undefined && current !== dep) {
              current = parent.get(current);
              if (current !== undefined) {
                path.push(current);
              }
            }
            path.reverse();
            return path;
          }
        }

        if (!pushed) {
          stack.pop();
          inStack.delete(node);
        }
      }
    }

    return [...remaining].sort();
  }
}
