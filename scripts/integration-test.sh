#!/bin/bash

set -e
echo "> Linking update-node"
npm link
echo

cd test/integration
if [ -d .git ]; then
    echo "> Reset integration folder"
    git reset --hard init || true
    rm -rf .git
fi

echo "> Setting up integration folder"
git init
git add .
git commit -m "Initial dummy commit"
git tag init
npm install
echo "> Install update node"
npm install --save-dev @coorpacademy/update-node
git add package.json package-lock.json
git commit -m "Install update-node"

echo "> Running update-node commands"
npm run update -- upgrade --local
git --no-pager log --graph --decorate --pretty=oneline --abbrev-commit
npm run update -- auto-bump --local
git --no-pager log --graph --decorate --pretty=oneline --abbrev-commit

git checkout  -b origins init
