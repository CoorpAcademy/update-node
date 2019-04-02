const test = require('ava');
const {__listDependencies} = require('../src/updatees/yarn');

const packageFixture = {
  dependencies: {
    foo1: '^1.0.0',
    foo2: '^1.0.0',
    foo3: '^1.0.0'
  },
  devDependencies: {
    bar1: '^1.0.0',
    bar2: '^1.0.0',
    bar3: '^1.0.0'
  }
};

test('should return empty array when dependencies is empty', t => {
  t.deepEqual([], __listDependencies(true, packageFixture, ['bar3'], []));
  t.deepEqual([], __listDependencies(false, packageFixture, ['bar3'], []));
});

test('should return intersection of requested dependencies and package dependencies if requested non-dev dependencies', t => {
  t.deepEqual(
    ['foo1', 'foo2'].sort(),
    __listDependencies(false, packageFixture, ['bar3'], ['foo1', 'foo2', 'bar1', 'bar2'])
  );
});

test('should return intersection of requested dependencies and package devDependencies if requested dev dependencies', t => {
  t.deepEqual(
    ['bar1', 'bar2'].sort(),
    __listDependencies(true, packageFixture, ['bar3'], ['foo1', 'foo2', 'bar1', 'bar2'])
  );
});

test('should remove blacklisted dependencies from the result', t => {
  t.deepEqual(
    ['foo1'].sort(),
    __listDependencies(false, packageFixture, ['foo2'], ['foo1', 'foo2', 'bar1', 'bar2'])
  );
  t.deepEqual(
    ['bar1'].sort(),
    __listDependencies(true, packageFixture, ['bar2'], ['foo1', 'foo2', 'bar1', 'bar2'])
  );
});
