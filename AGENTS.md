# Paperkite

## Architecture and scope

Read [the agreed architecture](docs/internals/architecture.md) first. T3 is an unchanged dependency, not the location for product edits. This branch is a new foundation, not a replacement ready for deployment. Do not import the old implementation, migrate data, disable native features, or start paid model work without a scoped task.

## Inherited engineering rules

The engineering guidance in [T3's AGENTS.md](vendor/t3/AGENTS.md) applies to owned Paperkite sources too: performance, native UI primitives, React Compiler, Effect services and scripts, contracts, authorization, meaningful tests and documentation. Follow its area-specific links before implementation. Upstream contribution policy and release infrastructure do not define Paperkite product scope.

- Never edit, install dependencies in, or start services from `vendor/t3/`.
- Edit owned sources only. `.build/t3/` is disposable composition output, never an authoritative source.
- Add integrations before replacing upstream files. Every replacement needs a reason and the original file's SHA-256 in `integration/t3/composition.json`.
- Use `pnpm setup`, `pnpm compose`, `pnpm check`, `pnpm test` and `pnpm build`; see [development](docs/operations/development.md). Builds precede web typechecks because T3 generates route types during its build.
- The dependency-free bootstrap and its Node tests are the pre-install exception described in T3's scripts guidance. Application and post-install service/CLI code follow Effect conventions; do not extend the bootstrap into a domain runtime.
- Native web and server are the current integration scope. Desktop/mobile distribution, authentication changes, production access, migration and deployment require separate decisions.
- Development state stays in this checkout's `.local/t3/`, with seeding disabled. Never read credentials into fixtures or point a process at existing Paperkite/T3 data. Track and stop only processes you started.
- Use focused checks while iterating. CI owns full suites. Do not weaken checks or hide unsupported upstream tooling behind a successful exit.
- Keep the upstream license and trademark policy intact. This development scaffold is not a branded distribution.

Documentation follows T3's user/internals/operations split. State what is implemented versus proposed; do not maintain a second feature catalog or duplicate upstream technical docs.
