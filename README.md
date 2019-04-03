# Update node :outbox_tray:

[![Npm version](https://img.shields.io/npm/v/@coorpacademy/update-node.svg)](https://www.npmjs.com/package/@coorpacademy/update-node)
[![Build Status](https://travis-ci.org/CoorpAcademy/update-node.svg?branch=master)](https://travis-ci.org/CoorpAcademy/update-node)


## Options :gear:

```bash
$ update-node [options]

Options:
  --help        Show help                                              [boolean]
  --version     Show version number                                    [boolean]
  --local, -l   Run in local mode with github publication              [boolean]
  --token, -t   Token to authentificate to github                       [string]
  --config, -c  Override update-node configuration default path         [string]

Examples
    update-node --token=TKN

    update-node -t TKN --config .my-update-node-config.json
```
