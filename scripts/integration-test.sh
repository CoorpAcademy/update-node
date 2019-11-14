#!/bin/bash

set -e
npm link
cd test/integration
git init
git add .
git commit -m "Initial dummy commit"
npm install
npm install --save-dev @coorpacademy/update-node
git add package{,-lock}.json
git commit -m "Install update-node"
npm run update -- upgrade --local
git log --graph --decorate --pretty=oneline --abbrev-commit
npm run update -- auto-bump --local
git log --graph --decorate --pretty=oneline --abbrev-commit
