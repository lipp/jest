/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import prettyFormat = require('pretty-format');
import chalk from 'chalk';
import getType = require('jest-get-type');
import {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
  Diff as DiffClass,
} from './cleanupSemantic';
import diffLines from './diffLines';
import {normalizeDiffOptions} from './normalizeDiffOptions';
import {diffStringsRaw, diffStringsUnified} from './printDiffs';
import {NO_DIFF_MESSAGE, SIMILAR_MESSAGE} from './constants';
import {DiffOptionsNormalized, DiffOptions as JestDiffOptions} from './types';

const {
  AsymmetricMatcher,
  DOMCollection,
  DOMElement,
  Immutable,
  ReactElement,
  ReactTestComponent,
} = prettyFormat.plugins;

const PLUGINS = [
  ReactTestComponent,
  ReactElement,
  DOMElement,
  DOMCollection,
  Immutable,
  AsymmetricMatcher,
];
const FORMAT_OPTIONS = {
  plugins: PLUGINS,
};
const FORMAT_OPTIONS_0 = {...FORMAT_OPTIONS, indent: 0};
const FALLBACK_FORMAT_OPTIONS = {
  callToJSON: false,
  maxDepth: 10,
  plugins: PLUGINS,
};
const FALLBACK_FORMAT_OPTIONS_0 = {...FALLBACK_FORMAT_OPTIONS, indent: 0};

// Generate a string that will highlight the difference between two values
// with green and red. (similar to how github does code diffing)
function diff(a: any, b: any, options?: JestDiffOptions): string | null {
  if (Object.is(a, b)) {
    return NO_DIFF_MESSAGE;
  }

  const aType = getType(a);
  let expectedType = aType;
  let omitDifference = false;
  if (aType === 'object' && typeof a.asymmetricMatch === 'function') {
    if (a.$$typeof !== Symbol.for('jest.asymmetricMatcher')) {
      // Do not know expected type of user-defined asymmetric matcher.
      return null;
    }
    if (typeof a.getExpectedType !== 'function') {
      // For example, expect.anything() matches either null or undefined
      return null;
    }
    expectedType = a.getExpectedType();
    // Primitive types boolean and number omit difference below.
    // For example, omit difference for expect.stringMatching(regexp)
    omitDifference = expectedType === 'string';
  }

  if (expectedType !== getType(b)) {
    return (
      '  Comparing two different types of values.' +
      ` Expected ${chalk.green(expectedType)} but ` +
      `received ${chalk.red(getType(b))}.`
    );
  }

  if (omitDifference) {
    return null;
  }

  const optionsNormalized = normalizeDiffOptions(options);
  switch (aType) {
    case 'string':
      return diffLines(a, b, optionsNormalized);
    case 'boolean':
    case 'number':
      return comparePrimitive(a, b, optionsNormalized);
    case 'map':
      return compareObjects(sortMap(a), sortMap(b), optionsNormalized);
    case 'set':
      return compareObjects(sortSet(a), sortSet(b), optionsNormalized);
    default:
      return compareObjects(a, b, optionsNormalized);
  }
}

function comparePrimitive(
  a: number | boolean,
  b: number | boolean,
  options: DiffOptionsNormalized,
) {
  return diffLines(
    prettyFormat(a, FORMAT_OPTIONS),
    prettyFormat(b, FORMAT_OPTIONS),
    options,
  );
}

function sortMap(map: Map<unknown, unknown>) {
  return new Map(Array.from(map.entries()).sort());
}

function sortSet(set: Set<unknown>) {
  return new Set(Array.from(set.values()).sort());
}

function compareObjects(
  a: Record<string, any>,
  b: Record<string, any>,
  options: DiffOptionsNormalized,
) {
  let diffMessage;
  let hasThrown = false;

  try {
    diffMessage = diffLines(
      prettyFormat(a, FORMAT_OPTIONS_0),
      prettyFormat(b, FORMAT_OPTIONS_0),
      options,
      {
        a: prettyFormat(a, FORMAT_OPTIONS),
        b: prettyFormat(b, FORMAT_OPTIONS),
      },
    );
  } catch (e) {
    hasThrown = true;
  }

  // If the comparison yields no results, compare again but this time
  // without calling `toJSON`. It's also possible that toJSON might throw.
  if (!diffMessage || diffMessage === NO_DIFF_MESSAGE) {
    diffMessage = diffLines(
      prettyFormat(a, FALLBACK_FORMAT_OPTIONS_0),
      prettyFormat(b, FALLBACK_FORMAT_OPTIONS_0),
      options,
      {
        a: prettyFormat(a, FALLBACK_FORMAT_OPTIONS),
        b: prettyFormat(b, FALLBACK_FORMAT_OPTIONS),
      },
    );
    if (diffMessage !== NO_DIFF_MESSAGE && !hasThrown) {
      diffMessage = SIMILAR_MESSAGE + '\n\n' + diffMessage;
    }
  }

  return diffMessage;
}

// eslint-disable-next-line no-redeclare
namespace diff {
  export type Diff = DiffClass;
  export type DiffOptions = JestDiffOptions;
}

diff.diffStringsUnified = diffStringsUnified;
diff.diffStringsRaw = diffStringsRaw;
diff.DIFF_DELETE = DIFF_DELETE;
diff.DIFF_EQUAL = DIFF_EQUAL;
diff.DIFF_INSERT = DIFF_INSERT;

export = diff;
