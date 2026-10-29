const test = require('ava').default;
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

test('independent stable-major updates each start with fresh YAML offsets', t => {
  const yaml = 'language: node_js\nnode_js:\n  - 22.12.0\n# Preserve this comment\n';
  for (const version of ['22.23.4', '24.22.2', '26.13.0']) {
    t.is(patchVersionInTravisYaml(version)(yaml), yaml.replace('22.12.0', version));
  }
});
