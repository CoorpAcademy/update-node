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

# try a targeted bump with clean and extra command and token
echo "\n\n\n" >> package.json
npm run update -- upgrade --local --target 20 \
  -fam "Beta test update-node major bump :scientist:" -R @Coorpacademy/development-mooc \
  --clean -p "echo before > .precommand" -P "echo after > .postcommand"

current_branch=$(git branch --show-current)
if  [[ $current_branch == "master" ]]; then
    exit 2;
fi
if  [[ $current_commit == "$(git rev-parse HEAD)" ]]; then
    echo "Seems like no commit was created while it wasn't supposed to"
    exit 2
fi
if  [[ ! -f .precommand ]]; then
    echo "Seems like pre command wasnt run"
    exit 2
fi
if  [[ ! -f .postcommand ]]; then
    echo "Seems like pre command wasnt run"
    exit 2
fi
rm -f .precommand .postcommand

git checkout -b origins init
git branch -d $current_branch
