import { describe, expect, it } from '@jest/globals';
import { runSelfAoChallengeDiscovery } from '../../../src/challenge/self-ao';

describe('self AO challenge discovery', () => {
  it('marks explicit blocked pages as access_blocked', () => {
    const output = runSelfAoChallengeDiscovery({
      url: 'https://m.happymh.com/mangaread/example/1',
      html: '<h1>Sorry, you have been blocked</h1><p>You are unable to access happymh.com</p>',
    });

    expect(output.diagnosisMarkdown).toContain('Challenge Type: access_blocked');
    expect(output.candidateSource).toContain("ctx.challenge('access_blocked'");
  });
});
