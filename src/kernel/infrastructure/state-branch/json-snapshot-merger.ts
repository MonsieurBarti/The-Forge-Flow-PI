export interface SnapshotEntity {
  id: string;
  [key: string]: unknown;
}

export interface Snapshot {
  project?: Record<string, unknown>;
  milestones: SnapshotEntity[];
  slices: SnapshotEntity[];
  tasks: SnapshotEntity[];
  shipRecords?: SnapshotEntity[];
  completionRecords?: SnapshotEntity[];
}

export function mergeSnapshots(
  parent: Snapshot,
  child: Snapshot,
  sliceId: string,
): Snapshot {
  return {
    // project: parent always wins
    project: parent.project,
    // milestones: parent always wins
    milestones: mergeById(
      parent.milestones ?? [],
      child.milestones ?? [],
      () => false,
    ),
    // slices: child wins only for the owned slice
    slices: mergeById(
      parent.slices ?? [],
      child.slices ?? [],
      (entity) => entity.id === sliceId,
    ),
    // tasks: child wins only for tasks belonging to the owned slice
    tasks: mergeById(
      parent.tasks ?? [],
      child.tasks ?? [],
      (entity) => entity.sliceId === sliceId,
    ),
    // shipRecords: child wins for records matching owned slice
    shipRecords: mergeById(
      parent.shipRecords ?? [],
      child.shipRecords ?? [],
      (entity) => entity.sliceId === sliceId,
    ),
    // completionRecords: parent always wins
    completionRecords: mergeById(
      parent.completionRecords ?? [],
      child.completionRecords ?? [],
      () => false,
    ),
  };
}

function mergeById(
  parentArr: SnapshotEntity[],
  childArr: SnapshotEntity[],
  childWins: (entity: SnapshotEntity) => boolean,
): SnapshotEntity[] {
  const parentMap = new Map<string, SnapshotEntity>(parentArr.map((e) => [e.id, e]));
  const childMap = new Map<string, SnapshotEntity>(childArr.map((e) => [e.id, e]));

  const result = new Map<string, SnapshotEntity>();

  // Walk all ids from both sides
  const allIds = new Set([...parentMap.keys(), ...childMap.keys()]);

  for (const id of allIds) {
    const inParent = parentMap.get(id);
    const inChild = childMap.get(id);

    if (inParent !== undefined && inChild !== undefined) {
      // Both have it — apply ownership rule
      result.set(id, childWins(inChild) ? inChild : inParent);
    } else if (inParent !== undefined) {
      result.set(id, inParent);
    } else if (inChild !== undefined) {
      result.set(id, inChild);
    }
  }

  return Array.from(result.values());
}
