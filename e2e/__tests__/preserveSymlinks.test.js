/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import runJest from '../runJest';

describe('a test with symlinks', () => {
  it('should work with --preserveSymlinks option', () => {
    const {status} = runJest('preserve-symlinks/child', [
      '--preserveSymlinks',
      '--no-watchman',
    ]);
    expect(status).toBe(0);
  });

  it('should NOT work without --preserveSymlinks option', () => {
    const {status} = runJest('preserve-symlinks/child', []);
    expect(status).toBe(1);
  });
});
