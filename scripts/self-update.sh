#!/bin/bash
set -e

npm config set //registry.npmjs.org/:_authToken $NPM_TOKEN
git checkout master
node ./src/index.js --token $GH_TOKEN --auto
