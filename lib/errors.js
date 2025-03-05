class CloudflareBlockError extends Error {
  constructor(message = 'Request blocked by Cloudflare') {
    super(message);
    this.name = 'CloudflareBlockError';
  }
}

class AuthenticationError extends Error {
  constructor(message = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

class NotFoundError extends Error {
  constructor(word) {
    super(`Word "${word}" not found in KBBI`);
    this.name = 'NotFoundError';
  }
}

class RateLimitError extends Error {
  constructor(message = 'KBBI daily search limit reached. Try again tomorrow or use a different IP address.') {
    super(message);
    this.name = 'RateLimitError';
  }
}

module.exports = {
  CloudflareBlockError,
  AuthenticationError,
  NotFoundError,
  RateLimitError
}; 