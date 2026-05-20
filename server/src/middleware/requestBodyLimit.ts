import { bodyLimit } from 'hono/body-limit';

export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export const requestBodyLimit = bodyLimit({
  maxSize: MAX_REQUEST_BODY_BYTES,
  onError: (c) => {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  },
});
