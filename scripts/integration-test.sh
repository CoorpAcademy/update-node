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

# Try the noop feature
git commit --allow-empty -m "Commit nope results. #noop"
current_commit="$(git rev-parse HEAD)"
npm run update -- auto-bump --local
if  [[ $current_commit != "$(git rev-parse HEAD)" ]]; then
    echo "Seems like a commit was created while it wasn't supposed to"
    exit 2
fi
git --no-pager log --graph --decorate --pretty=oneline --abbrev-commit

git checkout -b origins init
