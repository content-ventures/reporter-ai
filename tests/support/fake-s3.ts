import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

type StoredObject = { body: Buffer; contentType: string; etag: string };
type Upload = { bucket: string; key: string; contentType: string; parts: Map<number, { body: Buffer; etag: string }> };

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>${body}`;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const etagOf = (body: Buffer) => `"${createHash('md5').update(body).digest('hex')}"`;

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * A loopback S3 for the cloud rehearsal: path-style buckets, multipart uploads, presigned
 * part PUTs, HEAD, ranged GET, PutObject and bucket CORS reads. Signatures are not checked;
 * the real storage contract is exercised on staging.
 */
export async function startFakeS3(options: { bucket: string; corsOrigins: string[] }) {
  const objects = new Map<string, StoredObject>(), uploads = new Map<string, Upload>();
  const requests: string[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://fake-s3');
    const [, bucket = '', ...rest] = url.pathname.split('/');
    const key = decodeURIComponent(rest.join('/'));
    const id = `${bucket}/${key}`;
    const method = request.method ?? 'GET';
    requests.push(`${method} ${url.pathname}${url.search ? '?' + [...url.searchParams.keys()].join('&') : ''}`);
    const send = (status: number, body = '', headers: Record<string, string> = {}) => {
      response.writeHead(status, { 'content-type': 'application/xml', ...headers }); response.end(body);
    };
    if (bucket !== options.bucket) return send(404, xml('<Error><Code>NoSuchBucket</Code></Error>'));
    const origin=request.headers.origin;
    if(origin&&options.corsOrigins.includes(origin)){
      response.setHeader('access-control-allow-origin',origin);response.setHeader('vary','Origin');response.setHeader('access-control-expose-headers','ETag');
    }
    if(method==='OPTIONS'){
      if(!origin||!options.corsOrigins.includes(origin)||request.headers['access-control-request-method']!=='PUT')return send(403);
      return send(204,'',{'access-control-allow-methods':'PUT','access-control-allow-headers':'*','access-control-max-age':'3600'});
    }

    if (!key && method === 'GET' && url.searchParams.has('cors')) {
      const rules = `<CORSRule>${options.corsOrigins.map(origin => `<AllowedOrigin>${escape(origin)}</AllowedOrigin>`).join('')}`
        + '<AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule>';
      return send(200, xml(`<CORSConfiguration>${rules}</CORSConfiguration>`));
    }
    if (method === 'POST' && url.searchParams.has('uploads')) {
      const uploadId = randomUUID();
      uploads.set(uploadId, { bucket, key, contentType: request.headers['content-type'] ?? 'application/octet-stream', parts: new Map() });
      return send(200, xml(`<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${escape(key)}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`));
    }
    const uploadId = url.searchParams.get('uploadId');
    if (uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.key !== key) return send(404, xml('<Error><Code>NoSuchUpload</Code></Error>'));
      if (method === 'PUT') {
        const body = await readBody(request), etag = etagOf(body);
        upload.parts.set(Number(url.searchParams.get('partNumber')), { body, etag });
        return send(200, '', { etag });
      }
      if (method === 'GET') {
        const parts = [...upload.parts.entries()].sort(([a], [b]) => a - b)
          .map(([number, part]) => `<Part><PartNumber>${number}</PartNumber><ETag>${escape(part.etag)}</ETag><Size>${part.body.length}</Size></Part>`).join('');
        return send(200, xml(`<ListPartsResult><Bucket>${bucket}</Bucket><Key>${escape(key)}</Key><UploadId>${uploadId}</UploadId><IsTruncated>false</IsTruncated>${parts}</ListPartsResult>`));
      }
      if (method === 'POST') {
        await readBody(request);
        const body = Buffer.concat([...upload.parts.entries()].sort(([a], [b]) => a - b).map(([, part]) => part.body));
        const etag = etagOf(body);
        objects.set(id, { body, contentType: upload.contentType, etag });
        uploads.delete(uploadId);
        return send(200, xml(`<CompleteMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${escape(key)}</Key><ETag>${escape(etag)}</ETag></CompleteMultipartUploadResult>`));
      }
      if (method === 'DELETE') { uploads.delete(uploadId); return send(204); }
    }
    if (method === 'PUT') {
      const body = await readBody(request), etag = etagOf(body);
      objects.set(id, { body, contentType: request.headers['content-type'] ?? 'application/octet-stream', etag });
      return send(200, '', { etag });
    }
    const object = objects.get(id);
    if (!object) return send(404, xml('<Error><Code>NoSuchKey</Code></Error>'));
    const headers = { 'content-type': object.contentType, etag: object.etag, 'accept-ranges': 'bytes' };
    if (method === 'HEAD') { response.writeHead(200, { ...headers, 'content-length': String(object.body.length) }); return response.end(); }
    if (method === 'GET') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
      if (!range) { response.writeHead(200, { ...headers, 'content-length': String(object.body.length) }); return response.end(object.body); }
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : object.body.length - 1, object.body.length - 1);
      if (start >= object.body.length) { response.writeHead(416, { 'content-range': `bytes */${object.body.length}` }); return response.end(); }
      response.writeHead(206, { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${object.body.length}` });
      return response.end(object.body.subarray(start, end + 1));
    }
    return send(405);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    endpoint, objects, requests,
    stop: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
