import foo from '../shared/foo';
import bar from '../bar';

describe('preserveSymlinks options', () => {
  it('should allow to use symlinked directories in test', () => {
    expect(foo.foo).toEqual('bar');
  });

  it('should allow to use symlinked files in test', () => {
    expect(bar).toEqual('super-bar');
  });
});
