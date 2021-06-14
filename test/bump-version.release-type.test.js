const test = require('ava');
const {mergeCustomKeywordsWithDefault, getBuiltInSelection} = require('../src/bump-version');

test('mergeCustomKeywords', t => {
  t.deepEqual(mergeCustomKeywordsWithDefault({patch: ['bigbug'], noop: ':see_no_evil:'}), {
    major: ['#major'],
    minor: ['#minor'],
    noop: ['#noop', '#no+(_|-|)release', ':see_no_evil:'],
    patch: ['#bug', '#fix', '#tweak', 'plugging', '#updates', 'bigbug']
  });
});

test('getBuiltInSelection custom-keyword', async t => {
  const config = {'custom-keywords': {patch: ['bigbug'], noop: ':see_no_evil:'}};
  t.is(await getBuiltInSelection(config, 'this is a #major commit'), 'major');
  t.is(await getBuiltInSelection(config, 'this is a no op so #noop'), 'noop');
  t.is(await getBuiltInSelection(config, 'this is a no match so minor as default'), 'minor');
});

test('getBuiltInSelection custom-keyword and custom order', async t => {
  const config = {
    'custom-keywords': {minor: ['#updates'], noop: ':see_no_evil:'},
    priority: ['minor', 'noop', 'patch']
  };
  t.is(await getBuiltInSelection(config, 'this is a #updates so minor with custom order'), 'minor');
  t.is(await getBuiltInSelection(config, 'this is a no op so #noop'), 'noop');
  t.is(
    await getBuiltInSelection(
      config,
      'this is a no match so patch as default according priority order'
    ),
    'patch'
  );
  t.is(
    await getBuiltInSelection(config, 'this is bit a #major commit, as not un prioties order'),
    'patch'
  );
});

test('getBuiltInSelection keyword and custom order', async t => {
  const config = {
    keywords: {minor: ['#updates'], noop: ':see_no_evil:', patch: '#bug'},
    priority: ['minor', 'noop', 'patch']
  };
  t.is(await getBuiltInSelection(config, '#fix is not a keyword so default'), 'patch');
  t.is(await getBuiltInSelection(config, '#noop is not a keyword so default'), 'patch');
  t.is(await getBuiltInSelection(config, ':see_no_evil:'), 'noop');
});
