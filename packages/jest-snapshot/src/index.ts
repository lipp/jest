/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as fs from 'fs';
import {Config} from '@jest/types';
import {FS as HasteFS} from 'jest-haste-map'; // eslint-disable-line import/no-extraneous-dependencies
import {MatcherState} from 'expect';

import {
  BOLD_WEIGHT,
  MatcherHintOptions,
  RECEIVED_COLOR,
  matcherHint,
} from 'jest-matcher-utils';
import {
  EXTENSION,
  SnapshotResolver as JestSnapshotResolver,
  buildSnapshotResolver,
  isSnapshotPath,
} from './snapshot_resolver';
import SnapshotState from './State';
import {addSerializer, getSerializers} from './plugins';
import {printDiffOrStringified} from './print';
import * as utils from './utils';

type Context = MatcherState & {
  snapshotState: SnapshotState;
};

type MatchSnapshotConfig = {
  context: Context;
  expectedArgument: string;
  hint?: string;
  inlineSnapshot?: string;
  matcherName: string;
  options: MatcherHintOptions;
  propertyMatchers?: any;
  received: any;
};

const DID_NOT_THROW = 'Received function did not throw'; // same as toThrow
const NOT_SNAPSHOT_MATCHERS = `.${BOLD_WEIGHT(
  'not',
)} cannot be used with snapshot matchers`;

const HINT_ARG = 'hint';
const HINT_COLOR = BOLD_WEIGHT;
const INLINE_SNAPSHOT_ARG = 'snapshot';
const PROPERTY_MATCHERS_ARG = 'properties';
const INDENTATION_REGEX = /^([^\S\n]*)\S/m;

// Display name in report when matcher fails same as in snapshot file,
// but with optional hint argument in bold weight.
const printName = (
  concatenatedBlockNames = '',
  hint = '',
  count: number,
): string => {
  const hasNames = concatenatedBlockNames.length !== 0;
  const hasHint = hint.length !== 0;

  return (
    '`' +
    (hasNames ? utils.escapeBacktickString(concatenatedBlockNames) : '') +
    (hasNames && hasHint ? ': ' : '') +
    (hasHint ? BOLD_WEIGHT(utils.escapeBacktickString(hint)) : '') +
    ' ' +
    count +
    '`'
  );
};

function stripAddedIndentation(inlineSnapshot: string) {
  // Find indentation if exists.
  const match = inlineSnapshot.match(INDENTATION_REGEX);
  if (!match || !match[1]) {
    // No indentation.
    return inlineSnapshot;
  }

  const indentation = match[1];
  const lines = inlineSnapshot.split('\n');
  if (lines.length <= 2) {
    // Must be at least 3 lines.
    return inlineSnapshot;
  }

  if (lines[0].trim() !== '' || lines[lines.length - 1].trim() !== '') {
    // If not blank first and last lines, abort.
    return inlineSnapshot;
  }

  for (let i = 1; i < lines.length - 1; i++) {
    if (lines[i] !== '') {
      if (lines[i].indexOf(indentation) !== 0) {
        // All lines except first and last should either be blank or have the same
        // indent as the first line (or more). If this isn't the case we don't
        // want to touch the snapshot at all.
        return inlineSnapshot;
      }

      lines[i] = lines[i].substr(indentation.length);
    }
  }

  // Last line is a special case because it won't have the same indent as others
  // but may still have been given some indent to line up.
  lines[lines.length - 1] = '';

  // Return inline snapshot, now at indent 0.
  inlineSnapshot = lines.join('\n');
  return inlineSnapshot;
}

const fileExists = (filePath: Config.Path, hasteFS: HasteFS): boolean =>
  hasteFS.exists(filePath) || fs.existsSync(filePath);

const cleanup = (
  hasteFS: HasteFS,
  update: Config.SnapshotUpdateState,
  snapshotResolver: JestSnapshotResolver,
  testPathIgnorePatterns?: Config.ProjectConfig['testPathIgnorePatterns'],
): {
  filesRemoved: number;
  filesRemovedList: Array<string>;
} => {
  const pattern = '\\.' + EXTENSION + '$';
  const files = hasteFS.matchFiles(pattern);
  let testIgnorePatternsRegex: RegExp | null = null;
  if (testPathIgnorePatterns && testPathIgnorePatterns.length > 0) {
    testIgnorePatternsRegex = new RegExp(testPathIgnorePatterns.join('|'));
  }

  const list = files.filter(snapshotFile => {
    const testPath = snapshotResolver.resolveTestPath(snapshotFile);

    // ignore snapshots of ignored tests
    if (testIgnorePatternsRegex && testIgnorePatternsRegex.test(testPath)) {
      return false;
    }

    if (!fileExists(testPath, hasteFS)) {
      if (update === 'all') {
        fs.unlinkSync(snapshotFile);
      }
      return true;
    }

    return false;
  });

  return {
    filesRemoved: list.length,
    filesRemovedList: list,
  };
};

