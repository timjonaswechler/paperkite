import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import { useAtomValue } from "@effect/atom-react";
import { msg } from "gt-react";
import type { VcsRefTarget } from "@t3tools/client-runtime/state/vcs";
import type { EnvironmentId, VcsListRefsResult, VcsRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";
import { m, type MessageResolver } from "../i18n/messages";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { vcsEnvironment } from "./vcs";
import { isPaginatedBranchesNextPagePending } from "./paginatedBranches";
const VCS_REF_LIST_LIMIT = 100;
const EMPTY_REFS: ReadonlyArray<VcsRef> = [];
const INITIAL_BRANCH_CURSORS = [undefined] as const;
function vcsRefPageAtom(targetKey: string, cursor: number | undefined) {
  const [environmentId, cwd, query] = JSON.parse(targetKey) as [EnvironmentId, string, string];
  return vcsEnvironment.listRefs({
    environmentId,
    input: {
      cwd,
      ...(query.length > 0 ? { query } : {}),
      ...(cursor === undefined ? {} : { cursor }),
      limit: VCS_REF_LIST_LIMIT,
    },
  });
}

const EMPTY_VCS_REF_PAGES_ATOM = Atom.make<
  ReadonlyArray<Atom.Type<ReturnType<typeof vcsRefPageAtom>>>
>([]).pipe(Atom.withLabel("web:vcs-ref-pages:empty"));

const vcsRefPagesAtom = Atom.family((pagesKey: string) => {
  const [targetKey, cursors] = JSON.parse(pagesKey) as [string, Array<number | null>];
  const pageAtoms = cursors.map((cursor) => vcsRefPageAtom(targetKey, cursor ?? undefined));
  return Atom.make((get) => pageAtoms.map((atom) => get(atom))).pipe(
    Atom.withLabel(`web:vcs-ref-pages:${pagesKey}`),
  );
});

export function usePaginatedBranches(target: VcsRefTarget, resolve: MessageResolver = m) {
  // Leave unkeyed; mismatches already reset cursors, and a seeded key would break caching across the hook.
  const [pagination, setPagination] = useState<{
    readonly targetKey: string | null;
    readonly cursors: ReadonlyArray<number | undefined>;
  }>({
    targetKey: null,
    cursors: INITIAL_BRANCH_CURSORS,
  });
  const { environmentId, cwd } = target;
  const query = target.query?.trim() ?? "";
  const targetKey =
    environmentId !== null && cwd !== null ? JSON.stringify([environmentId, cwd, query]) : null;
  const cursors = pagination.targetKey === targetKey ? pagination.cursors : INITIAL_BRANCH_CURSORS;
  const pagesKey = targetKey === null ? null : JSON.stringify([targetKey, cursors]);
  const results = useAtomValue(
    pagesKey === null ? EMPTY_VCS_REF_PAGES_ATOM : vcsRefPagesAtom(pagesKey),
  );
  const values = results.flatMap((result) => {
    const value = AsyncResult.getOrElse(result, () => null);
    return value === null ? [] : [value];
  });
  const refs = new Map<string, VcsRef>();
  for (const value of values) {
    for (const ref of value.refs) {
      refs.set(ref.name, ref);
    }
  }
  const first = values[0] ?? null;
  const last = values.at(-1) ?? null;
  const data: VcsListRefsResult | null =
    first === null || last === null
      ? null
      : {
          refs: [...refs.values()],
          isRepo: first.isRepo,
          hasPrimaryRemote: first.hasPrimaryRemote,
          nextCursor: last.nextCursor,
          totalCount: Math.max(...values.map((value) => value.totalCount)),
        };
  const failed = results.find((result) => result._tag === "Failure");
  const isFetchingNextPage = isPaginatedBranchesNextPagePending(results);
  const error =
    failed?._tag === "Failure"
      ? (() => {
          const cause = Cause.squash(failed.cause);
          return (
            (cause instanceof Error ? errorDisplayMessage(cause, resolve) : null) ??
            resolve(msg("Failed to load refs."))
          );
        })()
      : null;
  const refresh = () => {
    setPagination({ targetKey, cursors: INITIAL_BRANCH_CURSORS });
    if (targetKey !== null) {
      appAtomRegistry.refresh(vcsRefPageAtom(targetKey, undefined));
    }
  };
  const nextCursor = data?.nextCursor;
  const loadNext = () => {
    if (targetKey === null || nextCursor === null || nextCursor === undefined) {
      return;
    }
    setPagination((current) => {
      const currentCursors =
        current.targetKey === targetKey ? current.cursors : INITIAL_BRANCH_CURSORS;
      return currentCursors.includes(nextCursor)
        ? { targetKey, cursors: currentCursors }
        : { targetKey, cursors: [...currentCursors, nextCursor] };
    });
  };

  return {
    data,
    refs: data?.refs ?? EMPTY_REFS,
    error,
    isPending: results.some((result) => result.waiting),
    isFetchingNextPage,
    refresh,
    loadNext,
  };
}
