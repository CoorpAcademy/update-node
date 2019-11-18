# Update node :outbox_tray:

[![Npm version](https://img.shields.io/npm/v/@coorpacademy/update-node.svg)](https://www.npmjs.com/package/@coorpacademy/update-node)
[![Build Status](https://travis-ci.org/CoorpAcademy/update-node.svg?branch=master)](https://travis-ci.org/CoorpAcademy/update-node)
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
