"use strict";

function requestError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

// A loopback listener alone does not prevent requests from hostile websites or
// DNS rebinding. Keep browser access same-origin; local CLI clients need no token.
function assertLocalRequest(req) {
  const host = req.headers.host;
  if (typeof host !== "string" || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)) {
    throw requestError("Only loopback hosts may access this workbench.", 403, "invalid_host");
  }
  const expected = new URL(`http://${host}`);
  if (Number(expected.port || 80) !== req.socket.localPort) {
    throw requestError("Host port does not match this workbench.", 403, "invalid_host");
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== expected.origin) {
    throw requestError("Cross-origin access to this workbench is not allowed.", 403, "invalid_origin");
  }
  if (req.headers["sec-fetch-site"] === "cross-site") {
    throw requestError("Cross-site access to this workbench is not allowed.", 403, "invalid_origin");
  }
}

function readRequestBody(req, limit = 256 * 1024 * 1024) {
  if (req.workbenchBody !== undefined) return Promise.resolve(req.workbenchBody);
  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    let chunks = [];
    const fail = (error) => {
      if (failed) return;
      failed = true;
      chunks = [];
      reject(error);
    };
    req.on("data", (chunk) => {
      if (failed) return;
      size += Buffer.byteLength(chunk);
      if (size > limit) return fail(requestError("Request body is too large.", 413, "body_too_large"));
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => { if (!failed) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", fail);
    req.on("aborted", () => fail(requestError("Request body was interrupted.", 400, "request_aborted")));
    // Reject known oversized requests before retaining any upload data. Continue
    // draining the stream so the caller can return a readable 413 response.
    if (Number(req.headers["content-length"]) > limit) {
      fail(requestError("Request body is too large.", 413, "body_too_large"));
    }
  });
}

module.exports = { assertLocalRequest, readRequestBody };
