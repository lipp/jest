/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as path from 'path';
import {Config, Global} from '@jest/types';
import {AssertionResult, TestResult} from '@jest/test-result';
import {JestEnvironment} from '@jest/environment';
import {SnapshotStateType} from 'jest-snapshot';
import Runtime = require('jest-runtime');

import {getCallsite} from '@jest/source-map';
import installEach from './each';
import {installErrorOnPrivate} from './errorOnPrivate';
import JasmineReporter from './reporter';
import jasmineAsyncInstall from './jasmineAsyncInstall';
import Spec from './jasmine/Spec';
import {Jasmine as JestJasmine} from './types';

const JASMINE = require.resolve('./jasmine/jasmineLight');

async function jasmine2(
  globalConfig: Config.GlobalConfig,
  config: Config.ProjectConfig,
  environment: JestEnvironment,
  runtime: Runtime,
  testPath: string,
): Promise<TestResult> {
  const reporter = new JasmineReporter(globalConfig, config, testPath);
  const jasmineFactory = runtime.requireInternalModule(JASMINE);
  const jasmine = jasmineFactory.create({
    process,
    testPath,
    testTimeout: globalConfig.testTimeout,
  });

  const env = jasmine.getEnv();
  const jasmineInterface = jasmineFactory.interface(jasmine, env);
  Object.assign(environment.global, jasmineInterface);
  env.addReporter(jasmineInterface.jsApiReporter);

  // TODO: Remove config option if V8 exposes some way of getting location of caller
  // in a future version
  if (config.testLocationInResults === true) {
    const originalIt = environment.global.it;
    environment.global.it = ((...args) => {
      const stack = getCallsite(1, runtime.getSourceMaps());
      const it = originalIt(...args);

      // @ts-ignore
      it.result.__callsite = stack;

      return it;
    }) as Global.Global['it'];

    const originalXit = environment.global.xit;
    environment.global.xit = ((...args) => {
      const stack = getCallsite(1, runtime.getSourceMaps());
      const xit = originalXit(...args);

      // @ts-ignore
      xit.result.__callsite = stack;

      return xit;
    }) as Global.Global['xit'];

    const originalFit = environment.global.fit;
    environment.global.fit = ((...args) => {
      const stack = getCallsite(1, runtime.getSourceMaps());
      const fit = originalFit(...args);

      // @ts-ignore
      fit.result.__callsite = stack;

      return fit;
    }) as Global.Global['fit'];
  }

  jasmineAsyncInstall(globalConfig, environment.global);

  installEach(environment);

  environment.global.test = environment.global.it;
  environment.global.it.only = environment.global.fit;
  environment.global.it.todo = env.todo;
  environment.global.it.skip = environment.global.xit;
  environment.global.xtest = environment.global.xit;
  environment.global.describe.skip = environment.global.xdescribe;
  environment.global.describe.only = environment.global.fdescribe;

  if (config.timers === 'fake') {
    environment.fakeTimers!.useFakeTimers();
  }

  env.beforeEach(() => {
    if (config.resetModules) {
      runtime.resetModules();
    }

    if (config.clearMocks) {
      runtime.clearAllMocks();
    }

    if (config.resetMocks) {
      runtime.resetAllMocks();

      if (config.timers === 'fake') {
        environment.fakeTimers!.useFakeTimers();
      }
    }

    if (config.restoreMocks) {
      runtime.restoreAllMocks();
    }
  });

  env.addReporter(reporter);

  runtime
    .requireInternalModule(path.resolve(__dirname, './jestExpect.js'))
    .default({
      expand: globalConfig.expand,
    });

  if (globalConfig.errorOnDeprecated) {
    installErrorOnPrivate(environment.global);
  } else {
    Object.defineProperty(jasmine, 'DEFAULT_TIMEOUT_INTERVAL', {
      configurable: true,
      enumerable: true,
      get() {
        return this._DEFAULT_TIMEOUT_INTERVAL;
      },
      set(value) {
        this._DEFAULT_TIMEOUT_INTERVAL = value;
      },
    });
  }

  const snapshotState: SnapshotStateType = runtime
    .requireInternalModule(path.resolve(__dirname, './setup_jest_globals.js'))
    .default({
      config,
      globalConfig,
      localRequire: runtime.requireModule.bind(runtime),
      testPath,
    });

  config.setupFilesAfterEnv.forEach((path: Config.Path) =>
    runtime.requireModule(path),
  );

  if (globalConfig.enabledTestsMap) {
    env.specFilter = (spec: Spec) => {
      const suiteMap =
        globalConfig.enabledTestsMap &&
        globalConfig.enabledTestsMap[spec.result.testPath];
      return suiteMap && suiteMap[spec.result.fullName];
    };
  } else if (globalConfig.testNamePattern) {
    const testNameRegex = new RegExp(globalConfig.testNamePattern, 'i');
    env.specFilter = (spec: Spec) => testNameRegex.test(spec.getFullName());
  }

  runtime.requireModule(testPath);
  await env.execute();

  const results = await reporter.getResults();

  return addSnapshotData(results, snapshotState);
}

const addSnapshotData = (
  results: TestResult,
  snapshotState: SnapshotStateType,
) => {
  results.testResults.forEach(({fullName, status}: AssertionResult) => {
    if (status === 'pending' || status === 'failed') {
      // if test is skipped or failed, we don't want to mark
      // its snapshots as obsolete.
      snapshotState.markSnapshotsAsCheckedForTest(fullName);
    }
  });

  const uncheckedCount = snapshotState.getUncheckedCount();
  const uncheckedKeys = snapshotState.getUncheckedKeys();

  if (uncheckedCount) {
    snapshotState.removeUncheckedKeys();
  }

  const status = snapshotState.save();
  results.snapshot.fileDeleted = status.deleted;
  results.snapshot.added = snapshotState.added;
  results.snapshot.matched = snapshotState.matched;
  results.snapshot.unmatched = snapshotState.unmatched;
  results.snapshot.updated = snapshotState.updated;
  results.snapshot.unchecked = !status.deleted ? uncheckedCount : 0;
  // Copy the array to prevent memory leaks
  results.snapshot.uncheckedKeys = Array.from(uncheckedKeys);

  return results;
};

// eslint-disable-next-line no-redeclare
namespace jasmine2 {
  export type Jasmine = JestJasmine;
}

export = jasmine2;
