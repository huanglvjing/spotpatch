export type WorkspaceActivityKind = "ask" | "change";

export interface WorkspaceActivityLease {
  release(): void;
}

export interface WorkspaceActivityCoordinator {
  acquire(kind: WorkspaceActivityKind): WorkspaceActivityLease | undefined;
  current(): WorkspaceActivityKind | undefined;
}

export function createWorkspaceActivityCoordinator(): WorkspaceActivityCoordinator {
  let active: WorkspaceActivityKind | undefined;

  return Object.freeze({
    acquire(kind: WorkspaceActivityKind): WorkspaceActivityLease | undefined {
      if (active !== undefined) return undefined;
      active = kind;
      let released = false;
      return Object.freeze({
        release(): void {
          if (released) return;
          released = true;
          if (active === kind) active = undefined;
        },
      });
    },
    current(): WorkspaceActivityKind | undefined {
      return active;
    },
  });
}
