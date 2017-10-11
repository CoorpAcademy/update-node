# Update node

[![Build Status](https://travis-ci.org/CoorpAcademy/update-node.svg?branch=master)](https://travis-ci.org/CoorpAcademy/update-node)

```bash
$ update-node [options]

  Options
    --package [FILE[,FILE]]         Update package's engine.node & engine.npm
    --nvmrc [FILE[,FILE]]           Update nvmrc's node version
    --dockerfile [FILE[,FILE]]      Update dockerfile's base image

    --branch                        Set branch's name to push
    --message                       Set commit & pull request message

    --repo_slug                     Set repo slug
    --github_token [TOKEN]          Set github token to use to create pull request
    --base [BRANCH_NAME]            Set pull request's base branch
    --reviewers [USER[,USER]]       Assign pull request to user
    --team_reviewers [TEAM[,TEAM]]  Assign pull request to team

    --dependencies                  Update dependencies with yarn
    --dev_dependencies              Update devDependencies with yarn

  Examples
    update-node --package ./package.json --dockerfiles ./Dockerfile,./test/Dockerfile --nvmrc ./nvmrc --branch update-node --message "Upgrade NODEJS" --repo_slug CoorpAcademy/update-node --github_token $GH_TOKEN --base master --reviewers CoorpAcademy --team_reviewers dev,reviewers --dependencies lodash --dev_dependencies mocha
```
