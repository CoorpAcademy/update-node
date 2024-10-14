const test = require('ava');
const {patchVersionInServerlessYaml} = require('../src/updatees/serverless');

test('should replace nodejs top level version', t => {
  const yaml = `service: update-node serverless # with comments

plugins:
  - serverless-offline

provider:
  name: aws
  runtime: nodejs12.x
  region: eu-west-1

functions:
  nodish-lambda:
    name: nodish-lambda
    description: Node Lambda
    handler: lambda/maybe-some-node.handler
`;

  t.is(
    patchVersionInServerlessYaml('18.17.1')(yaml),
    `service: update-node serverless # with comments

plugins:
  - serverless-offline

provider:
  name: aws
  runtime: nodejs18.x
  region: eu-west-1

functions:
  nodish-lambda:
    name: nodish-lambda
    description: Node Lambda
    handler: lambda/maybe-some-node.handler
`
  );
});

test('should replace nodejs top function version', t => {
  const yaml = `service: update-node serverless # with comments

plugins:
  - serverless-offline

provider:
  name: aws
  region: eu-west-1

functions:
  nodish-lambda-default-runtime:
    name: nodish-default-lambda
    description: Node Lambda
    handler: lambda/maybe-some-node.handler
    runtime: nodejs14.x

  progression-completion:
    name: python-lambda
    handler: lambda/maybe-some-python.handler
    description: Python Lambda
    runtime: python3.8
`;

  t.is(
    patchVersionInServerlessYaml('18.17.1')(yaml),
    `service: update-node serverless # with comments

plugins:
  - serverless-offline

provider:
  name: aws
  region: eu-west-1

functions:
  nodish-lambda-default-runtime:
    name: nodish-default-lambda
    description: Node Lambda
    handler: lambda/maybe-some-node.handler
    runtime: nodejs18.x

  progression-completion:
    name: python-lambda
    handler: lambda/maybe-some-python.handler
    description: Python Lambda
    runtime: python3.8
`
  );
});
