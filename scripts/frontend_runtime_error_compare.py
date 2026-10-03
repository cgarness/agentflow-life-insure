"""Compare explicit Vitest completion evidence; permit removals, reject new runtime errors."""
from collections import Counter


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
