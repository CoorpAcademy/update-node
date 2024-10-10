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
git init --initial-branch=master
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

PRE_COMMAND_FILE="$(mktemp -t precommand)"
POST_COMMAND_FILE="$(mktemp -t postcommand)"
# try a targeted bump with clean and extra command and token
echo "            " >> package.json
npm run update -- upgrade --local --target 20 \
  -fam "Beta test update-node major bump :scientist:" -R @Coorpacademy/development-mooc \
  --clean -p "echo before > $PRE_COMMAND_FILE" -P "echo after > $POST_COMMAND_FILE"
# note: cannot test so far with a real branch. should set up a local upstream

if ! git log --graph --decorate --pretty=oneline --abbrev-commit | grep -q "Upgrade Node to v20"; then
    echo "Seems like no commit was created while it wasn't supposed to"
    exit 2
fi
if  [[ ! -f $PRE_COMMAND_FILE ]]; then
    echo "Seems like pre command wasnt run"
    exit 2
fi
if  [[ ! -f $POST_COMMAND_FILE ]]; then
    echo "Seems like pre command wasnt run"
    exit 2
fi
rm -f $PRE_COMMAND_FILE $POST_COMMAND_FILE

git checkout init
