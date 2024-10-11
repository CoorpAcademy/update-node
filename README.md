# Update node :outbox_tray:

[![Npm version](https://img.shields.io/npm/v/@coorpacademy/update-node.svg)](https://www.npmjs.com/package/@coorpacademy/update-node)
[![Build Status](https://app.travis-ci.com/CoorpAcademy/update-node.svg?token=KnYzxEMEXjZwczDR8x2L&branch=master)](https://travis-ci.com/CoorpAcademy/update-node)
[![Github Actions Status](https://github.com/coorpacademy/update-node/actions/workflows/ci.yml/badge.svg)](https://github.com/CoorpAcademy/update-node/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/CoorpAcademy/update-node/branch/master/graph/badge.svg)](https://codecov.io/gh/CoorpAcademy/update-node)

## Options :gear:

```bash
$ update-node [command]

Commands:
  update-node bump-dependencies  Upgrades defined dependencies and open Pull
                                 request for them            [aliases: upgrade, bd]
  update-node auto-bump          Auto Bump package version   [aliases: version, ab]
  update-node validate           Validate a update-node configuration
                                                                   [aliases: check]
  update-node setup              Scaffold a update-node configuration
                                                                [aliases: scaffold]

Options:
      --version                        Show version number             [boolean]
  -l, --local                          Run in local mode with github publication
                                                                       [boolean]
  -v, --verbose                        More log outputs                [boolean]
  -t, --token                          Token to authentificate to github[string]
  -a, --autoToken, --at, --auto-token  Get authentificated github token from gh
                                       cli                             [boolean]
  -A, --auto                           Select automatically behavior to adopt
                                       based on current commit and branch
                                                                       [boolean]
  -F, --folder                         Run in a specific folder         [string]
  -s, --scope                          Apply to a scope of the repository
                                       (impact on title and branch name)[string]
  -C, --config                         Override update-node configuration
                                       default path                     [string]
  -d, --default-config, --default      Override update-node configuration
                                       default path                    [boolean]
  -c, --clean                          Run on a clean state            [boolean]
  -p, --pre-clean-command              Run before to clean state         [array]
  -P, --post-clean-command             Run on a clean state              [array]
  -f, --force                          Git Push with force changes
                                       (--force-with-lease is used by default)
                                                                       [boolean]
  -h, --help                           Show help                       [boolean]

Upgrade related options:
  -T, --target                           Node version to target         [string]
      --ignoreDependencies, --only-node  Ignore depencies              [boolean]
      --lerna                            Consider as learna monorepo (only
                                         applies for node bump)        [boolean]
  -m, --message                          Optional extra message to attach to the
                                         commit and pull request        [string]
  -r, --reviewers                        Extra reviewers to add to the pull
                                         request                        [string]
  -R, --teamReviewers                    Extra team reviewers to add to the pull
                                         request                        [string]
      --exact                            Keep exact version in engine version
                                                      [boolean] [default: false]
      --loose                            For loose version for nodes version.
                                         This will replace exisiting range
                                         constraint (^, ~ or none).
                                         Use --no-loose to disable or place
                                         loose: false in config in the node
                                         section)      [boolean] [default: true]

Examples
    update-node --token=TKN

    update-node -t TKN --config .my-update-node-config.json
```

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

Here is the list of config properties:
- `branch`: the branch prefix for the node updates to be perform
- `nvrmc`: should a `.nvmrc` file be udpated (default _true_), can be an array of files
- `dockerfile`: should a Dockerfile be udpated (default _false_), can be an array of files
- `travis`: should a `.travis.yml` be udpated (default _false_), can be an array of files
- `package`: should package engine in `package.json` be updated (default _false_), can be an array of files

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

Here is the config of the repo itself:
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
    "publish": true,
    "keywords": {
      "noop": ["#noop", "Update *#*"],
      "major": "#major",
      "minor": true,
      "patch": ["#bug", "#tweak", "plugging", "#updates"]
    }
  },
  "node": false,
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