const toMatchSnapshot = function(
  this: Context,
  received: any,
  propertyMatchers?: any,
  hint?: Config.Path,
) {
  const matcherName = 'toMatchSnapshot';
  let expectedArgument = '';
  let secondArgument = '';

  if (typeof propertyMatchers === 'object' && propertyMatchers !== null) {
    expectedArgument = PROPERTY_MATCHERS_ARG;
    if (typeof hint === 'string' && hint.length !== 0) {
      secondArgument = HINT_ARG;
    }
  } else if (
    typeof propertyMatchers === 'string' &&
    propertyMatchers.length !== 0
  ) {
    expectedArgument = HINT_ARG;
  }

  const options: MatcherHintOptions = {
    isNot: this.isNot,
    promise: this.promise,
    secondArgument,
  };

  if (expectedArgument === HINT_ARG) {
    options.expectedColor = HINT_COLOR;
  }
  if (secondArgument === HINT_ARG) {
    options.secondArgumentColor = HINT_COLOR;
  }

  if (arguments.length === 3 && !propertyMatchers) {
    throw new Error(
      'Property matchers must be an object.\n\nTo provide a snapshot test name without property matchers, use: toMatchSnapshot("name")',
    );
  }

  return _toMatchSnapshot({
    context: this,
    expectedArgument,
    hint,
    matcherName,
    options,
    propertyMatchers,
    received,
  });
};

const toMatchInlineSnapshot = function(
  this: Context,
  received: any,
  propertyMatchersOrInlineSnapshot?: any,
  inlineSnapshot?: string,
) {
  const matcherName = 'toMatchInlineSnapshot';
  let expectedArgument = '';
  let secondArgument = '';

  if (typeof propertyMatchersOrInlineSnapshot === 'string') {
    expectedArgument = INLINE_SNAPSHOT_ARG;
  } else if (
    typeof propertyMatchersOrInlineSnapshot === 'object' &&
    propertyMatchersOrInlineSnapshot !== null
  ) {
    expectedArgument = PROPERTY_MATCHERS_ARG;
    if (typeof inlineSnapshot === 'string') {
      secondArgument = INLINE_SNAPSHOT_ARG;
    }
  }

  const options: MatcherHintOptions = {
    isNot: this.isNot,
    promise: this.promise,
    secondArgument,
  };

  let propertyMatchers;
  if (typeof propertyMatchersOrInlineSnapshot === 'string') {
    inlineSnapshot = propertyMatchersOrInlineSnapshot;
  } else {
    propertyMatchers = propertyMatchersOrInlineSnapshot;
  }

  return _toMatchSnapshot({
    context: this,
    expectedArgument,
    inlineSnapshot: stripAddedIndentation(inlineSnapshot || ''),
    matcherName,
    options,
    propertyMatchers,
    received,
  });
};

const _toMatchSnapshot = ({
  context,
  expectedArgument,
  hint,
  inlineSnapshot,
  matcherName,
  options,
  propertyMatchers,
  received,
}: MatchSnapshotConfig) => {
  context.dontThrow && context.dontThrow();
  hint = typeof propertyMatchers === 'string' ? propertyMatchers : hint;

  const {currentTestName, isNot, snapshotState} = context;

  if (isNot) {
    throw new Error(
      matcherHint(matcherName, undefined, expectedArgument, options) +
        '\n\n' +
        NOT_SNAPSHOT_MATCHERS,
    );
  }

  if (!snapshotState) {
    throw new Error(
      matcherHint(matcherName, undefined, expectedArgument, options) +
        '\n\nsnapshot state must be initialized',
    );
  }

  const fullTestName =
    currentTestName && hint
      ? `${currentTestName}: ${hint}`
      : currentTestName || ''; // future BREAKING change: || hint

  if (typeof propertyMatchers === 'object') {
    if (propertyMatchers === null) {
      throw new Error(`Property matchers must be an object.`);
    }
    const propertyPass = context.equals(received, propertyMatchers, [
      context.utils.iterableEquality,
      context.utils.subsetEquality,
    ]);

    if (!propertyPass) {
      const key = snapshotState.fail(fullTestName, received);
      const matched = /(\d+)$/.exec(key);
      const count = matched === null ? 1 : Number(matched[1]);

      const report = () =>
        `Snapshot name: ${printName(currentTestName, hint, count)}\n` +
        '\n' +
        `Expected properties: ${context.utils.printExpected(
          propertyMatchers,
        )}\n` +
        `Received value:      ${context.utils.printReceived(received)}`;

      return {
        message: () =>
          matcherHint(matcherName, undefined, expectedArgument, options) +
          '\n\n' +
          report(),
        name: matcherName,
        pass: false,
        report,
      };
    } else {
      received = utils.deepMerge(received, propertyMatchers);
    }
  }

  const result = snapshotState.match({
    error: context.error,
    inlineSnapshot,
    received,
    testName: fullTestName,
  });
  const {count, pass} = result;
  let {actual, expected} = result;

  let report: () => string;
  if (pass) {
    return {message: () => '', pass: true};
  } else if (!expected) {
    report = () =>
      `New snapshot was ${RECEIVED_COLOR('not written')}. The update flag ` +
      `must be explicitly passed to write a new snapshot.\n\n` +
      `This is likely because this test is run in a continuous integration ` +
      `(CI) environment in which snapshots are not written by default.\n\n` +
      `${RECEIVED_COLOR('Received value')} ` +
      `${actual}`;
  } else {
    expected = utils.removeExtraLineBreaks(expected || '');
    actual = utils.removeExtraLineBreaks(actual || '');

    // Assign to local variable because of declaration let expected:
    // TypeScript thinks it could change before report function is called.
    const printed = printDiffOrStringified(
      expected,
      actual,
      received,
      'Snapshot',
      'Received',
      snapshotState.expand,
    );

    report = () =>
      `Snapshot name: ${printName(currentTestName, hint, count)}\n\n` + printed;
  }

  // Passing the actual and expected objects so that a custom reporter
  // could access them, for example in order to display a custom visual diff,
  // or create a different error message
  return {
    actual,
    expected,
    message: () =>
      matcherHint(matcherName, undefined, expectedArgument, options) +
      '\n\n' +
      report(),
    name: matcherName,
    pass: false,
    report,
  };
};

