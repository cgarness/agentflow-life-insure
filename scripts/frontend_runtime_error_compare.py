"""Compare explicit Vitest completion evidence; permit removals, reject new runtime errors."""
from collections import Counter


def assert_no_new_test_failures(base, branch):
    """Resolved failures are improvements; a replacement or duplicate failure is not."""
    for kind, previous, current in zip(('suite', 'test'), base, branch, strict=True):
        added = Counter(current) - Counter(previous)
        assert not added, f'New Vitest {kind} failures against base: {dict(added)}'


def runtime_error_signatures(evidence, roots=()):
    if not isinstance(evidence, dict) or evidence.get('finished') is not True:
        raise ValueError('Runtime error run did not finish')
    if evidence.get('reason') not in ('passed', 'failed') or not isinstance(evidence.get('errors'), list):
        raise ValueError('Invalid runtime error evidence')
    signatures = Counter()
    for error in evidence['errors']:
        if not isinstance(error, dict) or not all(isinstance(error.get(k), str) for k in ('name', 'message')):
            raise ValueError('Invalid runtime error fingerprint')
        message = error['message']
        for root in roots:
            message = message.replace(str(root), '<ROOT>')
        signatures[(error['name'], message)] += 1
    return signatures


def selftest():
    failed = (['old.ts'], [('old.ts', 'existing test')])
    assert_no_new_test_failures(failed, failed)
    assert_no_new_test_failures(failed, ([], []))
    for regression in ((['replacement.ts'], []),
                       (['old.ts'], [('old.ts', 'replacement test')]),
                       (['old.ts', 'old.ts'], failed[1]),
                       (failed[0], failed[1] * 2)):
        try:
            assert_no_new_test_failures(failed, regression)
        except AssertionError:
            continue
        raise AssertionError('New/replacement/duplicate failures must be rejected')

    def done(*messages):
        return {'finished': True, 'reason': 'failed', 'errors': [{'name': 'Error', 'message': m} for m in messages]}

    baseline = runtime_error_signatures(done('old'))
    assert not (runtime_error_signatures(done()) - baseline), 'Removing an error must be allowed'
    assert not (runtime_error_signatures(done('old')) - baseline)
    assert runtime_error_signatures(done('replacement')) - baseline, 'Same count can hide a new error'
    assert runtime_error_signatures(done('old', 'old')) - baseline, 'Duplicate increases must fail'
    assert runtime_error_signatures(done('new')) - runtime_error_signatures(done()), 'New errors must fail'
    for malformed in ({}, {'finished': True}, {'finished': True, 'reason': 'failed', 'errors': None},
                      {'finished': True, 'reason': 'failed', 'errors': [{}]},
                      {'finished': True, 'reason': 'interrupted', 'errors': []}):
        try:
            runtime_error_signatures(malformed)
        except ValueError:
            continue
        raise AssertionError('Missing/malformed/interrupted evidence must fail closed')
    print('Runtime error comparison self-tests passed')


if __name__ == '__main__':
    selftest()
