# Update node :outbox_tray:

[![Npm version](https://img.shields.io/npm/v/@coorpacademy/update-node.svg)](https://www.npmjs.com/package/@coorpacademy/update-node)
[![Build Status](https://travis-ci.com/CoorpAcademy/update-node.svg?branch=master)](https://travis-ci.com/CoorpAcademy/update-node)
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
  --help        Show help                                              [boolean]
  --version     Show version number                                    [boolean]
  --local, -l   Run in local mode with github publication              [boolean]
  --token, -t   Token to authentificate to github                       [string]
  --config, -c  Override update-node configuration default path         [string]
  --auto, -A    Select automatically behavior to adopt based on current commit
                and branch                                             [boolean]
Examples
    update-node --token=TKN

    update-node -t TKN --config .my-update-node-config.json
```

### Configuration

#### Base Configuration

> _:construction: To be made_ :exclamation:


#### Auto-Bump
You can configure the ability to make a new version with the top level `auto-bump` key.

If you want the new package version to be publiished, just the the `publish` subproperty to true. (Default command `npm publish`, repleaceable with `publish-command`)

The default mecanism to select which semver level is based on a keyword mechanism. `major`, `minor`, `patch` that are provided to `npm version`. `noop` is also used to prevent a new version to be made.

For the bump, default keywords are the following
- `major`: `#major`
- `minor`: `#noop` `#noRelease` (was an accepted `_` or `-` between _no_  and _release_)
- `patch`: `#bug`, `#fix`, `#tweak`, `#updates`
- `noop`: `#minor`

Order of preference is `noop`, `major`, `parch`, `minor`. If none match, the latest is selected. By default `minor`

You can either add your custom keywords with `custom-keywords` or replace default with yours using `keywords`. Both of them accept an object {[priority]: [keywordOrList]}. (if you have only one keyword pattern for one given semver level, you can just provide it as a string)/

Pattern matching is insensitive.
You can also provide [minimatch](https://www.npmjs.com/package/minimatch) glob patterns as value.

If ever you want a custom, external selection mecanism just put your command in the `release-type-command` property.


#### Dependencies Updates

> _:construction: To be made_ :exclamation:

### Example:
You can check this project [`.update-node.json`](./.update-node.json) as example, or check [validation schema](./src/core/config.js)
