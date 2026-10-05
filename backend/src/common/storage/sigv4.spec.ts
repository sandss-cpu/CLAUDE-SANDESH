import { presignGet, signRequest } from './sigv4';

/** AWS's published Signature Version 4 examples for S3 (the "examplebucket" ones). */
const creds = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };
const at = new Date('2013-05-24T00:00:00Z');

describe('AWS Signature Version 4', () => {
  it('presigns a GET as in AWS’s query-string example', () => {
    const url = presignGet(new URL('https://examplebucket.s3.amazonaws.com/test.txt'), creds, 86400, at);
    expect(url).toContain('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request');
    expect(url.endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')).toBe(true);
  });

  it('signs a GET with headers as in AWS’s GET Object example', () => {
    const h = signRequest('GET', new URL('https://examplebucket.s3.amazonaws.com/test.txt'), creds, '', { Range: 'bytes=0-9' }, at);
    expect(h.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
      + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, '
      + 'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('signs a PUT with a body as in AWS’s PUT Object example', () => {
    const h = signRequest('PUT', new URL('https://examplebucket.s3.amazonaws.com/test$file.text'), creds, 'Welcome to Amazon S3.', {
      Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY',
    }, at);
    expect(h.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
      + 'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, '
      + 'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });
});
