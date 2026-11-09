# Update node :outbox_tray:

[![Npm version](https://img.shields.io/npm/v/@coorpacademy/update-node.svg)](https://www.npmjs.com/package/@coorpacademy/update-node)
[![Build Status](https://app.travis-ci.com/CoorpAcademy/update-node.svg?token=KnYzxEMEXjZwczDR8x2L&branch=master)](https://travis-ci.com/CoorpAcademy/update-node)
[![Github Actions Status](https://github.com/coorpacademy/update-node/actions/workflows/ci.yml/badge.svg)](https://github.com/CoorpAcademy/update-node/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/CoorpAcademy/update-node/branch/master/graph/badge.svg)](https://codecov.io/gh/CoorpAcademy/update-node)

## Options :gear:

Requires Node.js 22.12.0 or newer.

Running the tests with AVA requires Node 22.20+, Node 24.12+, or Node 26+. Use the development version in `.nvmrc`.

```text
$ update-node --help
update-node [command]

Commands:
  update-node bump-dependencies  Upgrade Node.js and configured dependency
                                 clusters, then open pull requests
                                                          [aliases: upgrade, bd]
  update-node auto-bump          Bump the package version and publish if
                                 configured               [aliases: version, ab]
  update-node cleanup-prs        Comment on and close superseded generated
                                 Node.js upgrade pull requests
  update-node validate           Check the update-node configuration against its
                                 schema                         [aliases: check]
  update-node setup              Create .update-node.json using detected
                                 repository settings         [aliases: scaffold]

Options:
      --version                        Show version number             [boolean]
  -l, --local                          Keep upgrade commits local and skip
                                       GitHub PR cleanup               [boolean]
  -v, --verbose                        Include stack traces when a command fails
                                                                       [boolean]
  -t, --token                          GitHub token used for authentication
                                                                        [string]
  -a, --autoToken, --at, --auto-token  Use the GitHub token from gh auth token
                                                                       [boolean]
  -A, --auto                           Choose an upgrade or release from the
                                       current branch and commit       [boolean]
  -F, --folder                         Change to this folder before running the
                                       command                          [string]
  -s, --scope                          Scope for upgrade titles and branch
                                       names; does not change folders   [string]
  -C, --config                         Read configuration from this file instead
                                       of .update-node.json             [string]
  -d, --default-config, --default      Infer configuration when no configuration
                                       file is found                   [boolean]
  -c, --clean                          Stash changes, check out master and pull
                                       its upstream                    [boolean]
      --sync-lock                      Refresh lockfiles after a Node.js
                                       upgrade; disable with --no-sync-lock
                                                       [boolean] [default: true]
  -b, --pre-commit-bump-command        Commands to run before committing a
                                       Node.js upgrade; include their changes
                                                                         [array]
  -p, --pre-clean-command              Commands to run before stashing changes
                                       and checking out master           [array]
  -P, --post-clean-command             Commands to run after the clean checkout
                                       and pull                          [array]
  -f, --force                          Push with --force instead of
                                       --force-with-lease              [boolean]
  -h, --help                           Show help                       [boolean]

Upgrade related options:
  -T, --target                           Node.js version or range to target
                                                                        [string]
      --ignoreDependencies, --only-node  Upgrade only Node.js; skip dependency
                                         clusters                      [boolean]
      --lerna                            Update package engines in Lerna
                                         workspaces during a Node.js upgrade
                                                                       [boolean]
  -m, --message                          Append a message to upgrade commits and
                                         pull requests                  [string]
  -r, --reviewers                        Additional GitHub reviewers, separated
                                         by commas                      [string]
  -R, --teamReviewers                    Additional GitHub team reviewers,
                                         separated by commas            [string]
      --exact                            Use exact Node.js and npm engine
                                         versions     [boolean] [default: false]
      --loose                            Use >= for engine ranges; --no-loose
                                         preserves existing prefixes
                                                       [boolean] [default: true]

Examples:
  update-node setup                         Create a configuration for the
                                            current repository
  update-node bump-dependencies             Upgrade Node.js and configured
  --auto-token                              dependencies
  update-node auto-bump --auto-token        Create a release using the
                                            configured rules
  update-node cleanup-prs --repo            Clean up superseded Node.js upgrade
  owner/name --auto-token                   PRs in any repository
```

Run `update-node <command> --help` for command-specific options and examples.

### Configuration

Configuration goes in a `.update-node.json` at the top level of your repository.

#### Base Configuration

Here are the main configuration items:
- `repoSlug`: the github account + repo name
- `reviewers`, `teamReviewers`: array of reviewers or team reviewers, default `[]`
- `baseBranch`: the branch to target, default `master`
- `label`: the tabel to attach to the update Pull request (default `Upgrades :outbox_tray:`)
- `packageManager`: the package manager to use (default `npm` unless a `yarn.lock`)

Three more complex items to configure the `node` bump logic,  dependencies bump logic `auto-bump`, and the PR updates `dependencies`, see below in the sections below.

#### Auto-Bump
You can configure the ability to make a new version with the top level `auto-bump` key.

Set `auto-bump` to `false` to disable autobump, including its automatic PR cleanup, or use an object to configure it.

`auto-bump.auto-clean-up` controls cleanup of superseded Node.js upgrade PRs during autobump and defaults to `true`. Set it to `false` to disable automatic cleanup. The standalone `cleanup-prs` command remains available regardless of this setting.

If you want the new package version to be publiished, just the the `publish` subproperty to true. (Default command `npm publish`, repleaceable with `publish-command`)

The default mecanism to select which semver level is based on a keyword mechanism. `major`, `minor`, `patch` that are provided to `npm version`. `noop` is also used to prevent a new version to be made.

For the bump, default keywords are the following
- `major`: `#major`
- `minor`: `#noop` `#noRelease` (was an accepted `_` or `-` between _no_  and _release_)
- `patch`: `#patch`, `#bug`, `#fix`, `#tweak`, `#updates`
- `noop`: `#minor`

Order of preference is `noop`, `major`, `parch`, `minor`. If none match, the latest is selected. By default `minor`

You can either add your custom keywords with `custom-keywords` or replace default with yours using `keywords`. Both of them accept an object {[priority]: [keywordOrList]}. (if you have only one keyword pattern for one given semver level, you can just provide it as a string)/

Pattern matching is insensitive.

You can also provide [minimatch] glob patterns as value.

If ever you want a custom, external selection mecanism just put your command in the `release-type-command` property.


#### `node`
This property helps to configure the files that are related to a node version, and that you wish to be updated when trying the bump the node version.

When a Node upgrade synchronizes the lockfile or runs precommit bump commands, update-node requires a Node version manager. It prefers nvm (`nvm use`, then `nvm install` if needed), falling back to `n auto` when nvm is unavailable. These commands run with the activated Node version. If neither manager is available, the upgrade stops before changing version files with `No node version manager was found`. Upgrades with `--no-sync-lock` and no precommit commands do not require a manager.

When the primary package declares an `engines.node` range starting with `>=`, automatic upgrades prepare a separate alternative for each released, supported even Node major that matches the effective range. Current releases are included before LTS; prereleases and EOL majors are excluded. The latest release with an available exact Docker tag is selected for each major. An explicit `--target` or another engine range operator retains the single-upgrade behavior.

Each alternative starts from the same `baseBranch` commit. A new major raises the engine minimum to the selected full release and updates an existing npm engine to the bundled npm version. Within the same major, each package keeps its existing Node and npm engine ranges while configured version pins and lockfiles refresh. Set `node.preserveSameMajor` to `false` to raise engine minima within the same major as well. A candidate below any configured package's minimum is skipped. Lock synchronization and precommit commands explicitly activate the selected release, even when no `.nvmrc` is configured.

Branches use the configured prefix, scope, major and minor, such as `update-node-api-v24.10`. Patch updates reuse the branch and PR. Local mode prepares independent local branches and commits. The original checkout is restored after each candidate; a clean tracked working tree is required. Failures are reported, other candidates continue, and the command exits unsuccessfully if any candidate failed. Unchanged candidates create no commit or PR.

During `auto-bump`, before creating the version commit, update-node checks the most recent merged PR at HEAD, including fast-forward summary commits. If it is a generated Node upgrade PR, it comments `Superseeded by #<merged-PR-number>` on matching Node upgrade PRs for lower majors or older minors within the same major, and closes them. Higher-version alternatives stay open. Cleanup requires matching generated metadata, repository, base, prefix and scope; PR authors do not need to match each other or the authenticated account. It runs only after a merge, not when a replacement PR is created. Existing identical comments are reused on retries. Local mode skips GitHub cleanup, and lookup or cleanup failures emit warnings without blocking the release.

Run `update-node cleanup-prs --auto-token` (or `--token <token>`) to perform cleanup independently of autobump and HEAD across all major lines. A matching newer merged upgrade takes precedence as the replacement, even for the newest open PR in its line. Otherwise, the newest open PR within each major supersedes older open PRs in that same major: with `22.1`, `22.2` and `22.3` open, cleanup closes the first two and references the `22.3` PR. Open higher-major alternatives do not supersede lower-major PRs. No version bump or publication is performed. `--local` skips GitHub access.

To clean up another repository from any folder, use `update-node cleanup-prs --repo owner/name --auto-token` (or `--token <token>`). With `--repo`, local configuration and package files are bypassed, and the target repository's default branch is resolved through GitHub. Repository, base, prefix and scope safeguards still apply, regardless of PR author. The command reports matching PR counts and the number closed, kept or failed, including when no eligible PRs are found. `--local` skips the lookup and cleanup.

Cleanup also recognizes older PRs without metadata when their generated title, body and full-version branch agree, for example `Upgrade Node to v26.13.0`, `:rocket: Upgraded Node version to v26.13.0`, and `update-node-v26.13.0`. Patch versions are compared numerically. A modern PR replaces an older-format PR for the same version, including the default prefix transition from `update-node` to `upgrade-node`; custom prefixes and scopes remain separate. A modern PR for a lower patch version cannot replace a newer legacy PR.

Here is the list of config properties:
- `branch`: the branch prefix for the node updates to be perform
- `exact`: write exact Node.js and npm engine versions, such as `24.22.2`, instead of ranges. Defaults to `false`; enabling `exact` takes precedence over `loose`.
- `loose`: write `>=` engine ranges by default. Set to `false` to preserve existing range prefixes, such as `^` or `~`, when `exact` is disabled. Equivalent CLI flags are `--exact` and `--no-loose`.
- `preserveSameMajor`: preserve existing Node and npm engine ranges when the selected release is in the same Node major. Defaults to `true` for automatic multi-version upgrades and `false` for single-version upgrades, including explicit `--target` requests. An explicit boolean overrides either default; pins and lockfiles still refresh.
- `nvmrc`: update `.nvmrc` files
- `dockerfile`: update Node.js versions in Dockerfiles
- `travis`: update Node.js versions in `.travis.yml` files
- `package`: update package engines in `package.json` files
- `serverless`: update Node.js runtimes in `serverless.yml` files
- `lerna`: update package engines across Lerna workspaces; defaults to `false` unless enabled with `--lerna` or detected when generating a default configuration

Each file option accepts `true` for its usual filename, a path, an array of paths, or `false` to skip it. Omitted file options are skipped; generated default configurations enable detected files and package engines. Set `node` to `false` to disable Node.js upgrades entirely.

When `preserveSameMajor` applies, existing engine ranges are kept even if `exact` or `loose` would otherwise change their formatting.

#### Dependencies Updates

The `dependencies` item is here to define the set of dependencies clusters you want to upgrade.
A cluster config have the following properties:
- `name`: The name of the cluster
- `message`: The name of the commit, and the Pull Request
- `branch`: The branch to use to open the pull request
- `dependencies`: The (production) dependencies to be updated.
- `devDependencies`: The dev dependencies to be updated.

The dependecies can either be a full match, or a glob using [minimatch]. For instance `eslint`, `eslint-plugin-*` `@babel/*`

### Example:

Here is a configuration inspired from this repository, with Node.js upgrades and automatic PR cleanup explicitly enabled:
```json
{
  "repoSlug": "Coorpacademy/update-node",
  "baseBranch": "master",
  "packageManager": "npm",
  "reviewers": [],
  "teamReviewers": [
    "env:TEAM_REVIEWERS"
  ],
  "label": "Upgrades :outbox_tray:",
  "auto-bump": {
    "auto-clean-up": true,
    "publish": true,
    "keywords": {
      "noop": ["#noop", "Update *#*"],
      "major": "#major",
      "minor": true,
      "patch": ["#bug", "#tweak", "plugging", "#updates"]
    }
  },
  "node": {
    "branch": "upgrade-node",
    "exact": false,
    "loose": true,
    "preserveSameMajor": true,
    "nvmrc": true,
    "dockerfile": false,
    "travis": false,
    "package": true,
    "serverless": false,
    "lerna": false
  },
  "dependencies": [
    {
      "name": "core",
      "message": "Update core dependencies",
      "branch": "update-core",
      "dependencies": [
        "bluebird",
        "yaml",
        "lodash",
        "minimatch",
        "yargs",
        "protocall",
        "request",
        "semver",
        "shelljs"
      ]
    },
    {
      "name": "testing-tools",
      "message": "Update Testing dependencies",
      "devDependencies": [
        "ava",
        "istanbul",
        "codecov",
        "nyc"
      ]
    },
    {
      "name": "eslint",
      "message": "Update eslint",
      "devDependencies": [
        "eslint",
        "@coorpacademy/eslint-plugin-coorpacademy"
      ]
    }
  ]
}
```

You can also check the [validation schema](./src/core/config.js) or [test sample](./test/integration/.update-node.json)

[minimatch]: https://www.npmjs.com/package/minimatch