const toThrowErrorMatchingSnapshot = function(
  this: Context,
  received: any,
  hint: string | undefined, // because error TS1016 for hint?: string
  fromPromise: boolean,
) {
  const matcherName = 'toThrowErrorMatchingSnapshot';
  const expectedArgument =
    typeof hint === 'string' && hint.length !== 0 ? HINT_ARG : '';
  const options = {
    expectedColor: HINT_COLOR,
    isNot: this.isNot,
    promise: this.promise,
    secondArgument: '',
  };

  return _toThrowErrorMatchingSnapshot(
    {
      context: this,
      expectedArgument,
      hint,
      matcherName,
      options,
      received,
    },
    fromPromise,
  );
};

const toThrowErrorMatchingInlineSnapshot = function(
  this: Context,
  received: any,
  inlineSnapshot?: string,
  fromPromise?: boolean,
) {
  const matcherName = 'toThrowErrorMatchingInlineSnapshot';
  const expectedArgument =
    typeof inlineSnapshot === 'string' ? INLINE_SNAPSHOT_ARG : '';
  const options: MatcherHintOptions = {
    isNot: this.isNot,
    promise: this.promise,
    secondArgument: '',
  };

  return _toThrowErrorMatchingSnapshot(
    {
      context: this,
      expectedArgument,
      inlineSnapshot: inlineSnapshot || '',
      matcherName,
      options,
      received,
    },
    fromPromise,
  );
};

const _toThrowErrorMatchingSnapshot = (
  {
    context,
    expectedArgument,
    inlineSnapshot,
    matcherName,
    options,
    received,
    hint,
  }: MatchSnapshotConfig,
  fromPromise?: boolean,
) => {
  context.dontThrow && context.dontThrow();
  const {isNot} = context;

  if (isNot) {
    throw new Error(
      matcherHint(matcherName, undefined, expectedArgument, options) +
        '\n\n' +
        NOT_SNAPSHOT_MATCHERS,
    );
  }

  let error;

  if (fromPromise) {
    error = received;
  } else {
    try {
      received();
    } catch (e) {
      error = e;
    }
  }

  if (error === undefined) {
    throw new Error(
      matcherHint(matcherName, undefined, expectedArgument, options) +
        '\n\n' +
        DID_NOT_THROW,
    );
  }

  return _toMatchSnapshot({
    context,
    expectedArgument,
    hint,
    inlineSnapshot,
    matcherName,
    options,
    received: error.message,
  });
};

const JestSnapshot = {
  EXTENSION,
  SnapshotState,
  addSerializer,
  buildSnapshotResolver,
  cleanup,
  getSerializers,
  isSnapshotPath,
  toMatchInlineSnapshot,
  toMatchSnapshot,
  toThrowErrorMatchingInlineSnapshot,
  toThrowErrorMatchingSnapshot,
  utils,
};
/* eslint-disable-next-line no-redeclare */
namespace JestSnapshot {
  export type SnapshotResolver = JestSnapshotResolver;
  export type SnapshotStateType = SnapshotState;
}

export = JestSnapshot;
