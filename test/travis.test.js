const test = require('ava');
const {patchVersionInTravisYaml} = require('../src/updatees/travis');

test('should replace nodejs version', t => {
  const yaml = `language: node_js # dummy travis
node_js:
  - 18.0.0
# This is here to show comment is preserved
anchor: &npm npm
cache: *npm
install: npm ci
script:
  - npm test
`;

  const actual = patchVersionInTravisYaml('18.17.1')(yaml);

  const expected = `language: node_js # dummy travis
node_js:
  - 18.17.1
# This is here to show comment is preserved
anchor: &npm npm
cache: *npm
install: npm ci
script:
  - npm test
`;

  t.is(actual, expected);
});
